import { ApiPromise, WsProvider } from '@polkadot/api';
import { decodeAddress, encodeAddress, keccakAsHex } from '@polkadot/util-crypto';

export const NETWORK = Object.freeze({
  name: 'Portaldot V3 Testnet',
  chainId: 420420777,
  evmRpcUrl: 'https://test-evm-rpc-v3.portaldot.dev',
  substrateRpcUrl: 'wss://test-node-v3.portaldot.dev',
  genesisHash: '0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd',
});

const TITLES = {
  'network.chain-id': 'Expected testnet identity',
  'network.finalized': 'Finalized cross-interface checkpoint',
  'account.mapping': 'Native / EVM account mapping',
  'account.balance': 'Test-token funding',
  'contract.code': 'Deployed contract code',
  'contract.value': 'Cross-interface value assertion',
  'transaction.finality': 'Finalized contract transaction',
};
const IDS = Object.keys(TITLES);
const H160 = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x[0-9a-fA-F]+$/;
export const VALUE_SELECTOR = keccakAsHex('value()').slice(0, 10);

export function formatNative(value, decimals) {
  const units = BigInt(value);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token decimals');
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${units / scale}${fraction ? `.${fraction}` : ''}`;
}

export function parseTokenAmount(value, decimals) {
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Token budget must be a positive decimal amount');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error('Token budget has too many decimal places');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

export function decodeUint256(data) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(data))) throw new Error('value() did not return one ABI uint256 word');
  return BigInt(data).toString();
}

export function availableNativeBalance(account, existentialDeposit = 0n) {
  const free = BigInt(account.data.free.toString());
  const frozen = BigInt(account.data.frozen?.toString() || '0');
  const ed = BigInt(existentialDeposit.toString());
  const reserve = frozen > ed ? frozen : ed;
  return free > reserve ? free - reserve : 0n;
}

const str = (value) => value?.toHex?.() ?? String(value);
const json = (value) => value?.toJSON?.() ?? value;
const lower = (value) => String(value).toLowerCase();
const quantity = (value) => {
  if (!QUANTITY.test(String(value))) throw new Error('Invalid JSON-RPC quantity');
  return BigInt(value);
};
const check = (id, status, observed, expected, remediation = '', evidence) => ({
  id, title: TITLES[id], status, observed, expected, remediation, ...(evidence ? { evidence } : {}),
});
const safeError = (error) => error?.name === 'TimeoutError' || error?.name === 'AbortError'
  ? 'The read-only request timed out or was cancelled.'
  : String(error?.message || error).slice(0, 280);

export async function evmRpc(method, params = [], { signal } = {}) {
  const response = await fetch(NETWORK.evmRpcUrl, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Official EVM RPC returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message || 'RPC error'}`);
  if (!Object.hasOwn(body, 'result')) throw new Error(`${method}: missing RPC result`);
  return body.result;
}

function abortable(promise, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal?.removeEventListener('abort', onAbort));
  });
}

export async function connectNative({ signal } = {}) {
  const provider = new WsProvider(NETWORK.substrateRpcUrl, false);
  let api;
  try {
    await abortable(provider.connect(), signal);
    const pending = ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true });
    pending.then((lateApi) => { if (signal?.aborted) void lateApi.disconnect(); }).catch(() => {});
    api = await abortable(pending, signal);
    return api;
  } catch (error) {
    await provider.disconnect().catch(() => {});
    throw error;
  }
}

export function assertTestnet(api, evmChainId) {
  if (str(api.genesisHash).toLowerCase() !== NETWORK.genesisHash) throw new Error('Native genesis differs from the pinned Portaldot V3 testnet');
  if (BigInt(evmChainId) !== BigInt(NETWORK.chainId) || BigInt(api.consts.revive.chainId.toString()) !== BigInt(NETWORK.chainId)) {
    throw new Error('Chain ID differs from Portaldot V3 testnet');
  }
}

function nativeCallValue(result) {
  if (!result.result?.isOk) throw new Error('Native ReviveApi call returned a dispatch error');
  const ok = result.result.asOk;
  const flags = json(ok.flags);
  if ((BigInt(typeof flags === 'object' ? flags.bits ?? 0 : flags) & 1n) !== 0n) throw new Error('Native ReviveApi call reverted');
  return decodeUint256(str(ok.data));
}

