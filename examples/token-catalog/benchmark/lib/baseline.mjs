// The baseline arm: "CI script + explorer + approval record".
//
// This is what a careful token-list maintainer could run today without ReviveCheck: a Node
// script with ethers for ABI encoding, @polkadot/api for native storage and blocks, and
// hard-coded facts about the contracts and the approval the maintainer recorded (the
// "approval record": which report hash the trusted reviewer approved, which revision, and
// where the report bytes were stored). It implements the same five checks as the ReviveCheck
// arm and nothing else:
//
//   C1 entry-vs-chain    chainId, address, symbol, name and decimals of the entry against the
//                        native Assets metadata and the ERC-20 precompile (both interfaces)
//   C2 trusted-approval  the registry's current revision carries exactly the recorded report
//                        hash and revision, the owner is the expected one, and the trusted
//                        reviewer's decision on it is reviewed and approved
//   C3 listing-entry     the token list lists the token on that release, that report hash and
//                        that reviewer
//   C4 stored-report     the report stored with remark.store sits in a canonical, finalized
//                        block and its canonical SHA-256 is the recorded hash
//   C5 age-runtime       the report is younger than the maximum age, was taken on the runtime
//                        the maintainer allows, and that runtime is the one the chain runs now
//
// Reads go through a small interface so the same script runs live (`liveReads`) or on a
// captured inputs file (`replayReads`), which is how the deterministic comparison holds both
// arms to identical inputs. A read that fails leaves its check `ok: null`; the script then
// refuses, because a verification that did not complete is not a pass.
import { AbiCoder, Interface, encodeBytes32String, keccak256 } from 'ethers';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { u8aToString } from '@polkadot/util';

export const SCRIPT = 'examples/token-catalog/benchmark/lib/baseline.mjs';
export const RESULT_SCHEMA = 'maintainer-ci-script.result.v1';
export const CHECKS = Object.freeze([
  { id: 'C1', name: 'entry-vs-chain', expected: 'every entry field equals the chain through both interfaces' },
  { id: 'C2', name: 'trusted-approval', expected: 'the current revision carries the recorded report hash and the trusted reviewer approved it' },
  { id: 'C3', name: 'listing-entry', expected: 'listed on the recorded release, report hash and reviewer' },
  { id: 'C4', name: 'stored-report', expected: 'the stored report is in a canonical finalized block and its canonical SHA-256 is the recorded hash' },
  { id: 'C5', name: 'age-runtime', expected: 'the report is within the maximum age and pinned the runtime the chain runs now' },
]);

/** Facts the script author had to know to write it. Counted as setup effort; a person needs none of them at run time. */
export const KNOWLEDGE = Object.freeze([
  'The ERC-20 precompile address scheme of native assets on Portaldot V3 (u32 big-endian id, 12 zero bytes, 00010000), verified for spec 3002 only.',
  'Native and EVM block hashes differ; ReviveApi.ethBlockHash maps the finalized native block to the EVM block tag for eth_call.',
  'The runtime types bundle for spec 3002 (NativeOrWithId / TAssetConversion), without which block decoding fails.',
  'The ReleaseRegistry ABI (releaseOf, decisionOf) and the release ID scheme keccak256(abi.encode(owner, bytes32(label))).',
  'The VerifiedTokenList ABI (isListed, entryOf) and that an entry names a release, a report hash and a reviewer.',
  'Where the report bytes are: the remark.store extrinsic hash and block hash, taken from the explorer or the publishing receipt.',
  'The canonical JSON form that the report hash is computed over (sorted keys, undefined dropped, evidenceHash excluded).',
  'Which report fields date it (completedAt) and pin its runtime (network.specName/specVersion).',
  'The ERC-20 metadata ABI (symbol, name, decimals) and how to decode the returned strings and uint8.',
  'Which reviewer counts as trusted, and that the release owner approving its own release does not.',
]);

