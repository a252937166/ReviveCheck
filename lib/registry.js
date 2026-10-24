import { AbiCoder, Interface, encodeBytes32String, decodeBytes32String, keccak256 } from 'ethers';
import { abortable, str } from './chain.js';

// The shared ReleaseRegistry on the V3 testnet: anyone submits a sealed report for a
// release they own, anyone reviews the current revision. Deployed 2026-10-23.
export const REGISTRY = Object.freeze({
  address: '0xe949b200edf070b9d425b206ed24dc8fe5b7d339',
  deploy: { extrinsicHash: '0xc099451a308eab45a2a29c1f1d628290d067c69250f129ad7aab145235c8aeea', blockHash: '0x0e97bc2094e457a382896129c119e82c8330f8da94c15ad24ef9f0a5a9d06940', blockNumber: '162962' },
  sourceSha256: '6ae08245bc8e5baa5c16643305c0db3704eff85dc0fb70ff337bf17600c466a7',
});
export const REGISTRY_ABI = Object.freeze([
  'function releaseId(address owner, bytes32 name) pure returns (bytes32)',
  'function submit(bytes32 name, bytes32 reportHash) returns (bytes32 id, uint64 revision)',
  'function review(bytes32 id, bytes32 reportHash, bool approved)',
  'function releaseOf(bytes32 id) view returns (address owner, uint64 revision, bytes32 reportHash)',
  'function decisionOf(bytes32 id, address reviewer) view returns (bool reviewed, bool approved)',
  'event ReportSubmitted(bytes32 indexed releaseId, address indexed owner, uint64 indexed revision, bytes32 reportHash, bytes32 name)',
  'event ReportReviewed(bytes32 indexed releaseId, address indexed reviewer, uint64 indexed revision, bytes32 reportHash, bool approved)',
  'error EmptyReport()', 'error EmptyName()', 'error UnknownRelease()', 'error StaleReport()',
]);
export const registryInterface = new Interface(REGISTRY_ABI);
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/;
const lower = (value) => String(value).toLowerCase();
const asHash = (hash) => { const value = String(hash || '').startsWith('0x') ? hash : `0x${hash}`; if (!HASH.test(value)) throw new Error('A report hash is 32 bytes (64 hex characters).'); return value.toLowerCase(); };

export function releaseLabel(text) {
  const label = String(text || '').trim();
  if (!label || new TextEncoder().encode(label).length > 31) throw new Error('A release label is 1–31 bytes, for example "pusd-token-list".');
  return encodeBytes32String(label);
}
export const labelText = (bytes32) => { try { return decodeBytes32String(bytes32); } catch { return bytes32; } };
export function releaseIdOf(owner, label) {
  if (!H160.test(owner || '')) throw new Error('The release owner is an EVM (H160) address.');
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'bytes32'], [owner, releaseLabel(label)]));
}

/** Unsigned calls. A wallet signs them: MetaMask as an EVM transaction, a Polkadot wallet through Revive.call. */
export const submitCall = (label, reportHash) => ({ to: REGISTRY.address, data: registryInterface.encodeFunctionData('submit', [releaseLabel(label), asHash(reportHash)]) });
export const reviewCall = (releaseId, reportHash, approved) => ({ to: REGISTRY.address, data: registryInterface.encodeFunctionData('review', [asHash(releaseId), asHash(reportHash), !!approved]) });
export function decodeRegistryError(data) {
  try { return registryInterface.parseError(data)?.name ?? null; } catch { return null; }
}

/** Decode the registry's events from a native receipt's revive.ContractEmitted records. */
export function registryEvents(events = []) {
  return events.filter((event) => event.section === 'revive' && event.method === 'ContractEmitted').map((event) => {
    const [contract, data, topics] = Array.isArray(event.data) ? event.data : [event.data?.contract, event.data?.data, event.data?.topics];
    if (lower(contract) !== REGISTRY.address) return null;
    try { const log = registryInterface.parseLog({ topics, data }); return log && { name: log.name, args: Object.fromEntries(log.fragment.inputs.map((input, index) => [input.name, typeof log.args[index] === 'bigint' ? log.args[index].toString() : log.args[index]])) }; } catch { return null; }
  }).filter(Boolean);
}

/**
 * Read one release through both V3 interfaces at a single finalized checkpoint:
 * the Ethereum RPC at the EVM block hash, and ReviveApi.call at the native hash.
 */
export async function readRegistryWithClients({ api, rpc, signal }, { releaseId, reviewer, reviewers = [], origin }) {
  const id = asHash(releaseId);
  // One decision read per distinct reviewer: the optional single `reviewer` keeps its `decision` field, and
  // every address in `reviewers` lands in `decisions`, so a policy can count a trusted set in one checkpoint.
  const wanted = [...new Set([reviewer, ...reviewers].filter((address) => address && H160.test(address)).map(lower))];
  const finalizedHash = await abortable(api.rpc.chain.getFinalizedHead(), signal);
  const number = BigInt((await abortable(api.rpc.chain.getHeader(finalizedHash), signal)).number.toString());
  const at = await abortable(api.at(finalizedHash), signal);
  const mapped = await abortable(at.call.reviveApi.ethBlockHash(number.toString()), signal);
  const evmHash = mapped.isNone ? null : str(mapped.unwrap ? mapped.unwrap() : mapped);
  if (!evmHash) throw new Error('ReviveApi has no EVM hash for the finalized block.');
  const readTag = { blockHash: evmHash, requireCanonical: true };
  const caller = origin || (await abortable(at.call.reviveApi.accountId(REGISTRY.address), signal)).toString();
  const views = [['releaseOf', [id], 'releaseOf'], ...wanted.map((address) => ['decisionOf', [id, address], reviewer && lower(reviewer) === address ? 'decisionOf' : `decisionOf:${address}`])];
  const results = {};
  for (const [method, args, key] of views) {
    const data = registryInterface.encodeFunctionData(method, args);
    const [evmData, nativeResult] = await abortable(Promise.all([rpc('eth_call', [{ to: REGISTRY.address, data }, readTag]), at.call.reviveApi.call(caller, REGISTRY.address, '0', null, null, data)]), signal);
    if (!nativeResult.result?.isOk) throw new Error(`Native ${method} call failed.`);
    const nativeData = str(nativeResult.result.asOk.data);
    const decode = (raw) => registryInterface.decodeFunctionResult(method, raw).map((value) => typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value.toLowerCase() : value);
    const evm = decode(evmData), native = decode(nativeData);
    results[key] = { evm, native, match: JSON.stringify(evm) === JSON.stringify(native) };
  }
  const [owner, revision, reportHash] = results.releaseOf.evm;
  const decisions = Object.fromEntries(wanted.map((address) => { const view = results[reviewer && lower(reviewer) === address ? 'decisionOf' : `decisionOf:${address}`]; return [address, { reviewer: address, reviewed: view.evm[0], approved: view.evm[1] }]; }));
  return {
    address: REGISTRY.address, releaseId: id, block: { number: number.toString(), nativeHash: str(finalizedHash), evmHash }, observedAt: new Date().toISOString(),
    release: { exists: revision !== '0', owner, revision, reportHash },
    decision: reviewer && H160.test(reviewer) ? decisions[lower(reviewer)] : null,
    decisions,
    interfacesAgree: Object.values(results).every((entry) => entry.match),
    views: results,
  };
}
