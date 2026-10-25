#!/usr/bin/env node
// The fair value benchmark (assessment item A-06): one maintainer question, two arms, the
// same five predefined checks, identical inputs where the inputs are captured, and a
// predefined expected decision per scenario.
//
//   Question: may this pUSD token-list entry be enabled in the catalog right now?
//   Arm "baseline":    a maintainer's CI script over raw reads (JSON-RPC eth_call + polkadot-js)
//                      plus the approval record it keeps; see lib/baseline.mjs.
//   Arm "revivecheck": evaluateBinding (lib/policy.js) and the catalog's entry comparison
//                      (examples/token-catalog/lib/catalog.js buildCatalog, which applies
//                      approvedEntry/compareEntry), called in-process: the same library calls
//                      `catalog.js acceptance` makes. Live inputs come from lib/service.js
//                      collectPolicyInputs, the function the CLI uses.
//
// Deterministic mode replays one captured inputs file per scenario to both arms, so the
// decisions are compared at identical checkpoints. Live mode lets both arms read fresh
// finalized checkpoints; every network round trip is timed through lib/instrument.mjs, and
// the "unavailable verification" scenario is run by refusing every connection at that layer
// for both arms alike. Nothing here signs anything or loads a wallet.
//
//   node examples/token-catalog/benchmark/run-fair-benchmark.mjs [--mode deterministic|live|both]
//        [--out <results.json>] [--artifacts <dir>] [--install <measurement.json>]... [--live-timeout-ms 150000]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { installNetworkTap } from './lib/instrument.mjs';
import { CHECKS, KNOWLEDGE, SCRIPT, baselineConfig, liveReads, replayReads, runMaintainerScript } from './lib/baseline.mjs';
import { reconstruct } from './reconstruct-decision.mjs';
import { connectNative, evmRpc } from '../../../lib/chain.js';
import { NETWORKS } from '../../../lib/networks.js';
import { evaluateBinding } from '../../../lib/policy.js';
import { verifyRun } from '../../../lib/report.js';
import { INPUTS_SCHEMA, buildCatalog, classifyBindings, normalizeConfig } from '../lib/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const today = new Date().toISOString().slice(0, 10);
const { values: options } = parseArgs({ options: {
  mode: { type: 'string', default: 'both' }, out: { type: 'string' }, artifacts: { type: 'string' }, install: { type: 'string', multiple: true }, 'live-timeout-ms': { type: 'string', default: '150000' },
} });
if (!['deterministic', 'live', 'both'].includes(options.mode)) throw new Error('--mode is deterministic, live or both.');
const outFile = options.out || `examples/token-catalog/benchmark/results-fair-${today}.json`;
const artifactsDir = options.artifacts || `examples/token-catalog/benchmark/artifacts/fair-${today}`;
const liveTimeoutMs = Number(options['live-timeout-ms']);
const resolve = (file) => path.isAbsolute(file) ? file : path.resolve(root, file);
const display = (file) => { const relative = path.relative(root, resolve(file)); return relative.startsWith('..') ? resolve(file) : relative; };
const readJson = async (file) => JSON.parse(await readFile(resolve(file), 'utf8'));
const sha256File = async (file) => createHash('sha256').update(await readFile(resolve(file))).digest('hex');
const writeJson = async (file, value) => { await mkdir(path.dirname(resolve(file)), { recursive: true }); await writeFile(resolve(file), `${JSON.stringify(value, null, 2)}\n`); return display(file); };
const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

const TOKEN = '0x00001e6100000000000000000000000000010000';
const BINDING_R2 = 'cfff0845-b6a1-4f77-a5c9-1245ae3df3f0'; // revision 2, report 1faef921...
const BINDING_R1 = '4896a5a5-1fc6-4160-9049-7a01b11a8591'; // revision 1, report eb960cc7...
const CAPTURES = 'examples/token-catalog/data/testnet-v2/captures';
const CONFIG = 'examples/token-catalog/config/testnet-v2.json';
const WRONG_ENTRY_CONFIG = 'examples/token-catalog/config/testnet-v2-wrong-entry.json';

