// Visitor wallets. A Polkadot extension signs native extrinsics (Revive.call and
// System.remark_with_event); an EVM wallet signs Ethereum transactions that reach
// the same contract through the official EVM RPC. ReviveCheck never sees a key:
// it prepares and dry-runs each call, and the wallet asks the visitor to sign.
import { NETWORKS } from '../lib/networks.js';

const TESTNET = NETWORKS.testnet;
export const EVM_CHAIN_HEX = `0x${TESTNET.chainId.toString(16)}`;
const service = () => import('../lib/service.js');

export async function polkadotAccounts() {
  const { web3Enable, web3Accounts } = await import('@polkadot/extension-dapp');
  const extensions = await web3Enable('ReviveCheck');
  if (!extensions.length) throw new Error('No Polkadot wallet extension answered. Install or unlock Polkadot.js, Talisman or SubWallet, then try again.');
  const accounts = (await web3Accounts({ ss58Format: 42 })).filter((account) => account.type !== 'ethereum');
  if (!accounts.length) throw new Error('The wallet shared no Substrate accounts with this page. Allow access for one account, then try again.');
  return accounts.map((account) => ({ kind: 'polkadot', address: account.address, name: account.meta?.name || 'Account', source: account.meta?.source || 'extension' }));
}

/** EIP-6963 wallet discovery, with window.ethereum as the fallback. */
export function discoverEvmWallets(wait = 350) {
  return new Promise((resolve) => {
    const found = new Map();
    const listener = (event) => { const { info, provider } = event.detail || {}; if (info?.uuid && provider) found.set(info.uuid, { name: info.name, icon: info.icon, rdns: info.rdns, provider }); };
    window.addEventListener('eip6963:announceProvider', listener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', listener);
      const wallets = [...found.values()];
      if (!wallets.length && window.ethereum) wallets.push({ name: window.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet', icon: null, rdns: 'injected', provider: window.ethereum });
      resolve(wallets);
    }, wait);
  });
}

async function ensureTestnet(provider) {
  if ((await provider.request({ method: 'eth_chainId' }))?.toLowerCase() === EVM_CHAIN_HEX) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: EVM_CHAIN_HEX }] });
  } catch (error) {
    if (error?.code !== 4902 && !/unrecognized|not been added|unknown chain/i.test(error?.message || '')) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: EVM_CHAIN_HEX, chainName: TESTNET.name, nativeCurrency: { name: 'Test POT', symbol: TESTNET.symbol, decimals: 18 }, rpcUrls: [TESTNET.evmRpcUrl] }] });
  }
  if ((await provider.request({ method: 'eth_chainId' }))?.toLowerCase() !== EVM_CHAIN_HEX) throw new Error(`Switch your wallet to ${TESTNET.name} (chain ${TESTNET.chainId}) and try again.`);
}

export async function connectEvm(wallet) {
  const [address] = await wallet.provider.request({ method: 'eth_requestAccounts' });
  if (!address) throw new Error('The wallet shared no account with this page.');
  await ensureTestnet(wallet.provider);
  return { kind: 'evm', address: address.toLowerCase(), name: wallet.name, provider: wallet.provider };
}

/** Both identities and spendable tPOT for the connected account. */
export async function overview(account) {
  return (await service()).accountOverview(account.address);
}

const friendly = (error) => {
  const message = String(error?.message || error);
  if (error?.code === 4001 || /reject|cancel|denied/i.test(message)) return new Error('You declined the request in your wallet. Nothing was sent.');
  return error instanceof Error ? error : new Error(message);
};

/**
 * Sign and send a native extrinsic from a Polkadot extension, then follow it to
 * finality. `build` receives the connected ApiPromise and returns the call.
 */