async function transactionCheck(project, { api, rpc, finalizedNumber, blockTag, nativeAccount, evmAccount }) {
  const hash = project.transactionHash || '';
  const blockHash = project.transactionBlockHash || '';
  const expected = 'A successful transaction for this contract in a canonical finalized block';
  if (!hash) return check('transaction.finality', 'blocked', 'No transaction hash supplied', expected, 'Deploy or update the probe, then save its transaction hash and native block hash.');
  if (!HASH.test(hash) || (blockHash && !HASH.test(blockHash))) return check('transaction.finality', 'failed', 'Invalid transaction or block hash', expected, 'Use complete 0x-prefixed 32-byte hashes.');
  if (!H160.test(project.contractAddress || '')) return check('transaction.finality', 'blocked', 'Contract address is required to associate the transaction', expected, 'Save the deployed contract address.');
  if (!nativeAccount || !evmAccount) return check('transaction.finality', 'blocked', 'A resolved project account is required to identify the sender', expected, 'Save and resolve the account that deployed or updated this contract.');
  try {
    if (blockHash) {
      const header = await api.rpc.chain.getHeader(blockHash);
      const number = BigInt(header.number.toString());
      const canonical = str(await api.rpc.chain.getBlockHash(header.number.toString()));
      if (number > finalizedNumber || lower(canonical) !== lower(blockHash)) return check('transaction.finality', 'blocked', 'The supplied native block is not canonical and finalized', expected, 'Wait for finality and provide the finalized native block hash.');
      const block = await api.rpc.chain.getBlock(blockHash);
      const index = block.block.extrinsics.findIndex((item) => lower(str(item.hash)) === lower(hash));
      if (index < 0) return check('transaction.finality', 'failed', 'Transaction hash is absent from the supplied block', expected, 'Provide matching extrinsic and native block hashes.');
      const blockApi = await api.at(blockHash);
      const records = await blockApi.query.system.events();
      const events = records.filter((record) => record.phase.isApplyExtrinsic && Number(record.phase.asApplyExtrinsic.toString()) === index).map((record) => record.event);
      const success = events.some((event) => event.section === 'system' && event.method === 'ExtrinsicSuccess');
      const failed = events.some((event) => event.section === 'system' && event.method === 'ExtrinsicFailed');
      const extrinsic = block.block.extrinsics[index];
      const tx = extrinsic.method;
      const senderMatches = extrinsic.isSigned && Buffer.from(decodeAddress(extrinsic.signer.toString())).equals(Buffer.from(decodeAddress(nativeAccount)));
      const deployedHere = events.some((event) => event.section === 'revive' && event.method === 'Instantiated' && lower(str(event.data[1])) === lower(project.contractAddress));
      const calledHere = tx.section === 'revive' && tx.method === 'call' && lower(str(tx.args[0])) === lower(project.contractAddress);
      const passed = success && !failed && senderMatches && (deployedHere || calledHere);
      return check('transaction.finality', passed ? 'passed' : 'failed', passed ? 'Successful native contract transaction from the project account is finalized' : 'The finalized extrinsic failed or has a different contract or sender', expected, passed ? '' : 'Use the successful deployment or Revive.call extrinsic from this project account.', { kind: 'native-extrinsic', hash, blockHash, blockNumber: number.toString(), sender: extrinsic.signer?.toString(), senderMatches, extrinsicIndex: index, events: events.map((event) => `${event.section}.${event.method}`) });
    }
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (!receipt) return check('transaction.finality', 'blocked', 'No EVM receipt found', expected, 'Wait for inclusion; native extrinsics also require their native block hash.');
    const number = quantity(receipt.blockNumber);
    const canonical = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
    const transaction = await rpc('eth_getTransactionByHash', [hash]);
    const related = [receipt.to, receipt.contractAddress].some((address) => address && lower(address) === lower(project.contractAddress));
    const senderMatches = transaction?.from && lower(transaction.from) === lower(evmAccount);
    const passed = quantity(receipt.status) === 1n && number <= finalizedNumber && canonical && lower(canonical.hash) === lower(receipt.blockHash) && related && senderMatches;
    return check('transaction.finality', passed ? 'passed' : number > finalizedNumber ? 'blocked' : 'failed', passed ? 'Successful EVM contract transaction from the project account is finalized' : 'Receipt is pending finality, reverted, noncanonical, or has a different contract or sender', expected, passed ? '' : 'Provide a successful finalized transaction from this project account for this contract.', { kind: 'evm-transaction', hash, blockHash: receipt.blockHash, blockNumber: number.toString(), status: receipt.status, sender: transaction?.from, senderMatches: !!senderMatches, finalizedCheckpoint: blockTag });
  } catch (error) {
    return check('transaction.finality', 'unknown', safeError(error), expected, 'Retry the official RPC or verify the supplied transaction evidence.');
  }
}

