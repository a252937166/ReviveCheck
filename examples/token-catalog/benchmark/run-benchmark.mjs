#!/usr/bin/env node
// The same maintainer task two ways, timed against the live V3 testnet (read-only, no wallet).
//
// Task: a token-list maintainer decides whether pUSD (native asset 7777) may be enabled in
// a catalog with the entry { chainId 420420777, 0x00001e61…10000, "pUSD", "Portaldot USD
// (test)", 6 decimals }, relying on the pusd-token-list release approved in the
// ReleaseRegistry and listed in the VerifiedTokenList, with the report stored on-chain.
//
// Path M replays, as code, the raw reads a maintainer would make by hand: JSON-RPC calls to
// the EVM endpoint, polkadot-js reads of native storage, explorer-free. Each step is timed and
// marked `intervention: true` where a person has to derive, encode, decode or compare
// something themselves. Path R runs ReviveCheck's documented commands. Both read the same
// public nodes, so network latency is in both totals; the operator steps are the difference.
//
//   node examples/token-catalog/benchmark/run-benchmark.mjs [--out examples/token-catalog/benchmark/results-<date>.json]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder, Interface, keccak256, encodeBytes32String } from 'ethers';
import { blake2AsHex } from '@polkadot/util-crypto';
import { u8aToString } from '@polkadot/util';
import { connectNative, evmRpc, nativeAssetAddress, str } from '../../../lib/chain.js';
import { fingerprint } from '../../../lib/report.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : `examples/token-catalog/benchmark/results-${new Date().toISOString().slice(0, 10)}.json`;
const run = promisify(execFile);
const ENTRY = { chainId: 420420777, address: '0x00001e6100000000000000000000000000010000', symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6 };
const REGISTRY = '0xe949b200edf070b9d425b206ed24dc8fe5b7d339', LIST = '0xd0bd833b4b8658b1230a0e9a99640935b3c65819';
const OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b', LABEL = 'pusd-token-list', REVIEWER = OWNER;
const STORED = { extrinsicHash: '0x14b66988c9b160c1442485eae729ec92731fedd45820f8b63718f2c6405520ac', blockHash: '0xdeda40b38138e6b83de68871c8c66f147e37ec9968abe21ab4d63cf15f53eeea' };
const registryAbi = new Interface(['function releaseOf(bytes32) view returns (address owner, uint64 revision, bytes32 reportHash)', 'function decisionOf(bytes32, address) view returns (bool reviewed, bool approved)']);
const listAbi = new Interface(['function isListed(address) view returns (bool)', 'function entryOf(address) view returns (bytes32 releaseId, bytes32 reportHash, address reviewer)']);
const erc20 = new Interface(['function symbol() view returns (string)', 'function name() view returns (string)', 'function decimals() view returns (uint8)']);

async function timed(steps, id, description, intervention, work) {
  const started = performance.now();
  let result, error = null;
  try { result = await work(); } catch (caught) { error = String(caught?.message || caught); }
  const ms = Math.round(performance.now() - started);
  steps.push({ id, description, intervention: intervention || null, ms, ...(error ? { error } : { result }) });
  if (error) throw new Error(`${id}: ${error}`);
  return result;
}

