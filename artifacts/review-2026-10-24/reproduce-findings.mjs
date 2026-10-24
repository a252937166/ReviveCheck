#!/usr/bin/env node
// Offline diagnostic evidence only. No production files, wallets or networks are used.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let blockedFetchAttempts = 0;
globalThis.fetch = async () => {
  blockedFetchAttempts += 1;
  throw new Error('Network fetch is prohibited in this offline review.');
};

const [commonModule, utilModule, vmModule, ethersModule, registryCompiler, listCompiler, replayModule, reportModule] = await Promise.all([
  import('@ethereumjs/common'), import('@ethereumjs/util'), import('@ethereumjs/vm'), import('ethers'),
  import('../../scripts/compile-release-registry.js'), import('../../scripts/compile-token-list.js'),
  import('../../lib/replay.js'), import('../../lib/report.js'),
]);
const { Common, Hardfork, Mainnet } = commonModule;
const { Account, bytesToHex, createAddressFromString, hexToBytes } = utilModule;
const { createVM } = vmModule;
const { Interface, encodeBytes32String } = ethersModule;
const { compileReleaseRegistry } = registryCompiler;
const { compileTokenList } = listCompiler;
const { replayWithClients } = replayModule;
const { verifyRun } = reportModule;

const root = new URL('../../', import.meta.url);
const reportPath = 'public/reports/9dd04e0685d06a1a9a0525b2b8d6ac4b259d1618184789f345a7be5e55ae0645.json';
const sourcePaths = [
  'contracts/ReleaseRegistry.sol', 'contracts/ReviveCheckGuard.sol', 'contracts/VerifiedTokenList.sol',
  'scripts/compile-release-registry.js', 'scripts/compile-token-list.js',
  'lib/replay.js', 'lib/chain.js', 'lib/plan.js', 'lib/report.js', 'lib/explorer.js',
  'package.json', 'package-lock.json', reportPath, 'public/baselines/current-2026-10-23.json',
  'artifacts/review-2026-10-24/reproduce-findings.mjs',
];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const snapshot = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(new URL(path, root)))])));
const before = await snapshot();
const retainedReport = JSON.parse(await readFile(new URL(reportPath, root), 'utf8'));
assert.equal(verifyRun(retainedReport), true, 'The unchanged retained report must pass its original fingerprint check.');
assert.equal(retainedReport.evidenceHash, '9dd04e0685d06a1a9a0525b2b8d6ac4b259d1618184789f345a7be5e55ae0645');

const TOKEN_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
contract ReviewStubToken { uint8 public decimals; constructor(uint8 d) { decimals = d; } }`;
const HARNESS_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IReleaseRegistry, ReviveCheckGuard} from "./ReviveCheckGuard.sol";
contract ReviewGuardHarness {
  function count(address registry, bytes32 releaseId, address[] memory reviewers) external view returns (uint256) {
    return ReviveCheckGuard.approvals(IReleaseRegistry(registry), releaseId, reviewers);
  }
}`;
const [registryArtifact, listArtifact] = await Promise.all([
  compileReleaseRegistry(),
  compileTokenList({ extraSources: { 'ReviewStubToken.sol': TOKEN_SOURCE, 'ReviewGuardHarness.sol': HARNESS_SOURCE } }),
]);
const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Paris }) });
const [owner, reviewer, other] = ['01', '02', '03'].map((byte) => createAddressFromString(`0x${byte.repeat(20)}`));
for (const actor of [owner, reviewer, other]) await vm.stateManager.putAccount(actor, new Account(0n, 10n ** 18n));
let inMemoryCreations = 0;
let inMemoryCalls = 0;
const mustSucceed = (result, operation) => {
  assert.equal(result.execResult.exceptionError, undefined, `${operation}: ${result.execResult.exceptionError?.error || 'must succeed'}`);
  return result;
};
const deploy = async (bytecode, abi, args = []) => {
  inMemoryCreations += 1;
  const data = `${bytecode}${args.length ? abi.encodeDeploy(args).slice(2) : ''}`;
  const result = mustSucceed(await vm.evm.runCall({ caller: owner, gasLimit: 5_000_000n, data: hexToBytes(data) }), 'in-memory deployment');
  assert.ok(result.createdAddress, 'in-memory deployment must return an address');
  return result.createdAddress;
};
const call = async (to, abi, actor, method, args = [], isStatic = false) => {
  inMemoryCalls += 1;
  return mustSucceed(await vm.evm.runCall({ caller: actor, to, gasLimit: 2_000_000n, data: hexToBytes(abi.encodeFunctionData(method, args)), isStatic }), method);
};
const read = async (to, abi, method, args = []) => abi.decodeFunctionResult(method, bytesToHex((await call(to, abi, owner, method, args, true)).execResult.returnValue));
const registryAbi = new Interface(registryArtifact.abi);
const listAbi = new Interface(listArtifact.abi);
const harnessContract = listArtifact.extra['ReviewGuardHarness.sol'].ReviewGuardHarness;
const tokenContract = listArtifact.extra['ReviewStubToken.sol'].ReviewStubToken;
const harnessAbi = new Interface(harnessContract.abi);
const tokenAbi = new Interface(tokenContract.abi);
const registryAddress = await deploy(registryArtifact.bytecode, registryAbi);
const listAddress = await deploy(listArtifact.bytecode, listAbi, [registryAddress.toString(), `0x${'00'.repeat(20)}`]);
const tokenAddress = await deploy(`0x${tokenContract.evm.bytecode.object}`, tokenAbi, [6]);
const harnessAddress = await deploy(`0x${harnessContract.evm.bytecode.object}`, harnessAbi);
const firstHash = `0x${'11'.repeat(32)}`;
const secondHash = `0x${'22'.repeat(32)}`;
const thirdHash = `0x${'33'.repeat(32)}`;
const label = encodeBytes32String('review-owner-release');
await call(registryAddress, registryAbi, owner, 'submit', [label, firstHash]);
const [releaseId] = await read(registryAddress, registryAbi, 'releaseId', [owner.toString(), label]);
await call(registryAddress, registryAbi, reviewer, 'review', [releaseId, firstHash, true]);