export const ERC20 = new Interface(['function symbol() view returns (string)', 'function name() view returns (string)', 'function decimals() view returns (uint8)']);
export const REGISTRY_ABI = new Interface(['function releaseOf(bytes32) view returns (address owner, uint64 revision, bytes32 reportHash)', 'function decisionOf(bytes32, address) view returns (bool reviewed, bool approved)']);
export const LIST_ABI = new Interface(['function isListed(address) view returns (bool)', 'function entryOf(address) view returns (bytes32 releaseId, bytes32 reportHash, address reviewer)']);

const lower = (value) => String(value ?? '').toLowerCase();
const hex = (value) => value?.toHex?.() ?? String(value);
const str = (value) => typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value.toLowerCase() : value;

/** Sorted-key JSON, the form the report's SHA-256 is computed over. Must match the publisher's canonicalization. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256Hex = (text) => bytesToHex(sha256(utf8ToBytes(text)));
export const precompileAddress = (assetId) => `0x${BigInt(assetId).toString(16).padStart(8, '0')}${'0'.repeat(24)}00010000`;
export const releaseIdOf = (owner, label) => keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [owner, encodeBytes32String(label)])).toLowerCase();

/** What the maintainer hard-codes. Built from the catalog configuration and the binding so both arms provably start from the same facts. */
export function baselineConfig({ config, token, binding, endpoints }) {
  const policy = config.policy;
  return {
    entry: { chainId: policy.network.chainId, address: token.address, symbol: token.symbol, name: token.name, decimals: token.decimals, assetId: token.assetId },
    registry: { address: policy.registry.address, owner: policy.registry.owner, label: policy.registry.label },
    tokenList: { address: policy.consumer.address },
    trustedReviewer: policy.reviewers.trusted[0],
    approvalRecord: { reportHash: binding.reportHash, revision: binding.revision, storage: { extrinsicHash: binding.storage.extrinsicHash, blockHash: binding.storage.blockHash } },
    limits: { maxReportAgeSeconds: policy.evidence.maxAgeSeconds, runtime: `${policy.runtime.specName}/${policy.runtime.specVersions[0]}` },
    endpoints,
  };
}