async function manualPath(api) {
  const steps = [];
  const decision = { mismatches: [] };
  const chainId = await timed(steps, 'm1', 'eth_chainId and compare with the entry', 'Know the expected chain ID and compare the hex value by hand.', async () => Number(BigInt(await evmRpc('eth_chainId'))));
  if (chainId !== ENTRY.chainId) decision.mismatches.push('chainId');
  const checkpoint = await timed(steps, 'm2', 'finalized native head, its number, and the EVM block hash for that height', 'Know that native and EVM block hashes differ and that ReviveApi.ethBlockHash maps them.', async () => {
    const nativeHash = await api.rpc.chain.getFinalizedHead();
    const number = (await api.rpc.chain.getHeader(nativeHash)).number.toString();
    const at = await api.at(nativeHash);
    const mapped = await at.call.reviveApi.ethBlockHash(number);
    return { number, nativeHash: str(nativeHash), evmHash: str(mapped.unwrap ? mapped.unwrap() : mapped), at };
  });
  const tag = { blockHash: checkpoint.evmHash, requireCanonical: true };
  const native = await timed(steps, 'm3', 'native Assets metadata and asset record for 7777 at that block', 'Decode SCALE storage with the right runtime types (the asset-fee decoding trap in docs/CHAIN_FINDINGS.md).', async () => {
    const metadata = await checkpoint.at.query.assets.metadata(7777);
    const asset = await checkpoint.at.query.assets.asset(7777);
    return { exists: asset.isSome, symbol: metadata.symbol.toUtf8(), name: metadata.name.toUtf8(), decimals: Number(metadata.decimals.toString()) };
  });
  const precompile = await timed(steps, 'm4', 'derive the ERC-20 precompile address of asset 7777', 'Know the runtime’s address scheme (u32 big-endian, 12 zero bytes, 00010000) and that it is verified for spec 3002 only.', async () => nativeAssetAddress('7777'));
  const evm = await timed(steps, 'm5', 'eth_call symbol(), name(), decimals() on the precompile at the EVM block hash', 'Encode three selectors and ABI-decode a string, a string and a uint8 by hand.', async () => {
    const call = async (method) => erc20.decodeFunctionResult(method, await evmRpc('eth_call', [{ to: precompile, data: erc20.encodeFunctionData(method, []) }, tag]))[0];
    return { symbol: await call('symbol'), name: await call('name'), decimals: Number(await call('decimals')) };
  });
  await timed(steps, 'm6', 'compare the five entry fields with native and EVM values', 'Compare five fields across three sources and notice any disagreement.', async () => {
    for (const [field, claimed, observed] of [['address', ENTRY.address, precompile.toLowerCase()], ['symbol', ENTRY.symbol, native.symbol], ['symbol (EVM)', ENTRY.symbol, evm.symbol], ['name', ENTRY.name, native.name], ['name (EVM)', ENTRY.name, evm.name], ['decimals', ENTRY.decimals, native.decimals], ['decimals (EVM)', ENTRY.decimals, evm.decimals]]) if (claimed !== observed) decision.mismatches.push(field);
    return { mismatches: [...decision.mismatches] };
  });
  const releaseId = await timed(steps, 'm7', 'compute the release ID keccak256(abi.encode(owner, bytes32 label))', 'Know the registry’s identifier scheme and pack the label as bytes32.', async () => keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [OWNER, encodeBytes32String(LABEL)])));
  const registry = await timed(steps, 'm8', 'eth_call releaseOf and decisionOf on the ReleaseRegistry', 'Know the ABI, decode the tuples, and decide whether this reviewer is one you trust.', async () => {
    const release = registryAbi.decodeFunctionResult('releaseOf', await evmRpc('eth_call', [{ to: REGISTRY, data: registryAbi.encodeFunctionData('releaseOf', [releaseId]) }, tag]));
    const decided = registryAbi.decodeFunctionResult('decisionOf', await evmRpc('eth_call', [{ to: REGISTRY, data: registryAbi.encodeFunctionData('decisionOf', [releaseId, REVIEWER]) }, tag]));
    return { owner: release[0].toLowerCase(), revision: release[1].toString(), reportHash: release[2].toLowerCase(), reviewed: decided[0], approved: decided[1] };
  });
  if (!registry.approved) decision.mismatches.push('approval');
  const listing = await timed(steps, 'm9', 'eth_call isListed and entryOf on the VerifiedTokenList and compare with the release', 'Know the consumer ABI and check that the entry names the same release, report and reviewer.', async () => {
    const [listed] = listAbi.decodeFunctionResult('isListed', await evmRpc('eth_call', [{ to: LIST, data: listAbi.encodeFunctionData('isListed', [ENTRY.address]) }, tag]));
    const entry = listAbi.decodeFunctionResult('entryOf', await evmRpc('eth_call', [{ to: LIST, data: listAbi.encodeFunctionData('entryOf', [ENTRY.address]) }, tag]));
    return { listed, releaseId: entry[0].toLowerCase(), reportHash: entry[1].toLowerCase(), reviewer: entry[2].toLowerCase(), matchesRelease: entry[0].toLowerCase() === releaseId && entry[1].toLowerCase() === registry.reportHash };
  });
  if (!listing.listed || !listing.matchesRelease) decision.mismatches.push('listing');
  const stored = await timed(steps, 'm10', 'fetch the block of the stored report, find the remark.store extrinsic, decode the bytes, recompute both hashes', 'Locate the extrinsic, decode hex to JSON, recompute blake2-256 of the bytes and the canonical SHA-256 of the report; not feasible by hand without the project’s canonicalization.', async () => {
    const block = await api.rpc.chain.getBlock(STORED.blockHash);
    const extrinsic = block.block.extrinsics.find((item) => str(item.hash).toLowerCase() === STORED.extrinsicHash);
    const bytes = extrinsic.method.args[0].toU8a(true);
    const report = JSON.parse(u8aToString(bytes));
    const { evidenceHash, ...payload } = report;
    return { bytes: bytes.length, contentHash: blake2AsHex(bytes, 256), reportHash: evidenceHash, sha256Verifies: fingerprint(payload) === evidenceHash, matchesRegistry: `0x${evidenceHash}` === registry.reportHash, completedAt: report.completedAt, runtime: `${report.network.specName}/${report.network.specVersion}` };
  });
  if (!stored.sha256Verifies || !stored.matchesRegistry) decision.mismatches.push('stored report');
  await timed(steps, 'm11', 'check the report’s age and the runtime it pinned against the current runtime', 'Compare dates by hand and know the current runtime version.', async () => {
    const ageDays = (Date.now() - Date.parse(stored.completedAt)) / 86400000;
    const current = `${api.runtimeVersion.specName}/${api.runtimeVersion.specVersion}`;
    if (ageDays > 7) decision.mismatches.push('age');
    if (current !== stored.runtime) decision.mismatches.push('runtime');
    return { ageDays: Number(ageDays.toFixed(2)), reportRuntime: stored.runtime, currentRuntime: current };
  });
  await timed(steps, 'm12', 'decide', 'Weigh eleven partial results; nothing records the decision or its basis.', async () => ({ enable: decision.mismatches.length === 0, mismatches: decision.mismatches }));
  return { steps, decision: { enable: decision.mismatches.length === 0, mismatches: decision.mismatches }, checkpoint: { number: checkpoint.number, nativeHash: checkpoint.nativeHash } };
}