const [singleCount] = await read(harnessAddress, harnessAbi, 'count', [registryAddress.toString(), releaseId, [reviewer.toString()]]);
const [duplicateCount] = await read(harnessAddress, harnessAbi, 'count', [registryAddress.toString(), releaseId, [reviewer.toString(), reviewer.toString()]]);
const duplicateFinding = {
  id: 'RC-01', title: 'Duplicate reviewer addresses inflate the approval count',
  status: singleCount === 1n && duplicateCount === 2n ? 'reproduced' : 'not-reproduced',
  environment: 'Compiled current source in an in-memory Paris EVM; no Portaldot node or wallet.',
  inputs: { reviewer: reviewer.toString(), releaseId, reportHash: firstHash, requestedReviewerLists: [[reviewer.toString()], [reviewer.toString(), reviewer.toString()]] },
  observed: { uniqueApprovingAccounts: 1, singleAddressCount: Number(singleCount), duplicateAddressCount: Number(duplicateCount), naiveTwoApprovalThresholdWouldPass: duplicateCount >= 2n },
  expected: { duplicateAddressCount: 1, twoDistinctApprovalThresholdWouldPass: false },
  limitation: 'This exercises the public library through a diagnostic harness; it does not show that the deployed token-list consumer uses multi-reviewer thresholds.',
};

await call(listAddress, listAbi, owner, 'list', [tokenAddress.toString(), releaseId, firstHash, reviewer.toString(), 6]);
const initialEntry = [...await read(listAddress, listAbi, 'entryOf', [tokenAddress.toString()])];
const [listedBefore] = await read(listAddress, listAbi, 'isListed', [tokenAddress.toString()]);
const otherLabel = encodeBytes32String('review-other-release');
await call(registryAddress, registryAbi, other, 'submit', [otherLabel, secondHash]);
const [otherReleaseId] = await read(registryAddress, registryAbi, 'releaseId', [other.toString(), otherLabel]);
await call(registryAddress, registryAbi, other, 'review', [otherReleaseId, secondHash, true]);
await call(listAddress, listAbi, other, 'list', [tokenAddress.toString(), otherReleaseId, secondHash, other.toString(), 6]);
const overwrittenEntry = [...await read(listAddress, listAbi, 'entryOf', [tokenAddress.toString()])];
const [listedAfterOverwrite] = await read(listAddress, listAbi, 'isListed', [tokenAddress.toString()]);
await call(registryAddress, registryAbi, other, 'submit', [otherLabel, thirdHash]);
const [listedAfterOtherRevision] = await read(listAddress, listAbi, 'isListed', [tokenAddress.toString()]);
const [originalReviewed, originalApproved] = await read(registryAddress, registryAbi, 'decisionOf', [releaseId, reviewer.toString()]);
const entryObject = (entry) => ({ releaseId: entry[0], reportHash: entry[1], reviewer: entry[2] });
const overwriteFinding = {
  id: 'RC-02', title: 'Open-curator listings can be overwritten by an unrelated self-approved release',
  status: listedBefore && overwrittenEntry[0] === otherReleaseId && listedAfterOverwrite && !listedAfterOtherRevision && originalReviewed && originalApproved ? 'reproduced' : 'not-reproduced',
  inputs: { curator: `0x${'00'.repeat(20)}`, originalReleaseOwner: owner.toString(), originalReviewer: reviewer.toString(), unrelatedReleaseOwnerAndReviewer: other.toString(), token: tokenAddress.toString(), realStubTokenDecimals: 6 },
  observed: { initialEntry: entryObject(initialEntry), listedBefore, overwrittenEntry: entryObject(overwrittenEntry), listedAfterOverwrite, listedAfterUnrelatedOwnerSubmitsNewRevision: listedAfterOtherRevision, originalReleaseStillApproved: originalReviewed && originalApproved },
  expected: { sharedTokenEntryReplacement: 'Requires an explicit trusted-curator, token-management or existing-entry update policy.', unrelatedReleaseRevision: 'Must not invalidate a previously accepted entry belonging to another release.' },
  limitation: 'Open reviewer choice is intentional in current source. The reproduced behavior is a trust and shared-entry integrity issue if presented as a curated or trusted directory; no live entry was changed.',
};

