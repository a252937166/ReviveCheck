import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { keccakAsHex } from '@polkadot/util-crypto';
import { NETWORK, assertTestnet, connectNative, evmRpc, inspectChain } from './chain.js';
import { buildRunBinding, canonical, compareRuns, environmentForRun, fingerprint, overall, sealRun, validateImportedRun } from './report.js';
import { lifecycleForRun } from './lifecycle.js';

const PUBLIC_ROOT = 'https://a252937166.github.io/ReviveCheck/';
const ENVIRONMENT_KEYS = ['chainId', 'genesisHash', 'specName', 'specVersion', 'transactionVersion', 'stateVersion', 'constantsHash'];
const PARAMETER_KEYS = ['chainId', 'nativeToEthRatio', 'allowEVMBytecode', 'autoMap', 'depositPerByte', 'depositPerItem', 'gasScale'];
const hexHash = /^0x[0-9a-fA-F]{64}$/;
// Codec quantities/Text expose toHex too; their human scalar value must use
// toString. Hash codecs already stringify to a complete 0x hash.
const str = value => value?.toString?.() ?? value?.toHex?.() ?? '';
const caveat = 'This is a current observed testnet baseline, not proof of pre-upgrade chronology. Changed runtime context does not prove an application repair. No signing, publishing, review inheritance, or automatic baseline replacement is performed.';

export class IdentityMismatch extends Error {
  constructor(message) { super(message); this.name = 'IdentityMismatch'; }
}

function completeEnvironment(network) {
  const environment = environmentForRun({ network });
  for (const key of ENVIRONMENT_KEYS) if (!environment[key]) throw new Error(`Finalized environment evidence is missing ${key}.`);
  if (!hexHash.test(environment.genesisHash) || !hexHash.test(environment.constantsHash)) throw new Error('Environment fingerprints are malformed.');
  for (const key of ['chainId', 'specVersion', 'transactionVersion', 'stateVersion']) if (!/^\d+$/.test(environment[key])) throw new Error(`Invalid runtime ${key}.`);
  return environment;
}

function assertPinnedEnvironment(environment) {
  if (environment.chainId !== String(NETWORK.chainId) || environment.genesisHash.toLowerCase() !== NETWORK.genesisHash) throw new IdentityMismatch('Observed identity differs from the pinned V3 testnet. Stop for manual network review; do not repin automatically.');
}

function requiredCheckpoint(network) {
  const checkpoint = { number: str(network.finalizedBlockNumber), nativeHash: str(network.finalizedNativeBlockHash), evmHash: str(network.finalizedEvmBlockHash) };
  if (!/^\d+$/.test(checkpoint.number) || !hexHash.test(checkpoint.nativeHash) || !hexHash.test(checkpoint.evmHash)) throw new Error('A complete finalized native/EVM checkpoint is required.');
  return checkpoint;
}

export function createBaseline(run, { id = 'current-2026-10-23', label = 'Current observed V3 testnet baseline' } = {}) {
  validateImportedRun(run);
  if (run.mode !== 'live' || run.scope !== 'portaldot-testnet-readonly') throw new Error('An upgrade baseline requires a real read-only testnet report.');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(id) || typeof label !== 'string' || label.length > 160) throw new Error('Invalid baseline identifier or label.');
  for (const key of ['network.chain-id', 'network.finalized']) if (run.checks.find(check => check.id === key)?.status !== 'passed') throw new Error('Baseline network identity and finalized checkpoint must have passed.');
  const binding = buildRunBinding(run), environment = completeEnvironment(run.network);
  assertPinnedEnvironment(environment);
  const manifest = {
    schema: 'revivecheck.baseline.v1', id, label, chronology: 'current-observed-baseline',
    observedAt: run.completedAt, observedAtEpochMs: Date.parse(run.completedAt),
    reportHash: run.evidenceHash, currentBaselineReportHash: run.evidenceHash, reportPath: `../reports/${run.evidenceHash}.json`,
    reportUrl: `${PUBLIC_ROOT}reports/${run.evidenceHash}.json`, viewerUrl: `${PUBLIC_ROOT}?report=${run.evidenceHash}#/review`,
    plan: binding.plan, planHash: binding.planHash, environment, environmentHash: fingerprint(environment),
    checkpoint: requiredCheckpoint(run.network), status: run.status,
    checkSummary: { passed: run.checks.filter(check => check.status === 'passed').length, total: run.checks.length }, caveat,
  };
  return { ...manifest, manifestHash: fingerprint(manifest) };
}