/** The five scenarios. `expected` is predefined; only the correct entry may be enabled. */
export const SCENARIOS = Object.freeze([
  { id: 'correct-entry', title: 'Correct entry', description: 'The configured entry (6 decimals) is the entry the approved revision-2 report verified; the trusted reviewer approved revision 2 again and the v2 token list lists pUSD on it.', config: CONFIG, bindingId: BINDING_R2, capture: `${CAPTURES}/12-reapprove-r2.inputs.json`, capturedState: 'lifecycle step 12 (reapprove-r2), finalized #187279', expected: 'enable', live: 'fresh-reads' },
  { id: 'incorrect-decimals', title: 'Incorrect decimals', description: 'The same chain state and binding, but the maintainer configured 18 decimals (the Ethereum default); the chain and the approved report say 6.', config: WRONG_ENTRY_CONFIG, bindingId: BINDING_R2, capture: `${CAPTURES}/12-reapprove-r2.inputs.json`, capturedState: 'lifecycle step 12 (reapprove-r2), finalized #187279', expected: 'refuse', live: 'fresh-reads' },
  { id: 'superseded-report', title: 'Superseded report', description: 'The maintainer still relies on the revision-1 approval record (report eb960cc7...) after the owner submitted revision 2; the registry cleared the approval and the token list stopped listing pUSD.', config: CONFIG, bindingId: BINDING_R1, capture: `${CAPTURES}/07-submit-r2.inputs.json`, capturedState: 'lifecycle step 7 (submit-r2), finalized #187171', expected: 'refuse', live: null, liveNote: 'Not reproducible read-only: the registry would have to hold a newer revision than the record, which needs a signed submit.' },
  { id: 'revoked-approval', title: 'Revoked approval', description: 'The trusted reviewer requested changes on revision 2; the token list stopped listing pUSD on that decision alone.', config: CONFIG, bindingId: BINDING_R2, capture: `${CAPTURES}/11-revoke-r2.inputs.json`, capturedState: 'lifecycle step 11 (revoke-r2), finalized #187248', expected: 'refuse', live: null, liveNote: 'Not reproducible read-only: revoking the approval needs a signed review transaction.' },
  { id: 'unavailable-verification', title: 'Unavailable verification', description: 'Every read fails, as when both public nodes time out. Deterministic: a copy of capture 12 whose reads are errors. Live: every connection and request is refused at the transport layer for both arms.', config: CONFIG, bindingId: BINDING_R2, capture: 'examples/token-catalog/benchmark/fixtures/12-reapprove-r2-unavailable.inputs.json', capturedState: 'derived from lifecycle step 12 with every read replaced by an error', expected: 'refuse', live: 'outage-injected' },
]);

const OPERATOR_ACTIONS = Object.freeze({
  definition: 'Distinct commands a person runs plus values a person must derive by hand (not copy from a record) to obtain one repeat decision for one scenario, once the arm is set up. Setup effort is counted separately under installation.',
  baseline: { commands: 1, command: 'node <maintainer-script>', manualDerivations: 0, total: 1, note: 'Once the script exists it is one command; the facts it encodes are counted under installation.baselineSetup. The benchmark runs the same script in-process.' },
  revivecheck: { commands: 1, command: 'node examples/token-catalog/catalog.js acceptance --config <config> [--fixture <capture>]', manualDerivations: 0, total: 1, note: 'One command; the policy and the explicit binding are counted under installation.reviveCheckSetup. The benchmark makes the same library calls in-process.' },
});
const ASSISTANCE = Object.freeze({ definition: 'Requests for help and corrections by a person during the task.', baseline: 0, revivecheck: 0, note: 'Both arms are scripts run by the benchmark. No person performed a step, so no assistance request or correction could occur or be observed. Human effort was not measured.' });