/** The five checks. `reads` is `liveReads(...)` or `replayReads(...)`; `now` is injectable so replays evaluate at the capture time. */
export async function runMaintainerScript(config, reads, { now = new Date() } = {}) {
  const startedAt = new Date().toISOString();
  const checks = [], problems = [];
  const spec = (id) => CHECKS.find((check) => check.id === id);
  const record = (id, ok, observed, extra = {}) => {
    const { problem, ...details } = extra;
    checks.push({ id, name: spec(id).name, ok, observed, expected: spec(id).expected, ...details });
    if (ok !== true) problems.push(`${id}:${ok === null ? 'unavailable' : problem || 'mismatch'}`);
  };
  const attempt = async (id, work) => { try { return await work(); } catch (error) { record(id, null, `read failed: ${String(error?.message || error).slice(0, 200)}`); return null; } };
  const entry = config.entry;
  const releaseId = releaseIdOf(config.registry.owner, config.registry.label);
  const expectedHash = `0x${lower(config.approvalRecord.reportHash).replace(/^0x/, '')}`;

  let checkpoint = null;
  try { checkpoint = await reads.checkpoint(); } catch (error) { checkpoint = { error: String(error?.message || error).slice(0, 200) }; }
  const usable = checkpoint && !checkpoint.error;

  // C1: the entry against native Assets metadata and the ERC-20 precompile.
  const expectedAddress = precompileAddress(entry.assetId);
  const c1 = await attempt('C1', async () => ({ native: await reads.assetMetadata(entry.assetId), evm: await reads.erc20(expectedAddress) }));
  if (c1) {
    const mismatches = [];
    if (!usable) mismatches.push('chainId(unknown)'); else if (Number(checkpoint.chainId) !== Number(entry.chainId)) mismatches.push('chainId');
    if (lower(entry.address) !== expectedAddress) mismatches.push('address');
    if (c1.native.exists === false) mismatches.push('asset-missing');
    for (const [field, claimed, observed, source] of [['symbol', entry.symbol, c1.native.symbol, 'native'], ['symbol', entry.symbol, c1.evm.symbol, 'evm'], ['name', entry.name, c1.native.name, 'native'], ['name', entry.name, c1.evm.name, 'evm'], ['decimals', Number(entry.decimals), Number(c1.native.decimals), 'native'], ['decimals', Number(entry.decimals), Number(c1.evm.decimals), 'evm']]) if (claimed !== observed) mismatches.push(`${field}(${source})`);
    record('C1', mismatches.length === 0, mismatches.length ? `entry differs from the chain in ${mismatches.join(', ')}: entry decimals ${entry.decimals}, native ${c1.native.decimals}, evm ${c1.evm.decimals}; entry symbol ${entry.symbol}, chain ${c1.native.symbol}/${c1.evm.symbol}` : `chainId ${checkpoint.chainId}, address ${expectedAddress}, symbol ${c1.native.symbol}, name ${c1.native.name}, decimals ${c1.native.decimals}; native and ERC-20 agree`, { problem: mismatches.map((item) => item.replace(/\(.*\)/, '')).filter((item, index, all) => all.indexOf(item) === index).join('+'), chainValues: c1, readAt: c1.native.readAt ?? c1.evm.readAt ?? (usable ? `finalized #${checkpoint.number}` : 'unknown') });
  }

  // C2: the registry's current revision and the trusted reviewer's decision on it.
  const c2 = await attempt('C2', async () => ({ release: await reads.releaseOf(releaseId), decision: await reads.decisionOf(releaseId, lower(config.trustedReviewer)) }));
  if (c2) {
    const issues = [];
    if (lower(c2.release.owner) !== lower(config.registry.owner)) issues.push('owner');
    if (String(c2.release.revision) === '0') issues.push('release-missing');
    if (lower(c2.release.reportHash) !== expectedHash) issues.push('report-superseded');
    if (String(c2.release.revision) !== String(config.approvalRecord.revision)) issues.push('revision');
    if (c2.decision.reviewed !== true) issues.push('not-reviewed'); else if (c2.decision.approved !== true) issues.push('changes-requested');
    record('C2', issues.length === 0, `registry revision ${c2.release.revision} report ${lower(c2.release.reportHash)} owner ${lower(c2.release.owner)}; reviewer ${lower(config.trustedReviewer)} reviewed ${c2.decision.reviewed} approved ${c2.decision.approved}; recorded revision ${config.approvalRecord.revision} report ${expectedHash}${issues.length ? `; issues: ${issues.join(', ')}` : ''}`, { problem: issues.join('+'), releaseId, release: c2.release, decision: c2.decision });
  }

  // C3: the token list entry.
  const c3 = await attempt('C3', async () => ({ listed: await reads.isListed(entry.address), entry: await reads.entryOf(entry.address) }));
  if (c3) {
    const issues = [];
    if (c3.listed !== true) issues.push('not-listed');
    if (!c3.entry) issues.push('no-entry'); else {
      if (lower(c3.entry.releaseId) !== releaseId) issues.push('release');
      if (lower(c3.entry.reportHash) !== expectedHash) issues.push('report');
      if (lower(c3.entry.reviewer) !== lower(config.trustedReviewer)) issues.push('reviewer');
    }
    record('C3', issues.length === 0, `isListed ${c3.listed}; entry ${c3.entry ? `release ${lower(c3.entry.releaseId)}, report ${lower(c3.entry.reportHash)}, reviewer ${lower(c3.entry.reviewer)}` : 'none'}${issues.length ? `; issues: ${issues.join(', ')}` : ''}`, { problem: issues.join('+'), listed: c3.listed, entry: c3.entry });
  }

  // C4: the stored report, decoded from the block and re-hashed.
  const c4 = await attempt('C4', () => reads.storedReport(config.approvalRecord.storage.extrinsicHash, config.approvalRecord.storage.blockHash));
  let report = null;
  if (c4) {
    const { evidenceHash, ...payload } = c4.report || {};
    const recomputed = c4.report ? sha256Hex(canonicalJson(payload)) : null;
    const issues = [];
    if (!c4.canonical) issues.push('block-not-canonical');
    if (!c4.finalized) issues.push('not-finalized');
    if (!c4.report) issues.push('no-report'); else {
      if (recomputed !== evidenceHash) issues.push('hash-mismatch');
      if (`0x${evidenceHash}` !== expectedHash) issues.push('different-report');
    }
    if (!issues.length) report = c4.report;
    record('C4', issues.length === 0, `block #${c4.blockNumber} canonical ${c4.canonical} finalized ${c4.finalized}; ${c4.bytes} bytes; recomputed SHA-256 ${recomputed}; stored evidenceHash ${evidenceHash ?? 'none'}${issues.length ? `; issues: ${issues.join(', ')}` : ''}`, { problem: issues.join('+'), blockNumber: c4.blockNumber, bytes: c4.bytes, recomputed });
  }

  // C5: age and runtime of the stored report against the chain now.
  if (report) {
    const ageSeconds = (now.getTime() - Date.parse(report.completedAt)) / 1000;
    const reportRuntime = `${report.network?.specName}/${report.network?.specVersion}`;
    const issues = [];
    if (!Number.isFinite(ageSeconds)) issues.push('undated'); else if (ageSeconds > config.limits.maxReportAgeSeconds) issues.push('too-old'); else if (ageSeconds < -60) issues.push('future-dated');
    if (reportRuntime !== config.limits.runtime) issues.push('runtime-not-allowed');
    if (usable && checkpoint.runtime !== reportRuntime) issues.push('runtime-changed');
    if (!usable) record('C5', null, `report ${Math.round(ageSeconds)} s old on ${reportRuntime}; the current runtime could not be read`, { ageSeconds: Math.round(ageSeconds), reportRuntime });
    else record('C5', issues.length === 0, `report completed ${report.completedAt}, ${Math.round(ageSeconds)} s before ${now.toISOString()} (limit ${config.limits.maxReportAgeSeconds} s); report runtime ${reportRuntime}, chain runtime ${checkpoint.runtime}, allowed ${config.limits.runtime}${issues.length ? `; issues: ${issues.join(', ')}` : ''}`, { problem: issues.join('+'), ageSeconds: Math.round(ageSeconds), reportRuntime, currentRuntime: checkpoint.runtime });
  } else record('C5', null, 'no verified stored report to date', {});

  const decision = checks.length === CHECKS.length && checks.every((check) => check.ok === true) && problems.length === 0 ? 'enable' : 'refuse';
  return {
    schema: RESULT_SCHEMA, script: SCRIPT, startedAt, finishedAt: new Date().toISOString(), now: now.toISOString(), source: reads.source,
    config, releaseId, checkpoint: usable ? { number: checkpoint.number, nativeHash: checkpoint.nativeHash, evmHash: checkpoint.evmHash, runtime: checkpoint.runtime, chainId: checkpoint.chainId } : { error: checkpoint?.error ?? 'not read' },
    checks, problems, decision, exitCode: decision === 'enable' ? 0 : 1,
  };
}