export function verifyBaseline(manifest, run) {
  try {
    return canonical(manifest) === canonical(createBaseline(run, { id: manifest.id, label: manifest.label }));
  } catch { return false; }
}

async function bounded(promise, signal) {
  if (signal?.aborted) throw signal.reason;
  let abort;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal?.removeEventListener('abort', abort); }
}

// Only identity, finalized linkage, runtime version and constants are read here.
// Account, funding, asset and contract acceptance reads are deferred until drift.
export async function observeEnvironmentWithClients({ api, rpc, signal, now = () => new Date() }) {
  signal ??= AbortSignal.timeout(25_000);
  const chainId = await bounded(rpc('eth_chainId', []), signal);
  if (!/^0x[0-9a-fA-F]+$/.test(str(chainId))) throw new Error('EVM chain identity is unavailable or malformed.');
  try { assertTestnet(api, chainId); }
  catch (error) { throw new IdentityMismatch(error.message); }
  const nativeHash = await bounded(api.rpc.chain.getFinalizedHead(), signal);
  if (!hexHash.test(str(nativeHash))) throw new Error('Finalized native hash is malformed.');
  const header = await bounded(api.rpc.chain.getHeader(nativeHash), signal);
  if (!/^\d+$/.test(str(header.number))) throw new Error('Finalized block number is malformed.');
  const number = BigInt(str(header.number));
  const at = await bounded(api.at(nativeHash), signal);
  const block = await bounded(rpc('eth_getBlockByNumber', [`0x${number.toString(16)}`, false]), signal);
  const mapped = await bounded(at.call.reviveApi.ethBlockHash(number.toString()), signal);
  const evmHash = mapped.isNone ? '' : str(mapped.unwrap ? mapped.unwrap() : mapped);
  if (!hexHash.test(evmHash) || !block || !/^0x[0-9a-fA-F]+$/.test(str(block.number)) || BigInt(block.number) !== number || str(block.hash).toLowerCase() !== evmHash.toLowerCase()) throw new Error('The interfaces do not establish the same finalized checkpoint.');
  if (!api.rpc.state?.getRuntimeVersion) throw new Error('The finalized runtime version is unavailable; head metadata is not a substitute.');
  const version = await bounded(api.rpc.state.getRuntimeVersion(nativeHash), signal);
  if (!at.consts?.revive || !at.consts?.balances) throw new Error('Finalized runtime constants are unavailable.');
  const parameters = Object.fromEntries(PARAMETER_KEYS.map(key => [key, str(at.consts.revive[key]) || null]));
  parameters.existentialDeposit = str(at.consts.balances.existentialDeposit) || null;
  if (Object.values(parameters).some(value => value === null)) throw new Error('The finalized parameter snapshot is incomplete.');
  for (const key of ['chainId', 'nativeToEthRatio', 'depositPerByte', 'depositPerItem', 'gasScale', 'existentialDeposit']) if (!/^\d+$/.test(parameters[key])) throw new Error(`Finalized parameter ${key} is malformed.`);
  for (const key of ['allowEVMBytecode', 'autoMap']) if (!['true', 'false'].includes(parameters[key])) throw new Error(`Finalized parameter ${key} is not a boolean.`);
  if (parameters.chainId !== String(NETWORK.chainId)) throw new IdentityMismatch('Finalized native runtime chain ID differs from the pinned V3 testnet. Manual review is required.');
  const network = { observedChainId: Number(BigInt(chainId)), nativeGenesisHash: str(api.genesisHash).toLowerCase(), finalizedBlockNumber: number.toString(), finalizedNativeBlockHash: str(nativeHash), finalizedEvmBlockHash: evmHash, parameterSnapshot: parameters, constantsHash: keccakAsHex(JSON.stringify(parameters)) };
  for (const key of ['specName', 'specVersion', 'transactionVersion', 'stateVersion']) network[key] = str(version[key]);
  const environment = completeEnvironment(network);
  assertPinnedEnvironment(environment);
  const observedAt = now().toISOString();
  return { schema: 'revivecheck.environment.v1', observedAt, observedAtEpochMs: Date.parse(observedAt), network, environment, environmentHash: fingerprint(environment), checkpoint: requiredCheckpoint(network) };
}