const classify = (expected, decision) => decision === 'incomplete' ? 'incomplete' : decision === expected ? 'correct' : decision === 'enable' ? 'false-enable' : 'false-refusal';
const leafPaths = (value, prefix = '') => Array.isArray(value)
  ? (value.length ? value.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`)) : [prefix])
  : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => leafPaths(item, prefix ? `${prefix}.${key}` : key)) : [prefix];

async function loadReport(config, hash) {
  const report = await readJson(path.join(config.reports, `${hash}.json`));
  if (!verifyRun(report) || report.evidenceHash !== hash) throw new Error(`Report ${hash} fails its SHA-256.`);
  return report;
}

async function loadScenario(scenario) {
  const rawConfig = await readJson(scenario.config);
  const config = normalizeConfig(rawConfig);
  const bindingsFile = path.join(config.data, 'bindings.json');
  const document = await readJson(bindingsFile);
  const history = classifyBindings(document.bindings || [], config);
  const binding = history.current.find((item) => item.id === scenario.bindingId);
  if (!binding) throw new Error(`${scenario.id}: binding ${scenario.bindingId} is not in ${bindingsFile} under the current policy.`);
  const report = await loadReport(config, binding.reportHash);
  const capture = await readJson(scenario.capture);
  if (capture.schema !== INPUTS_SCHEMA) throw new Error(`${scenario.id}: the capture declares ${capture.schema}, not ${INPUTS_SCHEMA}.`);
  if (capture.policyHash !== config.policyHash) throw new Error(`${scenario.id}: the capture was taken under another policy.`);
  const token = config.tokens[0];
  if (token.address !== TOKEN || !capture.tokens[token.address]) throw new Error(`${scenario.id}: the capture has no inputs for ${token.address}.`);
  const endpoints = { evmRpc: NETWORKS.testnet.evmRpcUrl, nativeRpc: NETWORKS.testnet.substrateRpcUrl };
  const reportFile = path.join(config.reports, `${binding.reportHash}.json`);
  return {
    ...scenario, rawConfig, config, history, binding, report, capture, token, inputs: capture.tokens[token.address], endpoints,
    baselineConfig: baselineConfig({ config, token, binding, endpoints }),
    inputs_files: {
      config: { path: scenario.config, sha256: await sha256File(scenario.config), policyHash: config.policyHash, configuredDecimals: token.decimals },
      bindings: { path: bindingsFile, sha256: await sha256File(bindingsFile) },
      binding: { id: binding.id, reportHash: binding.reportHash, release: binding.release, releaseId: binding.releaseId, revision: binding.revision, storage: binding.storage, bindingHash: binding.bindingHash },
      report: { path: reportFile, sha256: await sha256File(reportFile), completedAt: report.completedAt, checkpoint: report.binding?.checkpoint?.number ?? null },
      capture: { path: scenario.capture, sha256: await sha256File(scenario.capture), now: capture.now, capturedState: scenario.capturedState },
    },
  };
}

async function runBaselineArm(loaded, mode, now) {
  const config = loaded.baselineConfig;
  const reads = mode === 'deterministic'
    ? replayReads(loaded.capture, loaded.token.address, { capturePath: loaded.capture_path })
    : (() => { const signal = AbortSignal.timeout(liveTimeoutMs); return liveReads({ connect: () => connectNative({ signal, url: loaded.endpoints.nativeRpc }), rpc: (method, params) => evmRpc(method, params, { signal }), endpoints: loaded.endpoints, registry: config.registry.address, tokenList: config.tokenList.address }); })();
  try { return await runMaintainerScript(config, reads, { now }); } finally { await reads.close(); }
}

async function runReviveCheckArm(loaded, mode, now) {
  let inputs, source;
  if (mode === 'deterministic') { inputs = loaded.inputs; source = `captured inputs ${loaded.capture_path}`; } else {
    const service = await import('../../../lib/service.js');
    try { inputs = await service.collectPolicyInputs({ policy: loaded.config.policy, binding: loaded.binding }); source = 'live reads through lib/service.js collectPolicyInputs (networkStatus, readRegistryWithClients, readTokenListWithClients, retrieveEvidence)'; } finally { await service.closeConnections(); }
  }
  const evaluation = evaluateBinding({ policy: loaded.config.policy, binding: loaded.binding, report: loaded.report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence: inputs.evidence, now });
  const catalog = buildCatalog({ config: loaded.config, entries: [{ token: loaded.token.address, binding: loaded.binding, report: loaded.report, evaluation }], history: loaded.history, generatedAt: now.toISOString() });
  return {
    schema: 'revivecheck.fair-benchmark.revivecheck-output.v1',
    note: 'The two documents catalog.js build/acceptance writes (catalog.json and evaluations/<token>.json), bundled in one file for the reconstruction test.',
    source, library: ['lib/policy.js evaluateBinding', 'examples/token-catalog/lib/catalog.js buildCatalog (approvedEntry, compareEntry)'],
    catalog, evaluation,
  };
}

function summarizeArtifact(arm, artifact) {
  if (arm === 'baseline') return { decision: artifact.decision, status: null, reasons: artifact.problems, nextAction: null, checkpoint: artifact.checkpoint, checks: artifact.checks.map((check) => ({ id: check.id, name: check.name, ok: check.ok })) };
  const token = artifact.catalog.tokens[0];
  return { decision: token.available ? 'enable' : 'refuse', status: token.status, reasons: token.reasons, nextAction: token.nextAction, checkpoint: artifact.evaluation.checkpoint, checks: { total: artifact.evaluation.checks.length, failed: artifact.evaluation.checks.filter((check) => check.status !== 'passed').map((check) => `${check.id}:${check.status}`), entryMatch: token.entry.match } };
}

/** A hard stop for a live arm: a read that never returns is recorded as a failure instead of stalling the run. */
function withDeadline(work, ms, label) {
  let timer;
  return Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded the ${ms} ms deadline`)), ms); })]).finally(() => clearTimeout(timer));
}

