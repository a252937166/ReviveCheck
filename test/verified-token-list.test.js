import test from 'node:test';
import assert from 'node:assert/strict';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { Account, bytesToHex, createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { createVM } from '@ethereumjs/vm';
import { Interface, encodeBytes32String as label } from 'ethers';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileReleaseRegistry } from '../scripts/compile-release-registry.js';
import { compileTokenList } from '../scripts/compile-token-list.js';

// The registry, the consumer and a stub token, as real bytecode in an in-memory EVM.
// This does not test Portaldot revive, signing, fees, RPC or finality.
const TOKEN = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
contract StubToken { uint8 public decimals; constructor(uint8 d) { decimals = d; } }`;
// A consumer that counts approvals through the guard library, as an integrator's quorum would.
const HARNESS = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IReleaseRegistry, ReviveCheckGuard} from "./ReviveCheckGuard.sol";
contract GuardHarness {
  function count(address registry, bytes32 id, address[] memory reviewers) external view returns (uint256) { return ReviveCheckGuard.approvals(IReleaseRegistry(registry), id, reviewers); }
  function countFor(address registry, bytes32 id, bytes32 reportHash, address[] memory reviewers) external view returns (uint256) { return ReviveCheckGuard.approvals(IReleaseRegistry(registry), id, reportHash, reviewers); }
}`;
const registryPromise = compileReleaseRegistry();
const listPromise = compileTokenList({ extraSources: { 'StubToken.sol': TOKEN, 'GuardHarness.sol': HARNESS } });
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
  const harness = list.extra['GuardHarness.sol'].GuardHarness;
  const harnessAbi = new Interface(harness.abi);
  const harnessAddress = await create(`0x${harness.evm.bytecode.object}`, harnessAbi);
  const call = (to, abi) => (actor, method, args = [], isStatic = false) => vm.evm.runCall({ caller: actor, to, gasLimit: 1_000_000n, data: hexToBytes(abi.encodeFunctionData(method, args)), isStatic });
  const ok = (result) => { assert.equal(result.execResult.exceptionError, undefined, 'call must succeed'); return result; };
  const reverts = (result, name) => { assert.equal(result.execResult.exceptionError?.error, 'revert'); assert.equal(listAbi.parseError(bytesToHex(result.execResult.returnValue))?.name, name); };
  const read = (to, abi) => async (method, args = []) => { const result = ok(await call(to, abi)(owner, method, args, true)); return abi.decodeFunctionResult(method, bytesToHex(result.execResult.returnValue)); };
  const [id] = await read(registryAddress, registryAbi)('releaseId', [owner.toString(), label('pusd-token-list')]);
  const [otherId] = await read(registryAddress, registryAbi)('releaseId', [other.toString(), label('other-release')]);
  const listed = async () => (await read(listAddress, listAbi)('isListed', [sixDecimals]))[0];
  const entry = async () => [...await read(listAddress, listAbi)('entryOf', [sixDecimals])];
  const count = async (method, args) => Number((await read(harnessAddress, harnessAbi)(method, [registryAddress.toString(), ...args]))[0]);
  return { owner, reviewer, other, id, otherId, token: sixDecimals, registry: call(registryAddress, registryAbi), list: call(listAddress, listAbi), listed, entry, count, read: read(listAddress, listAbi), ok, reverts };
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

// Review F-01 (2026-10-24): the v1 library counted array entries, so [A, A] satisfied a two-reviewer threshold.
test('a reviewer passed twice counts once, and a report-bound count needs the exact current hash', async () => {
  const t = await deploy();
  const reviewer = t.reviewer.toString();
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), firstHash]));
  assert.equal(await t.count('count', [t.id, [reviewer, reviewer]]), 0, 'nothing approved yet');
  t.ok(await t.registry(t.reviewer, 'review', [t.id, firstHash, true]));
  assert.equal(await t.count('count', [t.id, [reviewer]]), 1);
  assert.equal(await t.count('count', [t.id, [reviewer, reviewer, reviewer]]), 1, 'duplicates count once');
  assert.equal(await t.count('count', [t.id, [reviewer, t.other.toString()]]), 1, 'an account that never reviewed adds nothing');
  assert.equal(await t.count('countFor', [t.id, firstHash, [reviewer, reviewer]]), 1);
  assert.equal(await t.count('countFor', [t.id, secondHash, [reviewer]]), 0, 'bound to the exact report hash');
  t.ok(await t.registry(t.other, 'review', [t.id, firstHash, true]));
  assert.equal(await t.count('countFor', [t.id, firstHash, [reviewer, t.other.toString(), reviewer]]), 2, 'two distinct approvals');
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), secondHash]));
  assert.equal(await t.count('count', [t.id, [reviewer, t.other.toString()]]), 0, 'a new revision clears every approval');
  assert.equal(await t.count('countFor', [t.id, firstHash, [reviewer]]), 0, 'the superseded report counts for nothing');
});