async function reviveCheckPath() {
  const steps = [];
  const node = process.execPath;
  const options = { cwd: root, env: { ...process.env, NODE_NO_WARNINGS: '1' }, maxBuffer: 16 * 1024 * 1024 };
  const check = await timed(steps, 'r1', 'npm run rc -- check_release --release v1.0.1 (the entry against both interfaces, sealed)', null, async () => {
    const { stdout } = await run(node, ['scripts/revivecheck.js', 'check_release', '--release', 'v1.0.1'], options);
    const result = JSON.parse(stdout);
    return { status: result.status, reportHash: result.reportHash, checkpoint: result.checkpoint.number, checks: result.checks.map((item) => `${item.id}:${item.status}`) };
  });
  const acceptance = await timed(steps, 'r2', 'node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet.json (registry, listing, stored report, runtime, age, policy)', null, async () => {
    const { stdout } = await run(node, ['examples/token-catalog/catalog.js', 'acceptance', '--config', 'examples/token-catalog/config/testnet.json', '--out', 'artifacts/local/token-catalog/benchmark'], options).catch((error) => { if (error.code === 1) return { stdout: error.stdout, failed: true }; throw error; });
    const line = stdout.split('\n').find((item) => item.includes('AVAILABLE') || item.includes('not available')) || '';
    return { passed: stdout.includes('acceptance PASSED'), line: line.trim() };
  });
  return { steps, decision: { enable: acceptance.passed, basis: 'recorded in artifacts/local/token-catalog/benchmark/acceptance.json with every reason' }, check };
}

