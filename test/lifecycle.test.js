import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, validateProject } from '../server/store.js';
import { sealRun, verifyRun, compareRuns, overall, reportHtml } from '../lib/report.js';
import { rehearse } from '../lib/rehearsal.js';

function makeRun(project, scenario, id) {
  const result = rehearse(project, scenario);
  return sealRun({ id, projectId: project.id, input: structuredClone(project), mode: 'rehearsal', scope: 'local-rehearsal', projectName: project.name, release: project.release, completedAt: new Date().toISOString(), checks: result.checks, limitations: result.limitations, status: overall(result.checks) });
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
    assert.equal(comparison.changes.find(c => c.id === 'network.chain-id').transition, 'improved');
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
