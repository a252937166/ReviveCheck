#!/usr/bin/env node
// Token Catalog: a consumer of ReviveCheck built only on its documented interfaces
// (lib/service.js, lib/policy.js, the contracts' ABIs). A token is available in the
// catalog only while its latest binding evaluates to `valid` under the catalog's
// policy and the entry it publishes is exactly the entry the approved report
// verified. See README.md in this directory.
//
//   node examples/token-catalog/catalog.js demo [--strict] [--out <dir>]
//   node examples/token-catalog/catalog.js bind --config <file> --token 0x… --report <hash> --release-id 0x… --revision <n> [--by "<who>"] [--note "…"] [--storage-extrinsic 0x… --storage-block 0x…]
//   node examples/token-catalog/catalog.js build --config <file> [--fixture <inputs.json>] [--capture <inputs.json>] [--out <dir>]
//   node examples/token-catalog/catalog.js acceptance --config <file> [--fixture <inputs.json>] [--out <dir>]
//   node examples/token-catalog/catalog.js record --config <file> --step <id> --actor "<who>" --action "<what>" [--receipt '<json>']… [--note "…"]
//   node examples/token-catalog/catalog.js publish --config <file> [--to <dir>]
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createBinding, evaluateBinding, summarizeEvaluation } from '../../lib/policy.js';
import { verifyRun } from '../../lib/report.js';
import { appendBinding, assertEntryApproved, buildCatalog, classifyBindings, latestBinding, normalizeConfig, BINDINGS_SCHEMA, INPUTS_SCHEMA } from './lib/catalog.js';
import { runLocalLifecycle, checkTranscript, EXPECTED } from './lib/lifecycle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const here = path.dirname(fileURLToPath(import.meta.url));
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string' }, out: { type: 'string' }, to: { type: 'string' }, strict: { type: 'boolean', default: false }, fixture: { type: 'string' }, capture: { type: 'string' },
  token: { type: 'string' }, report: { type: 'string' }, 'release-id': { type: 'string' }, revision: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' }, 'storage-extrinsic': { type: 'string' }, 'storage-block': { type: 'string' },
  step: { type: 'string' }, actor: { type: 'string' }, action: { type: 'string' }, receipt: { type: 'string', multiple: true },
} });
const [command] = positionals;
const resolve = (file) => path.isAbsolute(file) ? file : path.resolve(root, file);
const readJson = async (file) => JSON.parse(await readFile(resolve(file), 'utf8'));
const writeJson = async (file, value) => { await mkdir(path.dirname(resolve(file)), { recursive: true }); await writeFile(resolve(file), `${JSON.stringify(value, null, 2)}\n`); return path.relative(root, resolve(file)); };
const usage = () => { console.log('Usage: node examples/token-catalog/catalog.js <demo|bind|build|acceptance|record|publish> [options]. See examples/token-catalog/README.md.'); };

async function loadConfig() {
  if (!values.config) throw new Error('--config <file> is required (examples/token-catalog/config/testnet-v2.json, config/testnet.json or config/local.json).');
  const config = normalizeConfig(await readJson(values.config));
  const bindingsFile = path.join(config.data, 'bindings.json');
  let document = { schema: BINDINGS_SCHEMA, policyHash: config.policyHash, bindings: [] };
  try { document = await readJson(bindingsFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const history = classifyBindings(document.bindings || [], config);
  return { config, bindings: history.current, history, document, bindingsFile };
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
      if (!binding) { entries.push({ token: token.address, binding: null, report: null, evaluation: null }); continue; }
      const report = await loadReport(config, binding.reportHash);
      let inputs;
      if (fixture) {
        inputs = fixture.tokens[token.address];
        if (!inputs) throw new Error(`The fixture has no inputs for ${token.address}.`);
      } else {
        inputs = await service.collectPolicyInputs({ policy: config.policy, binding });
      }
      captured.tokens[token.address] = { observation: inputs.observation, registry: inputs.registry, listing: inputs.listing, evidence: inputs.evidence, ...(inputs.subject !== undefined ? { subject: inputs.subject } : {}), collectedAt: inputs.collectedAt ?? now.toISOString() };
      const evaluation = evaluateBinding({ policy: config.policy, binding, report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence: inputs.evidence, subject: inputs.subject ?? null, now });
      entries.push({ token: token.address, binding, report, evaluation, inputs });
    }
  } finally { if (service) await service.closeConnections(); }
  if (capture) console.log(`inputs captured to ${await writeJson(capture, captured)}`);
  return { entries, now, captured, source: fixture ? `fixture ${values.fixture}` : 'live reads through lib/service.js' };
}

