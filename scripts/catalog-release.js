#!/usr/bin/env node
// The release gate and reader: one command that validates a consumer configuration,
// retrieves and verifies the bound report from the chain, evaluates the policy on fresh
// reads, derives the entry from the approved report, and writes an immutable catalog
// release ONLY when the entry is permitted; a reader that imports a release, verifies it
// and decides which entries may be used now; and a comparison of two releases.
//
//   revivecheck-catalog prepare --config <consumer config> [--out <dir>] [--previous <release.json>] [--fixture <reads>] [--now <ISO>] [--name <text>] [--producer <text>] [--retries <n>]
//   revivecheck-catalog read <release.json> [--now <ISO>] [--live] [--json]
//   revivecheck-catalog compare <before.json> <after.json> [--json]
//
// Exit codes of `prepare`: 0 permitted (release written), 1 refused (a known policy or
// entry refusal: nothing written but the outcome and the evidence), 2 unknown (a read was
// unavailable: never a pass, never silently a fixture), 3 configuration error. `read`
// exits 0 when at least one entry is usable at the clock given. Every run writes
// outcome.json (`revivecheck.release-gate-outcome.v1`) with field-level diagnostics.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildCatalogRelease, readCatalogRelease, verifyCatalogRelease, compareCatalogReleases, gateOutcome, loadConsumerConfig, selectorFrom, EXIT, CATALOG_RELEASE_SCHEMA } from '../lib/catalog-release.js';
import { createBinding, evaluateBinding } from '../lib/policy.js';
import { buildDecisionEvidence } from '../lib/decision.js';
import { entryDecision } from '../lib/entry.js';
import { verifyRun } from '../lib/report.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string' }, out: { type: 'string', default: 'releases' }, previous: { type: 'string' }, fixture: { type: 'string' }, now: { type: 'string' }, name: { type: 'string' }, producer: { type: 'string' }, retries: { type: 'string', default: '3' }, live: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
} });
const [command, ...files] = positionals;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const writeJson = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); return file; };
const usage = () => console.log('Usage: revivecheck-catalog prepare --config <file> [--out <dir>] [--previous <release.json>] [--fixture <reads>] [--now <ISO>]\n       revivecheck-catalog read <release.json> [--now <ISO>] [--live] [--json]\n       revivecheck-catalog compare <before.json> <after.json> [--json]');

/** Reads from a fixture: the separate consumer's fixture shape, or an example-catalog capture (`--fixture <file>` with the policy subject). */
function fixtureReads(fixture, config) {
  if (fixture?.schema === 'revivecheck-consumer.fixture.v1') return { report: fixture.report, inputs: fixture.inputs, now: fixture.now, binding: fixture.binding, source: `fixture:${fixture.name ?? 'consumer'}` };
  if (fixture?.schema === 'revivecheck.token-catalog-inputs.v1') {
    const token = fixture.tokens?.[config.policy.subject.address];
    if (!token) throw new Error(`The capture has no reads for ${config.policy.subject.address}.`);
    const report = token.evidence?.run;
    if (!report?.evidenceHash) throw new Error('The capture carries no retrieved report under evidence.run.');
    return { report, inputs: { observation: token.observation, registry: token.registry, listing: token.listing, evidence: token.evidence }, now: fixture.now, binding: null, source: `fixture:${fixture.config ?? 'capture'}` };
  }
  throw new Error('A fixture declares schema revivecheck-consumer.fixture.v1 or revivecheck.token-catalog-inputs.v1.');
}

/** Live: the bound report from the chain, then fresh reads; retried when the public nodes do not answer. */
async function liveReads(config, { retries, log }) {
  const service = await import('../lib/service.js');
  const { extrinsicHash, blockHash } = config.release.storage;
  const attempts = [];
  try {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const record = { attempt, startedAt: new Date().toISOString() };
      try {
        const result = await service.retrieveEvidence({ extrinsicHash, blockHash, expectedHash: config.release.reportHash });
        if (!result.verified || !result.run) { record.failure = `retrieveEvidence: ${(result.reasons || []).join(' ') || 'not verified'}`; attempts.push(record); log(`attempt ${attempt}: ${record.failure}`); await service.closeConnections().catch(() => {}); continue; }
        const { run, ...retrieval } = result;
        const binding = createBinding({ policy: config.policy, report: run, releaseId: config.release.releaseId, revision: String(config.release.revision), boundBy: config.boundBy, note: `Release gate binding for ${config.release.label}: report ${run.evidenceHash.slice(0, 12)}… on revision ${config.release.revision}.`, storage: { extrinsicHash, blockHash: blockHash ?? null } });
        const inputs = await service.collectPolicyInputs({ policy: config.policy, binding });
        const failed = ['observation', 'registry', 'listing', 'evidence'].filter((key) => inputs[key]?.error).map((key) => `${key}: ${inputs[key].error}`);
        record.failedReads = failed; attempts.push(record);
        if (failed.length && attempt < retries) { log(`attempt ${attempt}: ${failed.join('; ')}`); await service.closeConnections().catch(() => {}); continue; }
        return { report: run, binding, inputs, retrieval, now: new Date().toISOString(), source: 'live:portaldot-v3-testnet', attempts };
      } catch (error) { record.failure = error.message; attempts.push(record); log(`attempt ${attempt}: ${error.message}`); await service.closeConnections().catch(() => {}); }
    }
    return { report: null, binding: null, inputs: null, retrieval: null, now: new Date().toISOString(), source: 'live:portaldot-v3-testnet', attempts };
  } finally { await service.closeConnections().catch(() => {}); }
}

