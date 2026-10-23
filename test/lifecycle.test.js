import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, validateProject } from '../server/store.js';
import { sealRun, verifyRun, compareRuns, overall, reportHtml, fingerprint } from '../lib/report.js';
import { lifecycleForRun, createReview, verifyReview } from '../lib/lifecycle.js';
import { rehearse } from '../lib/rehearsal.js';

function makeRun(project, scenario, id) {
  const result = rehearse(project, scenario);
  return sealRun({ id, projectId: project.id, input: structuredClone(project), mode: 'rehearsal', scope: 'local-rehearsal', scenario, network: result.network, projectName: project.name, release: project.release, completedAt: new Date().toISOString(), checks: result.checks, limitations: result.limitations, status: overall(result.checks) });
}
test('same project keeps its failed evidence after a repair, restart, comparison, and archive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'revivecheck-'));
  try {
    const store = new Store(dir);
    const project = await store.create({ name: 'My migration', release: 'v0.1.0' });
    const failed = makeRun(project, 'wrong-network', 'first');
    await store.addRun(failed);
    const updated = await store.update(project.id, { release: 'v0.1.1' });
    const passed = makeRun(updated, 'ready', 'second');
    await store.addRun(passed);
    const reopened = await new Store(dir).read();
    assert.equal(reopened.runs[0].input.release, 'v0.1.0');
    assert.equal(reopened.runs[1].input.release, 'v0.1.1');
    assert.ok(reopened.runs.every(verifyRun));
    const comparison = compareRuns(...reopened.runs);
    assert.equal(comparison.compatible, true);
    assert.equal(comparison.comparisonKind, 'fixture-scenario');
    assert.equal(comparison.changes.find(c => c.id === 'network.chain-id').transition, 'context-changed');
    assert.equal(comparison.summary.improved, 0);
    assert.equal(comparison.summary.regressed, 0);
    assert.equal((await store.archive(project.id)).archivedAt !== null, true);
    assert.equal((await store.read()).runs.length, 2);
    assert.equal((await store.archive(project.id, true)).archivedAt, null);
    await assert.rejects(store.addRun(failed), /cannot be overwritten/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('tampering a report invalidates integrity and blocks comparison', () => {
  const project = { id: 'p', name: 'My app', release: 'v1', expectedValue: '42' };
  const first = makeRun(project, 'wrong-network', 'a');
  const second = JSON.parse(JSON.stringify(makeRun(project, 'ready', 'b')));
  second.checks[0].observed = 'Edited evidence';
  assert.equal(verifyRun(second), false);
  assert.equal(compareRuns(first, second).compatible, false);
});
test('scope mismatch never turns a rehearsal repair into live success', () => {
  const project = { id: 'p', name: 'My app', expectedValue: '42' };
  const rehearsal = makeRun(project, 'ready', 'a');
  const live = sealRun({ ...JSON.parse(JSON.stringify(rehearsal)), evidenceHash: undefined, id: 'b', mode: 'live', scope: 'portaldot-testnet-readonly' });
  assert.equal(compareRuns(rehearsal, live).compatible, false);
});
test('unknown and missing evidence cannot pass acceptance', () => {
  assert.equal(overall([]), 'inconclusive');
  assert.equal(overall([{ status: 'passed' }, { status: 'unknown' }]), 'inconclusive');
  assert.equal(overall([{ status: 'passed' }, { status: 'blocked' }]), 'blocked');
});
test('reports escape user content and preserve synthetic evidence scope', () => {
  const run = makeRun({ id: 'p', name: '<script>alert(1)</script>', expectedValue: '42' }, 'ready', 'a');
  const html = reportHtml(run);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('synthetic fixtures'));
  assert.ok(html.includes('not an on-chain attestation'));
});
test('concurrent project writes survive without losing either object', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'revivecheck-'));
  try {
    const store = new Store(dir);
    await Promise.all([store.create({ name: 'One' }), store.create({ name: 'Two' })]);
    assert.equal((await store.read()).projects.length, 2);
    JSON.parse(await readFile(path.join(dir, 'workspace.json'), 'utf8'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('invalid addresses, unbounded values, and seed-shaped input are not saved as account configuration', () => {
  assert.throws(() => validateProject({ name: 'X', account: 'some mnemonic words' }), /address/);
  assert.throws(() => validateProject({ name: 'X', expectedValue: (1n << 256n).toString() }), /uint256/);
  assert.throws(() => validateProject({ name: 'X', contractAddress: 'bad' }), /address/);
});
test('changing the contract, caller, or expected value cannot be counted as repairing the same target', () => {
  const project = { id: 'p', name: 'My migration', release: 'v1', expectedChainId: 420420777, account: `0x${'1'.repeat(40)}`, contractAddress: `0x${'2'.repeat(40)}`, expectedValue: '42' };
  const baseline = makeRun(project, 'missing-code', 'before');
  for (const [key, value] of [['contractAddress', `0x${'3'.repeat(40)}`], ['account', `0x${'4'.repeat(40)}`], ['expectedValue', '41']]) {
    const candidate = makeRun({ ...project, [key]: value }, 'ready', `after-${key}`);
    const comparison = compareRuns(baseline, candidate);
    assert.equal(comparison.compatible, false, `${key} requires a new baseline`);
    assert.equal(comparison.summary.improved, 0);
    assert.deepEqual(comparison.changes, []);
    assert.match(comparison.reason, /cannot establish a repair.*new baseline/i);
    assert.ok(comparison.inputChanges.some(change => change.key === key));
  }
});
test('correcting the expected chain is identified as configuration correction rather than an application fix', () => {
  const project = { id: 'p', name: 'My migration', release: 'v1', expectedChainId: 1, expectedValue: '42' };
  const baseline = makeRun(project, 'ready', 'wrong-expectation');
  const candidate = makeRun({ ...project, expectedChainId: 420420777 }, 'ready', 'corrected-expectation');
  const comparison = compareRuns(baseline, candidate);
  assert.equal(comparison.compatible, true);
  assert.equal(comparison.comparisonKind, 'configuration-correction');
  assert.match(comparison.caveat, /configuration correction, not proof of an application code fix/i);
  assert.equal(comparison.changes.find(change => change.id === 'network.chain-id').transition, 'improved');
  assert.ok(comparison.inputChanges.some(change => change.key === 'expectedChainId' && change.before === 1 && change.after === 420420777));
});
test('rehearsal never passes a saved non-Portaldot chain expectation even in the ready scenario', () => {
  const project = { expectedChainId: 1, expectedValue: '42' };
  for (const scenario of ['ready', 'wrong-network']) {
    const result = rehearse(project, scenario);
    assert.equal(result.checks.find(check => check.id === 'network.chain-id').status, 'failed');
    assert.match(result.checks[0].observed, /saved project expects 1/);
    assert.ok(result.checks.slice(1).every(check => check.status === 'blocked'));
    assert.equal(overall(result.checks), 'failed');
  }
});

const target = { id: 'application', name: 'A real release', release: 'v1', logicalContractId: 'release-gate', sourceRevision: 'source-a', expectedChainId: 420420777, contractAddress: `0x${'1'.repeat(40)}`, account: `0x${'2'.repeat(40)}`, expectedValue: '42' };
function observedRun(project, id, status = 'passed', specVersion = '3002') {
  return sealRun({ id, projectId: project.id, projectName: project.name, release: project.release, input: structuredClone(project), mode: 'live', scope: 'portaldot-testnet-readonly', startedAt: id === 'before' ? '2026-10-23T01:00:00Z' : '2026-10-23T02:00:00Z', completedAt: id === 'before' ? '2026-10-23T01:01:00Z' : '2026-10-23T02:01:00Z', network: { chainId: 420420777, specVersion, constantsHash: 'same-runtime-constants', finalizedBlockNumber: '42', finalizedNativeBlockHash: 'native-checkpoint', finalizedEvmBlockHash: 'evm-checkpoint' }, checks: [{ id: 'contract.code', title: 'Contract code', status: 'passed', observed: 'Code present', expected: 'Code', evidence: { codeHash: `code-for-${project.sourceRevision}` } }, { id: 'contract.value', title: 'Contract state', status, observed: status === 'passed' ? '42' : '41', expected: '42' }], status, limitations: ['Test fixture for lifecycle semantics; not a live RPC result.'] });
}
test('new deployment versions compare only with the same explicit logical contract and assertion plan', () => {
  const before = observedRun(target, 'before', 'failed');
  const nextProject = { ...target, release: 'v2', sourceRevision: 'source-b', contractAddress: `0x${'3'.repeat(40)}` };
  const after = observedRun(nextProject, 'after');
  const comparison = compareRuns(before, after);
  assert.equal(comparison.compatible, true);
  assert.equal(comparison.comparisonKind, 'deployment-version');
  assert.equal(comparison.summary.improved, 1);
  assert.match(comparison.caveat, /do not prove an application code fix/);
  assert.equal(before.binding.planHash, after.binding.planHash);
  assert.notEqual(before.binding.codeHash, after.binding.codeHash);
  assert.equal(after.binding.sourceRevision, 'source-b');
  const weakened = observedRun({ ...nextProject, expectedValue: '41' }, 'weakened');
  assert.equal(compareRuns(before, weakened).compatible, false);
  assert.equal(compareRuns(before, weakened).summary.improved, 0);
});
test('runtime drift cannot be counted as a repair and marks old evidence for recheck without rewriting its review', () => {
  const before = observedRun(target, 'before', 'failed');
  const after = observedRun(target, 'after', 'passed', '3003');
  const review = createReview(before, { reviewer: 'Maintainer', decision: 'accepted', comment: 'Acknowledged this exact failed observation.' });
  const comparison = compareRuns(before, after);
  assert.equal(comparison.comparisonKind, 'runtime-change');
  assert.equal(comparison.summary.improved, 0);
  assert.ok(comparison.summary.changed > 0);
  const lifecycle = lifecycleForRun(before, { project: target, runs: [before, after], reviews: [review] });
  assert.equal(lifecycle.freshness.status, 'environment-changed');
  assert.equal(lifecycle.review.status, 'accepted');
  assert.equal(lifecycle.review.official, false);
  assert.equal(lifecycle.verification.status, 'failed');
  assert.equal(lifecycle.nextAction.kind, 'recheck');
});
test('exact-hash review receipts and share preparation survive restart but never transfer to a new run', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'revivecheck-review-'));
  try {
    const store = new Store(dir), before = observedRun(target, 'before');
    await store.importRun(before);
    const review = await store.addReview(before.id, { reviewer: 'Self-declared reviewer', decision: 'accepted', comment: 'Reviewed the stated scope.' });
    assert.equal(verifyReview(review), true);
    assert.equal(review.reportHash, before.evidenceHash);
    await store.addShare(before.id, { method: 'fragment', url: 'https://example.com/review#report=example' });
    const after = observedRun(target, 'after');
    await store.addRun(after);
    const reopened = await new Store(dir).read();
    const oldLifecycle = lifecycleForRun(before, { ...reopened, project: reopened.projects[0] });
    const newLifecycle = lifecycleForRun(after, { ...reopened, project: reopened.projects[0] });
    assert.equal(oldLifecycle.review.status, 'accepted');
    assert.equal(oldLifecycle.publishing.status, 'share-prepared');
    assert.equal(newLifecycle.review.status, 'unreviewed');
    assert.equal(newLifecycle.publishing.status, 'not-shared');
    assert.equal(newLifecycle.verification.status, 'passed');
    assert.equal(oldLifecycle.review.identity, 'self-declared');
    assert.equal(JSON.stringify(reopened.runs[0]), JSON.stringify(before));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('legacy reports import unchanged; tampering and conflicting review receipts cannot overwrite history', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'revivecheck-import-'));
  try {
    const store = new Store(dir);
    const { schemaVersion, binding, evidenceHash, ...legacyPayload } = observedRun(target, 'before');
    const legacy = { ...legacyPayload, evidenceHash: fingerprint(legacyPayload) };
    assert.equal(verifyRun(legacy), true);
    await store.importRun(legacy);
    assert.equal((await store.importRun(legacy)).imported, false);
    const review = createReview(legacy, { reviewer: 'Reviewer', decision: 'changes-requested', comment: 'Need additional evidence.' });
    await store.importReview(review);
    assert.equal((await store.importReview(review)).receiptHash, review.receiptHash);
    const changed = { ...review, comment: 'Changed opinion' };
    assert.equal(verifyReview(changed), false);
    await assert.rejects(async () => store.importReview(changed), /integrity or schema/);
    const { receiptHash, ...replacementPayload } = changed;
    await assert.rejects(store.importReview({ ...replacementPayload, receiptHash: fingerprint(replacementPayload) }), /cannot be overwritten/);
    await assert.rejects(async () => store.importRun({ ...legacy, status: 'failed' }), /integrity/);
    assert.deepEqual((await store.read()).runs[0], legacy);
    assert.equal((await store.read()).reviews.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('changing an assertion plan makes previous evidence stale; sample acceptance is never live verification', () => {
  const run = observedRun(target, 'before');
  const changed = { ...target, assertions: [{ id: 'approved', label: 'Approval', signature: 'approved()', returns: 'bool', args: [], expected: true }] };
  assert.equal(lifecycleForRun(run, { project: changed }).freshness.status, 'plan-changed');
  const sample = makeRun(target, 'ready', 'sample');
  const review = createReview(sample, { reviewer: 'Reviewer', decision: 'accepted', comment: 'Sample scope only.' });
  const lifecycle = lifecycleForRun(sample, { project: target, reviews: [review] });
  assert.equal(lifecycle.verification.status, 'sample');
  assert.equal(lifecycle.review.status, 'accepted');
  assert.equal(lifecycle.nextAction.kind, 'run-live');
});
test('profile and scalar assertion settings are preserved and unsafe share destinations are rejected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'revivecheck-plan-'));
  try {
    const store = new Store(dir);
    const project = await store.create({ name: 'Native asset', profile: 'native-asset', logicalContractId: 'asset-7777', sourceRevision: 'source-a', nativeAsset: { assetId: '7777', holder: '' } });
    assert.equal(project.profile, 'native-asset');
    assert.equal(project.nativeAsset.assetId, '7777');
    const updated = await store.update(project.id, { release: 'v2' });
    assert.deepEqual(updated.nativeAsset, project.nativeAsset);
    assert.equal(updated.profile, 'native-asset');
    await assert.rejects(async () => store.addShare('missing', { method: 'fragment', url: 'http://127.0.0.1:4173/' }), /static HTTPS/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('current actor, asset holder, source, and target changes invalidate the corresponding saved scope', () => {
  const run = observedRun(target, 'before');
  for (const patch of [{ account: `0x${'3'.repeat(40)}` }, { logicalContractId: 'another-logical-contract' }]) {
    assert.equal(lifecycleForRun(run, { project: { ...target, ...patch } }).freshness.status, 'plan-changed');
  }
  for (const patch of [{ release: 'v2' }, { sourceRevision: 'source-b' }]) {
    assert.equal(lifecycleForRun(run, { project: { ...target, ...patch } }).freshness.status, 'release-changed');
  }
  for (const patch of [{ contractAddress: `0x${'3'.repeat(40)}` }, { expectedChainId: 1 }]) {
    assert.equal(lifecycleForRun(run, { project: { ...target, ...patch } }).freshness.status, 'target-changed');
  }
  const assetProject = { ...target, profile: 'native-asset', nativeAsset: { assetId: '7777', holder: `0x${'3'.repeat(40)}` } };
  const assetRun = observedRun(assetProject, 'asset-before');
  for (const nativeAsset of [{ assetId: '7778', holder: assetProject.nativeAsset.holder }, { assetId: '7777', holder: `0x${'4'.repeat(40)}` }]) {
    assert.equal(lifecycleForRun(assetRun, { project: { ...assetProject, nativeAsset } }).freshness.status, 'plan-changed');
  }
});
