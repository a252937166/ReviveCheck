#!/usr/bin/env node
// Token Catalog: a consumer of ReviveCheck built only on its documented interfaces
// (lib/service.js, lib/policy.js, the contracts' ABIs). A token is available in the
// catalog only while its latest binding evaluates to `valid` under the catalog's
// policy. See README.md in this directory.
//
//   node examples/token-catalog/catalog.js demo [--strict] [--out <dir>]
//   node examples/token-catalog/catalog.js bind --config <file> --token 0x… --report <hash> --release-id 0x… --revision <n> [--by "<who>"] [--note "…"] [--storage-extrinsic 0x… --storage-block 0x…]
//   node examples/token-catalog/catalog.js build --config <file> [--fixture <inputs.json>] [--capture <inputs.json>] [--out <dir>]
//   node examples/token-catalog/catalog.js acceptance --config <file> [--fixture <inputs.json>] [--out <dir>]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createBinding, evaluateBinding, summarizeEvaluation, verifyBinding } from '../../lib/policy.js';
import { verifyRun } from '../../lib/report.js';
import { appendBinding, buildCatalog, latestBinding, normalizeConfig, INPUTS_SCHEMA } from './lib/catalog.js';
import { runLocalLifecycle, checkTranscript, EXPECTED } from './lib/lifecycle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const here = path.dirname(fileURLToPath(import.meta.url));
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string' }, out: { type: 'string' }, strict: { type: 'boolean', default: false }, fixture: { type: 'string' }, capture: { type: 'string' },
  token: { type: 'string' }, report: { type: 'string' }, 'release-id': { type: 'string' }, revision: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' }, 'storage-extrinsic': { type: 'string' }, 'storage-block': { type: 'string' },
} });
const [command] = positionals;
const resolve = (file) => path.isAbsolute(file) ? file : path.resolve(root, file);
const readJson = async (file) => JSON.parse(await readFile(resolve(file), 'utf8'));
const writeJson = async (file, value) => { await mkdir(path.dirname(resolve(file)), { recursive: true }); await writeFile(resolve(file), `${JSON.stringify(value, null, 2)}\n`); return path.relative(root, resolve(file)); };
const usage = () => { console.log(readFile(fileURLToPath(import.meta.url), 'utf8').then ? '' : ''); console.log('Usage: node examples/token-catalog/catalog.js <demo|bind|build|acceptance> [options]. See examples/token-catalog/README.md.'); };