async function prepare() {
  const out = values.out;
  let config, reads, release = null, evidence = null;
  try {
    if (!values.config) throw new Error('--config <file> names the consumer configuration (revivecheck-consumer.config.v1).');
    config = loadConsumerConfig(await readJson(values.config), values.config);
    const previous = values.previous ? await readJson(values.previous) : null;
    if (previous && previous.schema !== CATALOG_RELEASE_SCHEMA) throw new Error('--previous is an earlier catalog release.');
    reads = values.fixture ? fixtureReads(await readJson(values.fixture), config) : await liveReads(config, { retries: Math.min(10, Math.max(1, Number.parseInt(values.retries, 10) || 3)), log: (line) => console.error(line) });
    const now = values.now ?? reads.now;
    if (!reads.report) {
      const outcome = gateOutcome({ evidence: null, release: null, subject: config.policy.subject.address, generatedAt: new Date().toISOString() });
      outcome.status = 'unknown'; outcome.exitCode = EXIT.unknown; outcome.reasons = ['storage-unverified']; outcome.attempts = reads.attempts ?? [];
      outcome.nextAction = 'Do not publish. The bound report could not be retrieved from the chain; retry the retrieval. Unavailable verification never counts as valid.';
      console.log(`UNKNOWN ${config.policy.subject.address}: the bound report was not retrieved (${reads.source}); nothing written but ${await writeJson(path.join(out, 'outcome.json'), outcome)}`);
      process.exitCode = EXIT.unknown; return;
    }
    if (!verifyRun(reads.report) || reads.report.evidenceHash !== config.release.reportHash.replace(/^0x/, '').toLowerCase()) throw new Error(`The report in hand (${reads.report.evidenceHash?.slice(0, 12)}…) is not the configured bound report (${config.release.reportHash.slice(0, 12)}…).`);
    const binding = reads.binding?.bindingHash ? reads.binding : createBinding({ policy: config.policy, report: reads.report, releaseId: reads.binding?.releaseId ?? config.release.releaseId, revision: String(reads.binding?.revision ?? config.release.revision), boundBy: config.boundBy, note: `Release gate binding for ${config.release.label}.`, storage: reads.binding?.storage ?? (config.release.storage?.extrinsicHash ? { extrinsicHash: config.release.storage.extrinsicHash, blockHash: config.release.storage.blockHash ?? null } : null), boundAt: now });
    const evaluation = evaluateBinding({ policy: config.policy, binding, report: reads.report, registry: reads.inputs.registry, observation: reads.inputs.observation, listing: reads.inputs.listing, evidence: reads.inputs.evidence, subject: reads.inputs.subject ?? null, now });
    const producer = { name: values.producer || config.name, kind: 'release-gate', control: config.roles?.operator?.control ?? null, source: reads.source };
    evidence = buildDecisionEvidence({ producer, policy: config.policy, binding, report: reads.report, evaluation, inputs: reads.inputs, configuredEntry: config.entry, extra: { attempts: reads.attempts ?? [], fixture: values.fixture ?? null }, generatedAt: now });
    release = buildCatalogRelease({ name: values.name || config.name, producer, decisions: [{ evidence }], previous, generatedAt: now });
    const outcome = gateOutcome({ evidence, release: release.entries.length ? release : null, subject: config.policy.subject.address, generatedAt: now });
    const written = [await writeJson(path.join(out, 'outcome.json'), outcome), await writeJson(path.join(out, 'decision-evidence.json'), evidence)];
    if (outcome.permitted) written.push(await writeJson(path.join(out, `catalog-release-${release.version}.json`), release));
    console.log(`${outcome.status.toUpperCase()} ${config.policy.subject.address} (${reads.source}; evaluated ${evaluation.evaluatedAt})`);
    console.log(`evaluation: ${evaluation.status}${evaluation.reasons.length ? `: ${evaluation.reasons.map((reason) => reason.code).join(', ')}` : ''}; entry: ${evidence.entry.match ? 'equals the approved report' : evidence.entry.reason}`);
    if (outcome.permitted) console.log(`release ${release.version} ${release.releaseHash} · ${release.entries.length} entry · permission ends ${release.validity.validUntil} (${release.validity.limitedBy})${previous ? ` · after ${previous.releaseHash.slice(0, 12)}…` : ''}`);
    else for (const item of outcome.diagnostics) console.log(`  ${item.pointer}: ${item.code} · observed ${JSON.stringify(item.observed ?? item.configured)} · expected ${JSON.stringify(item.expected ?? item.approved)} · checkpoint #${item.checkpoint?.number ?? '-'} · ${item.role} → ${item.nextAction}`);
    console.log(`wrote ${written.join(', ')}${outcome.permitted ? '' : ' (no release file: the entry is not permitted)'}`);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    const outcome = gateOutcome({ error, subject: config?.policy?.subject?.address ?? null });
    await writeJson(path.join(out, 'outcome.json'), outcome).catch(() => {});
    console.error(`CONFIGURATION ERROR: ${error.message}`);
    process.exitCode = EXIT['configuration-error'];
  }
}

