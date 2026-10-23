import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { keccakAsHex } from '@polkadot/util-crypto';
import { TypeRegistry } from '@polkadot/types';
import { createBaseline, verifyBaseline, observeEnvironmentWithClients, checkUpgrade, IdentityMismatch } from '../lib/baseline.js';
import { environmentForRun, fingerprint, verifyRun } from '../lib/report.js';
import { NETWORK } from '../lib/chain.js';

const originalFile = new URL('../artifacts/local/announcement-2026-10-23-live.json', import.meta.url);
const publicFile = new URL('../public/reports/0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5.json', import.meta.url);
// Tests use the retained, non-secret public evidence, not private workspace files.
const original = await readFile(publicFile, 'utf8');
const baselineRun = JSON.parse(original);
const manifest = createBaseline(baselineRun);
const clock = () => new Date('2026-10-23T09:00:00.000Z');

function clients({ version = {}, parameters = {}, genesisHash = NETWORK.genesisHash, mismatch = false, missingParameters = false } = {}) {
  const source = baselineRun.network;
  const constants = { ...source.parameterSnapshot, ...parameters };
  const finalized = { specName: 'portaldot-v3', specVersion: '3002', transactionVersion: '2', stateVersion: '1', ...version };
  const calls = [];
  const at = { consts: { revive: Object.fromEntries(Object.entries(constants).filter(([key]) => key !== 'existentialDeposit')), balances: { existentialDeposit: constants.existentialDeposit } }, call: { reviveApi: { ethBlockHash: async number => { calls.push('checkpoint-map'); assert.equal(number, source.finalizedBlockNumber); return source.finalizedEvmBlockHash; } } } };
  if (missingParameters) delete at.consts.revive.gasScale;
  const api = {
    genesisHash, consts: { revive: { chainId: NETWORK.chainId, gasScale: 'head-value-not-used' } },
    runtimeVersion: { specVersion: '9999' },
    rpc: { chain: {
      getFinalizedHead: async () => { calls.push('finalized-head'); return source.finalizedNativeBlockHash; },
      getHeader: async hash => { calls.push('finalized-header'); assert.equal(hash, source.finalizedNativeBlockHash); return { number: source.finalizedBlockNumber }; },
    }, state: { getRuntimeVersion: async hash => { calls.push('finalized-runtime'); assert.equal(hash, source.finalizedNativeBlockHash); return finalized; } } },
    at: async hash => { calls.push('finalized-at'); assert.equal(hash, source.finalizedNativeBlockHash); return at; },
  };
  const rpc = async (method, params) => {
    calls.push(method);
    if (method === 'eth_chainId') return `0x${NETWORK.chainId.toString(16)}`;
    if (method === 'eth_getBlockByNumber') {
      assert.deepEqual(params, [`0x${BigInt(source.finalizedBlockNumber).toString(16)}`, false]);
      return { number: params[0], hash: mismatch ? `0x${'ef'.repeat(32)}` : source.finalizedEvmBlockHash };
    }
    throw new Error(`Unexpected acceptance RPC in lightweight observer: ${method}`);
  };
  return { api, rpc, calls, now: clock };
}

function observation(networkPatch = {}) {
  const network = { ...structuredClone(baselineRun.network), ...networkPatch };
  const environment = environmentForRun({ network });
  return { schema: 'revivecheck.environment.v1', observedAt: clock().toISOString(), observedAtEpochMs: +clock(), network, environment, environmentHash: fingerprint(environment), checkpoint: { number: network.finalizedBlockNumber, nativeHash: network.finalizedNativeBlockHash, evmHash: network.finalizedEvmBlockHash } };
}

