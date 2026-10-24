import { Interface, keccak256 } from 'ethers';
import { abortable, str } from './chain.js';
import { REGISTRY } from './registry.js';
import { TOKEN_LIST_DEPLOYMENTS } from './tokenlist.deployments.js';

// The VerifiedTokenList: the registry's reference consumer on the V3 testnet. A
// token is listed only while the named reviewer's approval of the exact report
// stands in the registry, so `isListed` follows the registry's state.
//
// Deployments are versioned. The generated module lists every verified deployment
// and names the active one; scripts/activate-token-list.js regenerates it after
// re-reading the chain. v1 (deployed 2026-10-23) lets any release owner replace any
// entry (review F-02); the v2 sources in contracts/ fix that and await deployment.
export const TOKEN_LIST_VERSIONS = TOKEN_LIST_DEPLOYMENTS;
export const TOKEN_LIST = Object.freeze({ ...TOKEN_LIST_DEPLOYMENTS[TOKEN_LIST_DEPLOYMENTS.active], registry: REGISTRY.address });
// Derived by executing the preserved v1 initcode with its recorded registry and
// zero curator. Missing version() is recognized only for this address AND code.
export const LEGACY_TOKEN_LIST_IDENTITY = Object.freeze({
  address: '0xd0bd833b4b8658b1230a0e9a99640935b3c65819',
  registry: REGISTRY.address, curator: '0x0000000000000000000000000000000000000000',
  runtimeCodeHash: '0xd58ab5505577526ad961676cecc5f07599d4571bb85922be16d1dfe5483ba6f2',
});
export const TOKEN_LIST_ABI = Object.freeze([
  'function list(address token, bytes32 releaseId, bytes32 reportHash, address reviewer, uint8 decimals)',
  'function isListed(address token) view returns (bool)',
  'function entryOf(address token) view returns (bytes32 releaseId, bytes32 reportHash, address reviewer)',
  'function registry() view returns (address)',
  'function curator() view returns (address)',
  // v2 surface (not on the v1 testnet deployment): delist, version, and the entry-ownership errors.
  'function delist(address token)',
  'function version() view returns (uint8)',
  'event Listed(address indexed token, bytes32 indexed releaseId, address indexed reviewer, bytes32 reportHash, uint8 decimals)',
  'event Delisted(address indexed token, bytes32 indexed releaseId, address indexed by)',
  'error ReviewerNotAllowed(address reviewer)', 'error NotReleaseOwner()', 'error DecimalsMismatch(uint8 chainDecimals)',
  'error EntryOwnedByAnother(address owner)', 'error NoEntry()',
  'error ReleaseNotApproved(bytes32 id)', 'error ReportMismatch(bytes32 id, bytes32 expected, bytes32 current)',
]);
export const tokenListInterface = new Interface(TOKEN_LIST_ABI);
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/;
const requireAddress = () => { if (!TOKEN_LIST.address) throw new Error('The VerifiedTokenList is not deployed yet.'); return TOKEN_LIST.address; };

/** Shared refusal for application and script writes; historical reads stay available. */
export function assertTokenListWritable(deployment = TOKEN_LIST) {
  if (deployment.version === 1 && deployment.knownIssue) throw new Error('New listings are disabled on the historical v1 token list because its entry-ownership defect is known. Read-only evidence remains available; activate a verified v2 deployment before preparing a listing.');
}

/** The unsigned `list` call. A wallet signs it as an EVM transaction or through Revive.call. */
export function listCall({ token, releaseId, reportHash, reviewer, decimals }) {
  if (!H160.test(token || '')) throw new Error('The token is an H160 address.');
  if (!H160.test(reviewer || '')) throw new Error('The reviewer is an H160 address.');
  if (!HASH.test(releaseId || '') || !HASH.test(reportHash || '')) throw new Error('The release ID and report hash are 32 bytes each.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Decimals is an integer from 0 to 255.');
  assertTokenListWritable();
  return { to: requireAddress(), data: tokenListInterface.encodeFunctionData('list', [token, releaseId, reportHash, reviewer, decimals]) };
}
export function decodeTokenListError(data) {
  try { return tokenListInterface.parseError(data)?.name ?? null; } catch { return null; }
}

async function finalizedCheckpoint({ api, signal }) {
  const finalizedHash = await abortable(api.rpc.chain.getFinalizedHead(), signal);
  const number = BigInt((await abortable(api.rpc.chain.getHeader(finalizedHash), signal)).number.toString());
  const at = await abortable(api.at(finalizedHash), signal);
  const mapped = await abortable(at.call.reviveApi.ethBlockHash(number.toString()), signal);
  const evmHash = mapped.isNone ? null : str(mapped.unwrap ? mapped.unwrap() : mapped);
  if (!evmHash) throw new Error('ReviveApi has no EVM hash for the finalized block.');
  return { at, block: { number: number.toString(), nativeHash: str(finalizedHash), evmHash }, readTag: { blockHash: evmHash, requireCanonical: true } };
}

