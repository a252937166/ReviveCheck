import test from 'node:test';
import assert from 'node:assert/strict';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { Account, bytesToHex, createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { createVM } from '@ethereumjs/vm';
import { Interface } from 'ethers';
import { compileReleaseGate } from '../scripts/compile-release-gate.js';

// Real compiled bytecode and persistent in-memory EVM storage, using message calls.
// This does not test Portaldot revive, transaction signing, fees, RPC, or finality.
// API reference: https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/evm#contract-calls-runcall
const artifactPromise = compileReleaseGate();
const zeroHash = `0x${'00'.repeat(32)}`;
const firstHash = `0x${'11'.repeat(32)}`;
const secondHash = `0x${'22'.repeat(32)}`;

async function deploy() {
  const artifact = await artifactPromise;
  const abi = new Interface(artifact.abi);
  const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Paris }) });
  const owner = createAddressFromString(`0x${'01'.repeat(20)}`);
  const reviewer = createAddressFromString(`0x${'02'.repeat(20)}`);
  const outsider = createAddressFromString(`0x${'03'.repeat(20)}`);
  for (const actor of [owner, reviewer, outsider]) await vm.stateManager.putAccount(actor, new Account(0n, 10n ** 18n));
  const deployment = await vm.evm.runCall({ caller: owner, gasLimit: 3_000_000n, data: hexToBytes(`${artifact.bytecode}${abi.encodeDeploy([reviewer.toString()]).slice(2)}`) });
  assert.equal(deployment.execResult.exceptionError, undefined, 'constructor must execute successfully');
  assert.ok(deployment.createdAddress, 'constructor must create a contract');
  const address = deployment.createdAddress;
  assert.ok((await vm.stateManager.getCode(address)).length > 0, 'constructor must persist executable runtime code');
  const call = async (actor, method, args = [], isStatic = false) => vm.evm.runCall({ caller: actor, to: address, gasLimit: 1_000_000n, data: hexToBytes(abi.encodeFunctionData(method, args)), isStatic });
  const read = async method => {
    const result = await call(owner, method, [], true);
    assert.equal(result.execResult.exceptionError, undefined, `${method} getter must execute`);
    return abi.decodeFunctionResult(method, bytesToHex(result.execResult.returnValue))[0];
  };
  const state = async () => {
    const snapshot = {};
    for (const key of ['owner', 'reviewer', 'reportHash', 'approved', 'revision']) snapshot[key] = await read(key);
    return snapshot;
  };
  const succeeded = result => assert.equal(result.execResult.exceptionError, undefined, 'state transition must execute');
  const event = (result, name) => {
    const logs = (result.execResult.logs || []).map(([, topics, data]) => abi.parseLog({ topics: topics.map(bytesToHex), data: bytesToHex(data) }));
    const found = logs.find(log => log?.name === name);
    assert.ok(found, `${name} must be emitted`);
    return found.args;
  };
  const unauthorized = result => {
    assert.equal(result.execResult.exceptionError?.error, 'revert');
    assert.equal(abi.parseError(bytesToHex(result.execResult.returnValue))?.name, 'UnauthorizedCaller');
    assert.equal(result.execResult.logs?.length || 0, 0, 'reverted calls must not retain workflow events');
  };
  return { owner, reviewer, outsider, call, read, state, succeeded, event, unauthorized };
}

test('local EVM executes constructor, exact-hash approval, and a new submission that clears approval', async () => {
  const gate = await deploy();
  const initial = await gate.state();
  assert.equal(initial.owner.toLowerCase(), gate.owner.toString());
  assert.equal(initial.reviewer.toLowerCase(), gate.reviewer.toString());
  assert.equal(initial.reportHash, zeroHash);
  assert.equal(initial.approved, false);
  assert.equal(initial.revision, 0n);

  const submitFirst = await gate.call(gate.owner, 'submit', [firstHash]);
  gate.succeeded(submitFirst);
  const submitted = gate.event(submitFirst, 'ReportSubmitted');
  assert.equal(submitted.reportHash, firstHash);
  assert.equal(submitted.revision, 1n);
  assert.equal(await gate.read('reportHash'), firstHash);
  assert.equal(await gate.read('approved'), false);

  const review = await gate.call(gate.reviewer, 'review', [true]);
  gate.succeeded(review);
  const reviewed = gate.event(review, 'ReportReviewed');
  assert.equal(reviewed.reportHash, firstHash);
  assert.equal(reviewed.revision, 1n);
  assert.equal(reviewed.reviewer.toLowerCase(), gate.reviewer.toString());
  assert.equal(reviewed.approved, true);
  assert.equal(await gate.read('approved'), true);

  const submitSecond = await gate.call(gate.owner, 'submit', [secondHash]);
  gate.succeeded(submitSecond);
  assert.equal(gate.event(submitSecond, 'ReportSubmitted').revision, 2n);
  assert.equal(await gate.read('reportHash'), secondHash);
  assert.equal(await gate.read('revision'), 2n);
  assert.equal(await gate.read('approved'), false, 'approval of hash1 must not transfer to hash2');
});

test('local EVM rejects submissions from reviewer or outsider without changing an approved report', async () => {
  const gate = await deploy();
  gate.succeeded(await gate.call(gate.owner, 'submit', [firstHash]));
  gate.succeeded(await gate.call(gate.reviewer, 'review', [true]));
  const before = await gate.state();
  for (const actor of [gate.reviewer, gate.outsider]) {
    gate.unauthorized(await gate.call(actor, 'submit', [secondHash]));
    assert.deepEqual(await gate.state(), before, 'rejected submission must preserve hash, approval, revision, and roles');
  }
});

test('local EVM rejects review by owner or outsider without changing the reviewer decision', async () => {
  const gate = await deploy();
  gate.succeeded(await gate.call(gate.owner, 'submit', [firstHash]));
  gate.succeeded(await gate.call(gate.reviewer, 'review', [true]));
  const before = await gate.state();
  for (const actor of [gate.owner, gate.outsider]) {
    gate.unauthorized(await gate.call(actor, 'review', [false]));
    assert.deepEqual(await gate.state(), before, 'rejected review must preserve the exact approved report');
  }
});