async function runArm({ tap, arm, loaded, mode, failures }) {
  const now = mode === 'deterministic' ? new Date(loaded.capture.now) : new Date();
  const label = `${mode}:${loaded.id}:${arm}`;
  if (mode === 'live' && loaded.live === 'outage-injected') tap.setOutage(true);
  const work = () => arm === 'baseline' ? runBaselineArm(loaded, mode, now) : runReviveCheckArm(loaded, mode, now);
  const { result: artifact, error, timing } = await tap.scope(label, () => mode === 'live' ? withDeadline(work, liveTimeoutMs + 15_000, label) : work());
  tap.setOutage(false);
  const record = { arm, now: now.toISOString(), expected: loaded.expected, timing, operatorActions: OPERATOR_ACTIONS[arm], assistance: ASSISTANCE[arm] };
  if (error) {
    failures.push({ mode, scenario: loaded.id, arm, error: String(error?.message || error), name: error?.name ?? null });
    return { ...record, decision: 'incomplete', classification: 'incomplete', reasons: [], artifact: null, reconstruction: null, error: String(error?.message || error) };
  }
  const artifactPath = await writeJson(path.join(artifactsDir, mode, `${loaded.id}.${arm}.json`), artifact);
  const summary = summarizeArtifact(arm, artifact);
  const reconstruction = reconstruct(artifact);
  return {
    ...record, decision: summary.decision, classification: classify(loaded.expected, summary.decision), status: summary.status, reasons: summary.reasons, nextAction: summary.nextAction, checkpoint: summary.checkpoint, checks: summary.checks, artifact: artifactPath,
    reconstruction: { requiredPresent: reconstruction.requiredPresent, requiredTotal: reconstruction.requiredTotal, extrasPresent: reconstruction.extrasPresent, extrasTotal: reconstruction.extrasTotal, absent: reconstruction.items.filter((item) => !item.present).map((item) => item.item), rederivedDecision: reconstruction.rederivedDecision, consistent: reconstruction.consistent },
  };
}