/**
 * Live reads: JSON-RPC eth_call at the EVM hash of the finalized block, polkadot-js storage
 * and blocks at the native hash. `connect` opens the node connection lazily so a connection
 * failure surfaces as failed reads (and a refusal), not as a crash before any check runs.
 */
export function liveReads({ connect, rpc, endpoints, registry, tokenList }) {
  let apiPromise = null, checkpoint = null;
  const api = () => (apiPromise ||= connect());
  const tag = () => { if (!checkpoint) throw new Error('no finalized checkpoint'); return checkpoint.tag; };
  return {
    source: `live reads: eth_call over ${endpoints.evmRpc} at the finalized block's EVM hash; polkadot-js storage and blocks over ${endpoints.nativeRpc}; one connection, sequential`,
    async checkpoint() {
      const chain = await api();
      const nativeHash = hex(await chain.rpc.chain.getFinalizedHead());
      const header = await chain.rpc.chain.getHeader(nativeHash);
      const number = header.number.toString();
      const at = await chain.at(nativeHash);
      const mapped = await at.call.reviveApi.ethBlockHash(number);
      const evmHash = hex(mapped.unwrap ? mapped.unwrap() : mapped);
      const version = await chain.rpc.state.getRuntimeVersion(nativeHash);
      const chainId = Number(BigInt(await rpc('eth_chainId', [])));
      checkpoint = { number, nativeHash, evmHash, runtime: `${version.specName}/${version.specVersion}`, chainId, at, tag: { blockHash: evmHash, requireCanonical: true } };
      const { at: _at, tag: _tag, ...plain } = checkpoint;
      return plain;
    },
    async assetMetadata(assetId) {
      if (!checkpoint) throw new Error('no finalized checkpoint');
      const metadata = await checkpoint.at.query.assets.metadata(assetId);
      const asset = await checkpoint.at.query.assets.asset(assetId);
      return { exists: asset.isSome, symbol: metadata.symbol.toUtf8(), name: metadata.name.toUtf8(), decimals: Number(metadata.decimals.toString()), readAt: `native #${checkpoint.number}` };
    },
    async erc20(address) {
      if (!checkpoint) throw new Error('no finalized checkpoint');
      const call = async (method) => ERC20.decodeFunctionResult(method, await rpc('eth_call', [{ to: address, data: ERC20.encodeFunctionData(method, []) }, checkpoint.tag]))[0];
      return { symbol: await call('symbol'), name: await call('name'), decimals: Number(await call('decimals')), readAt: `evm ${checkpoint.evmHash}` };
    },
    async releaseOf(id) { const [owner, revision, reportHash] = REGISTRY_ABI.decodeFunctionResult('releaseOf', await rpc('eth_call', [{ to: registry, data: REGISTRY_ABI.encodeFunctionData('releaseOf', [id]) }, tag()])).map(str); return { owner, revision, reportHash }; },
    async decisionOf(id, reviewer) { const [reviewed, approved] = REGISTRY_ABI.decodeFunctionResult('decisionOf', await rpc('eth_call', [{ to: registry, data: REGISTRY_ABI.encodeFunctionData('decisionOf', [id, reviewer]) }, tag()])); return { reviewed, approved }; },
    async isListed(token) { return LIST_ABI.decodeFunctionResult('isListed', await rpc('eth_call', [{ to: tokenList, data: LIST_ABI.encodeFunctionData('isListed', [token]) }, tag()]))[0]; },
    async entryOf(token) { const [releaseId, reportHash, reviewer] = LIST_ABI.decodeFunctionResult('entryOf', await rpc('eth_call', [{ to: tokenList, data: LIST_ABI.encodeFunctionData('entryOf', [token]) }, tag()])).map(str); return releaseId === `0x${'00'.repeat(32)}` ? null : { releaseId, reportHash, reviewer }; },
    async storedReport(extrinsicHash, blockHash) {
      const chain = await api();
      const header = await chain.rpc.chain.getHeader(blockHash);
      const number = header.number.toString();
      const canonicalHash = hex(await chain.rpc.chain.getBlockHash(number));
      const finalizedNumber = BigInt((await chain.rpc.chain.getHeader(await chain.rpc.chain.getFinalizedHead())).number.toString());
      const block = await chain.rpc.chain.getBlock(blockHash);
      const extrinsic = block.block.extrinsics.find((item) => lower(hex(item.hash)) === lower(extrinsicHash));
      if (!extrinsic) throw new Error('the extrinsic is not in this block');
      if (extrinsic.method.section !== 'remark' || extrinsic.method.method !== 'store') throw new Error(`the extrinsic is ${extrinsic.method.section}.${extrinsic.method.method}, not remark.store`);
      const bytes = extrinsic.method.args[0].toU8a(true);
      return { report: JSON.parse(u8aToString(bytes)), bytes: bytes.length, blockNumber: number, canonical: lower(canonicalHash) === lower(blockHash), finalized: BigInt(number) <= finalizedNumber };
    },
    async close() { if (apiPromise) await apiPromise.then((chain) => chain.disconnect(), () => {}); },
  };
}

