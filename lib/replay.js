import { abortable, connectNative, decodeUint256, evmRpc, safeError, str } from './chain.js';
import { decodeAssertion } from './plan.js';

const lower = (value) => String(value ?? '').toLowerCase();
const unwrap = (value) => value?.isSome ? value.unwrap() : value;
const STRING_VIEW = { name: { signature: 'name()', returns: 'string' }, symbol: { signature: 'symbol()', returns: 'string' } };

/**
 * Re-read a sealed testnet report's observations at its own pinned finalized
 * block, through both interfaces. Reproduction shows the recorded values match
 * the chain at that block; it still trusts the same official RPC operators.
 * Status: 'reproduced' (every covered observation matches and nothing was left out),
 * 'partial' (the covered observations match but the report carries checks this replay
 * does not re-read; they are listed in coverage.unsupported), 'differs' or 'unavailable'.
 */
export async function replayWithClients(run, { api, rpc, signal } = {}) {
  const network = run?.network || {};
  const number = network.finalizedBlockNumber, nativeHash = network.finalizedNativeBlockHash, evmHash = network.finalizedEvmBlockHash;
  const result = { reportHash: run?.evidenceHash ?? null, blockNumber: number ?? null, nativeHash: nativeHash ?? null, evmHash: evmHash ?? null, items: [], status: 'unavailable', checkedAt: new Date().toISOString() };
  const item = (id, label, recorded, replayed, compare = (a, b) => String(a) === String(b)) => result.items.push({ id, label, recorded: recorded ?? null, replayed: replayed ?? null, match: recorded !== undefined && recorded !== null && compare(recorded, replayed) });
  try {
    if (run?.mode !== 'live' || run.scope !== 'portaldot-testnet-readonly') throw new Error('Replay needs a live testnet report with a cross-interface checkpoint.');
    if (!number || !nativeHash || !evmHash) throw new Error('The report has no complete finalized checkpoint to replay.');
    if (lower(str(api.genesisHash)) !== lower(network.nativeGenesisHash || network.genesisHash)) throw new Error('The connected node has a different genesis from the report.');
    // Every read is independent once the block is pinned, so they go out together;
    // the public RPCs answer in about half a second each, which adds up in sequence.
    const readTag = { blockHash: evmHash, requireCanonical: true };
    const call = (to, data) => rpc('eth_call', [{ to, data }, readTag]);
    const parity = run.checks?.find((check) => check.id === 'asset.native-erc20')?.evidence;
    const listing = run.checks?.find((check) => check.id === 'token.listing')?.evidence;
    const hasParity = !!(parity?.assetId && parity.precompileAddress);
    const hasListing = !!(listing?.precompileAddress && Array.isArray(listing.fields));
    const balanceData = hasParity && parity.evmHolder ? `0x70a08231${parity.evmHolder.slice(2).padStart(64, '0')}` : null;
    // What this replay re-reads: the checkpoint for every report, plus asset-parity and
    // token-listing evidence when present. Contract code, ABI assertions, account mapping and
    // transaction evidence are not re-read yet; a report that carries them comes back partial.
    const covered = (id) => id.startsWith('network.') || (id === 'asset.native-erc20' && hasParity) || (id === 'token.listing' && hasListing);
    const unsupported = (run.checks || []).map((check) => check.id).filter((id) => !covered(id));
    result.coverage = { checks: (run.checks || []).length, unsupported };
    const [canonical, head, at] = await abortable(Promise.all([
      api.rpc.chain.getBlockHash(number),
      api.rpc.chain.getFinalizedHead().then((hash) => api.rpc.chain.getHeader(hash)),
      api.at(nativeHash),
    ]), signal);
    const skip = Promise.resolve(null);
    const [mapped, details, parityMetadata, account, supplyData, balanceResult, decimalsData, listingMetadata, nameData, symbolData] = await abortable(Promise.all([
      at.call.reviveApi.ethBlockHash(String(number)),
      hasParity ? at.query.assets.asset(parity.assetId) : skip,
      hasParity ? at.query.assets.metadata(parity.assetId) : skip,
      hasParity && parity.nativeHolder ? at.query.assets.account(parity.assetId, parity.nativeHolder) : skip,
      hasParity ? call(parity.precompileAddress, '0x18160ddd') : skip,
      balanceData ? call(parity.precompileAddress, balanceData) : skip,
      hasParity ? call(parity.precompileAddress, '0x313ce567') : skip,
      hasListing ? at.query.assets.metadata(listing.assetId) : skip,
      hasListing ? call(listing.precompileAddress, '0x06fdde03') : skip,
      hasListing ? call(listing.precompileAddress, '0x95d89b41') : skip,
    ]), signal);
    item('checkpoint.native', `Block ${number} is still canonical`, lower(nativeHash), lower(str(canonical)));
    item('checkpoint.finalized', `Block ${number} is finalized`, true, BigInt(head.number.toString()) >= BigInt(number));
    item('checkpoint.evm', 'EVM block hash via ReviveApi', lower(evmHash), lower(str(unwrap(mapped))));
    if (hasParity) {
      item('native.supply', 'Native Assets supply', parity.nativeSupply, details?.isSome ? details.unwrap().supply.toString() : null);
      item('native.decimals', 'Native Assets decimals', parity.nativeDecimals, Number(parityMetadata.decimals.toString()));
      if (parity.nativeHolder) item('native.balance', 'Native holder balance', parity.nativeBalance, account?.isSome ? account.unwrap().balance.toString() : '0');
      item('erc20.totalSupply', 'ERC-20 totalSupply()', parity.erc20Supply, decodeUint256(supplyData));
      if (balanceResult) item('erc20.balanceOf', 'ERC-20 balanceOf(holder)', parity.erc20Balance, decodeUint256(balanceResult));
      item('erc20.decimals', 'ERC-20 decimals()', parity.erc20Decimals, decodeUint256(decimalsData));
    }
    if (hasListing) {
      const recorded = Object.fromEntries(listing.fields.map((field) => [field.field, field]));
      const text = (value) => value?.toUtf8 ? value.toUtf8() : String(value);
      item('native.symbol', 'Native Assets symbol', recorded.symbol?.native, text(listingMetadata.symbol));
      item('erc20.symbol', 'ERC-20 symbol()', recorded.symbol?.evm, decodeAssertion(STRING_VIEW.symbol, symbolData));
      item('native.name', 'Native Assets name', recorded.name?.native, text(listingMetadata.name));
      item('erc20.name', 'ERC-20 name()', recorded.name?.evm, decodeAssertion(STRING_VIEW.name, nameData));
    }
    const allMatch = result.items.length > 0 && result.items.every((entry) => entry.match);
    result.status = !allMatch ? 'differs' : unsupported.length ? 'partial' : 'reproduced';
  } catch (error) {
    result.error = safeError(error);
  }
  return result;
}

export async function replayReport(run, { signal, timeoutMs = 45_000 } = {}) {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let api;
  try {
    api = await connectNative({ signal: bounded });
    return await abortable(replayWithClients(run, { api, rpc: (method, params) => evmRpc(method, params, { signal: bounded }), signal: bounded }), bounded);
  } catch (error) {
    return { reportHash: run?.evidenceHash ?? null, items: [], status: 'unavailable', error: safeError(error), checkedAt: new Date().toISOString() };
  } finally { if (api) await api.disconnect().catch(() => {}); }
}
