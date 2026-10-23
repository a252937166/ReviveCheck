import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { TypeRegistry, Metadata } from '@polkadot/types';
import { getSpecTypes } from '@polkadot/types-known';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Interface } from 'ethers';
import { inspectWithClients, decodeUint256, formatNative, parseTokenAmount, availableNativeBalance, NETWORK, NATIVE_TYPES_BUNDLE, nativeAssetAddress } from '../lib/chain.js';
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

test('historical asset-paid block fails with default types and decodes with the spec-scoped historical registry', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/portaldot-156435.json', import.meta.url), 'utf8'));
  const metadataBytes = gunzipSync(Buffer.from(fixture.metadataGzipBase64, 'base64'));
  assert.equal(createHash('sha256').update(metadataBytes).digest('hex'), fixture.metadataSha256);
  const registryFor = (patched) => {
    const registry = new TypeRegistry();
    if (patched) {
      registry.setKnownTypes({ typesBundle: NATIVE_TYPES_BUNDLE });
      registry.register(getSpecTypes(registry, 'Portaldot', fixture.runtime.specName, fixture.runtime.specVersion));
    }
    registry.setMetadata(new Metadata(registry, metadataBytes), undefined, undefined, true);
    return registry;
  };
  assert.throws(() => registryFor(false).createType('SignedBlock', fixture.raw), /assetId|MultiLocation/);
  const block = registryFor(true).createType('SignedBlock', fixture.raw);
  assert.equal(block.block.header.hash.toHex(), fixture.blockHash);
  assert.equal(block.block.header.number.toString(), '156435');
  assert.equal(block.block.extrinsics.length, 2);
  assert.equal(block.block.extrinsics[1].hash.toHex(), '0xbb7823122c7e1500d846e6b040768c3f9390ecd5326b27bfee689a5b6d8162ff');
  assert.deepEqual(block.block.extrinsics[1].assetId.toJSON(), { withId: 7777 });
  assert.equal(block.block.extrinsics[1].method.section, 'utility');
  const registry = new TypeRegistry();
  registry.setKnownTypes({ typesBundle: NATIVE_TYPES_BUNDLE });
  for (const version of [3001, 3003]) assert.notEqual(getSpecTypes(registry, 'Portaldot', 'portaldot-v3', version).TAssetConversion, 'Option<NativeOrWithId>');
  assert.notEqual(getSpecTypes(registry, 'Other chain', 'other-runtime', 3002).TAssetConversion, 'Option<NativeOrWithId>');
});

function assetClients({ exists = true, nativeSupply = '100000000000', evmSupply = nativeSupply, nativeBalance = '99683035000', evmBalance = nativeBalance, mapped = true, specVersion = 3002 } = {}) {
  const mocked = clients({ mapped });
  mocked.api.runtimeVersion = { specName: 'portaldot-v3', specVersion, transactionVersion: 2, stateVersion: 1 };
  const some = (value) => ({ isSome: true, isNone: false, unwrap: () => value });
  mocked.api.query.assets = {
    asset: async () => exists ? some({ owner: native, supply: nativeSupply }) : { isSome: false, isNone: true },
    metadata: async () => ({ decimals: 6 }),
    account: async () => some({ balance: nativeBalance }),
  };
  const originalRpc = mocked.rpc;
  mocked.rpc = async (method, params) => {
    if (method === 'eth_getCode') throw new Error('Precompiles must not require deployed code');
    if (method === 'eth_call') {
      assert.deepEqual(params[1], { blockHash: evmHash, requireCanonical: true });
      const selector = params[0].data.slice(0, 10);
      return valueWord(selector === '0x18160ddd' ? evmSupply : selector === '0x70a08231' ? evmBalance : 6);
    }
    return originalRpc(method, params);
  };
  return mocked;
}

const assetProject = { profile: 'native-asset', nativeAsset: { assetId: '7777', holder: '' } };