/**
 * Replayed reads: the captured inputs file (schema revivecheck.token-catalog-inputs.v1) stands
 * in for the chain. The registry and listing `views.*.evm` tuples are the decoded eth_call
 * results the script would have obtained; the observation is its finalized checkpoint and
 * runtime; `evidence.run` is the report it would have decoded from the block. No separate
 * asset read was captured, so the entry's chain values come from the stored report's raw
 * `token.listing` evidence: the native field values and the raw ERC-20 return data, which
 * the script decodes itself. Those were read at the report's checkpoint, not the capture's.
 */
export function replayReads(capture, token, { capturePath = 'captured inputs' } = {}) {
  const inputs = capture.tokens?.[token];
  if (!inputs) throw new Error(`the capture has no inputs for ${token}`);
  const need = (name) => { const read = inputs[name]; if (!read) throw new Error(`no ${name} read in the capture`); if (read.error) throw new Error(read.error); return read; };
  const listingCheck = () => { const run = need('evidence').run; const check = run?.checks?.find((item) => item.id === 'token.listing'); if (!check?.evidence?.fields || !check.evidence.raw) throw new Error('the captured inputs carry no raw asset reads'); return { run, check }; };
  return {
    source: `replayed ${capturePath}: registry and listing views as eth_call results, the observation as the checkpoint, the stored report from evidence.run, entry chain values from the report's raw token.listing evidence`,
    async checkpoint() { const observation = need('observation'); return { number: observation.finalized.number, nativeHash: observation.finalized.nativeHash, evmHash: observation.evm?.finalizedHash ?? null, runtime: observation.runtime, chainId: observation.evm?.chainId ?? observation.chainId }; },
    async assetMetadata() { const { run, check } = listingCheck(); const field = (name) => check.evidence.fields.find((item) => item.field === name); return { exists: true, symbol: field('symbol').native, name: field('name').native, decimals: Number(field('decimals').native), readAt: `report checkpoint #${run.binding?.checkpoint?.number} (native)` }; },
    async erc20() { const { run, check } = listingCheck(); const raw = check.evidence.raw; return { symbol: ERC20.decodeFunctionResult('symbol', raw.symbolData)[0], name: ERC20.decodeFunctionResult('name', raw.nameData)[0], decimals: Number(ERC20.decodeFunctionResult('decimals', raw.decimalsData)[0]), readAt: `report checkpoint #${run.binding?.checkpoint?.number} (evm)` }; },
    async releaseOf() { const [owner, revision, reportHash] = need('registry').views.releaseOf.evm; return { owner, revision, reportHash }; },
    async decisionOf(id, reviewer) { const registry = need('registry'); const view = registry.views[`decisionOf:${lower(reviewer)}`] ?? (registry.decision && lower(registry.decision.reviewer) === lower(reviewer) ? registry.views.decisionOf : null); if (!view) throw new Error(`no decision read for ${reviewer} in the capture`); return { reviewed: view.evm[0], approved: view.evm[1] }; },
    async isListed() { return need('listing').views.isListed.evm[0]; },
    async entryOf() { const [releaseId, reportHash, reviewer] = need('listing').views.entryOf.evm; return releaseId === `0x${'00'.repeat(32)}` ? null : { releaseId, reportHash, reviewer }; },
    async storedReport() { const evidence = need('evidence'); if (!evidence.run) throw new Error((evidence.reasons || []).join(' ') || 'the stored report was not retrieved'); return { report: evidence.run, bytes: evidence.length, blockNumber: evidence.blockNumber, canonical: true, finalized: evidence.finalized === true }; },
    async close() {},
  };
}
