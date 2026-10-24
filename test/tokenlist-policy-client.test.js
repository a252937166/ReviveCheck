import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { Account, bytesToHex, createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { createVM } from '@ethereumjs/vm';
import { Interface, keccak256 } from 'ethers';
import { compileTokenList } from '../scripts/compile-token-list.js';
import { TOKEN_LIST, LEGACY_TOKEN_LIST_IDENTITY, assertTokenListWritable, readTokenListWithClients, resolveTokenListVersion, tokenListInterface } from '../lib/tokenlist.js';
import { prepareTransaction } from '../lib/service.js';

const legacy = LEGACY_TOKEN_LIST_IDENTITY;
const OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const TOKEN = '0x00001e6100000000000000000000000000010000';
const NATIVE = `0x${'aa'.repeat(32)}`, EVM = `0x${'bb'.repeat(32)}`;
const v1Artifact = JSON.parse(await readFile(new URL('../artifacts/VerifiedTokenList.json', import.meta.url), 'utf8'));

async function clientsFor(artifact, { address = legacy.address, corruptCode = false, nativeVersion = null } = {}) {
  const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Paris }) });
  const caller = createAddressFromString(OWNER);
  await vm.stateManager.putAccount(caller, new Account(0n, 10n ** 18n));
  const args = new Interface(artifact.abi).encodeDeploy([legacy.registry, legacy.curator]).slice(2);
  const deployed = await vm.evm.runCall({ caller, gasLimit: 5_000_000n, data: hexToBytes(`${artifact.bytecode}${args}`) });
  assert.equal(deployed.execResult.exceptionError, undefined);
  let code = bytesToHex(await vm.stateManager.getCode(deployed.createdAddress));
  if (corruptCode) code = `${code.slice(0, -2)}${code.endsWith('00') ? '01' : '00'}`;
  await vm.stateManager.putCode(createAddressFromString(address), hexToBytes(code));
  const call = (data) => vm.evm.runCall({ caller, to: createAddressFromString(address), gasLimit: 1_000_000n, data: hexToBytes(data), isStatic: true });
  let finalizedReads = 0;
  const seenTags = [];
  const at = { call: { reviveApi: {
    ethBlockHash: async () => ({ isNone: false, unwrap: () => EVM }),
    accountId: async () => OWNER,
    call: async (_origin, _address, _value, _weight, _deposit, data) => {
      if (nativeVersion !== null && data === tokenListInterface.encodeFunctionData('version', [])) return { result: { isOk: true, asOk: { flags: { toJSON: () => ({ bits: 0 }) }, data: tokenListInterface.encodeFunctionResult('version', [nativeVersion]) } } };
      const result = await call(data);
      return { result: { isOk: true, asOk: { flags: { toJSON: () => ({ bits: result.execResult.exceptionError ? 1 : 0 }) }, data: bytesToHex(result.execResult.returnValue) } } };
    },
  } } };
  const api = { rpc: { chain: { getFinalizedHead: async () => { finalizedReads += 1; return NATIVE; }, getHeader: async () => ({ number: 170000 }) } }, at: async (hash) => { assert.equal(hash, NATIVE); return at; } };
  const rpc = async (method, params) => {
    const tag = params[1];
    assert.deepEqual(tag, { blockHash: EVM, requireCanonical: true });
    seenTags.push(tag);
    if (method === 'eth_getCode') return code;
    assert.equal(method, 'eth_call');
    const result = await call(params[0].data);
    if (result.execResult.exceptionError) throw new Error('The simulated EVM call reverted.');
    return bytesToHex(result.execResult.returnValue);
  };
  return { api, rpc, code, finalizedReads: () => finalizedReads, seenTags };
}

test('legacy v1 is identified by its exact recorded address and constructor-specific runtime code', async () => {
  const clients = await clientsFor(v1Artifact);
  assert.equal(keccak256(clients.code), legacy.runtimeCodeHash, 'the identity pin derives from the preserved artifact and recorded constructor arguments');
  const listing = await readTokenListWithClients(clients, { token: TOKEN, address: legacy.address });
  assert.equal(listing.list, legacy.address);
  assert.equal(listing.token, TOKEN);
  assert.equal(listing.identity.version, 1);
  assert.equal(listing.identity.versionSource, 'known-deployment-runtime-code');
  assert.equal(listing.identity.evm.version, null, 'v1 has no on-chain version getter');
  assert.equal(listing.identity.native.version, null);
  assert.deepEqual(listing.identity.block, listing.block);
  assert.equal(clients.finalizedReads(), 1, 'listing, identity and runtime code use the same finalized checkpoint');
});

test('a missing version getter or matching code at another address does not identify v1', async () => {
  for (const options of [{ address: `0x${'11'.repeat(20)}` }, { corruptCode: true }]) {
    const clients = await clientsFor(v1Artifact, options);
    const listing = await readTokenListWithClients(clients, { token: TOKEN, address: options.address || legacy.address });
    assert.equal(listing.identity.version, null);
    assert.equal(listing.identity.versionSource, 'unavailable');
  }
  assert.equal(resolveTokenListVersion({ address: legacy.address, interfacesAgree: true, runtimeCodeHash: legacy.runtimeCodeHash, evm: { version: null, registry: legacy.registry, curator: legacy.curator }, native: { version: null, registry: OWNER, curator: legacy.curator } }).version, null);
});

test('v2 uses its actual getter, and disagreeing identity interfaces leave the version unknown', async () => {
  const artifact = await compileTokenList();
  const good = await clientsFor(artifact);
  const listing = await readTokenListWithClients(good, { token: TOKEN });
  assert.equal(listing.identity.version, 2);
  assert.equal(listing.identity.versionSource, 'on-chain-version-getter');
  const split = await clientsFor(artifact, { nativeVersion: 99 });
  const disagreeing = await readTokenListWithClients(split, { token: TOKEN });
  assert.equal(disagreeing.identity.interfacesAgree, false);
  assert.equal(disagreeing.identity.version, null);
});

test('the service blocks known-vulnerable active v1 and prepares unsigned calls only to the active corrected consumer', async () => {
  if (TOKEN_LIST.version === 1 && TOKEN_LIST.knownIssue) {
    await assert.rejects(prepareTransaction({ action: 'list', from: OWNER }), /New listings are disabled on the historical v1 token list/);
    return;
  }
  assert.ok(TOKEN_LIST.version >= 2);
  const prepared = await prepareTransaction({ action: 'list', token: TOKEN, releaseId: `0x${'ab'.repeat(32)}`, reportHash: `0x${'cd'.repeat(32)}`, reviewer: OWNER, decimals: 6 });
  assert.equal(prepared.to, TOKEN_LIST.address);
  assert.equal(prepared.action, 'list');
  assert.equal(prepared.dryRun, undefined, 'an unsigned preparation without a sender does not contact the network');
  assert.equal(tokenListInterface.decodeFunctionData('list', prepared.data)[0].toLowerCase(), TOKEN);
});

test('the shared write guard preserves v1 refusal after another version becomes active', () => {
  assert.throws(() => assertTokenListWritable({ version: 1, knownIssue: 'the historical ownership defect' }), /New listings are disabled/);
  assert.doesNotThrow(() => assertTokenListWritable({ version: 2 }));
});
