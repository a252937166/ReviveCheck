import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { inspectWithClients, decodeUint256, formatNative, parseTokenAmount, availableNativeBalance, NETWORK } from '../lib/chain.js';
import { compileProbe } from '../scripts/compile-probe.js';

const native = encodeAddress(new Uint8Array(32).fill(1), 42);
const h160 = `0x${'11'.repeat(20)}`;
const contract = `0x${'22'.repeat(20)}`;
const txHash = `0x${'33'.repeat(32)}`;
const nativeHash = `0x${'44'.repeat(32)}`;
const evmHash = `0x${'55'.repeat(32)}`;
const valueWord = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;

function clients({ code = '0x6000', nativeValue = 42, evmValue = 42, balance = 100n, mapped = true, txRelated = true, txSuccess = true, senderMatches = true } = {}) {
  const api = {
    genesisHash: NETWORK.genesisHash,
    runtimeVersion: { specVersion: 3002 },
    registry: { chainDecimals: [14], chainTokens: ['tPOT'] },
    consts: { revive: { chainId: NETWORK.chainId, nativeToEthRatio: 10000 } },
    rpc: { chain: {
      getFinalizedHead: async () => nativeHash,
      getHeader: async () => ({ number: 100 }),
      getBlockHash: async () => nativeHash,
      getBlock: async () => ({ block: { extrinsics: [{ hash: txHash, isSigned: true, signer: senderMatches ? native : encodeAddress(new Uint8Array(32).fill(3), 42), method: { section: 'revive', method: 'instantiateWithCode', args: [] } }] } }),
    } },
    call: { reviveApi: {
      ethBlockHash: async () => evmHash,
      accountId: async () => mapped ? native : encodeAddress(new Uint8Array(32).fill(2), 42),
      address: async () => h160,
      call: async () => ({ result: { isOk: true, asOk: { flags: { bits: 0 }, data: valueWord(nativeValue) } } }),
    } },
    query: { system: {
      account: async () => ({ data: { free: balance, frozen: 0n } }),
      events: async () => [
        { phase: { isApplyExtrinsic: true, asApplyExtrinsic: 0 }, event: { section: 'system', method: txSuccess ? 'ExtrinsicSuccess' : 'ExtrinsicFailed', data: [] } },
        { phase: { isApplyExtrinsic: true, asApplyExtrinsic: 0 }, event: { section: 'revive', method: 'Instantiated', data: [h160, txRelated ? contract : h160] } },
      ],
    } },
  };
  api.at = async () => api;
  const rpc = async (method) => {
    switch (method) {
      case 'eth_chainId': return '0x190f1ca9';
      case 'eth_getBlockByNumber': return { number: '0x64', hash: evmHash };
      case 'eth_getBalance': return '0x42';
      case 'eth_getCode': return code;
      case 'eth_call': return valueWord(evmValue);
      default: throw new Error(`Unexpected test RPC method: ${method}`);
    }
  };
  return { api, rpc };
}

const project = { account: native, contractAddress: contract, expectedValue: '42', expectedChainId: NETWORK.chainId, transactionHash: txHash, transactionBlockHash: nativeHash };
const byId = (report, id) => report.checks.find((check) => check.id === id);

test('empty live input cannot pass as a release', async () => {
  const report = await inspectWithClients({}, clients());
  assert.equal(byId(report, 'network.chain-id').status, 'passed');
  assert.equal(byId(report, 'network.finalized').status, 'passed');
  for (const id of ['account.mapping', 'account.balance', 'contract.code', 'contract.value', 'transaction.finality']) assert.equal(byId(report, id).status, 'blocked');
});

test('expected-network mismatch blocks dependent reads', async () => {
  const report = await inspectWithClients({ ...project, expectedChainId: 1 }, clients());
  assert.equal(byId(report, 'network.chain-id').status, 'failed');
  assert.equal(byId(report, 'contract.code').status, 'blocked');
});

test('two interfaces must resolve the same finalized EVM hash', async () => {
  const mocked = clients();
  mocked.api.call.reviveApi.ethBlockHash = async () => `0x${'99'.repeat(32)}`;
  const report = await inspectWithClients(project, mocked);
  assert.equal(byId(report, 'network.finalized').status, 'failed');
  assert.equal(byId(report, 'contract.value').status, 'blocked');
});

test('round-trip mapping failure cannot pass a native call assertion', async () => {
  const report = await inspectWithClients(project, clients({ mapped: false }));
  assert.equal(byId(report, 'account.mapping').status, 'blocked');
  assert.equal(byId(report, 'contract.value').status, 'blocked');
});