export async function observeEnvironment({ signal } = {}) {
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000);
  let api;
  try {
    api = await connectNative({ signal: boundedSignal });
    return await observeEnvironmentWithClients({ api, rpc: (method, params) => evmRpc(method, params, { signal: boundedSignal }), signal: boundedSignal });
  } finally {
    if (api) await Promise.race([api.disconnect().catch(() => {}), delay(1500, undefined, { ref: false })]);
  }
}

function assessRecheck(baseline, run, environmentHash) {
  let comparison = compareRuns(baseline, run), reconfirmed = false, identityMismatch = false;
  try {
    const environment = completeEnvironment(run.network);
    assertPinnedEnvironment(environment);
    requiredCheckpoint(run.network);
    reconfirmed = fingerprint(environment) !== environmentHash && run.checks.find(check => check.id === 'network.chain-id')?.status === 'passed' && run.checks.find(check => check.id === 'network.finalized')?.status === 'passed';
  } catch (error) { identityMismatch = error instanceof IdentityMismatch; }
  if (!reconfirmed) comparison = { ...comparison, compatible: false, comparisonKind: 'environment-unconfirmed', reason: 'The fresh acceptance run did not reconfirm a complete changed environment. No repair or upgrade success can be established.', changes: [], summary: { improved: 0, regressed: 0, unchanged: 0, changed: 0 } };
  return { comparison, reconfirmed, identityMismatch };
}

function validatePreviousResult(previous, baseline, manifest) {
  if (!previous || previous.schema !== 'revivecheck.upgrade-check.v1' || previous.baselineReportHash !== baseline.evidenceHash || previous.baselineEnvironmentHash !== manifest.environmentHash) throw new Error('Previous result does not match this exact immutable baseline.');
  if (!['environment-changed', 'recheck-incomplete'].includes(previous.status) || !previous.run || !previous.comparison) throw new Error('Previous result lacks a verifiable sealed run/comparison. Use --force only for deliberate manual revalidation.');
  validateImportedRun(previous.run);
  if (previous.run.mode !== 'live' || previous.run.scope !== baseline.scope || previous.run.projectId !== baseline.projectId || previous.run.previousRunId !== baseline.id || previous.run.trigger !== 'upgrade-recheck' || canonical(previous.run.input) !== canonical(baseline.input)) throw new Error('Previous recheck is not the same baseline plan.');
  const environment = completeEnvironment(previous.observation?.network);
  assertPinnedEnvironment(environment);
  requiredCheckpoint(previous.observation.network);
  const hash = fingerprint(environment);
  if (hash !== previous.observedEnvironmentHash || hash !== previous.observation.environmentHash || canonical(environment) !== canonical(previous.observation.environment)) throw new Error('Previous observation fingerprint is inconsistent.');
  const assessed = assessRecheck(baseline, previous.run, manifest.environmentHash);
  if (assessed.identityMismatch || canonical(previous.comparison) !== canonical(assessed.comparison) || (previous.status === 'environment-changed') !== assessed.reconfirmed) throw new Error('Previous comparison/status does not match its sealed reports.');
  return { observedEnvironmentHash: hash, runEnvironmentHash: buildRunBinding(previous.run).environmentHash, status: previous.status, reportHash: previous.run.evidenceHash };
}

