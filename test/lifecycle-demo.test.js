import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AbiCoder } from 'ethers';
import { stringToU8a } from '@polkadot/util';
import { blake2AsHex, encodeAddress } from '@polkadot/util-crypto';
import { inspectWithClients, NETWORK } from '../lib/chain.js';
import { inspectPromotionWithClients, PROMOTION_CHECK_IDS } from '../lib/promotion.js';
import { replayWithClients } from '../lib/replay.js';
import { attestationRemark, parseAttestationRemark, verifyAttestationWithApi, locateExtrinsic } from '../lib/attestation.js';
import { sealRun, overall, fingerprint, canonical, compareRuns, validateImportedRun, buildRunBinding } from '../lib/report.js';
import { validateReportShape } from '../lib/share.js';
import { reportExplorerEvidence, isApprovedExplorerUrl, LIVE_EXPLORER_ORIGIN } from '../lib/explorer.js';
import { normalizePlan } from '../lib/plan.js';
import { demoPlan, tokenListDocument, DEMO_PRECOMPILE } from '../lib/demo.js';
import { NETWORKS, blockUrl, extrinsicUrl, networkForScope } from '../lib/networks.js';

const native = encodeAddress(new Uint8Array(32).fill(1), 42);
const h160 = `0x${'11'.repeat(20)}`;
const nativeHash = `0x${'44'.repeat(32)}`, evmHash = `0x${'55'.repeat(32)}`;
const word = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const abiString = (value) => AbiCoder.defaultAbiCoder().encode(['string'], [value]);
const some = (value) => ({ isSome: true, isNone: false, unwrap: () => value });
const none = { isSome: false, isNone: true };
const bytes = (text) => ({ toUtf8: () => text });

function testnetClients({ decimals = 6, evmDecimals = decimals, symbol = 'pUSD', evmSymbol = symbol, specVersion = 3002 } = {}) {
  const api = {
    genesisHash: NETWORK.genesisHash,
    runtimeVersion: { specName: 'portaldot-v3', specVersion, transactionVersion: 2, stateVersion: 1 },
    registry: { chainDecimals: [14], chainTokens: ['tPOT'] },
    consts: { revive: { chainId: NETWORK.chainId }, balances: { existentialDeposit: 10n } },
    rpc: { chain: { getFinalizedHead: async () => nativeHash, getHeader: async () => ({ number: 100 }), getBlockHash: async () => nativeHash } },
    call: { reviveApi: { ethBlockHash: async () => evmHash, accountId: async () => native, address: async () => h160 } },
    query: { assets: {
      asset: async () => some({ owner: native, supply: '100000000000' }),
      metadata: async () => ({ decimals, symbol: bytes(symbol), name: bytes('Portaldot USD (test)') }),
      account: async () => some({ balance: '99543035000' }),
    } },
  };
  api.at = async () => api;
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return '0x190f1ca9';
    if (method === 'eth_getBlockByNumber') return { number: '0x64', hash: evmHash };
    if (method !== 'eth_call') throw new Error(`Unexpected ${method}`);
    assert.deepEqual(params[1], { blockHash: evmHash, requireCanonical: true });
    const selector = params[0].data.slice(0, 10);
    return { '0x18160ddd': word('100000000000'), '0x70a08231': word('99543035000'), '0x313ce567': word(evmDecimals), '0x95d89b41': abiString(evmSymbol), '0x06fdde03': abiString('Portaldot USD (test)') }[selector];
  };
  return { api, rpc };
}

const byId = (report, id) => report.checks.find((check) => check.id === id);
const seal = (input, result, overrides = {}) => sealRun({ id: overrides.id || 'run', projectId: 'demo', projectName: 'pUSD token list', release: input.release, input, mode: 'live', scope: 'portaldot-testnet-readonly', startedAt: '2026-10-23T10:00:00Z', completedAt: overrides.completedAt || '2026-10-23T10:00:01Z', status: overall(result.checks), checks: result.checks, network: result.network, limitations: result.limitations, ...overrides });

test('demo releases are valid plans and standard token-list documents', () => {
  for (const version of ['v1.0.0', 'v1.0.1']) {
    const plan = normalizePlan(demoPlan(version));
    assert.equal(plan.listing.address, DEMO_PRECOMPILE.toLowerCase());
    assert.equal(tokenListDocument(version).tokens[0].address, DEMO_PRECOMPILE);
  }
  assert.equal(demoPlan('v1.0.0').listing.decimals, 18);
  assert.equal(demoPlan('v1.0.1').listing.decimals, 6);
  assert.throws(() => normalizePlan({ profile: 'contract', listing: demoPlan('v1.0.1').listing }), /native-asset profile/);
  assert.throws(() => normalizePlan({ ...demoPlan('v1.0.1'), listing: { ...demoPlan('v1.0.1').listing, address: '0x1234' } }), /H160/);
});