const network = retainedReport.network;
const calls = { getBlockHash: 0, getFinalizedHead: 0, getHeader: 0, at: 0, ethBlockHash: 0, nativeContractReads: 0, evmRpcCalls: 0, unexpectedReads: 0 };
const unexpected = (name) => () => { calls.unexpectedReads += 1; throw new Error(`Unexpected mocked read: ${name}`); };
const at = {
  call: { reviveApi: {
    ethBlockHash: async (number) => { calls.ethBlockHash += 1; assert.equal(number, network.finalizedBlockNumber); return network.finalizedEvmBlockHash; },
    call: () => { calls.nativeContractReads += 1; throw new Error('Generic contract observations should not be silently skipped.'); },
  } },
  query: { assets: { asset: unexpected('assets.asset'), metadata: unexpected('assets.metadata'), account: unexpected('assets.account') } },
};
const api = {
  genesisHash: network.nativeGenesisHash,
  rpc: { chain: {
    getBlockHash: async (number) => { calls.getBlockHash += 1; assert.equal(number, network.finalizedBlockNumber); return network.finalizedNativeBlockHash; },
    getFinalizedHead: async () => { calls.getFinalizedHead += 1; return network.finalizedNativeBlockHash; },
    getHeader: async () => { calls.getHeader += 1; return { number: BigInt(network.finalizedBlockNumber) }; },
  } },
  at: async (hash) => { calls.at += 1; assert.equal(hash, network.finalizedNativeBlockHash); return at; },
};
const replayResult = await replayWithClients(retainedReport, { api, rpc: async () => { calls.evmRpcCalls += 1; throw new Error('No EVM RPC read should occur in this reproduction.'); } });
const replayFinding = {
  id: 'RC-03', title: 'A generic contract report is reported as reproduced after checkpoint-only reads',
  status: replayResult.status === 'reproduced' && replayResult.items.length === 3 && calls.nativeContractReads === 0 && calls.evmRpcCalls === 0 ? 'reproduced' : 'not-reproduced',
  inputs: { path: reportPath, evidenceHash: retainedReport.evidenceHash, originalFingerprintValid: verifyRun(retainedReport), profile: retainedReport.input.profile, retainedCheckCount: retainedReport.checks.length, configuredAssertionCount: retainedReport.input.assertions.length, retainedCheckIds: retainedReport.checks.map((check) => check.id) },
  observed: { status: replayResult.status, replayedItemIds: replayResult.items.map((item) => item.id), replayedItemCount: replayResult.items.length, calls, result: replayResult },
  expected: { fullReproduction: 'Re-read supported generic contract observations at the pinned block, including code and ABI assertions.', partialCoverage: 'Return an explicit partial or unsupported result; checkpoint agreement alone must not imply complete report reproduction.' },
  limitation: 'The checkpoint responses are local mocks copied from the unchanged retained report. This demonstrates adapter coverage and status behavior, not current-chain truth or RPC correctness.',
};

const after = await snapshot();
assert.deepEqual(after, before, 'Reviewed sources and retained reports must not change during reproduction.');
assert.equal(blockedFetchAttempts, 0, 'No code path should attempt network access.');
const findings = [duplicateFinding, overwriteFinding, replayFinding];
const output = {
  schemaVersion: 1, createdAt: new Date().toISOString(), project: 'ReviveCheck',
  purpose: 'Offline diagnostic reproductions supporting the English project review; no fixes or real-chain actions.',
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, compiler: registryArtifact.compiler, evmVersion: 'paris', inMemoryCreations, inMemoryCalls },
  safety: { globalFetchDenied: true, blockedFetchAttempts, actualNetworkRequests: 0, keyFilesRead: 0, walletConnections: 0, signedTransactions: 0, broadcastTransactions: 0, productionFilesWritten: 0, reviewedInputsUnchanged: true },
  sourceSha256: before,
  retainedEvidence: { reportHash: retainedReport.evidenceHash, reportFileSha256: before[reportPath], baselineReportHash: '0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5', baselineFileSha256: before['public/baselines/current-2026-10-23.json'] },
  diagnosticSourceSha256: { 'ReviewStubToken.sol': sha256(TOKEN_SOURCE), 'ReviewGuardHarness.sol': sha256(HARNESS_SOURCE) },
  findings,
  summary: { reproduced: findings.filter((finding) => finding.status === 'reproduced').length, total: findings.length },
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;
await writeFile(new URL('reproduction-results.json', import.meta.url), serialized);
process.stdout.write(serialized);
if (output.summary.reproduced !== findings.length) process.exitCode = 1;