export async function checkUpgrade(manifest, sourceRun, { observe = observeEnvironment, inspect = inspectChain, signal, now = () => new Date(), newId = randomUUID, previousResult, force = false } = {}) {
  if (!verifyBaseline(manifest, sourceRun)) throw new Error('Baseline manifest/report integrity or binding is invalid.');
  const baseline = structuredClone(sourceRun);
  signal ??= AbortSignal.timeout(45_000);
  const result = { schema: 'revivecheck.upgrade-check.v1', baselineId: manifest.id, baselineReportHash: baseline.evidenceHash, baselineEnvironmentHash: manifest.environmentHash, checkedAt: now().toISOString(), signing: false, publishing: false, baselineReplaced: false, quiet: false, caveat };
  let observation;
  try {
    observation = await bounded(observe({ signal }), signal);
    const environment = completeEnvironment(observation.network);
    assertPinnedEnvironment(environment);
    requiredCheckpoint(observation.network);
    if (canonical(observation.environment) !== canonical(environment) || observation.environmentHash !== fingerprint(environment)) throw new Error('Observed environment fingerprint is inconsistent.');
  } catch (error) {
    return { ...result, status: error instanceof IdentityMismatch ? 'identity-mismatch' : 'unavailable', manualReviewRequired: error instanceof IdentityMismatch, reason: String(error.message).slice(0, 280) };
  }
  const changes = ENVIRONMENT_KEYS.filter(key => manifest.environment[key] !== observation.environment[key]).map(key => ({ key, before: manifest.environment[key], after: observation.environment[key] }));
  const observed = { ...result, observation, observedEnvironmentHash: observation.environmentHash, changes };
  if (!changes.length) return { ...observed, status: 'unchanged', quiet: true, reason: 'No runtime/environment drift was observed. No acceptance run was created; this is not an application-health recheck.' };

  if (previousResult && !force) {
    const previous = validatePreviousResult(previousResult, baseline, manifest);
    if (previous.observedEnvironmentHash === observation.environmentHash) {
      if (previous.status === 'recheck-incomplete') return { ...observed, status: 'recheck-incomplete', previousResultUsed: true, previousReportHash: previous.reportHash, manualReviewRequired: true, requiresForce: true, reason: 'This unchanged drift already has an incomplete recheck. Preserve its evidence; use --force only after manual revalidation.' };
      if (previous.runEnvironmentHash === observation.environmentHash) return { ...observed, status: 'already-rechecked', quiet: true, previousResultUsed: true, previousReportHash: previous.reportHash, reason: 'This exact baseline and observed environment already have a verified sealed recheck/comparison. No new run or review was created.' };
    }
  }

  const input = structuredClone(baseline.input), startedAt = now().toISOString();
  let inspected;
  try { inspected = await bounded(inspect(structuredClone(input), { signal }), signal); }
  catch (error) { return { ...observed, status: 'recheck-incomplete', manualReviewRequired: true, reason: String(error.message).slice(0, 280) }; }
  const run = sealRun({ id: newId(), projectId: baseline.projectId, projectName: baseline.projectName, release: baseline.release, input, mode: 'live', scope: 'portaldot-testnet-readonly', scenario: null, trigger: 'upgrade-recheck', startedAt, completedAt: now().toISOString(), previousRunId: baseline.id, status: overall(inspected.checks), checks: inspected.checks, network: inspected.network, limitations: inspected.limitations });
  validateImportedRun(run);
  const { comparison, reconfirmed, identityMismatch } = assessRecheck(baseline, run, manifest.environmentHash);
  return { ...observed, status: identityMismatch ? 'identity-mismatch' : reconfirmed ? 'environment-changed' : 'recheck-incomplete', manualReviewRequired: true, run, comparison, lifecycle: lifecycleForRun(run, { project: input, runs: [baseline, run], reviews: [], shares: [] }), reason: reconfirmed ? 'Actual finalized environment drift created a new same-plan report. Review its checks and context caveat; the baseline is unchanged.' : comparison.reason };
}
