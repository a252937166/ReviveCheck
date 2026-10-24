import { keccakAsHex } from '@polkadot/util-crypto';
import { abortable, check, connectNative, safeError, str } from './chain.js';
import { NETWORKS } from './networks.js';

const LIVE = NETWORKS.live;
const TITLES = {
  'network.chain-id': 'V3 Live network identity',
  'network.finalized-native': 'Finalized V3 Live checkpoint',
  'promotion.chain-id': 'Release names this network',
  'promotion.runtime': 'Runtime matches the accepted report',
  'promotion.asset': 'Referenced asset exists on V3 Live',
  'promotion.evm-interface': 'EVM interface for dual reads',
};
export const PROMOTION_CHECK_IDS = Object.freeze(Object.keys(TITLES));

/**
 * Assess whether an accepted testnet report can stand for V3 Live. Read-only:
 * nothing is deployed or listed. Injectable clients keep tests deterministic.
 */
export async function inspectPromotionWithClients(project, accepted, { api, signal } = {}) {
  const results = new Map();
  const add = (item) => results.set(item.id, { ...item, title: TITLES[item.id] });
  const network = { name: LIVE.name, chainId: LIVE.chainId, substrateRpcUrl: LIVE.substrateRpcUrl, evmRpcUrl: null, genesisHash: LIVE.genesisHash };
  const limitations = ['A promotion assessment reads V3 Live without signing. It decides whether an accepted testnet report can stand for this network; it does not deploy, list, or migrate anything.'];
  try {
    const genesis = str(api.genesisHash).toLowerCase();
    const runtimeChainId = api.consts.revive?.chainId?.toString() ?? null;
    network.nativeGenesisHash = genesis;
    network.observedChainId = runtimeChainId === null ? null : Number(runtimeChainId);
    if (genesis !== LIVE.genesisHash) {
      add(check('network.chain-id', 'failed', 'Native genesis differs from the pinned Portaldot V3 Live network', `Portaldot V3 Live ${LIVE.chainId} with pinned genesis`, 'Connect to the official V3 Live node.'));
      throw new Error('Connected node is not Portaldot V3 Live; dependent checks were not run');
    }
    add(check('network.chain-id', 'passed', `Native runtime identifies ${runtimeChainId}; pinned V3 Live genesis matches`, `Portaldot V3 Live ${LIVE.chainId} with pinned genesis`, '', { nativeGenesisHash: genesis, nativeRuntimeChainId: runtimeChainId, evmChainIdHex: null }));

    const finalizedHash = await abortable(api.rpc.chain.getFinalizedHead(), signal);
    const header = await abortable(api.rpc.chain.getHeader(finalizedHash), signal);
    const number = BigInt(header.number.toString());
    const at = await abortable(api.at(finalizedHash), signal);
    const version = await abortable(api.rpc.state.getRuntimeVersion(finalizedHash), signal);
    for (const key of ['specName', 'specVersion', 'transactionVersion', 'stateVersion']) network[key] = version[key]?.toString() ?? null;
    network.finalizedBlockNumber = number.toString();
    network.finalizedNativeBlockHash = str(finalizedHash);
    network.finalizedEvmBlockHash = null;
    const revive = at.consts?.revive || api.consts.revive;
    const balances = at.consts?.balances || api.consts.balances;
    network.parameterSnapshot = Object.fromEntries(['chainId', 'nativeToEthRatio', 'allowEVMBytecode', 'autoMap', 'depositPerByte', 'depositPerItem', 'gasScale'].map((key) => [key, revive?.[key]?.toString() ?? null]));
    network.parameterSnapshot.existentialDeposit = balances?.existentialDeposit?.toString() ?? null;
    network.constantsHash = keccakAsHex(JSON.stringify(network.parameterSnapshot));
    add(check('network.finalized-native', 'passed', `Finalized native block ${number}`, 'One canonical finalized native checkpoint', '', { nativeBlockHash: str(finalizedHash), nativeBlockNumber: number.toString() }));

    const claimed = Number(project.listing?.chainId ?? project.expectedChainId);
    const sameChain = claimed === network.observedChainId;
    add(check('promotion.chain-id', sameChain ? 'passed' : 'failed', sameChain ? `The release names chain ${claimed}` : `The release names chain ${claimed}; V3 Live reports ${network.observedChainId}`, `The release names chain ${network.observedChainId}`, sameChain ? '' : `Publish a separate V3 Live release that names chain ${network.observedChainId}.`, { claimedChainId: claimed, targetChainId: network.observedChainId }));

    const acceptedRuntime = `${accepted?.network?.specName}/${accepted?.network?.specVersion}`;
    const targetRuntime = `${network.specName}/${network.specVersion}`;
    const sameRuntime = acceptedRuntime === targetRuntime;
    add(check('promotion.runtime', sameRuntime ? 'passed' : 'blocked', sameRuntime ? `Both networks run ${targetRuntime}` : `V3 Live runs ${targetRuntime}; the report was accepted on ${acceptedRuntime}`, `The accepting runtime, ${acceptedRuntime}`, sameRuntime ? '' : `Recheck on ${targetRuntime}. The ERC-20 precompile address scheme is verified only for portaldot-v3/3002.`, { acceptedReportHash: accepted?.evidenceHash ?? null, acceptedRuntime, targetRuntime }));

    const assetId = project.nativeAsset?.assetId;
    const details = await abortable(at.query.assets.asset(assetId), signal);
    const exists = !!details?.isSome;
    add(check('promotion.asset', exists ? 'passed' : 'failed', exists ? `Asset ${assetId} exists at block ${number}` : `Asset ${assetId} does not exist on V3 Live at block ${number}`, `Native asset ${assetId} exists`, exists ? '' : `The listing cannot point at asset ${assetId}'s precompile until that asset exists on V3 Live.`, { assetId, nativeExists: exists, nativeBlockHash: str(finalizedHash) }));

    add(check('promotion.evm-interface', 'blocked', 'No official V3 Live EVM RPC is listed in the official explorer configuration; ERC-20 reads were not performed', 'An official EVM endpoint for dual-interface reads', 'Obtain the official V3 Live EVM endpoint, then recheck through both interfaces.', { configuredNodes: [LIVE.substrateRpcUrl], evmRpcUrl: null }));
  } catch (error) {
    if (!results.has('network.chain-id')) add(check('network.chain-id', 'unknown', safeError(error), `Portaldot V3 Live ${LIVE.chainId} with pinned genesis`, 'Retry the official V3 Live node.'));
    limitations.push(safeError(error));
  }
  for (const id of PROMOTION_CHECK_IDS) if (!results.has(id)) add(check(id, 'blocked', 'Required upstream evidence is unavailable', TITLES[id], 'Resolve the network identity first.'));
  return { checks: PROMOTION_CHECK_IDS.map((id) => results.get(id)), network, limitations };
}

export async function inspectPromotion(project, accepted, { signal, timeoutMs = 60_000 } = {}) {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let api;
  try {
    api = await connectNative({ signal: bounded, url: LIVE.substrateRpcUrl });
    return await abortable(inspectPromotionWithClients(project, accepted, { api, signal: bounded }), bounded);
  } catch (error) {
    return { checks: PROMOTION_CHECK_IDS.map((id) => ({ ...check(id, id === 'network.chain-id' ? 'unknown' : 'blocked', id === 'network.chain-id' ? safeError(error) : 'Network evidence unavailable', TITLES[id], 'Retry the official V3 Live node.'), title: TITLES[id] })), network: { name: LIVE.name, chainId: LIVE.chainId, substrateRpcUrl: LIVE.substrateRpcUrl, evmRpcUrl: null, genesisHash: LIVE.genesisHash }, limitations: ['No signing or deployment was performed.', safeError(error)] };
  } finally { if (api) await api.disconnect().catch(() => {}); }
}