test('the published current baseline preserves exact report bytes, hashes and observation chronology', async () => {
  assert.equal(verifyRun(baselineRun), true);
  assert.equal(baselineRun.evidenceHash, '0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5');
  try { assert.equal(await readFile(originalFile, 'utf8'), original); }
  catch (error) { if (error.code !== 'ENOENT') throw error; } // The ignored local source is absent in a clean clone.
  assert.equal(manifest.chronology, 'current-observed-baseline');
  assert.equal(manifest.observedAtEpochMs, Date.parse(baselineRun.completedAt));
  assert.equal(manifest.checkpoint.number, '157790');
  assert.equal(manifest.planHash, baselineRun.binding.planHash);
  assert.equal(manifest.environmentHash, baselineRun.binding.environmentHash);
  assert.equal(verifyBaseline(manifest, baselineRun), true);
  assert.equal(verifyBaseline({ ...manifest, observedAtEpochMs: manifest.observedAtEpochMs - 1 }, baselineRun), false);
  const publishedManifest = JSON.parse(await readFile(new URL('../public/baselines/current-2026-10-23.json', import.meta.url), 'utf8'));
  assert.deepEqual(publishedManifest, manifest);
  const index = JSON.parse(await readFile(new URL('../public/reports/index.json', import.meta.url), 'utf8'));
  assert.ok(index.reports.some(item => item.evidenceHash.startsWith('15baa9e')));
  assert.equal(index.reports.find(item => item.evidenceHash === baselineRun.evidenceHash).role, 'upgrade-baseline');
});

test('lightweight observation pins runtime and constants to the finalized checkpoint without asset/account calls', async () => {
  const fake = clients();
  const current = await observeEnvironmentWithClients(fake);
  assert.equal(current.environmentHash, manifest.environmentHash);
  assert.equal(current.environment.specVersion, '3002', 'head runtime version must not race the finalized observation');
  assert.equal(current.network.parameterSnapshot.gasScale, '5', 'head constants must not substitute for checkpoint constants');
  assert.equal(current.observedAtEpochMs, +clock());
  assert.deepEqual(fake.calls, ['eth_chainId', 'finalized-head', 'finalized-header', 'finalized-at', 'eth_getBlockByNumber', 'checkpoint-map', 'finalized-runtime']);
});

test('actual polkadot codecs preserve decimal quantities, boolean scalars, Text names and hex hashes', async () => {
  const registry = new TypeRegistry(), source = baselineRun.network;
  const fake = clients();
  const rawAt = await fake.api.at(source.finalizedNativeBlockHash);
  fake.api.genesisHash = registry.createType('Hash', NETWORK.genesisHash);
  fake.api.consts.revive.chainId = registry.createType('u64', NETWORK.chainId);
  fake.api.rpc.chain.getFinalizedHead = async () => registry.createType('Hash', source.finalizedNativeBlockHash);
  fake.api.rpc.chain.getHeader = async () => ({ number: registry.createType('u32', source.finalizedBlockNumber) });
  fake.api.rpc.state.getRuntimeVersion = async () => Object.fromEntries(['specName', 'specVersion', 'transactionVersion', 'stateVersion'].map(key => [key, registry.createType(key === 'specName' ? 'Text' : 'u32', source[key])]));
  for (const [key, value] of Object.entries(rawAt.consts.revive)) rawAt.consts.revive[key] = registry.createType(['allowEVMBytecode', 'autoMap'].includes(key) ? 'bool' : 'u128', value);
  rawAt.consts.balances.existentialDeposit = registry.createType('u128', source.parameterSnapshot.existentialDeposit);
  rawAt.call.reviveApi.ethBlockHash = async () => registry.createType('Option<Hash>', source.finalizedEvmBlockHash);
  fake.api.at = async hash => { assert.equal(hash.toString(), source.finalizedNativeBlockHash); return rawAt; };
  const current = await observeEnvironmentWithClients(fake);
  assert.equal(current.checkpoint.number, '157790');
  assert.equal(current.environment.specName, 'portaldot-v3');
  assert.equal(current.network.parameterSnapshot.allowEVMBytecode, 'true');
  assert.equal(current.environmentHash, manifest.environmentHash);
});