async function failureScenario() {
  const steps = [];
  const options = { cwd: root, env: { ...process.env, NODE_NO_WARNINGS: '1' }, maxBuffer: 16 * 1024 * 1024 };
  const result = await timed(steps, 'f1', 'npm run rc -- check_release --release v1.0.0 (the entry with the Ethereum default of 18 decimals)', null, async () => {
    const { stdout } = await run(process.execPath, ['scripts/revivecheck.js', 'check_release', '--release', 'v1.0.0'], options);
    const report = JSON.parse(stdout);
    return { status: report.status, observed: report.checks.find((item) => item.id === 'token.listing')?.observed, remediation: report.checks.find((item) => item.id === 'token.listing')?.remediation };
  });
  return { steps, detected: result.status === 'failed', observed: result.observed };
}

let api;
try {
  const startedAt = new Date().toISOString();
  api = await connectNative({ signal: AbortSignal.timeout(60_000) });
  const manual = await manualPath(api);
  const revivecheck = await reviveCheckPath();
  const failure = await failureScenario();
  const total = (steps) => steps.reduce((sum, step) => sum + step.ms, 0);
  const results = {
    schema: 'revivecheck.value-benchmark.v1', startedAt, finishedAt: new Date().toISOString(), node: process.version,
    task: 'Decide whether pUSD (asset 7777) may be enabled in a token catalog with the entry below, relying on the pusd-token-list release approved in the ReleaseRegistry, listed in the VerifiedTokenList and stored on-chain.',
    entry: ENTRY, network: { evmRpc: 'https://test-evm-rpc-v3.portaldot.dev', nativeRpc: 'wss://test-node-v3.portaldot.dev', checkpoint: manual.checkpoint, runtime: `${api.runtimeVersion.specName}/${api.runtimeVersion.specVersion}` },
    manual: { steps: manual.steps.map(({ result, ...step }) => ({ ...step, result: result && typeof result === 'object' && 'at' in result ? { ...result, at: undefined } : result })), totalMs: total(manual.steps), operatorSteps: manual.steps.length, interventions: manual.steps.filter((step) => step.intervention).length, decision: manual.decision, recordOfDecision: 'none: the maintainer would have to write it down' },
    revivecheck: { steps: revivecheck.steps, totalMs: total(revivecheck.steps), operatorSteps: revivecheck.steps.length, interventions: 0, decision: revivecheck.decision },
    failureDetection: { scenario: 'The same entry with 18 decimals (release v1.0.0).', manual: 'Detected only if the maintainer compares the decimals in step m6; nothing stops the process otherwise.', revivecheck: failure, totalMs: total(failure.steps) },
    scope: 'Internal validation by the project author on the public testnet nodes. Path M is executed as code so its timings are reproducible; a person performing the same reads with a wallet UI, an explorer and a terminal would be slower at each intervention. Owner, reviewer and operator are the project test account. External adoption and willingness to pay are not measured here.',
  };
  await mkdir(path.dirname(path.resolve(root, out)), { recursive: true });
  await writeFile(path.resolve(root, out), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ out, manual: { totalMs: results.manual.totalMs, steps: results.manual.operatorSteps, interventions: results.manual.interventions, enable: manual.decision.enable }, revivecheck: { totalMs: results.revivecheck.totalMs, steps: results.revivecheck.operatorSteps, enable: revivecheck.decision.enable }, failureDetected: failure.detected, observed: failure.observed }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message) }));
  process.exitCode = 1;
} finally { if (api) await api.disconnect().catch(() => {}); }
