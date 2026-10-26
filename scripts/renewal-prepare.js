#!/usr/bin/env node
// Prepare a renewal, read-only: the evidence health of the bound release, the renewal
// stages with their verified state, the next revision derived from the registry, the
// pending-transaction state of the signing accounts, and, when a successor report exists
// in public/reports, the successor consumer configuration with a diff. Nothing is signed
// or sent; the commands printed are the dry-run forms of the existing guarded scripts.
//
//   node scripts/renewal-prepare.js [--config examples/token-catalog/config/testnet-v2.json] [--consumer <consumer config>]
//                                   [--capture <inputs.json>] [--now <ISO>] [--freeze 2026-11-06T04:00:00Z] [--planned <ISO>] [--out artifacts/local/renewal]
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { evidenceHealth, renewalPlan, successorReports, successorConsumerConfig, diffConsumerConfigs } from '../lib/health.js';
import { normalizeConfig, classifyBindings, latestBinding } from '../examples/token-catalog/lib/catalog.js';
import { verifyRun } from '../lib/report.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { config: { type: 'string', default: 'examples/token-catalog/config/testnet-v2.json' }, consumer: { type: 'string' }, capture: { type: 'string' }, now: { type: 'string' }, freeze: { type: 'string', default: '2026-11-06T04:00:00.000Z' }, planned: { type: 'string' }, out: { type: 'string', default: 'artifacts/local/renewal' } } });
const resolve = (file) => path.isAbsolute(file) ? file : path.resolve(root, file);
const readJson = async (file) => JSON.parse(await readFile(resolve(file), 'utf8'));
const optional = async (file) => { try { return await readJson(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const writeJson = async (file, value) => { await mkdir(path.dirname(resolve(file)), { recursive: true }); await writeFile(resolve(file), `${JSON.stringify(value, null, 2)}\n`); return path.relative(root, resolve(file)); };

const config = normalizeConfig(await readJson(values.config));
const { current } = classifyBindings((await optional(path.join(config.data, 'bindings.json')))?.bindings || [], config);
const binding = latestBinding(current, config.policy.subject.address);
if (!binding) throw new Error('No binding under the current policy; nothing to renew.');
const report = await readJson(path.join(config.reports ?? 'public/reports', `${binding.reportHash}.json`));
if (!verifyRun(report)) throw new Error('The bound report does not verify.');
const reports = [];
for (const file of (await readdir(resolve(config.reports ?? 'public/reports'))).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) { const item = await optional(path.join(config.reports ?? 'public/reports', file)); if (item) reports.push(item); }
const owner = await optional('docs/WALLET_PUBLIC.json');
const reviewer = await optional('docs/REVIEWER_WALLET_PUBLIC.json');

let registry, listing, observation, subject = null, storage = null, pendingSends = [], source;
if (values.capture) {
  const capture = await readJson(values.capture);
  const token = capture.tokens?.[config.policy.subject.address];
  if (!token) throw new Error(`The capture has no reads for ${config.policy.subject.address}.`);
  ({ registry, listing, observation } = token);
  subject = token.subject ?? null;
  source = `capture ${values.capture} (replayed reads: they establish recorded behavior, not present signing readiness; pending sends not read offline)`;
} else {
  const service = await import('../lib/service.js');
  const chain = await import('../lib/chain.js');
  try {
    const inputs = await service.collectPolicyInputs({ policy: config.policy, binding });
    ({ registry, listing, observation } = inputs);
    subject = inputs.subject ?? null;
    const candidates = successorReports(reports, { binding, report, policy: config.policy, now: values.now ?? new Date() });
    if (candidates.length && config.policy.evidence.requireStoredOnChain) {
      // A recorded store is retrieved from chain data and verified by content hash; a successor with no recorded store is a pending stage, not an unknown one.
      const stored = (await optional('public/lifecycle/evidence.json'))?.items?.find((item) => item.reportHash === candidates[0].reportHash);
      storage = stored ? await service.retrieveEvidence({ extrinsicHash: stored.extrinsicHash, blockHash: stored.blockHash, expectedHash: candidates[0].reportHash }).catch((error) => ({ error: error.message })) : { notRecorded: true, reason: 'the successor report is not in public/lifecycle/evidence.json; store it first (a store is a send: check the pending-send state before it)' };
    }
    // Pending sends: the pool's next index against the account nonce, for both signing accounts. A difference is a stop condition.
    pendingSends = await service.withNetwork(chain.NETWORK ? { ...chain.NETWORK, key: 'testnet' } : null, async ({ api }) => {
      const out = [];
      for (const [role, record] of [['owner', owner], ['reviewer', reviewer]]) {
        if (!record?.ss58Address) continue;
        const account = await api.query.system.account(record.ss58Address);
        const next = (await api.rpc.system.accountNextIndex(record.ss58Address)).toNumber();
        out.push({ role, address: record.ss58Address, nonce: account.nonce.toNumber(), nextIndex: next, pending: next - account.nonce.toNumber() });
      }
      return out;
    }).catch((error) => [{ role: 'unknown', address: 'both accounts', pending: 1, error: `the pending-send check could not be made: ${error.message}` }]);
    source = 'live reads through lib/service.js';
  } finally { await service.closeConnections(); }
}
const now = values.now ?? new Date().toISOString();
const health = evidenceHealth({ policy: config.policy, binding, report, registry, listing, observation, subject, reports, now, freezeAt: values.freeze, plannedRenewalAt: values.planned ?? null });
const successorHash = health.successors[0]?.reportHash ?? null;
const successor = successorHash ? reports.find((item) => item.evidenceHash === successorHash) : null;
const plan = renewalPlan({ policy: config.policy, binding, report, successor, storage, registry, listing, subject, observation, bindings: current, pendingSends, now, releaseLabel: config.policy.registry.label ?? null });
const written = [await writeJson(path.join(values.out, 'evidence-health.json'), { ...health, source }), await writeJson(path.join(values.out, 'renewal-plan.json'), { ...plan, source })];
if (values.consumer && successor && plan.registry?.revision) {
  const consumer = await readJson(values.consumer);
  const next = successorConsumerConfig(consumer, { report: successor, revision: plan.stages.find((item) => item.stage === 'submit').status === 'done' ? plan.registry.revision : plan.nextRevision, storage: storage?.verified ? { extrinsicHash: storage.extrinsicHash, blockHash: storage.blockHash } : null });
  written.push(await writeJson(path.join(values.out, 'successor-consumer-config.json'), next), await writeJson(path.join(values.out, 'successor-diff.json'), diffConsumerConfigs(consumer, next)));
}
console.log(`Evidence health (${source}) at ${health.at}`);
console.log(`  bound report ${health.report.reportHash.slice(0, 12)}… sealed ${health.report.completedAt}, acceptable until ${health.report.expiresAt} (${health.report.expired ? 'EXPIRED' : `${(health.report.secondsLeft / 3600).toFixed(1)} h left`})`);
for (const read of Object.values(health.reads)) console.log(`  ${read.kind.padEnd(12)} ${read.state}${read.lapsesAt ? ` · lapses ${read.lapsesAt}` : ''}${read.error ? ` · ${read.error}` : read.detail ? ` · ${read.detail}` : ''}`);
console.log(`  approval     ${health.approval.state}${health.approval.detail ? ` · ${health.approval.detail}` : ''}`);
console.log(`  binding      revision ${health.bound.revision}${health.bound.onCurrentRevision === null ? ' · registry state not established' : health.bound.onCurrentRevision ? ' · current in the registry' : ' · superseded'}`);
console.log(`  listing      ${health.listed.state}${health.listed.detail ? ` · ${health.listed.detail}` : ''}`);
console.log(`  subject      ${health.subjectState.state} · ${health.subjectState.detail}`);
console.log(`  successor    ${health.successors.length ? `${health.successors[0].reportHash.slice(0, 12)}… sealed ${health.successors[0].completedAt} (${health.successors[0].predicates.length} predicates)` : 'none in public/reports'} · next revision ${health.nextRevision ?? '?'}`);
console.log(`  next         ${health.nextRole.role}: ${health.nextRole.action}`);
for (const warning of health.warnings) console.log(`  warning      ${warning.code}: ${warning.text}`);
console.log(`Renewal plan: next stage ${plan.next ? `${plan.next.stage} (${plan.next.role})` : 'none'}${plan.stop ? ` · STOP: ${plan.stop.reason}` : ''}`);
for (const stage of plan.stages) console.log(`  ${stage.status.padEnd(12)} ${stage.stage.padEnd(9)} ${stage.role.padEnd(18)} ${stage.status === 'done' ? `verified by ${stage.verified.predicates.join(', ')}` : stage.status === 'pending' ? `${stage.verified.reason} → ${stage.command}` : stage.verified.reason}`);
for (const send of pendingSends) console.log(`  signer       ${send.role} ${send.address}: nonce ${send.nonce ?? '?'}, next index ${send.nextIndex ?? '?'}, pending ${send.pending}${send.error ? ` (${send.error})` : ''}`);
console.log(`wrote ${written.join(', ')}. Nothing was signed or sent.`);