test('public native-asset profile passes without wallet, contract code, transaction, or own funding', async () => {
  const report = await inspectWithClients(assetProject, assetClients());
  assert.deepEqual(report.checks.map((c) => c.id), ['network.chain-id', 'network.finalized', 'asset.native-erc20']);
  assert.ok(report.checks.every((c) => c.status === 'passed'));
  const evidence = byId(report, 'asset.native-erc20').evidence;
  assert.equal(evidence.holderSource, 'native-asset-owner');
  assert.equal(evidence.nativeHolder, native);
  assert.equal(evidence.precompileAddress, '0x00001e6100000000000000000000000000010000');
  assert.equal(evidence.nativeBalance, evidence.erc20Balance);
  assert.match(evidence.targetOwnership, /External public asset/);
  assert.equal(report.network.specName, 'portaldot-v3');
  assert.equal(report.network.specVersion, '3002');
});

test('missing native asset cannot pass when precompile returns zeros', async () => {
  const mocked = assetClients({ exists: false, evmSupply: '0', evmBalance: '0' });
  let evmCalls = 0;
  const rpc = mocked.rpc;
  mocked.rpc = async (method, params) => { if (method === 'eth_call') evmCalls++; return rpc(method, params); };
  const report = await inspectWithClients(assetProject, mocked);
  assert.equal(byId(report, 'asset.native-erc20').status, 'failed');
  assert.equal(evmCalls, 0);
});

test('asset parity detects a wrong supply or holder balance and rejects unverified runtime versions', async () => {
  for (const change of [{ evmSupply: '1' }, { evmBalance: '1' }]) {
    const report = await inspectWithClients(assetProject, assetClients(change));
    assert.equal(byId(report, 'asset.native-erc20').status, 'failed');
  }
  assert.equal(byId(await inspectWithClients(assetProject, assetClients({ specVersion: 3003 })), 'asset.native-erc20').status, 'blocked');
  assert.equal(byId(await inspectWithClients(assetProject, assetClients({ mapped: false })), 'asset.native-erc20').status, 'blocked');
});

test('configured ABI views replace the legacy value() check and compare both interfaces', async () => {
  const assertions = [
    { id: 'owner', label: 'Owner', signature: 'owner()', returns: 'address', args: [], expected: h160 },
    { id: 'approved', label: 'Approved', signature: 'approved()', returns: 'bool', args: [], expected: true },
    { id: 'revision', label: 'Revision', signature: 'revision()', returns: 'uint256', args: [], expected: '2' },
    { id: 'report', label: 'Report', signature: 'reportHash()', returns: 'bytes32', args: [], expected: txHash },
  ];
  const iface = new Interface(assertions.map((a) => `function ${a.signature} view returns (${a.returns})`));
  const response = (data) => {
    const assertion = assertions.find((a) => iface.getFunction(a.signature).selector === data.slice(0, 10));
    assert.ok(assertion, 'No legacy value() call should execute');
    return iface.encodeFunctionResult(assertion.signature, [assertion.expected]);
  };
  const mocked = clients();
  const originalRpc = mocked.rpc;
  mocked.rpc = async (method, params) => method === 'eth_call' ? response(params[0].data) : originalRpc(method, params);
  mocked.api.call.reviveApi.call = async (_from, _to, _value, _weight, _deposit, data) => ({ result: { isOk: true, asOk: { flags: { bits: 0 }, data: response(data) } } });
  const report = await inspectWithClients({ ...project, assertions }, mocked);
  assert.equal(byId(report, 'contract.value'), undefined);
  assert.equal(byId(report, 'contract.assertions').status, 'passed');
  assert.equal(byId(report, 'contract.assertions').evidence.assertions.length, 4);
  assert.equal(report.network.contractCodeHash, byId(report, 'contract.code').evidence.codeHash);
  const approvedSelector = iface.getFunction('approved()').selector;
  mocked.rpc = async (method, params) => method === 'eth_call'
    ? params[0].data === approvedSelector ? iface.encodeFunctionResult('approved()', [false]) : response(params[0].data)
    : originalRpc(method, params);
  assert.equal(byId(await inspectWithClients({ ...project, assertions }, mocked), 'contract.assertions').status, 'failed');
  mocked.api.call.reviveApi.call = async () => ({ result: { isOk: true, asOk: { flags: { bits: 1 }, data: '0x' } } });
  assert.equal(byId(await inspectWithClients({ ...project, assertions }, mocked), 'contract.assertions').status, 'unknown');
});

test('asset precompile address rejects out-of-range IDs', () => {
  assert.equal(nativeAssetAddress('7777'), '0x00001e6100000000000000000000000000010000');
  assert.throws(() => nativeAssetAddress('4294967296'));
});
