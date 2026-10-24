import test from 'node:test';
import assert from 'node:assert/strict';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { Account, bytesToHex, createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { createVM } from '@ethereumjs/vm';
import { Interface, encodeBytes32String as label } from 'ethers';
import { compileReleaseRegistry } from '../scripts/compile-release-registry.js';
import { releaseIdOf, releaseLabel, labelText, submitCall, reviewCall, registryInterface, registryEvents, decodeRegistryError, REGISTRY } from '../lib/registry.js';

// Real compiled bytecode in an in-memory EVM, using message calls. This does not
// test Portaldot revive, signing, fees, RPC or finality.
const artifactPromise = compileReleaseRegistry();
const firstHash = `0x${'11'.repeat(32)}`, secondHash = `0x${'22'.repeat(32)}`, zeroHash = `0x${'00'.repeat(32)}`;

async function deploy() {
  const artifact = await artifactPromise;
  const abi = new Interface(artifact.abi);
  const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Paris }) });
  const [owner, reviewer, other] = ['01', '02', '03'].map((byte) => createAddressFromString(`0x${byte.repeat(20)}`));
  for (const actor of [owner, reviewer, other]) await vm.stateManager.putAccount(actor, new Account(0n, 10n ** 18n));
  const deployment = await vm.evm.runCall({ caller: owner, gasLimit: 3_000_000n, data: hexToBytes(artifact.bytecode) });
  assert.equal(deployment.execResult.exceptionError, undefined, 'deployment must execute');
  const address = deployment.createdAddress;
  const call = (actor, method, args = [], isStatic = false) => vm.evm.runCall({ caller: actor, to: address, gasLimit: 1_000_000n, data: hexToBytes(abi.encodeFunctionData(method, args)), isStatic });
  const read = async (method, args = []) => {
    const result = await call(owner, method, args, true);
    assert.equal(result.execResult.exceptionError, undefined, `${method} must execute`);
    return abi.decodeFunctionResult(method, bytesToHex(result.execResult.returnValue));
  };
  const ok = (result) => { assert.equal(result.execResult.exceptionError, undefined, 'call must succeed'); return result; };
  const reverts = (result, name) => {
    assert.equal(result.execResult.exceptionError?.error, 'revert');
    assert.equal(abi.parseError(bytesToHex(result.execResult.returnValue))?.name, name);
    assert.equal(result.execResult.logs?.length || 0, 0, 'reverted calls emit nothing');
  };
  const event = (result, name) => (result.execResult.logs || []).map(([, topics, data]) => abi.parseLog({ topics: topics.map(bytesToHex), data: bytesToHex(data) })).find((log) => log?.name === name)?.args;
  return { owner, reviewer, other, call, read, ok, reverts, event };
}

test('a submission opens revision 1 and a reviewer approves that exact report', async () => {
  const registry = await deploy();
  const submitted = registry.ok(await registry.call(registry.owner, 'submit', [label('pusd-token-list'), firstHash]));
  const [id] = await registry.read('releaseId', [registry.owner.toString(), label('pusd-token-list')]);
  const log = registry.event(submitted, 'ReportSubmitted');
  assert.equal(log.releaseId, id);
  assert.equal(log.revision, 1n);
  assert.equal(log.name, label('pusd-token-list'));
  const [owner, revision, reportHash] = await registry.read('releaseOf', [id]);
  assert.equal(owner.toLowerCase(), registry.owner.toString());
  assert.equal(revision, 1n);
  assert.equal(reportHash, firstHash);
  assert.deepEqual([...await registry.read('decisionOf', [id, registry.reviewer.toString()])], [false, false]);
  const reviewed = registry.ok(await registry.call(registry.reviewer, 'review', [id, firstHash, true]));
  assert.equal(registry.event(reviewed, 'ReportReviewed').approved, true);
  assert.deepEqual([...await registry.read('decisionOf', [id, registry.reviewer.toString()])], [true, true]);
});