async function runMode({ tap, mode, scenarios, failures }) {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const [index, loaded] of scenarios.entries()) {
    const base = { id: loaded.id, title: loaded.title, description: loaded.description, expected: loaded.expected, inputs: loaded.inputs_files };
    if (mode === 'live' && !loaded.live) { results.push({ ...base, skipped: loaded.liveNote }); console.log(`${mode.padEnd(13)} ${loaded.id.padEnd(26)} skipped: ${loaded.liveNote}`); continue; }
    // Counterbalanced arm order: scripts do not learn, but the second arm may meet a warmer connection path or a busier node.
    const order = index % 2 === 0 ? ['baseline', 'revivecheck'] : ['revivecheck', 'baseline'];
    const arms = {};
    for (const arm of order) {
      arms[arm] = await runArm({ tap, arm, loaded, mode, failures });
      const result = arms[arm];
      console.log(`${mode.padEnd(13)} ${loaded.id.padEnd(26)} ${arm.padEnd(11)} ${result.decision.padEnd(10)} ${result.classification.padEnd(13)} wall ${String(result.timing.wallMs).padStart(8)} ms  network ${String(result.timing.networkWaitMs).padStart(8)} ms  compute ${String(result.timing.computeMs).padStart(7)} ms  calls ${String(result.timing.calls).padStart(3)}${result.reasons?.length ? `  reasons ${result.reasons.join(', ')}` : ''}${result.error ? `  FAILED: ${result.error}` : ''}`);
    }
    results.push({ ...base, liveMode: mode === 'live' ? loaded.live : null, order, arms, agreement: arms.baseline.decision === arms.revivecheck.decision, checkpoints: { baseline: arms.baseline.checkpoint ?? null, revivecheck: arms.revivecheck.checkpoint ?? null } });
  }
  return { mode, startedAt, finishedAt: new Date().toISOString(), scenarios: results };
}

async function installation(first) {
  const measurements = [];
  for (const file of options.install || []) { try { measurements.push({ file: display(file), ...(await readJson(file)) }); } catch (error) { measurements.push({ file: display(file), error: String(error.message) }); } }
  const policyPaths = leafPaths(first.rawConfig.policy);
  const { policy: _policy, ...catalogOnly } = first.rawConfig;
  const catalogPaths = leafPaths(catalogOnly);
  const baselinePaths = leafPaths(first.baselineConfig);
  const scriptLines = (await readFile(resolve(SCRIPT), 'utf8')).split('\n').filter((line) => line.trim() && !line.trim().startsWith('//')).length;
  return {
    note: 'First-time effort, measured once and separately from repeat decisions. Field counts stand in for the time to write a configuration; the time a person needs to read documentation, type, or understand a field was not measured.',
    freshClone: measurements,
    reviveCheckSetup: {
      steps: ['git clone and npm ci (measured above)', 'write the catalog configuration with its policy', 'obtain the sealed report (check_release or an existing published report) and store it on-chain, or reference the stored one', 'bind the exact report once per approved revision: catalog.js bind with six arguments', 'run catalog.js acceptance for every later decision'],
      policyFields: policyPaths.length, policyFieldPaths: policyPaths, catalogFieldsExcludingPolicy: catalogPaths.length, catalogFieldPaths: catalogPaths,
      bindCommandArguments: ['--token', '--report', '--release-id', '--revision', '--storage-extrinsic', '--storage-block'], bindOptionalArguments: ['--by', '--note'],
      valuesCopiedNotDerived: 'the release ID, report hash, extrinsic hash and block hash are copied from receipts or read_registry output; none is computed by hand',
    },
    baselineSetup: {
      steps: ['npm install ethers @polkadot/api @polkadot/util @noble/hashes', 'write the script (its facts are listed under knowledge)', 'look up the stored report extrinsic hash and block hash in the explorer or the publishing receipt', 'record the approved report hash and revision', 'run the script for every decision'],
      configConstants: baselinePaths.length, configConstantPaths: baselinePaths, knowledgeItems: KNOWLEDGE.length, knowledge: KNOWLEDGE, scriptNonCommentLines: scriptLines, script: SCRIPT,
      dependencies: ['ethers', '@polkadot/api', '@polkadot/util', '@noble/hashes', 'the project connection helper lib/chain.js connectNative for the spec-3002 types bundle'],
    },
  };
}