async function loadConfig() {
  if (!values.config) throw new Error('--config <file> is required (examples/token-catalog/config/testnet.json or config/local.json).');
  const config = normalizeConfig(await readJson(values.config));
  const bindingsFile = path.join(config.data, 'bindings.json');
  let bindings = [];
  try { bindings = (await readJson(bindingsFile)).bindings || []; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const binding of bindings) if (!verifyBinding(binding, config.policy)) throw new Error(`Binding ${binding.id} in ${bindingsFile} is not intact or was made under another policy.`);
  return { config, bindings, bindingsFile };
}
async function loadReport(config, hash) {
  for (const directory of [config.reports, path.join(config.data, 'reports')].filter(Boolean)) {
    try { const report = await readJson(path.join(directory, `${hash}.json`)); if (!verifyRun(report) || report.evidenceHash !== hash) throw new Error(`Report ${hash} in ${directory} fails its SHA-256.`); return report; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error(`No report ${hash}.json under ${[config.reports, path.join(config.data, 'reports')].filter(Boolean).join(' or ')}.`);
}

/** Evaluate every token's latest binding: live through lib/service.js, or from a captured inputs file. */
async function evaluateAll({ config, bindings, fixture = null, capture = null }) {
  const now = fixture ? new Date(fixture.now) : new Date();
  const captured = { schema: INPUTS_SCHEMA, capturedAt: now.toISOString(), now: now.toISOString(), config: config.name, policyHash: config.policyHash, tokens: {} };
  const service = fixture ? null : await import('../../lib/service.js');
  const entries = [];
  try {
    for (const token of config.tokens) {
      const binding = latestBinding(bindings, token.address);
      if (!binding) { entries.push({ token: token.address, binding: null, evaluation: null }); continue; }
      const report = await loadReport(config, binding.reportHash);
      let inputs;
      if (fixture) {
        inputs = fixture.tokens[token.address];
        if (!inputs) throw new Error(`The fixture has no inputs for ${token.address}.`);
      } else {
        inputs = await service.collectPolicyInputs({ policy: config.policy, binding });
      }
      captured.tokens[token.address] = { observation: inputs.observation, registry: inputs.registry, listing: inputs.listing, evidence: inputs.evidence, collectedAt: inputs.collectedAt ?? now.toISOString() };
      const evaluation = evaluateBinding({ policy: config.policy, binding, report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence: inputs.evidence, now });
      entries.push({ token: token.address, binding, evaluation });
    }
  } finally { if (service) await service.closeConnections(); }
  if (capture) console.log(`inputs captured to ${await writeJson(capture, captured)}`);
  return { entries, now, source: fixture ? `fixture ${values.fixture}` : 'live reads through lib/service.js' };
}

function printCatalog(catalog, source) {
  console.log(`${catalog.name} · ${catalog.mode}${catalog.simulation ? ' · SIMULATED' : ''} · ${source}`);
  console.log(`policy ${catalog.policy.name} (${catalog.policy.hash.slice(0, 12)}…) · reviewers ${catalog.policy.reviewers.trusted.join(', ')} · threshold ${catalog.policy.reviewers.threshold}`);
  console.log(`reviewer trust: ${catalog.policy.reviewers.basis}`);
  for (const token of catalog.tokens) console.log(`  ${token.symbol.padEnd(8)} ${token.address}  ${token.available ? 'AVAILABLE' : 'not available'}  ${token.status}${token.reasons.length ? ` (${token.reasons.join(', ')})` : ''}${token.binding ? `  report ${token.binding.reportHash.slice(0, 12)}… revision ${token.binding.revision}` : ''}`);
  console.log(`${catalog.summary.available} of ${catalog.summary.total} available · ${catalog.caveat}`);
}

try {
  if (command === 'demo') {
    const config = await readJson(path.join(here, 'config/local.json'));
    const out = values.out || 'artifacts/local/token-catalog';
    const result = await runLocalLifecycle({ config });
    console.log(`Token Catalog lifecycle on the local stand-in chain. ${result.chain.label}`);
    console.log(`registry ${result.chain.registry} · token list (v2, fixture address) ${result.chain.tokenList} · pUSD ${result.chain.token}`);
    console.log('');
    console.log('step               actor         status            listed  available  reasons');
    for (const entry of result.transcript) console.log(`${entry.step.padEnd(18)} ${entry.actor.padEnd(13)} ${entry.status.padEnd(17)} ${String(entry.listed).padEnd(7)} ${String(entry.available).padEnd(10)} ${entry.reasons.join(', ')}${entry.outcome.reverted ? `  [reverted: ${entry.outcome.reverted}]` : ''}${entry.outcome.list ? `  [C list: ${entry.outcome.list}; C delist: ${entry.outcome.delist}]` : ''}`);
    const verdict = checkTranscript(result.transcript);
    const files = { transcript: await writeJson(path.join(out, 'transcript.json'), { schema: 'revivecheck.token-catalog-transcript.v1', label: result.chain.label, generatedAt: new Date().toISOString(), expected: EXPECTED, verdict, steps: result.transcript.map(({ evaluation, ...rest }) => ({ ...rest, evaluationHash: evaluation?.evaluationHash ?? null })) }), catalog: await writeJson(path.join(out, 'catalog.json'), result.catalog), bindings: await writeJson(path.join(out, 'bindings.json'), { schema: 'revivecheck.token-catalog-bindings.v1', bindings: result.bindings }) };
    for (const report of result.reports) await writeJson(path.join(out, 'reports', `${report.evidenceHash}.json`), report);
    console.log('');
    printCatalog(result.catalog, 'local lifecycle');
    console.log(`written: ${Object.values(files).join(', ')}, ${result.reports.length} simulated reports`);
    console.log(verdict.ok ? `sequence matches EXPECTED (${EXPECTED.length} steps)` : `sequence differs from EXPECTED: ${JSON.stringify(verdict.mismatches)}`);
    if (values.strict && !verdict.ok) process.exitCode = 1;
  } else if (command === 'bind') {
    const { config, bindings, bindingsFile } = await loadConfig();
    for (const key of ['token', 'report', 'release-id', 'revision']) if (!values[key]) throw new Error(`bind needs --${key}.`);
    const report = await loadReport(config, values.report.replace(/^0x/, '').toLowerCase());
    const binding = createBinding({ policy: config.policy, report, releaseId: values['release-id'], revision: values.revision, boundBy: values.by || `catalog operator (${config.roles.operator.control})`, note: values.note || '', storage: values['storage-extrinsic'] ? { extrinsicHash: values['storage-extrinsic'], blockHash: values['storage-block'] || null } : null });
    if (binding.subject !== values.token.toLowerCase()) throw new Error(`The policy subject is ${binding.subject}; --token names ${values.token}.`);
    const next = appendBinding(bindings, binding, config.policy);
    console.log(`binding ${binding.id} appended to ${await writeJson(bindingsFile, { schema: 'revivecheck.token-catalog-bindings.v1', policyHash: config.policyHash, bindings: next })} (${next.length} in history)`);
    console.log(JSON.stringify(binding, null, 2));
  } else if (command === 'build' || command === 'acceptance') {
    const { config, bindings } = await loadConfig();
    const fixture = values.fixture ? await readJson(values.fixture) : null;
    if (fixture && fixture.schema !== INPUTS_SCHEMA) throw new Error(`A fixture declares schema ${INPUTS_SCHEMA}.`);
    if (fixture && fixture.policyHash !== config.policyHash) throw new Error('The fixture was captured under another policy.');
    const { entries, now, source } = await evaluateAll({ config, bindings, fixture, capture: values.capture || null });
    const catalog = buildCatalog({ config, entries, generatedAt: now.toISOString() });
    const out = values.out || config.data;
    const written = [await writeJson(path.join(out, 'catalog.json'), catalog)];
    for (const entry of entries) if (entry.evaluation) written.push(await writeJson(path.join(out, 'evaluations', `${entry.token}.json`), entry.evaluation));
    printCatalog(catalog, source);
    for (const entry of entries) if (entry.evaluation) console.log(`  ${entry.token}: ${summarizeEvaluation(entry.evaluation)}`);
    console.log(`written: ${written.join(', ')}`);
    if (command === 'acceptance') {
      const ok = catalog.tokens.length > 0 && catalog.tokens.every((token) => token.available);
      const acceptance = { schema: 'revivecheck.token-catalog-acceptance.v1', ok, generatedAt: now.toISOString(), source, catalog: path.join(out, 'catalog.json'), tokens: catalog.tokens.map((token) => ({ address: token.address, symbol: token.symbol, status: token.status, available: token.available, reasons: token.reasons })), rule: 'Every token must evaluate to valid. recheck-required, expired, unknown and unbound all fail the job; an unavailable verification is never a pass.' };
      console.log(`acceptance ${ok ? 'PASSED' : 'FAILED'}: ${await writeJson(path.join(out, 'acceptance.json'), acceptance)}`);
      if (!ok) process.exitCode = 1;
    }
  } else { usage(); process.exitCode = command ? 1 : 0; }
} catch (error) {
  console.error(JSON.stringify({ error: String(error?.message || error) }));
  process.exitCode = 1;
}