// Injectable clients are used by deterministic tests. Production always uses the two pinned RPC URLs.
export async function inspectWithClients(project, { api, rpc, signal } = {}) {
  const results = new Map();
  const network = { ...NETWORK };
  const limitations = ['Read-only verification does not sign, deploy, or prove a complete product flow.', 'A funded balance does not prove that deployment fees and storage deposits are affordable.', 'Transaction evidence associates the project sender and contract; it does not prove that this historical transaction caused the currently observed value.'];
  const add = (item) => results.set(item.id, item);
  try {
    const chainIdHex = await abortable(rpc('eth_chainId', []), signal);
    const expectedId = BigInt(project.expectedChainId ?? NETWORK.chainId);
    try { assertTestnet(api, chainIdHex); }
    catch (error) {
      add(check('network.chain-id', 'failed', safeError(error), `Portaldot V3 testnet ${NETWORK.chainId} with pinned genesis`, 'Use the official V3 testnet; do not continue on another chain.'));
      throw error;
    }
    network.observedChainId = Number(quantity(chainIdHex));
    network.nativeGenesisHash = str(api.genesisHash);
    network.specVersion = api.runtimeVersion.specVersion.toString();
    if (expectedId !== BigInt(NETWORK.chainId)) {
      add(check('network.chain-id', 'failed', `Connected to ${NETWORK.chainId}`, `Project expects ${expectedId}`, 'Select the Portaldot V3 testnet chain ID 420420777.'));
      throw new Error('Project expects a different network; dependent checks were not run');
    }
    add(check('network.chain-id', 'passed', `EVM and native runtime identify ${NETWORK.chainId}; pinned native genesis matches`, String(expectedId), '', { evmChainIdHex: chainIdHex, nativeGenesisHash: network.nativeGenesisHash, nativeRuntimeChainId: api.consts.revive.chainId.toString() }));

    const finalizedHash = await abortable(api.rpc.chain.getFinalizedHead(), signal);
    const finalizedHeader = await abortable(api.rpc.chain.getHeader(finalizedHash), signal);
    const finalizedNumber = BigInt(finalizedHeader.number.toString());
    const blockTag = `0x${finalizedNumber.toString(16)}`;
    const at = await abortable(api.at(finalizedHash), signal);
    const evmBlock = await abortable(rpc('eth_getBlockByNumber', [blockTag, false]), signal);
    const nativeEvmHash = await abortable(api.call.reviveApi.ethBlockHash(finalizedNumber.toString()), signal);
    const expectedEvmHash = nativeEvmHash.isNone ? '' : str(nativeEvmHash.unwrap ? nativeEvmHash.unwrap() : nativeEvmHash);
    const matching = evmBlock && quantity(evmBlock.number) === finalizedNumber && expectedEvmHash && lower(evmBlock.hash) === lower(expectedEvmHash);
    network.finalizedBlockNumber = finalizedNumber.toString();
    network.finalizedNativeBlockHash = str(finalizedHash);
    network.finalizedEvmBlockHash = evmBlock?.hash || null;
    add(check('network.finalized', matching ? 'passed' : 'failed', matching ? `Both interfaces resolve finalized block ${finalizedNumber}` : 'EVM block does not match the native ReviveApi finalized checkpoint', 'One canonical finalized checkpoint across the two interfaces', matching ? '' : 'Retry after the official EVM RPC catches up; do not compare different checkpoints.', { nativeBlockHash: str(finalizedHash), nativeBlockNumber: finalizedNumber.toString(), evmBlockHash: evmBlock?.hash, runtimeEvmBlockHash: expectedEvmHash }));
    if (!matching) throw new Error('Cross-interface checkpoint mismatch; dependent checks were not run');

    let nativeAccount;
    let evmAccount;
    if (!project.account) {
      add(check('account.mapping', 'blocked', 'No account supplied', 'A chain-resolved native / EVM account pair', 'Save a native SS58 address or EVM H160 address.'));
    } else {
      try {
        if (H160.test(project.account)) {
          evmAccount = project.account;
          nativeAccount = encodeAddress(decodeAddress(String(await abortable(at.call.reviveApi.accountId(evmAccount), signal))), 42);
        } else {
          const input = decodeAddress(project.account);
          if (input.length !== 32) throw new Error('Native address must identify an AccountId32');
          nativeAccount = encodeAddress(input, 42);
          evmAccount = str(await abortable(at.call.reviveApi.address(nativeAccount), signal));
        }
        if (!H160.test(evmAccount)) throw new Error('Runtime returned an invalid H160 address');
        const reverseAddress = str(await abortable(at.call.reviveApi.address(nativeAccount), signal));
        const roundTrip = decodeAddress(String(await abortable(at.call.reviveApi.accountId(evmAccount), signal)));
        const mapped = H160.test(reverseAddress) && lower(reverseAddress) === lower(evmAccount) && Buffer.from(roundTrip).equals(Buffer.from(decodeAddress(nativeAccount)));
        add(check('account.mapping', mapped ? 'passed' : 'blocked', mapped ? `${nativeAccount} ↔ ${evmAccount}` : 'Runtime mapping does not round-trip to the supplied account', 'A chain-resolved native / EVM account pair', mapped ? '' : 'Resolve the mapping mismatch before using the native account as the same EVM caller.', { nativeAccount, evmAccount, nativeToEvmAddress: reverseAddress, source: 'ReviveApi.account_id / address', checkpoint: str(finalizedHash) }));
      } catch (error) {
        nativeAccount = undefined;
        add(check('account.mapping', 'unknown', safeError(error), 'A chain-resolved native / EVM account pair', 'Verify the address and retry the official native RPC.'));
      }
    }
    if (!nativeAccount) {
      add(check('account.balance', 'blocked', 'A native account could not be resolved', 'Nonzero available test-token balance', 'Resolve the account mapping first.'));
    } else {
      try {
        const account = await abortable(at.query.system.account(nativeAccount), signal);
        const decimals = api.registry.chainDecimals[0];
        const symbol = api.registry.chainTokens[0];
        const free = BigInt(account.data.free.toString());
        const frozen = BigInt(account.data.frozen?.toString() || '0');
        const existentialDeposit = BigInt(api.consts.balances?.existentialDeposit?.toString() || '0');
        const available = availableNativeBalance(account, existentialDeposit);
        const rawEvmBalance = await abortable(rpc('eth_getBalance', [evmAccount, blockTag]), signal);
        quantity(rawEvmBalance);
        add(check('account.balance', available > 0n ? 'passed' : 'blocked', `${formatNative(available, decimals)} ${symbol} conservatively available while preserving the native account`, 'Nonzero available test-token balance', available > 0n ? '' : 'Request tPOT from the official Discord support flow using this native address.', { nativeAccount, nativeFreeRaw: free.toString(), nativeFrozenRaw: frozen.toString(), nativeExistentialDepositRaw: existentialDeposit.toString(), nativeAvailableRaw: available.toString(), nativeDecimals: decimals, nativeSymbol: symbol, evmBalanceRaw: rawEvmBalance, nativeToEthRatio: api.consts.revive.nativeToEthRatio?.toString() ?? null, checkpoint: str(finalizedHash) }));
      } catch (error) { add(check('account.balance', 'unknown', safeError(error), 'Nonzero available test-token balance', 'Retry the balance read; no funding claim can be made.')); }
    }

    const contract = project.contractAddress || '';
    if (!contract) {
      add(check('contract.code', 'blocked', 'No contract address supplied', 'Nonempty deployed code on Portaldot V3 testnet', 'Deploy ReviveProbe and save the resulting contract address.'));
      add(check('contract.value', 'blocked', 'No contract address supplied', `Both interfaces return value() = ${project.expectedValue ?? '42'}`, 'Deploy the probe and configure its expected value.'));
    } else if (!H160.test(contract)) {
      add(check('contract.code', 'failed', 'Contract address is not a complete H160 address', 'A 0x-prefixed 20-byte contract address', 'Copy the deployed contract address.'));
      add(check('contract.value', 'blocked', 'Invalid contract address', 'A valid contract to query', 'Correct the contract address first.'));
    } else {
      try {
        const code = await abortable(rpc('eth_getCode', [contract, blockTag]), signal);
        const hasCode = typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code);
        add(check('contract.code', hasCode ? 'passed' : 'failed', hasCode ? `${(code.length - 2) / 2} bytes of deployed code` : 'No deployed code at the finalized checkpoint', 'Nonempty deployed code on Portaldot V3 testnet', hasCode ? '' : 'Verify deployment, address, network, and finality.', { address: contract, codeHash: hasCode ? keccakAsHex(code) : null, blockTag }));
        if (!hasCode) {
          add(check('contract.value', 'blocked', 'No deployed code to query', `Both interfaces return value() = ${project.expectedValue ?? '42'}`, 'Fix contract deployment first.'));
        } else if (!nativeAccount || results.get('account.mapping')?.status !== 'passed') {
          add(check('contract.value', 'blocked', 'A round-trip mapped caller is required for the native read', 'Both interfaces return the expected value', 'Resolve account.mapping first.'));
        } else {
          const expected = String(project.expectedValue ?? '42');
          if (!/^\d+$/.test(expected) || BigInt(expected) >= 2n ** 256n) throw new Error('Expected value must be a uint256 decimal string');
          const [evmData, nativeResult] = await abortable(Promise.all([
            rpc('eth_call', [{ from: evmAccount, to: contract, data: VALUE_SELECTOR }, blockTag]),
            at.call.reviveApi.call(nativeAccount, contract, '0', null, null, VALUE_SELECTOR),
          ]), signal);
          const evmValue = decodeUint256(evmData);
          const nativeValue = nativeCallValue(nativeResult);
          const passed = BigInt(evmValue) === BigInt(expected) && evmValue === nativeValue;
          add(check('contract.value', passed ? 'passed' : 'failed', `EVM ${evmValue}; native ${nativeValue}`, `Both interfaces return value() = ${BigInt(expected)}`, passed ? '' : 'Check the deployed release, expected value, and cross-interface call encoding.', { selector: VALUE_SELECTOR, evmValue, nativeValue, expectedValue: BigInt(expected).toString(), nativeBlockHash: str(finalizedHash), evmBlockNumber: blockTag }));
        }
      } catch (error) {
        if (!results.has('contract.code')) add(check('contract.code', 'unknown', safeError(error), 'Nonempty deployed code', 'Retry the official EVM RPC.'));
        add(check('contract.value', 'unknown', safeError(error), `Both interfaces return value() = ${project.expectedValue ?? '42'}`, 'Verify the probe ABI, address, and native runtime availability.'));
      }
    }
    add(await abortable(transactionCheck(project, { api, rpc, finalizedNumber, blockTag, nativeAccount, evmAccount }), signal));
  } catch (error) {
    if (!results.has('network.chain-id')) add(check('network.chain-id', 'unknown', safeError(error), `Portaldot V3 testnet ${NETWORK.chainId} with pinned genesis`, 'Retry the official endpoints; no network identity has been verified.'));
    limitations.push(safeError(error));
  }
  for (const id of IDS) if (!results.has(id)) add(check(id, 'blocked', 'Required upstream evidence is unavailable', TITLES[id], 'Resolve the network or preceding check, then run again.'));
  return { checks: IDS.map((id) => results.get(id)), network, limitations };
}

export async function inspectChain(project, { signal } = {}) {
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(26_000)]) : AbortSignal.timeout(26_000);
  let api;
  try {
    api = await connectNative({ signal: boundedSignal });
    return await abortable(inspectWithClients(project, { api, rpc: (method, params) => evmRpc(method, params, { signal: boundedSignal }), signal: boundedSignal }), boundedSignal);
  } catch (error) {
    return { checks: IDS.map((id) => check(id, id === 'network.chain-id' ? 'unknown' : 'blocked', id === 'network.chain-id' ? safeError(error) : 'Network evidence unavailable', TITLES[id], 'Retry the official Portaldot V3 testnet endpoints.')), network: { ...NETWORK }, limitations: ['No signing or deployment was performed.', safeError(error)] };
  } finally { if (api) await api.disconnect().catch(() => {}); }
}
