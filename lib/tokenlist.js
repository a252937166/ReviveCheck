import { Interface } from 'ethers';
import { abortable, str } from './chain.js';
import { REGISTRY } from './registry.js';

// The VerifiedTokenList: the registry's reference consumer on the V3 testnet. A
// token is listed only while the named reviewer's approval of the exact report
// stands in the registry, so `isListed` follows the registry's state.
export const TOKEN_LIST = Object.freeze({
  address: '0xd0bd833b4b8658b1230a0e9a99640935b3c65819',
  registry: REGISTRY.address,
  curator: '0x0000000000000000000000000000000000000000',
  deploy: {"extrinsicHash":"0xe3efb1e79d8544a42aa1ee4472c291e1f61538b1c6a2346ae9746ee004f56570","blockHash":"0x214b2443a3a32d6de5f463835d7220547074452a1436fbd8602d327102134226","blockNumber":"164220","finalizedAt":"2026-10-23T19:03:12.758Z"},
});
export const TOKEN_LIST_ABI = Object.freeze([
  'function list(address token, bytes32 releaseId, bytes32 reportHash, address reviewer, uint8 decimals)',
  'function isListed(address token) view returns (bool)',
  'function entryOf(address token) view returns (bytes32 releaseId, bytes32 reportHash, address reviewer)',
  'function registry() view returns (address)',
  'function curator() view returns (address)',
  'event Listed(address indexed token, bytes32 indexed releaseId, address indexed reviewer, bytes32 reportHash, uint8 decimals)',
  'error ReviewerNotAllowed(address reviewer)', 'error NotReleaseOwner()', 'error DecimalsMismatch(uint8 chainDecimals)',
  'error ReleaseNotApproved(bytes32 id)', 'error ReportMismatch(bytes32 id, bytes32 expected, bytes32 current)',
]);
export const tokenListInterface = new Interface(TOKEN_LIST_ABI);
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/;
const requireAddress = () => { if (!TOKEN_LIST.address) throw new Error('The VerifiedTokenList is not deployed yet.'); return TOKEN_LIST.address; };

/** The unsigned `list` call. A wallet signs it as an EVM transaction or through Revive.call. */
export function listCall({ token, releaseId, reportHash, reviewer, decimals }) {
  if (!H160.test(token || '')) throw new Error('The token is an H160 address.');
  if (!H160.test(reviewer || '')) throw new Error('The reviewer is an H160 address.');
  if (!HASH.test(releaseId || '') || !HASH.test(reportHash || '')) throw new Error('The release ID and report hash are 32 bytes each.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Decimals is an integer from 0 to 255.');
  return { to: requireAddress(), data: tokenListInterface.encodeFunctionData('list', [token, releaseId, reportHash, reviewer, decimals]) };
}
export function decodeTokenListError(data) {
  try { return tokenListInterface.parseError(data)?.name ?? null; } catch { return null; }
}

/** Read one token's listing through both V3 interfaces at a single finalized checkpoint. */
export async function readTokenListWithClients({ api, rpc, signal }, { token }) {
  const address = requireAddress();
  if (!H160.test(token || '')) throw new Error('The token is an H160 address.');
  const finalizedHash = await abortable(api.rpc.chain.getFinalizedHead(), signal);
  const number = BigInt((await abortable(api.rpc.chain.getHeader(finalizedHash), signal)).number.toString());
  const at = await abortable(api.at(finalizedHash), signal);
  const mapped = await abortable(at.call.reviveApi.ethBlockHash(number.toString()), signal);
  const evmHash = mapped.isNone ? null : str(mapped.unwrap ? mapped.unwrap() : mapped);
  if (!evmHash) throw new Error('ReviveApi has no EVM hash for the finalized block.');
  const caller = (await abortable(at.call.reviveApi.accountId(address), signal)).toString();
  const views = {};
  for (const [method, args] of [['isListed', [token]], ['entryOf', [token]]]) {
    const data = tokenListInterface.encodeFunctionData(method, args);
    const [evmData, nativeResult] = await abortable(Promise.all([rpc('eth_call', [{ to: address, data }, { blockHash: evmHash, requireCanonical: true }]), at.call.reviveApi.call(caller, address, '0', null, null, data)]), signal);
    if (!nativeResult.result?.isOk) throw new Error(`Native ${method} call failed.`);
    const decode = (raw) => tokenListInterface.decodeFunctionResult(method, raw).map((value) => typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value.toLowerCase() : value);
    const evm = decode(evmData), native = decode(str(nativeResult.result.asOk.data));
    views[method] = { evm, native, match: JSON.stringify(evm) === JSON.stringify(native) };
  }
  const [releaseId, reportHash, reviewer] = views.entryOf.evm;
  return {
    token: token.toLowerCase(), block: { number: number.toString(), nativeHash: str(finalizedHash), evmHash },
    listed: views.isListed.evm[0], entry: releaseId === `0x${'00'.repeat(32)}` ? null : { releaseId, reportHash, reviewer },
    interfacesAgree: Object.values(views).every((entry) => entry.match), views,
  };
}
