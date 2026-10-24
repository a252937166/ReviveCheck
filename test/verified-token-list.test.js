import test from 'node:test';
import assert from 'node:assert/strict';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { Account, bytesToHex, createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { createVM } from '@ethereumjs/vm';
import { Interface, encodeBytes32String as label } from 'ethers';
import { compileReleaseRegistry } from '../scripts/compile-release-registry.js';
import { compileTokenList } from '../scripts/compile-token-list.js';

// The registry, the consumer and a stub token, as real bytecode in an in-memory EVM.
// This does not test Portaldot revive, signing, fees, RPC or finality.
const TOKEN = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
contract StubToken { uint8 public decimals; constructor(uint8 d) { decimals = d; } }`;
const registryPromise = compileReleaseRegistry();
const listPromise = compileTokenList({ extraSources: { 'StubToken.sol': TOKEN } });
const firstHash = `0x${'11'.repeat(32)}`, secondHash = `0x${'22'.repeat(32)}`;
const ZERO = `0x${'00'.repeat(20)}`;

async function deploy({ curated = false } = {}) {
  const registry = await registryPromise;
  const list = await listPromise;
  const token = list.extra['StubToken.sol'].StubToken;
  const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Paris }) });
  const [owner, reviewer, other] = ['01', '02', '03'].map((byte) => createAddressFromString(`0x${byte.repeat(20)}`));
  for (const actor of [owner, reviewer, other]) await vm.stateManager.putAccount(actor, new Account(0n, 10n ** 18n));
  const create = async (bytecode, abi, args = []) => {
    const result = await vm.evm.runCall({ caller: owner, gasLimit: 3_000_000n, data: hexToBytes(`${bytecode}${args.length ? abi.encodeDeploy(args).slice(2) : ''}`) });
    assert.equal(result.execResult.exceptionError, undefined, 'deployment must execute');
    return result.createdAddress;
  };
  const registryAbi = new Interface(registry.abi), listAbi = new Interface(list.abi), tokenAbi = new Interface(token.abi);
  const registryAddress = await create(registry.bytecode, registryAbi);
  const listAddress = await create(list.bytecode, listAbi, [registryAddress.toString(), curated ? reviewer.toString() : ZERO]);
  const sixDecimals = (await create(`0x${token.evm.bytecode.object}`, tokenAbi, [6])).toString();
  const call = (to, abi) => (actor, method, args = [], isStatic = false) => vm.evm.runCall({ caller: actor, to, gasLimit: 1_000_000n, data: hexToBytes(abi.encodeFunctionData(method, args)), isStatic });
  const ok = (result) => { assert.equal(result.execResult.exceptionError, undefined, 'call must succeed'); return result; };
  const reverts = (result, name) => { assert.equal(result.execResult.exceptionError?.error, 'revert'); assert.equal(listAbi.parseError(bytesToHex(result.execResult.returnValue))?.name, name); };
  const read = (to, abi) => async (method, args = []) => { const result = ok(await call(to, abi)(owner, method, args, true)); return abi.decodeFunctionResult(method, bytesToHex(result.execResult.returnValue)); };
  const [id] = await read(registryAddress, registryAbi)('releaseId', [owner.toString(), label('pusd-token-list')]);
  const listed = async () => (await read(listAddress, listAbi)('isListed', [sixDecimals]))[0];
  return { owner, reviewer, other, id, token: sixDecimals, registry: call(registryAddress, registryAbi), list: call(listAddress, listAbi), listed, ok, reverts };
}

test('a token is listed only from an approved release, by its owner, with the chain’s decimals', async () => {
  const t = await deploy();
  const reviewer = t.reviewer.toString();
  t.reverts(await t.list(t.owner, 'list', [t.token, t.id, firstHash, reviewer, 6]), 'ReportMismatch');
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), firstHash]));
  t.reverts(await t.list(t.owner, 'list', [t.token, t.id, firstHash, reviewer, 6]), 'ReleaseNotApproved');
  t.ok(await t.registry(t.reviewer, 'review', [t.id, firstHash, true]));
  t.reverts(await t.list(t.other, 'list', [t.token, t.id, firstHash, reviewer, 6]), 'NotReleaseOwner');
  t.reverts(await t.list(t.owner, 'list', [t.token, t.id, firstHash, reviewer, 18]), 'DecimalsMismatch');
  t.ok(await t.list(t.owner, 'list', [t.token, t.id, firstHash, reviewer, 6]));
  assert.equal(await t.listed(), true);
});

test('a listing stops counting the moment its release moves to an unapproved revision', async () => {
  const t = await deploy();
  const reviewer = t.reviewer.toString();
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), firstHash]));
  t.ok(await t.registry(t.reviewer, 'review', [t.id, firstHash, true]));
  t.ok(await t.list(t.owner, 'list', [t.token, t.id, firstHash, reviewer, 6]));
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), secondHash]));
  assert.equal(await t.listed(), false, 'revision 2 is not approved');
  t.ok(await t.registry(t.reviewer, 'review', [t.id, secondHash, false]));
  assert.equal(await t.listed(), false, 'changes requested');
  t.reverts(await t.list(t.owner, 'list', [t.token, t.id, secondHash, reviewer, 6]), 'ReleaseNotApproved');
  t.ok(await t.registry(t.reviewer, 'review', [t.id, secondHash, true]));
  t.ok(await t.list(t.owner, 'list', [t.token, t.id, secondHash, reviewer, 6]));
  assert.equal(await t.listed(), true);
});

test('a curated list accepts only its curator’s approvals', async () => {
  const t = await deploy({ curated: true });
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), firstHash]));
  t.ok(await t.registry(t.other, 'review', [t.id, firstHash, true]));
  t.reverts(await t.list(t.owner, 'list', [t.token, t.id, firstHash, t.other.toString(), 6]), 'ReviewerNotAllowed');
  t.ok(await t.registry(t.reviewer, 'review', [t.id, firstHash, true]));
  t.ok(await t.list(t.owner, 'list', [t.token, t.id, firstHash, t.reviewer.toString(), 6]));
  assert.equal(await t.listed(), true);
});