function protocol() {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const version = (name) => lock.packages?.[`node_modules/${name}`]?.version ?? null;
  const dirty = git('status', '--porcelain');
  return {
    question: 'May the pUSD entry { chainId 420420777, 0x00001e61...10000, pUSD, Portaldot USD (test), 6 decimals, asset 7777 } be enabled in the catalog right now?',
    arms: {
      baseline: { name: 'CI script + explorer + approval record', implementation: SCRIPT, reads: 'JSON-RPC eth_call at the EVM hash of the finalized block (ethers for ABI), polkadot-js storage and blocks at the native hash; one connection per run, sequential reads', record: 'the maintainer keeps the approved report hash, the revision and the remark.store extrinsic and block hash (what the explorer shows)', output: 'maintainer-ci-script.result.v1: configuration echo, checkpoint, five checks with observed values, problem labels, decision, exit code' },
      revivecheck: { name: 'ReviveCheck policy evaluation and catalog entry comparison', implementation: 'lib/policy.js evaluateBinding; examples/token-catalog/lib/catalog.js buildCatalog (approvedEntry, compareEntry); live inputs from lib/service.js collectPolicyInputs', invocation: 'library calls in-process, the same calls catalog.js acceptance makes; the CLI was not spawned so both arms share one process and one timing tap', output: 'catalog.json and evaluations/<token>.json as the CLI writes them, bundled' },
    },
    checks: CHECKS.map((check) => ({ ...check, revivecheck: {
      C1: 'approvedEntry requires a passed token.listing check that confirmed chainId, address, symbol, name and decimals through both interfaces at the report checkpoint; compareEntry requires the configured entry to equal that approved entry field by field (entry-mismatch:<field> otherwise); target.subject ties the report to the policy subject',
      C2: 'registry.read, registry.provenance, registry.domain, registry.fresh, registry.interfaces, registry.release, registry.owner, registry.label, registry.revision (exact report hash and revision), registry.approvals (trusted set, threshold, no request for changes)',
      C3: 'consumer.read, consumer.provenance, consumer.domain, consumer.fresh, consumer.identity, consumer.registry, consumer.version-known, consumer.version, consumer.interfaces, consumer.listed, consumer.entry (release, exact report hash, a trusted reviewer)',
      C4: 'storage.read (retrieved from a canonical finalized block, Remark.Stored event matches publisher and content hash, SHA-256 verifies), storage.report (it is the bound report)',
      C5: 'evidence.age, runtime.report, observation.present, observation.fresh, observation.network, runtime.current',
    }[check.id] })),
    reviveCheckOnly: ['evidence.integrity (binding hash and report hash verify under this exact policy)', 'evidence.scope', 'target.network', 'plan.fingerprint', 'report.status', 'interface agreement for registry and consumer reads', 'consumer identity and version at the listing checkpoint', 'observation freshness windows', 'a documented reason vocabulary with the status each reason forces and a next action'],
    baselineOnly: ['C1 re-reads the asset metadata at the evaluation checkpoint in live mode; ReviveCheck relies on the sealed report\'s token.listing check at the report checkpoint, bounded by evidence.age'],
    deterministicInputs: 'Both arms consume the same captured inputs file (revivecheck.token-catalog-inputs.v1). The baseline replays registry.views.*.evm and listing.views.*.evm as its eth_call results, the observation as its finalized checkpoint and runtime, and evidence.run as the report it would decode from the block. No separate asset read was captured, so its C1 chain values come from the stored report\'s raw token.listing evidence (native field values and raw ERC-20 return data, decoded by the script) at the report checkpoint, which is also the checkpoint ReviveCheck\'s approvedEntry relies on. Both arms evaluate at the capture\'s recorded time.',
    liveInputs: 'Each arm opens its own connection and reads a fresh finalized checkpoint; the checkpoints are recorded per arm and may differ by a block or more. The baseline reads sequentially; collectPolicyInputs reads observation, registry and listing in parallel and then the stored report.',
    timing: 'wallMs: the arm\'s wall clock including its connection handshake and teardown. networkWaitMs: the union of intervals during which at least one network call was in flight (fetch for JSON-RPC, WsProvider.send and connect for the native node). computeMs = wallMs - networkWaitMs. networkCallSumMs: the sum of individual call durations; it exceeds networkWaitMs when calls overlap. connectMs: the WebSocket handshake. Every call is listed in callLog.',
    counterbalancing: 'Live arm order alternates per scenario and is recorded. Scripts have no learning effect; the alternation only balances connection warm-up and node load.',
    correctness: 'correct: the decision equals the predefined expectation; false-enable: enabled when the expectation was refuse; false-refusal: refused when the expectation was enable; incomplete: the arm threw and produced no decision.',
    operatorActions: OPERATOR_ACTIONS.definition, assistance: ASSISTANCE.definition,
    versions: { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), uncommittedChanges: dirty === null ? null : dirty.split('\n').filter(Boolean).length, node: process.version, platform: `${process.platform} ${os.release()} ${process.arch}`, dependencies: { ethers: version('ethers'), '@polkadot/api': version('@polkadot/api'), '@polkadot/util-crypto': version('@polkadot/util-crypto'), '@noble/hashes': version('@noble/hashes') } },
    endpoints: { evmRpc: NETWORKS.testnet.evmRpcUrl, nativeRpc: NETWORKS.testnet.substrateRpcUrl, network: NETWORKS.testnet.name, chainId: NETWORKS.testnet.chainId, genesisHash: NETWORKS.testnet.genesisHash },
    writes: 'none: no wallet is loaded and nothing is signed; all chain access is read-only',
  };
}