test('a token-list entry with the Ethereum default of 18 decimals fails against both interfaces', async () => {
  const report = await inspectWithClients(demoPlan('v1.0.0'), testnetClients());
  assert.deepEqual(report.checks.map((check) => check.id), ['network.chain-id', 'network.finalized', 'asset.native-erc20', 'token.listing']);
  const listing = byId(report, 'token.listing');
  assert.equal(listing.status, 'failed');
  assert.equal(listing.observed, 'decimals: listed 18, chain 6');
  assert.match(listing.remediation, /decimals \(6\)/);
  assert.deepEqual(listing.evidence.fields.find((field) => field.field === 'decimals'), { field: 'decimals', claimed: 18, native: 6, evm: 6, status: 'failed' });
  assert.equal(byId(report, 'asset.native-erc20').status, 'passed');
});

test('the corrected entry passes, and native/ERC-20 disagreement still fails it', async () => {
  const report = await inspectWithClients(demoPlan('v1.0.1'), testnetClients());
  assert.equal(overall(report.checks), 'passed');
  const split = await inspectWithClients(demoPlan('v1.0.1'), testnetClients({ evmSymbol: 'PUSD' }));
  assert.equal(byId(split, 'token.listing').status, 'failed');
  assert.match(byId(split, 'token.listing').observed, /native pUSD \/ ERC-20 PUSD/);
  const unverified = await inspectWithClients(demoPlan('v1.0.1'), testnetClients({ specVersion: 3003 }));
  assert.equal(byId(unverified, 'token.listing').status, 'blocked');
});

test('the corrected release is compared as the same plan and credited as one improvement', async () => {
  const before = seal(demoPlan('v1.0.0'), await inspectWithClients(demoPlan('v1.0.0'), testnetClients()), { id: 'before', completedAt: '2026-10-23T10:00:01Z' });
  const after = seal(demoPlan('v1.0.1'), await inspectWithClients(demoPlan('v1.0.1'), testnetClients()), { id: 'after', completedAt: '2026-10-23T10:01:01Z' });
  assert.equal(buildRunBinding(before).planHash, buildRunBinding(after).planHash);
  assert.notEqual(buildRunBinding(before).releaseArtifactHash, buildRunBinding(after).releaseArtifactHash);
  const comparison = compareRuns(before, after);
  assert.equal(comparison.compatible, true);
  assert.deepEqual(comparison.summary, { improved: 1, regressed: 0, unchanged: 3, changed: 0 });
  assert.ok(comparison.inputChanges.some((change) => change.key === 'listing'));
});

function liveApi({ genesis = NETWORKS.live.genesisHash, chainId = '780780777', specVersion = '3001', asset = none } = {}) {
  const api = {
    genesisHash: genesis,
    consts: { revive: { chainId, nativeToEthRatio: '10000' }, balances: { existentialDeposit: '10000000000000' } },
    rpc: { chain: { getFinalizedHead: async () => nativeHash, getHeader: async () => ({ number: 761073 }) }, state: { getRuntimeVersion: async () => ({ specName: 'portaldot-v3', specVersion, transactionVersion: 2, stateVersion: 1 }) } },
    query: { assets: { asset: async () => asset } },
  };
  api.at = async () => api;
  return api;
}

test('promotion to V3 Live is refused by chain ID and a missing asset, and blocked by runtime and EVM access', async () => {
  const accepted = seal(demoPlan('v1.0.1'), await inspectWithClients(demoPlan('v1.0.1'), testnetClients()));
  const result = await inspectPromotionWithClients(demoPlan('v1.0.1'), accepted, { api: liveApi() });
  assert.deepEqual(result.checks.map((check) => check.id), PROMOTION_CHECK_IDS);
  const status = Object.fromEntries(result.checks.map((check) => [check.id, check.status]));
  assert.deepEqual(status, { 'network.chain-id': 'passed', 'network.finalized-native': 'passed', 'promotion.chain-id': 'failed', 'promotion.runtime': 'blocked', 'promotion.asset': 'failed', 'promotion.evm-interface': 'blocked' });
  assert.equal(overall(result.checks), 'failed');
  assert.match(result.checks.find((check) => check.id === 'promotion.runtime').observed, /3001.*3002/);
  const run = sealRun({ id: 'promotion', projectId: 'demo', projectName: 'pUSD token list', release: 'v1.0.1', input: demoPlan('v1.0.1'), mode: 'live', scope: 'portaldot-live-readonly', startedAt: '2026-10-23T10:02:00Z', completedAt: '2026-10-23T10:02:01Z', status: overall(result.checks), checks: result.checks, network: result.network, limitations: result.limitations });
  assert.equal(validateImportedRun(run), run);
  assert.equal(validateReportShape(JSON.parse(JSON.stringify(run))).scope, 'portaldot-live-readonly');
  const explorer = reportExplorerEvidence(run);
  assert.equal(explorer.eligible, true);
  assert.equal(explorer.items.find((item) => item.kind === 'finalized-block').url, `${LIVE_EXPLORER_ORIGIN}/#/blocks/${nativeHash}`);
  assert.equal(compareRuns(accepted, run).compatible, false);
  assert.match(compareRuns(accepted, run).reason, /different networks/);
});