// Review F-02 (2026-10-24): the v1 contract let any release owner replace any token's entry.
test('an entry can be replaced or delisted only by the owner of the release it names', async () => {
  const t = await deploy();
  const reviewer = t.reviewer.toString(), other = t.other.toString();
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), firstHash]));
  t.ok(await t.registry(t.reviewer, 'review', [t.id, firstHash, true]));
  t.ok(await t.list(t.owner, 'list', [t.token, t.id, firstHash, reviewer, 6]));
  // An unrelated account self-approves its own release and tries to take the entry.
  t.ok(await t.registry(t.other, 'submit', [label('other-release'), secondHash]));
  t.ok(await t.registry(t.other, 'review', [t.otherId, secondHash, true]));
  t.reverts(await t.list(t.other, 'list', [t.token, t.otherId, secondHash, other, 6]), 'EntryOwnedByAnother');
  t.reverts(await t.list(t.other, 'delist', [t.token]), 'EntryOwnedByAnother');
  assert.equal((await t.entry())[0], t.id, 'the original entry stands');
  assert.equal(await t.listed(), true);
  t.ok(await t.registry(t.other, 'submit', [label('other-release'), `0x${'33'.repeat(32)}`]));
  assert.equal(await t.listed(), true, 'another release’s revision cannot un-list it');
  // The owner rebinds the entry to a new approved revision, then removes it.
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), secondHash]));
  t.ok(await t.registry(t.reviewer, 'review', [t.id, secondHash, true]));
  t.ok(await t.list(t.owner, 'list', [t.token, t.id, secondHash, reviewer, 6]));
  assert.equal((await t.entry())[1], secondHash);
  const delisted = t.ok(await t.list(t.owner, 'delist', [t.token]));
  assert.equal(delisted.execResult.logs.length, 1, 'Delisted is emitted');
  assert.equal(await t.listed(), false);
  t.reverts(await t.list(t.owner, 'delist', [t.token]), 'NoEntry');
  // Once the entry is gone, another owner may list the token on their own approval.
  t.ok(await t.registry(t.other, 'review', [t.otherId, `0x${'33'.repeat(32)}`, true]));
  t.ok(await t.list(t.other, 'list', [t.token, t.otherId, `0x${'33'.repeat(32)}`, other, 6]));
  assert.equal((await t.entry())[0], t.otherId);
  assert.equal((await t.read('version'))[0], 2n);
});

test('a curator can replace or delist any entry, while other listers cannot', async () => {
  const t = await deploy({ curated: true });
  const curator = t.reviewer.toString();
  t.ok(await t.registry(t.owner, 'submit', [label('pusd-token-list'), firstHash]));
  t.ok(await t.registry(t.reviewer, 'review', [t.id, firstHash, true]));
  t.ok(await t.list(t.owner, 'list', [t.token, t.id, firstHash, curator, 6]));
  t.ok(await t.registry(t.other, 'submit', [label('other-release'), secondHash]));
  t.ok(await t.registry(t.reviewer, 'review', [t.otherId, secondHash, true]));
  t.reverts(await t.list(t.other, 'list', [t.token, t.otherId, secondHash, curator, 6]), 'EntryOwnedByAnother');
  t.ok(await t.list(t.reviewer, 'delist', [t.token]));
  assert.equal(await t.listed(), false);
  t.ok(await t.list(t.other, 'list', [t.token, t.otherId, secondHash, curator, 6]));
  assert.equal(await t.listed(), true);
});

test('the v1 sources kept beside the deployment record still hash to it', async () => {
  const joined = (await Promise.all(['ReviveCheckGuard.sol', 'VerifiedTokenList.sol'].map((file) => readFile(new URL(`../contracts/deployed/v1/${file}`, import.meta.url), 'utf8')))).join('\n');
  const record = JSON.parse(await readFile(new URL('../public/lifecycle/token-list.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(joined).digest('hex'), record.sourceSha256);
  assert.notEqual((await listPromise).sourceSha256, record.sourceSha256, 'the v2 sources in contracts/ are a new version');
});