const tap = installNetworkTap();
try {
  const startedAt = new Date().toISOString();
  const scenarios = [];
  for (const scenario of SCENARIOS) scenarios.push({ ...(await loadScenario(scenario)), capture_path: scenario.capture });
  const failures = [];
  const runs = [];
  if (options.mode !== 'live') runs.push(await runMode({ tap, mode: 'deterministic', scenarios, failures }));
  if (options.mode !== 'deterministic') runs.push(await runMode({ tap, mode: 'live', scenarios, failures }));
  const results = {
    schema: 'revivecheck.fair-value-benchmark.v1', startedAt, finishedAt: new Date().toISOString(),
    scope: 'Author-run scripted comparison on the public Portaldot V3 testnet nodes. N = 1 run per mode. No human participant, no external maintainer, no adoption or willingness-to-pay evidence. Owner, reviewer and operator are project-controlled accounts. Case-level findings only.',
    protocol: protocol(), installation: await installation(scenarios[0]), operatorActions: OPERATOR_ACTIONS, assistance: ASSISTANCE, runs, failures,
    reconstruction: runs.flatMap((run) => run.scenarios.filter((scenario) => scenario.arms).flatMap((scenario) => ['baseline', 'revivecheck'].map((arm) => ({ mode: run.mode, scenario: scenario.id, arm, artifact: scenario.arms[arm].artifact, ...(scenario.arms[arm].reconstruction || { requiredPresent: 0, requiredTotal: 6, extrasPresent: 0, extrasTotal: 4, absent: ['no artifact'], consistent: false }) })))),
  };
  const written = await writeJson(outFile, results);
  console.log(`\nresults: ${written}; artifacts under ${display(artifactsDir)}; failures: ${failures.length}`);
  for (const failure of failures) console.log(`  FAILURE ${failure.mode} ${failure.scenario} ${failure.arm}: ${failure.error}`);
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error?.message || error) }));
  process.exitCode = 1;
} finally {
  tap.uninstall();
  // The node client can keep the event loop alive after disconnect (observed on 2026-10-25: a finished run
  // stayed resident for more than ten minutes). Everything is written by now, so exit once stdout has flushed.
  process.stdout.write('', () => process.exit(process.exitCode ?? 0));
}