function printCatalog(catalog, source) {
  console.log(`${catalog.name} · ${catalog.mode}${catalog.simulation ? ' · SIMULATED' : ''} · ${source}`);
  console.log(`policy ${catalog.policy.name} (${catalog.policy.hash.slice(0, 12)}…) · reviewers ${catalog.policy.reviewers.trusted.join(', ')} · threshold ${catalog.policy.reviewers.threshold}`);
  console.log(`reviewer trust: ${catalog.policy.reviewers.basis}`);
  for (const token of catalog.tokens) console.log(`  ${token.symbol.padEnd(8)} ${token.address}  ${token.available ? 'AVAILABLE' : 'not available'}  ${token.status}${token.reasons.length ? ` (${token.reasons.join(', ')})` : ''}${token.binding ? `  report ${token.binding.reportHash.slice(0, 12)}… revision ${token.binding.revision}` : ''}  entry ${token.entry.match ? 'equals the approved report' : token.entry.reason}`);
  console.log(`${catalog.summary.available} of ${catalog.summary.total} available · ${catalog.caveat}`);
}

/** Write the catalog, the evaluations and the acceptance verdict for a set of entries. */
async function writeOutputs({ config, history, entries, now, out, acceptance = false, source }) {
  const catalog = buildCatalog({ config, entries, history, generatedAt: now.toISOString() });
  const written = [await writeJson(path.join(out, 'catalog.json'), catalog)];
  for (const entry of entries) if (entry.evaluation) written.push(await writeJson(path.join(out, 'evaluations', `${entry.token}.json`), entry.evaluation));
  printCatalog(catalog, source);
  for (const entry of entries) if (entry.evaluation) console.log(`  ${entry.token}: ${summarizeEvaluation(entry.evaluation)}`);
  let verdict = null;
  if (acceptance) {
    const ok = catalog.tokens.length > 0 && catalog.tokens.every((token) => token.available);
    verdict = { schema: 'revivecheck.token-catalog-acceptance.v2', ok, generatedAt: now.toISOString(), source, catalog: path.join(out, 'catalog.json'), tokens: catalog.tokens.map((token) => ({ address: token.address, symbol: token.symbol, status: token.status, available: token.available, reasons: token.reasons, entry: { match: token.entry.match, mismatches: token.entry.mismatches } })), rule: 'Every token must evaluate to valid and publish exactly the approved entry. recheck-required, expired, unknown, unbound and an entry that differs from the approved report all fail the job; an unavailable verification is never a pass.' };
    console.log(`acceptance ${ok ? 'PASSED' : 'FAILED'}: ${await writeJson(path.join(out, 'acceptance.json'), verdict)}`);
  }
  console.log(`written: ${written.join(', ')}`);
  return { catalog, verdict };
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
    const files = { transcript: await writeJson(path.join(out, 'transcript.json'), { schema: 'revivecheck.token-catalog-transcript.v1', label: result.chain.label, generatedAt: new Date().toISOString(), expected: EXPECTED, verdict, steps: result.transcript.map(({ evaluation, ...rest }) => ({ ...rest, evaluationHash: evaluation?.evaluationHash ?? null })) }), catalog: await writeJson(path.join(out, 'catalog.json'), result.catalog), bindings: await writeJson(path.join(out, 'bindings.json'), { schema: BINDINGS_SCHEMA, bindings: result.bindings }) };
    for (const report of result.reports) await writeJson(path.join(out, 'reports', `${report.evidenceHash}.json`), report);
    console.log('');
    printCatalog(result.catalog, 'local lifecycle');
    console.log(`written: ${Object.values(files).join(', ')}, ${result.reports.length} simulated reports`);
    console.log(verdict.ok ? `sequence matches EXPECTED (${EXPECTED.length} steps)` : `sequence differs from EXPECTED: ${JSON.stringify(verdict.mismatches)}`);
    if (values.strict && !verdict.ok) process.exitCode = 1;
  } else if (command === 'bind') {
    const { config, bindings, document, bindingsFile } = await loadConfig();
    for (const key of ['token', 'report', 'release-id', 'revision']) if (!values[key]) throw new Error(`bind needs --${key}.`);
    const token = config.tokens.find((item) => item.address === values.token.toLowerCase());
    if (!token) throw new Error(`The catalog configuration has no token ${values.token}.`);
    const report = await loadReport(config, values.report.replace(/^0x/, '').toLowerCase());
    // The invariant holds at binding time too: the configured entry must be the entry this report verified.
    assertEntryApproved(token, report);
    const binding = createBinding({ policy: config.policy, report, releaseId: values['release-id'], revision: values.revision, boundBy: values.by || `catalog operator (${config.roles.operator.control})`, note: values.note || '', storage: values['storage-extrinsic'] ? { extrinsicHash: values['storage-extrinsic'], blockHash: values['storage-block'] || null } : null });
    if (binding.subject !== token.address) throw new Error(`The policy subject is ${binding.subject}; --token names ${values.token}.`);
    appendBinding(bindings, binding, config.policy);
    const all = [...(document.bindings || []), binding];
    console.log(`binding ${binding.id} appended to ${await writeJson(bindingsFile, { ...document, schema: BINDINGS_SCHEMA, policyHash: config.policyHash, bindings: all })} (${all.length} in history, ${bindings.length + 1} under the current policy)`);
    console.log(JSON.stringify(binding, null, 2));
  } else if (command === 'build' || command === 'acceptance') {
    const { config, bindings, history } = await loadConfig();
    const fixture = values.fixture ? await readJson(values.fixture) : null;
    if (fixture && fixture.schema !== INPUTS_SCHEMA) throw new Error(`A fixture declares schema ${INPUTS_SCHEMA}.`);
    if (fixture && fixture.policyHash !== config.policyHash) throw new Error('The fixture was captured under another policy.');
    const { entries, now, source } = await evaluateAll({ config, bindings, fixture, capture: values.capture || null });
    const { verdict } = await writeOutputs({ config, history, entries, now, out: values.out || config.data, acceptance: command === 'acceptance', source });
    if (verdict && !verdict.ok) process.exitCode = 1;
  } else if (command === 'record') {
    // One step of a live lifecycle: evaluate now, capture the inputs, and append what happened to lifecycle.json with its receipts.
    const { config, bindings, history } = await loadConfig();
    if (config.mode !== 'testnet') throw new Error('record documents live steps; the local lifecycle is scripted by demo.');
    for (const key of ['step', 'actor', 'action']) if (!values[key]) throw new Error(`record needs --${key}.`);
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(values.step)) throw new Error('--step is a short kebab-case identifier.');
    const receipts = (values.receipt || []).map((text) => { const receipt = JSON.parse(text); for (const key of ['kind', 'extrinsicHash', 'blockNumber']) if (!receipt[key]) throw new Error(`A receipt names ${key}.`); return receipt; });
    const lifecycleFile = path.join(config.data, 'lifecycle.json');
    let lifecycle = { schema: 'revivecheck.token-catalog-lifecycle.v1', config: values.config, policyHash: config.policyHash, scope: 'Live Portaldot V3 testnet steps recorded as they happened, each with its finalized receipts, the checkpoint read afterwards and the policy decision at that moment. Roles are labelled in the configuration; nothing here is independent review.', steps: [] };
    try { lifecycle = await readJson(lifecycleFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (lifecycle.policyHash !== config.policyHash) throw new Error('lifecycle.json was recorded under another policy; start a new data directory for a new policy.');
    const index = lifecycle.steps.length + 1;
    const capture = path.join(config.data, 'captures', `${String(index).padStart(2, '0')}-${values.step}.inputs.json`);
    const { entries, now, source } = await evaluateAll({ config, bindings, capture });
    const { catalog } = await writeOutputs({ config, history, entries, now, out: config.data, source });
    const token = catalog.tokens[0];
    const inputs = entries[0]?.inputs || {};
    const registry = inputs.registry && !inputs.registry.error ? { block: inputs.registry.block, revision: inputs.registry.release?.revision ?? null, reportHash: inputs.registry.release?.reportHash ?? null, exists: inputs.registry.release?.exists ?? null, decisions: inputs.registry.decisions ?? null, interfacesAgree: inputs.registry.interfacesAgree } : { error: inputs.registry?.error ?? 'not read' };
    const listing = inputs.listing && !inputs.listing.error ? { block: inputs.listing.block, listed: inputs.listing.listed, entry: inputs.listing.entry, interfacesAgree: inputs.listing.interfacesAgree, consumer: inputs.listing.list, version: inputs.listing.identity?.version ?? null } : { error: inputs.listing?.error ?? 'not read' };
    const entry = { index, step: values.step, at: now.toISOString(), actor: values.actor, action: values.action, note: values.note || '', receipts, registry, listing, observation: inputs.observation && !inputs.observation.error ? { finalized: inputs.observation.finalized, runtime: inputs.observation.runtime, observedAt: inputs.observation.observedAt } : { error: inputs.observation?.error ?? 'not read' }, binding: token.binding ? { id: token.binding.id, reportHash: token.binding.reportHash, revision: token.binding.revision } : null, status: token.status, available: token.available, reasons: token.reasons, entryMatch: token.entry.match, evaluationHash: token.evaluation?.evaluationHash ?? null, capture: path.relative(root, resolve(capture)) };
    lifecycle.steps.push(entry);
    console.log(`step ${index} "${values.step}" recorded in ${await writeJson(lifecycleFile, lifecycle)}: ${token.status}, available ${token.available}, listed ${listing.listed ?? 'unknown'}, ${receipts.length} receipt${receipts.length === 1 ? '' : 's'}`);
  } else if (command === 'publish') {
    // Copy the catalog's public documents under the site so the app can show the decision without a wallet.
    const { config } = await loadConfig();
    const to = values.to || path.join('public/catalog', path.basename(config.data));
    const copied = [];
    for (const file of ['catalog.json', 'bindings.json', 'lifecycle.json', 'acceptance.json']) {
      try { await mkdir(resolve(to), { recursive: true }); await copyFile(resolve(path.join(config.data, file)), resolve(path.join(to, file))); copied.push(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const directory of ['evaluations', 'captures']) {
      try {
        const files = (await readdir(resolve(path.join(config.data, directory)))).filter((file) => file.endsWith('.json'));
        if (files.length) await mkdir(resolve(path.join(to, directory)), { recursive: true });
        for (const file of files) { await copyFile(resolve(path.join(config.data, directory, file)), resolve(path.join(to, directory, file))); copied.push(`${directory}/${file}`); }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await writeJson(path.join(to, 'index.json'), { schema: 'revivecheck.token-catalog-publication.v1', name: config.name, mode: config.mode, policyHash: config.policyHash, source: config.data, publishedAt: new Date().toISOString(), files: copied });
    console.log(`published ${copied.length} files from ${config.data} to ${to}`);
  } else { usage(); process.exitCode = command ? 1 : 0; }
} catch (error) {
  console.error(JSON.stringify({ error: String(error?.message || error) }));
  process.exitCode = 1;
}