test('a node with another genesis cannot stand in for V3 Live', async () => {
  const result = await inspectPromotionWithClients(demoPlan('v1.0.1'), null, { api: liveApi({ genesis: NETWORK.genesisHash }) });
  assert.equal(result.checks[0].status, 'failed');
  assert.ok(result.checks.slice(1).every((check) => check.status === 'blocked'));
  const matching = await inspectPromotionWithClients({ ...demoPlan('v1.0.1'), listing: { ...demoPlan('v1.0.1').listing, chainId: 780780777 } }, null, { api: liveApi({ asset: some({ supply: '1' }) }) });
  assert.equal(matching.checks.find((check) => check.id === 'promotion.chain-id').status, 'passed');
  assert.equal(matching.checks.find((check) => check.id === 'promotion.asset').status, 'passed');
});

test('replay reproduces every recorded observation at the pinned block and flags any difference', async () => {
  const run = seal(demoPlan('v1.0.1'), await inspectWithClients(demoPlan('v1.0.1'), testnetClients()));
  const replay = await replayWithClients(run, testnetClients());
  assert.equal(replay.status, 'reproduced');
  assert.equal(replay.items.length, 13);
  assert.ok(replay.items.every((item) => item.match));
  const drifted = await replayWithClients(run, testnetClients({ evmSymbol: 'pUSD2' }));
  assert.equal(drifted.status, 'differs');
  assert.deepEqual(drifted.items.filter((item) => !item.match).map((item) => item.id), ['erc20.symbol']);
  const rehearsal = await replayWithClients({ ...run, scope: 'local-rehearsal', mode: 'rehearsal' }, testnetClients());
  assert.equal(rehearsal.status, 'unavailable');
});

test('attestation remarks bind one exact report hash and decision', () => {
  const hash = 'ab'.repeat(32);
  const remark = attestationRemark({ reportHash: hash, decision: 'accepted' });
  assert.equal(remark, `revivecheck:1:review:accepted:${hash}`);
  assert.deepEqual(parseAttestationRemark(remark), { version: 1, decision: 'accepted', reportHash: hash });
  assert.equal(parseAttestationRemark(`${remark} `), null);
  assert.equal(parseAttestationRemark('revivecheck:1:review:approved:' + hash), null);
  assert.throws(() => attestationRemark({ reportHash: 'AB'.repeat(32), decision: 'accepted' }), /fingerprint/);
  assert.throws(() => attestationRemark({ reportHash: hash, decision: 'maybe' }), /accepted or changes-requested/);
});

function attestationApi({ remark, signed = true, success = true, digest, method = 'remarkWithEvent', finalizedNumber = 200 } = {}) {
  const blockHash = `0x${'66'.repeat(32)}`, extrinsicHash = `0x${'77'.repeat(32)}`;
  const remarkBytes = stringToU8a(remark);
  const extrinsic = { hash: extrinsicHash, isSigned: signed, signer: native, method: { section: 'system', method, args: [{ toU8a: () => remarkBytes }] } };
  const timestamp = { hash: `0x${'78'.repeat(32)}`, isSigned: false, method: { section: 'timestamp', method: 'set', args: [{ toString: () => '1792750000000' }] } };
  const event = (index, section, name, data = []) => ({ phase: { isApplyExtrinsic: true, asApplyExtrinsic: index }, event: { section, method: name, data } });
  const api = {
    rpc: { chain: {
      getHeader: async (hash) => ({ number: hash === blockHash ? 150 : finalizedNumber }),
      getBlockHash: async () => blockHash,
      getFinalizedHead: async () => `0x${'99'.repeat(32)}`,
      getBlock: async () => ({ block: { extrinsics: [timestamp, extrinsic] } }),
    } },
    call: { reviveApi: { address: async () => h160 } },
    query: { system: { events: async () => [event(0, 'system', 'ExtrinsicSuccess'), event(1, 'system', 'Remarked', [native, digest ?? blake2AsHex(remarkBytes, 256)]), event(1, 'system', success ? 'ExtrinsicSuccess' : 'ExtrinsicFailed')] } },
  };
  api.at = async () => api;
  return { api, blockHash, extrinsicHash };
}