export async function sendNative(account, build, onStatus = () => {}) {
  const [{ web3FromSource }, { withNetwork, extrinsicEvents }] = await Promise.all([import('@polkadot/extension-dapp'), service()]);
  const injector = await web3FromSource(account.source);
  return withNetwork(TESTNET, ({ api }) => new Promise((resolve, reject) => {
    let unsubscribe, extrinsicHash;
    onStatus({ stage: 'signing' });
    build(api).signAndSend(account.address, { signer: injector.signer }, (result) => {
      extrinsicHash ||= result.txHash.toHex();
      if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped) { unsubscribe?.(); reject(new Error(`The node reported ${result.status.type} for ${extrinsicHash}. Check the explorer before signing again.`)); return; }
      if (result.status.isReady || result.status.isBroadcast) onStatus({ stage: 'submitted', extrinsicHash });
      if (result.status.isInBlock) onStatus({ stage: 'in-block', extrinsicHash, blockHash: result.status.asInBlock.toHex() });
      if (!result.status.isFinalized) return;
      unsubscribe?.();
      const blockHash = result.status.asFinalized.toHex();
      Promise.all([api.rpc.chain.getHeader(blockHash), api.rpc.chain.getBlock(blockHash)]).then(async ([header, block]) => {
        const index = block.block.extrinsics.findIndex((extrinsic) => extrinsic.hash.toHex() === extrinsicHash);
        const { events, success } = await extrinsicEvents(api, blockHash, index);
        let failure = null;
        if (result.dispatchError) {
          const error = result.dispatchError;
          failure = error.isModule ? (({ section, name }) => `${section}.${name}`)(api.registry.findMetaError(error.asModule)) : error.toString();
        }
        resolve({ route: 'native', extrinsicHash, blockHash, blockNumber: header.number.toString(), extrinsicIndex: index, success: success && !failure, failure, events, finalizedAt: new Date().toISOString() });
      }).catch(reject);
    }).then((value) => { unsubscribe = value; }).catch((error) => reject(friendly(error)));
  }), 600_000);
}

/** Send a prepared registry call from an EVM wallet, then follow it to finality and its native extrinsic. */
export async function sendEvm(account, prepared, onStatus = () => {}) {
  try {
    await ensureTestnet(account.provider);
    onStatus({ stage: 'signing' });
    const txHash = await account.provider.request({ method: 'eth_sendTransaction', params: [{ from: account.address, to: prepared.to, data: prepared.data, value: '0x0' }] });
    onStatus({ stage: 'submitted', txHash });
    return await (await service()).settleEthTransaction(txHash, { onStatus });
  } catch (error) { throw friendly(error); }
}

/** One prepared contract call from whichever wallet is connected. A native call carries the dry-run's weight and deposit limits. */
export async function sendContractCall(account, prepared, onStatus) {
  if (account.kind === 'evm') return sendEvm(account, prepared, onStatus);
  const { weightLimit, storageDepositLimit } = prepared.native.args;
  if (typeof weightLimit !== 'object') throw new Error('The dry-run did not return a weight limit, so nothing was sent.');
  // Headroom over the dry-run: the call is charged for the weight it actually uses.
  const limit = { refTime: Math.ceil(Number(weightLimit.refTime) * 1.2), proofSize: Math.ceil(Number(weightLimit.proofSize) * 1.2) };
  return sendNative(account, (api) => api.tx.revive.call(prepared.to, 0, limit, storageDepositLimit, prepared.data), onStatus);
}

export const sendRegistryCall = sendContractCall;
export const sendRemark = (account, remark, onStatus) => sendNative(account, (api) => api.tx.system.remarkWithEvent(remark), onStatus);
/** Store a sealed report on Portaldot through the native Remark module. */
export const sendStore = (account, hex, onStatus) => sendNative(account, (api) => api.tx.remark.store(hex), onStatus);

/** Fee estimate for a native call, so a dry-run can show the full cost before signing. */
export async function nativeFee(account, prepared) {
  const { withNetwork } = await service();
  return withNetwork(TESTNET, async ({ api }) => {
    const call = prepared.action === 'remark' ? api.tx.system.remarkWithEvent(prepared.remark) : prepared.action === 'store' ? api.tx.remark.store(prepared.hex) : api.tx.revive.call(prepared.to, 0, prepared.native.args.weightLimit, prepared.native.args.storageDepositLimit, prepared.data);
    const info = await call.paymentInfo(account.address);
    return info.partialFee.toString();
  }, 60_000);
}