test('new checkpoint and different application code alone do not trigger an upgrade recheck', async () => {
  let runs = 0;
  const next = observation({ finalizedBlockNumber: '157999', contractCodeHash: `0x${'12'.repeat(32)}` });
  const result = await checkUpgrade(manifest, baselineRun, { observe: async () => next, inspect: async () => { runs++; throw new Error('Unexpected acceptance'); }, now: clock });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.quiet, true);
  assert.equal(runs, 0);
  assert.equal(result.run, undefined);
  assert.equal(result.baselineReplaced, false);
  assert.match(result.reason, /not an application-health recheck/);
});

test('actual runtime or constant changes create a new same-plan run with context caveat and no inherited review', async () => {
  for (const patch of [{ specVersion: '3003' }, { transactionVersion: '3' }, { stateVersion: '2' }, { constantsHash: keccakAsHex('changed-runtime-constants') }]) {
    let calls = 0;
    const current = observation(patch);
    const result = await checkUpgrade(manifest, baselineRun, { observe: async () => current, inspect: async input => {
      calls++;
      assert.deepEqual(input, baselineRun.input);
      input.release = 'mutation must not affect the sealed plan';
      return { network: current.network, checks: structuredClone(baselineRun.checks), limitations: baselineRun.limitations };
    }, now: clock, newId: () => 'after-upgrade' });
    assert.equal(result.status, 'environment-changed');
    assert.equal(result.quiet, false);
    assert.equal(calls, 1);
    assert.equal(verifyRun(result.run), true);
    assert.deepEqual(result.run.input, baselineRun.input);
    assert.equal(result.run.previousRunId, baselineRun.id);
    assert.equal(result.run.binding.planHash, manifest.planHash);
    assert.notEqual(result.run.evidenceHash, baselineRun.evidenceHash);
    assert.equal(result.comparison.comparisonKind, 'runtime-change');
    assert.equal(result.comparison.summary.improved, 0);
    assert.equal(result.comparison.summary.regressed, 0);
    assert.match(result.comparison.caveat, /not counted as a repair/);
    assert.equal(result.lifecycle.review.status, 'unreviewed');
    assert.equal(result.lifecycle.publishing.status, 'not-shared');
    assert.equal(JSON.stringify(baselineRun, null, 2), original.trim());
  }
});

test('unexpected genesis or chain identity stops for manual review before acceptance', async () => {
  const fake = clients({ genesisHash: `0x${'34'.repeat(32)}` });
  await assert.rejects(observeEnvironmentWithClients(fake), IdentityMismatch);
  assert.deepEqual(fake.calls, ['eth_chainId']);
  let runs = 0;
  for (const patch of [{ nativeGenesisHash: `0x${'34'.repeat(32)}` }, { observedChainId: 1 }]) {
    const result = await checkUpgrade(manifest, baselineRun, { observe: async () => observation(patch), inspect: async () => { runs++; }, now: clock });
    assert.equal(result.status, 'identity-mismatch');
    assert.equal(result.manualReviewRequired, true);
    assert.equal(result.run, undefined);
    assert.equal(result.baselineReplaced, false);
  }
  assert.equal(runs, 0);
});

test('incomplete constants, absent finalized version and mismatched checkpoints cannot claim an unchanged environment', async () => {
  const noVersion = clients();
  delete noVersion.api.rpc.state.getRuntimeVersion;
  for (const fake of [clients({ missingParameters: true }), clients({ mismatch: true }), noVersion]) {
    const result = await checkUpgrade(manifest, baselineRun, { observe: () => observeEnvironmentWithClients(fake), inspect: async () => { throw new Error('Acceptance must not run'); }, now: clock });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.quiet, false);
    assert.equal(result.run, undefined);
  }
});

test('transient drift not reconfirmed by full acceptance never receives improvement credit', async () => {
  const result = await checkUpgrade(manifest, baselineRun, { observe: async () => observation({ specVersion: '3003' }), inspect: async () => ({ network: baselineRun.network, checks: baselineRun.checks, limitations: baselineRun.limitations }), now: clock, newId: () => 'transient-after' });
  assert.equal(result.status, 'recheck-incomplete');
  assert.equal(result.comparison.compatible, false);
  assert.equal(result.comparison.comparisonKind, 'environment-unconfirmed');
  assert.equal(result.comparison.summary.improved, 0);
  assert.equal(result.lifecycle.review.status, 'unreviewed');
});