test('a new submission starts a new revision, so the earlier approval no longer applies', async () => {
  const registry = await deploy();
  registry.ok(await registry.call(registry.owner, 'submit', [label('release'), firstHash]));
  const [id] = await registry.read('releaseId', [registry.owner.toString(), label('release')]);
  registry.ok(await registry.call(registry.reviewer, 'review', [id, firstHash, true]));
  registry.ok(await registry.call(registry.owner, 'submit', [label('release'), secondHash]));
  const [, revision, reportHash] = await registry.read('releaseOf', [id]);
  assert.equal(revision, 2n);
  assert.equal(reportHash, secondHash);
  assert.deepEqual([...await registry.read('decisionOf', [id, registry.reviewer.toString()])], [false, false]);
  registry.reverts(await registry.call(registry.reviewer, 'review', [id, firstHash, true]), 'StaleReport');
  registry.ok(await registry.call(registry.reviewer, 'review', [id, secondHash, false]));
  assert.deepEqual([...await registry.read('decisionOf', [id, registry.reviewer.toString()])], [true, false]);
});

test('releases are namespaced by owner and invalid inputs revert without events', async () => {
  const registry = await deploy();
  registry.ok(await registry.call(registry.owner, 'submit', [label('same-name'), firstHash]));
  registry.ok(await registry.call(registry.other, 'submit', [label('same-name'), secondHash]));
  const [ownerId] = await registry.read('releaseId', [registry.owner.toString(), label('same-name')]);
  const [otherId] = await registry.read('releaseId', [registry.other.toString(), label('same-name')]);
  assert.notEqual(ownerId, otherId);
  assert.equal((await registry.read('releaseOf', [ownerId]))[2], firstHash);
  registry.reverts(await registry.call(registry.owner, 'submit', [label('x'), zeroHash]), 'EmptyReport');
  registry.reverts(await registry.call(registry.owner, 'submit', [zeroHash, firstHash]), 'EmptyName');
  registry.reverts(await registry.call(registry.reviewer, 'review', [`0x${'99'.repeat(32)}`, firstHash, true]), 'UnknownRelease');
});

test('the client library computes the same release ID and encodes the calls the contract decodes', async () => {
  const registry = await deploy();
  const [id] = await registry.read('releaseId', [registry.owner.toString(), releaseLabel('pusd-token-list')]);
  assert.equal(releaseIdOf(registry.owner.toString(), 'pusd-token-list'), id);
  assert.equal(labelText(releaseLabel('pusd-token-list')), 'pusd-token-list');
  assert.throws(() => releaseLabel('x'.repeat(32)), /1–31 bytes/);
  assert.throws(() => releaseLabel('  '), /1–31 bytes/);
  const submit = submitCall('pusd-token-list', '11'.repeat(32));
  assert.equal(submit.to, REGISTRY.address);
  const submitted = registry.ok(await registry.call(registry.owner, 'submit', [...registryInterface.decodeFunctionData('submit', submit.data)]));
  assert.equal(registry.event(submitted, 'ReportSubmitted').releaseId, id);
  const review = reviewCall(id, `0x${'22'.repeat(32)}`, true);
  const stale = await registry.call(registry.reviewer, 'review', [...registryInterface.decodeFunctionData('review', review.data)]);
  assert.equal(decodeRegistryError(bytesToHex(stale.execResult.returnValue)), 'StaleReport');
});

test('registry events decode from native ContractEmitted records and ignore other contracts', () => {
  const id = `0x${'ab'.repeat(32)}`, owner = `0x${'01'.repeat(20)}`;
  const log = registryInterface.encodeEventLog('ReportSubmitted', [id, owner, 1n, `0x${'11'.repeat(32)}`, releaseLabel('demo')]);
  const events = registryEvents([
    { section: 'revive', method: 'ContractEmitted', data: [REGISTRY.address, log.data, log.topics] },
    { section: 'revive', method: 'ContractEmitted', data: [`0x${'99'.repeat(20)}`, log.data, log.topics] },
    { section: 'system', method: 'ExtrinsicSuccess', data: [] },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'ReportSubmitted');
  assert.equal(events[0].args.releaseId, id);
  assert.equal(events[0].args.revision, '1');
});