/** Read one token's listing through both V3 interfaces at a single finalized checkpoint. */
export async function readTokenListWithClients({ api, rpc, signal }, { token, address = requireAddress() }) {
  if (!H160.test(token || '')) throw new Error('The token is an H160 address.');
  if (!H160.test(address || '')) throw new Error('The token list is an H160 address.');
  const checkpoint = await finalizedCheckpoint({ api, signal });
  const { at, block, readTag } = checkpoint;
  const caller = (await abortable(at.call.reviveApi.accountId(address), signal)).toString();
  const views = {};
  for (const [method, args] of [['isListed', [token]], ['entryOf', [token]]]) {
    const data = tokenListInterface.encodeFunctionData(method, args);
    const [evmData, nativeResult] = await abortable(Promise.all([rpc('eth_call', [{ to: address, data }, readTag]), at.call.reviveApi.call(caller, address, '0', null, null, data)]), signal);
    if (!nativeResult.result?.isOk) throw new Error(`Native ${method} call failed.`);
    const decode = (raw) => tokenListInterface.decodeFunctionResult(method, raw).map((value) => typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value.toLowerCase() : value);
    const evm = decode(evmData), native = decode(str(nativeResult.result.asOk.data));
    views[method] = { evm, native, match: JSON.stringify(evm) === JSON.stringify(native) };
  }
  const [releaseId, reportHash, reviewer] = views.entryOf.evm;
  const identity = await readTokenListIdentityWithClients({ api, rpc, signal }, address, { checkpoint }).catch((error) => ({ error: String(error?.message || error) }));
  return {
    token: token.toLowerCase(), list: address.toLowerCase(), block,
    listed: views.isListed.evm[0], entry: releaseId === `0x${'00'.repeat(32)}` ? null : { releaseId, reportHash, reviewer },
    interfacesAgree: Object.values(views).every((entry) => entry.match), views, identity, observedAt: new Date().toISOString(),
  };
}

/**
 * The identity a deployment is verified by: version(), registry() and curator(),
 * each through the EVM RPC and ReviveApi at one finalized block. A contract
 * without version() (the v1 deployment) reads as `null` on both interfaces.
 */
export async function readTokenListIdentityWithClients({ api, rpc, signal }, address = requireAddress(), { checkpoint } = {}) {
  if (!H160.test(address || '')) throw new Error('The token list is an H160 address.');
  const { at, block, readTag } = checkpoint || await finalizedCheckpoint({ api, signal });
  const caller = (await abortable(at.call.reviveApi.accountId(address), signal)).toString();
  const views = {};
  for (const method of ['version', 'registry', 'curator']) {
    const data = tokenListInterface.encodeFunctionData(method, []);
    const [evmData, nativeResult] = await abortable(Promise.all([rpc('eth_call', [{ to: address, data }, readTag]).catch((error) => ({ error: String(error?.message || error) })), at.call.reviveApi.call(caller, address, '0', null, null, data)]), signal);
    const decode = (raw) => { try { const [value] = tokenListInterface.decodeFunctionResult(method, raw); return typeof value === 'bigint' ? value.toString() : String(value).toLowerCase(); } catch { return null; } };
    const evm = typeof evmData === 'string' && /^0x[0-9a-fA-F]+$/.test(evmData) ? decode(evmData) : null;
    const ok = nativeResult.result?.isOk ? nativeResult.result.asOk : null;
    const flags = ok ? ok.flags.toJSON() : null;
    const native = ok && (BigInt(flags?.bits ?? flags) & 1n) === 0n ? decode(str(ok.data)) : null;
    views[method] = { evm, native, match: evm === native };
  }
  const pick = (side) => ({ version: views.version[side], registry: views.registry[side], curator: views.curator[side] });
  const code = await abortable(rpc('eth_getCode', [address, readTag]), signal);
  const runtimeCodeHash = /^0x[0-9a-fA-F]+$/.test(code || '') ? keccak256(code) : null;
  const identity = { address: address.toLowerCase(), block, evm: pick('evm'), native: pick('native'), interfacesAgree: Object.values(views).every((entry) => entry.match), views, runtimeCodeHash, observedAt: new Date().toISOString() };
  return { ...identity, ...resolveTokenListVersion(identity) };
}

/** A missing getter never identifies an arbitrary contract as v1. */
export function resolveTokenListVersion(identity) {
  const unavailable = { version: null, versionSource: 'unavailable' };
  if (!identity?.interfacesAgree || !identity.runtimeCodeHash) return unavailable;
  const version = Number(identity.evm?.version);
  if (identity.evm?.version !== null && Number.isSafeInteger(version) && version > 0 && String(identity.native?.version) === String(version)) return { version, versionSource: 'on-chain-version-getter' };
  const legacy = LEGACY_TOKEN_LIST_IDENTITY;
  if (identity.address === legacy.address && identity.runtimeCodeHash === legacy.runtimeCodeHash && identity.evm?.version === null && identity.native?.version === null && ['evm', 'native'].every((side) => identity[side]?.registry === legacy.registry && identity[side]?.curator === legacy.curator)) return { version: 1, versionSource: 'known-deployment-runtime-code' };
  return unavailable;
}