async function read() {
  const [file] = files;
  if (!file) { usage(); process.exitCode = 3; return; }
  const release = await readJson(file);
  let reads = null;
  if (values.live) {
    const service = await import('../lib/service.js');
    try {
      reads = {};
      for (const entry of release.entries || []) {
        const document = release.evidence.find((item) => item.evidenceHash === entry.evidenceHash);
        reads[entry.address] = await service.collectPolicyInputs({ policy: document.policy, binding: document.binding });
      }
    } finally { await service.closeConnections().catch(() => {}); }
  }
  const result = readCatalogRelease(release, { now: values.now ?? new Date(), reads });
  if (values.json) console.log(JSON.stringify({ ...result, selector: selectorFrom(result) }, null, 2));
  else {
    console.log(`Release ${result.version} ${String(result.releaseHash).slice(0, 16)}… · ${result.name} · read at ${result.readAt} (${result.freshness})`);
    for (const check of result.verification.checks) console.log(`${check.ok ? 'ok     ' : 'FAILED '} ${check.id.padEnd(26)} ${check.detail ?? ''}`);
    for (const row of selectorFrom(result)) console.log(`${row.selectable ? 'USABLE  ' : 'withheld'} ${row.label}\n         ${row.reason}`);
    console.log(result.note);
  }
  process.exitCode = result.ok ? 0 : 1;
}

async function compare() {
  const [before, after] = files;
  if (!before || !after) { usage(); process.exitCode = 3; return; }
  const diff = compareCatalogReleases(await readJson(before), await readJson(after));
  if (values.json) console.log(JSON.stringify(diff, null, 2));
  else {
    console.log(`${before} (version ${diff.before.version}) → ${after} (version ${diff.after.version})${diff.chained ? ', chained' : ', NOT chained'}`);
    for (const entry of diff.added) console.log(`added     ${entry.address} ${entry.symbol} · report ${entry.reportHash.slice(0, 12)}… revision ${entry.revision}`);
    for (const entry of diff.removed) console.log(`removed   ${entry.address} ${entry.symbol}${entry.withheldAfter ? ` · now withheld: ${entry.withheldAfter.reasons.join(', ')}` : ''}`);
    for (const entry of diff.changed) console.log(`changed   ${entry.address} · ${[...entry.fields.map((item) => `${item.field} ${JSON.stringify(item.before)} → ${JSON.stringify(item.after)}`), ...entry.evidence.map((item) => `${item.key} ${String(item.before).slice(0, 12)} → ${String(item.after).slice(0, 12)}`)].join('; ')}`);
    for (const entry of diff.unchanged) console.log(`unchanged ${entry.address}`);
  }
  process.exitCode = 0;
}

if (command === 'prepare') await prepare();
else if (command === 'read') await read();
else if (command === 'compare') await compare();
else if (command === 'verify') { const release = await readJson(files[0]); const result = verifyCatalogRelease(release); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1; }
else { usage(); process.exitCode = command ? 3 : 0; }