test('aborted readiness is bounded and baseline tampering is rejected before clients run', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Readiness deadline')), 10);
  try {
    const result = await checkUpgrade(manifest, baselineRun, { observe: () => new Promise(() => {}), signal: controller.signal, now: clock });
    assert.equal(result.status, 'unavailable');
    assert.match(result.reason, /deadline/);
  } finally { clearTimeout(timer); }
  await assert.rejects(checkUpgrade({ ...manifest, planHash: 'edited' }, baselineRun, { observe: () => { throw new Error('Client must not run'); } }), /integrity or binding/);
});

test('CLI help and invalid timeout terminate before connecting to the network', () => {
  const file = new URL('../scripts/check-upgrade.js', import.meta.url);
  const help = spawnSync(process.execPath, [file.pathname, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
  const invalid = spawnSync(process.execPath, [file.pathname, '--timeout-ms', '0'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).status, 'error');
  assert.match(invalid.stderr, /1000/);
});

test('a verified previous recheck suppresses duplicate runs, while force deliberately creates a new record', async () => {
  const current=observation({specVersion:'3003'});
  const inspect=async()=>({network:current.network,checks:baselineRun.checks,limitations:baselineRun.limitations});
  const previous=await checkUpgrade(manifest,baselineRun,{observe:async()=>current,inspect,now:clock,newId:()=> 'first-upgrade'});
  let repeats=0;
  const skipped=await checkUpgrade(manifest,baselineRun,{observe:async()=>current,inspect:async()=>{repeats++;throw Error('Must not repeat');},previousResult:previous,now:clock});
  assert.equal(skipped.status,'already-rechecked');
  assert.equal(skipped.quiet,true);
  assert.equal(skipped.previousReportHash,previous.run.evidenceHash);
  assert.equal(skipped.run,undefined);
  assert.equal(repeats,0);
  const forced=await checkUpgrade(manifest,baselineRun,{observe:async()=>current,inspect,previousResult:previous,force:true,now:clock,newId:()=> 'manual-revalidation'});
  assert.equal(forced.status,'environment-changed');
  assert.notEqual(forced.run.evidenceHash,previous.run.evidenceHash);
  assert.equal(forced.lifecycle.review.status,'unreviewed');
  assert.equal(verifyBaseline(manifest,baselineRun),true);
});

test('an altered previous comparison cannot suppress an acceptance run', async () => {
  const current=observation({specVersion:'3003'});
  const previous=await checkUpgrade(manifest,baselineRun,{observe:async()=>current,inspect:async()=>({network:current.network,checks:baselineRun.checks,limitations:baselineRun.limitations}),now:clock,newId:()=> 'previous-upgrade'});
  previous.comparison.summary.improved=99;
  await assert.rejects(checkUpgrade(manifest,baselineRun,{observe:async()=>current,previousResult:previous,now:clock}),/comparison\/status/);
});

test('an incomplete recheck is retained until deliberate manual revalidation', async () => {
  const current=observation({specVersion:'3003'});
  const previous=await checkUpgrade(manifest,baselineRun,{observe:async()=>current,inspect:async()=>({network:baselineRun.network,checks:baselineRun.checks,limitations:baselineRun.limitations}),now:clock,newId:()=> 'incomplete-upgrade'});
  let repeats=0;
  const skipped=await checkUpgrade(manifest,baselineRun,{observe:async()=>current,previousResult:previous,inspect:async()=>{repeats++;},now:clock});
  assert.equal(skipped.status,'recheck-incomplete');
  assert.equal(skipped.previousResultUsed,true);
  assert.equal(skipped.requiresForce,true);
  assert.equal(skipped.run,undefined);
  assert.equal(repeats,0);
});
