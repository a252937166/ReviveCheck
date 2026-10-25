// A fresh observation of a native-asset subject: the release-critical metadata (symbol,
// name, decimals) and the address mapping, read at one finalized checkpoint through both
// interfaces (native Assets storage and the ERC-20 precompile). A policy that sets
// `evidence.requireFreshSubject` has the evaluator compare this read with the approved
// report: an approval that still stands on-chain does not by itself say that the subject
// still reports the values the report verified. The read is bounded to the one adapter
// the checker has verified (portaldot-v3/3002); on another runtime it is `unsupported`,
// which the evaluator treats as unknown, never as a pass. Supply or balance changes are
// not read here: a metadata release does not depend on them.
import { abortable, decodeUint256, nativeAssetAddress, str } from './chain.js';
import { decodeAssertion } from './plan.js';

const VERIFIED_RUNTIME = Object.freeze({ specName: 'portaldot-v3', specVersion: '3002' });
const VIEWS = { name: { signature: 'name()', returns: 'string', selector: '0x06fdde03' }, symbol: { signature: 'symbol()', returns: 'string', selector: '0x95d89b41' } };
/** The fields a fresh subject read establishes and the evaluator compares with the approved entry. */
export const SUBJECT_FIELDS = Object.freeze(['address', 'symbol', 'name', 'decimals']);
const textOf = (value) => typeof value === 'string' ? value : value?.toUtf8 ? value.toUtf8() : new TextDecoder().decode(value?.toU8a ? value.toU8a(true) : value);

/** Read the subject at one finalized checkpoint through both interfaces. Returns a dated read; throws only when the node cannot be reached. */
export async function readSubjectWithClients({ api, rpc, signal }, { assetId, address }) {
  if (!/^\d+$/.test(String(assetId ?? ''))) throw new Error('The subject asset ID is a u32 decimal string.');
  const finalizedHash = await abortable(api.rpc.chain.getFinalizedHead(), signal);
  const header = await abortable(api.rpc.chain.getHeader(finalizedHash), signal);
  const number = header.number.toString();
  const at = await abortable(api.at(finalizedHash), signal);
  const mapped = await abortable(at.call.reviveApi.ethBlockHash(number), signal);
  const evmHash = mapped.isNone ? null : str(mapped.unwrap ? mapped.unwrap() : mapped);
  if (!evmHash) throw new Error('ReviveApi has no EVM hash for the finalized block.');
  const version = api.rpc.state?.getRuntimeVersion ? await abortable(api.rpc.state.getRuntimeVersion(finalizedHash), signal) : api.runtimeVersion;
  const runtime = { specName: version.specName.toString(), specVersion: version.specVersion.toString() };
  const base = { subject: String(address).toLowerCase(), assetId: String(assetId), block: { number, nativeHash: str(finalizedHash), evmHash }, runtime: `${runtime.specName}/${runtime.specVersion}`, observedAt: new Date().toISOString() };
  if (runtime.specName !== VERIFIED_RUNTIME.specName || runtime.specVersion !== VERIFIED_RUNTIME.specVersion) return { ...base, supported: false, exists: null, native: null, evm: null, interfacesAgree: null, note: `The precompile address scheme is verified for ${VERIFIED_RUNTIME.specName}/${VERIFIED_RUNTIME.specVersion} only; this read is unsupported on ${base.runtime}.` };
  const derived = nativeAssetAddress(assetId).toLowerCase();
  const details = await abortable(at.query.assets.asset(assetId), signal);
  if (!details.isSome) return { ...base, supported: true, exists: false, derivedAddress: derived, native: null, evm: null, interfacesAgree: null };
  const metadata = await abortable(at.query.assets.metadata(assetId), signal);
  const readTag = { blockHash: evmHash, requireCanonical: true };
  const [nameData, symbolData, decimalsData] = await abortable(Promise.all([VIEWS.name.selector, VIEWS.symbol.selector, '0x313ce567'].map((data) => rpc('eth_call', [{ to: derived, data }, readTag]))), signal);
  const native = { address: derived, symbol: textOf(metadata.symbol), name: textOf(metadata.name), decimals: Number(metadata.decimals.toString()) };
  const evm = { address: derived, symbol: decodeAssertion(VIEWS.symbol, symbolData), name: decodeAssertion(VIEWS.name, nameData), decimals: Number(decodeUint256(decimalsData)) };
  return { ...base, supported: true, exists: true, derivedAddress: derived, native, evm, interfacesAgree: SUBJECT_FIELDS.every((field) => native[field] === evm[field]), raw: { nameData, symbolData, decimalsData } };
}

/** The read as a fixture would carry it, from values (used by tests and by the local lifecycle). */
export function subjectReadFrom({ assetId, address, values, block, observedAt, runtime = 'portaldot-v3/3002', exists = true, supported = true, evmValues = null }) {
  const derived = nativeAssetAddress(assetId).toLowerCase();
  const native = values ? { address: derived, symbol: values.symbol, name: values.name, decimals: Number(values.decimals) } : null;
  const evm = values ? { address: derived, ...(evmValues ? { symbol: evmValues.symbol ?? values.symbol, name: evmValues.name ?? values.name, decimals: Number(evmValues.decimals ?? values.decimals) } : { symbol: values.symbol, name: values.name, decimals: Number(values.decimals) }) } : null;
  return { subject: String(address).toLowerCase(), assetId: String(assetId), block, runtime, observedAt, supported, exists, derivedAddress: derived, native, evm, interfacesAgree: native && evm ? SUBJECT_FIELDS.every((field) => native[field] === evm[field]) : null };
}