test('H160 input must resolve back to the same H160 through the native account', async () => {
  const mocked = clients();
  // accountId(H160) is stable, but the reverse API disagrees. Repeating only
  // accountId(H160) would have incorrectly accepted this inconsistent mapping.
  mocked.api.call.reviveApi.address = async () => contract;
  const report = await inspectWithClients({ ...project, account: h160 }, mocked);
  assert.equal(byId(report, 'account.mapping').status, 'blocked');
  assert.equal(byId(report, 'account.mapping').evidence.nativeToEvmAddress, contract);
  assert.equal(byId(report, 'contract.value').status, 'blocked');
});

test('consistent H160-to-native-to-H160 mapping is accepted', async () => {
  const report = await inspectWithClients({ ...project, account: h160 }, clients());
  assert.equal(byId(report, 'account.mapping').status, 'passed');
  assert.equal(byId(report, 'account.mapping').evidence.nativeToEvmAddress, h160);
  assert.ok(report.checks.every((check) => check.status === 'passed'));
});

test('zero balance blocks funding without claiming deployment failure', async () => {
  const report = await inspectWithClients(project, clients({ balance: 0n }));
  assert.equal(byId(report, 'account.balance').status, 'blocked');
  assert.equal(byId(report, 'contract.code').status, 'passed');
});

test('an EOA empty-code response cannot satisfy the contract assertion', async () => {
  const report = await inspectWithClients(project, clients({ code: '0x' }));
  assert.equal(byId(report, 'contract.code').status, 'failed');
  assert.equal(byId(report, 'contract.value').status, 'blocked');
});

test('cross-interface mismatch fails even when EVM matches expected value', async () => {
  const report = await inspectWithClients(project, clients({ nativeValue: 41 }));
  assert.equal(byId(report, 'contract.value').status, 'failed');
});

test('successful unrelated finalized transaction cannot pass contract provenance', async () => {
  const report = await inspectWithClients(project, clients({ txRelated: false }));
  assert.equal(byId(report, 'transaction.finality').status, 'failed');
});

test('failed native extrinsic cannot pass despite an Instantiated event fixture', async () => {
  const report = await inspectWithClients(project, clients({ txSuccess: false }));
  assert.equal(byId(report, 'transaction.finality').status, 'failed');
});

test('another sender cannot provide transaction evidence for the project account', async () => {
  const report = await inspectWithClients(project, clients({ senderMatches: false }));
  assert.equal(byId(report, 'transaction.finality').status, 'failed');
});

test('complete consistent evidence passes, retaining raw EVM balance units', async () => {
  const report = await inspectWithClients(project, clients());
  assert.ok(report.checks.every((check) => check.status === 'passed'));
  assert.equal(byId(report, 'account.balance').evidence.evmBalanceRaw, '0x42');
  assert.equal(byId(report, 'account.balance').evidence.nativeDecimals, 14);
  assert.equal(byId(report, 'account.balance').evidence.nativeToEthRatio, '10000');
});

test('unit conversion is exact and rejects truncated ABI data', () => {
  assert.equal(formatNative('123456789012345', 14), '1.23456789012345');
  assert.equal(parseTokenAmount('1.23456789012345', 14), 123456789012345n);
  assert.throws(() => parseTokenAmount('0.000000000000001', 14));
  assert.throws(() => decodeUint256('0x'));
  assert.throws(() => decodeUint256('0x2a'));
  assert.equal(decodeUint256(valueWord(42)), '42');
  assert.equal(decodeAddress(native).length, 32);
});

test('funding availability preserves the existential deposit and respects a higher freeze', () => {
  assert.equal(availableNativeBalance({ data: { free: 500n, frozen: 0n } }, 10n), 490n);
  assert.equal(availableNativeBalance({ data: { free: 500n, frozen: 30n } }, 10n), 470n);
  assert.equal(availableNativeBalance({ data: { free: 10n, frozen: 0n } }, 10n), 0n);
});

test('probe compiles with the pinned compiler and exposes an owned state-changing function', async () => {
  const artifact = await compileProbe();
  assert.match(artifact.bytecode, /^0x(?:[0-9a-f]{2})+$/);
  assert.ok(artifact.bytecode.length > 100);
  assert.equal(artifact.target, 'evm-paris');
  assert.ok(artifact.abi.some((entry) => entry.name === 'setValue' && entry.stateMutability === 'nonpayable'));
  assert.ok(artifact.abi.some((entry) => entry.name === 'UnauthorizedCaller' && entry.type === 'error'));
  assert.ok(artifact.abi.some((entry) => entry.name === 'ValueChanged' && entry.type === 'event'));
});