test('an on-chain review attestation is verified from the block alone', async () => {
  const reportHash = 'cd'.repeat(32);
  const remark = attestationRemark({ reportHash, decision: 'accepted' });
  const { api, blockHash, extrinsicHash } = attestationApi({ remark });
  const result = await verifyAttestationWithApi(api, { extrinsicHash, blockHash });
  assert.equal(result.verified, true, result.reasons.join(' '));
  assert.equal(result.reviewer, native);
  assert.equal(result.reviewerEvm, h160);
  assert.equal(result.reportHash, reportHash);
  assert.equal(result.decision, 'accepted');
  assert.equal(result.blockNumber, '150');
  assert.equal(result.time, new Date(1792750000000).toISOString());
});

test('attestation verification rejects wrong calls, digests, failures, and unfinalized blocks', async () => {
  const remark = attestationRemark({ reportHash: 'cd'.repeat(32), decision: 'changes-requested' });
  const cases = [
    [{ remark, method: 'remark' }, /not system.remarkWithEvent/],
    [{ remark: 'hello' }, /not a ReviveCheck review attestation/],
    [{ remark, digest: `0x${'00'.repeat(32)}` }, /Remarked event does not match/],
    [{ remark, success: false }, /did not dispatch successfully/],
    [{ remark, signed: false }, /unsigned/],
    [{ remark, finalizedNumber: 120 }, /not finalized/],
  ];
  for (const [options, reason] of cases) {
    const { api, blockHash, extrinsicHash } = attestationApi(options);
    const result = await verifyAttestationWithApi(api, { extrinsicHash, blockHash });
    assert.equal(result.verified, false);
    assert.match(result.reasons.join(' '), reason);
  }
});

test('explorer index lookup accepts only complete hashes and reports missing entries as null', async () => {
  const hash = `0x${'77'.repeat(32)}`;
  await assert.rejects(locateExtrinsic(NETWORKS.testnet, '0x1234'), /complete/);
  const missing = await locateExtrinsic(NETWORKS.testnet, hash, { fetchImpl: async () => ({ status: 404, ok: false }) });
  assert.equal(missing, null);
  const found = await locateExtrinsic(NETWORKS.testnet, hash, { fetchImpl: async (url) => { assert.equal(url, `${NETWORKS.testnet.explorerApi}/extrinsics/${hash}`); return { status: 200, ok: true, json: async () => ({ indexer: { blockHeight: 150, blockHash: `0x${'66'.repeat(32)}`, extrinsicIndex: 1 } }) }; } });
  assert.deepEqual(found, { blockHash: `0x${'66'.repeat(32)}`, blockNumber: 150, extrinsicIndex: 1 });
});

test('network registry links only complete hashes on the two official explorers', () => {
  assert.equal(networkForScope('portaldot-live-readonly'), NETWORKS.live);
  assert.equal(NETWORKS.testnet.genesisHash, NETWORK.genesisHash);
  assert.equal(NETWORKS.testnet.chainId, NETWORK.chainId);
  assert.equal(blockUrl(NETWORKS.live, nativeHash.toUpperCase().replace('0X', '0x')), `${NETWORKS.live.explorer}/#/blocks/${nativeHash}`);
  assert.equal(extrinsicUrl(NETWORKS.testnet, '0x12'), null);
  assert.equal(isApprovedExplorerUrl(`${NETWORKS.live.explorer}/#/blocks/${nativeHash}`), true);
  assert.equal(isApprovedExplorerUrl(`${NETWORKS.live.explorer}/#/accounts/${nativeHash}`), false);
  assert.equal(isApprovedExplorerUrl(`https://scanner-live-v3.portaldot.dev.evil.example/#/blocks/${nativeHash}`), false);
});

test('report fingerprints are byte-identical to the previous Node implementation', () => {
  const payload = { b: [1, 'two', { c: true }], a: 'Ψ', z: undefined };
  assert.equal(fingerprint(payload), createHash('sha256').update(canonical(payload)).digest('hex'));
});
