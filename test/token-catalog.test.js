import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runLocalLifecycle, checkTranscript, EXPECTED } from '../examples/token-catalog/lib/lifecycle.js';
import { normalizeConfig, appendBinding, latestBinding, buildCatalog } from '../examples/token-catalog/lib/catalog.js';
import { createLocalChain, FIXTURE } from '../examples/token-catalog/lib/local-chain.js';
import { createBinding, verifyBinding } from '../lib/policy.js';
import { verifyRun, validateImportedRun } from '../lib/report.js';
import { demoPlan } from '../lib/demo.js';

// Review F-07 (2026-10-24): the Token Catalog is a consumer built only on documented
// interfaces. Offline: the whole lifecycle runs on the in-memory stand-in chain with
// fixture accounts A, B and C; the acceptance command runs on captured inputs.
const root = new URL('../', import.meta.url);
const run = promisify(execFile);
const localConfig = JSON.parse(await readFile(new URL('examples/token-catalog/config/local.json', root), 'utf8'));
const testnetConfig = JSON.parse(await readFile(new URL('examples/token-catalog/config/testnet.json', root), 'utf8'));
const lifecycle = await runLocalLifecycle({ config: localConfig });
const byStep = Object.fromEntries(lifecycle.transcript.map((entry) => [entry.step, entry]));

test('the lifecycle runs A submits → B approves → A lists → revision invalidates → recheck → reapproval → explicit rebinding → available again', () => {
  const verdict = checkTranscript(lifecycle.transcript);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.mismatches));
  assert.equal(lifecycle.transcript.length, EXPECTED.length);
  assert.equal(byStep.submit.available, false, 'an unapproved release is unavailable');
  assert.deepEqual(byStep.submit.reasons, ['approval-missing', 'consumer-not-listed']);
  assert.equal(byStep.approve.available, false, 'approved but not yet listed by the consumer');
  assert.equal(byStep.list.available, true);
  assert.equal(byStep.list.listed, true);
  assert.equal(byStep['revision-2'].available, false, 'a new revision invalidates the old binding and un-lists the token');
  assert.equal(byStep['revision-2'].listed, false);
  assert.ok(byStep['revision-2'].reasons.includes('revision-superseded'));
  assert.ok(byStep['approve-r2'].reasons.includes('revision-superseded'), 'approval of the new report does not move the old binding');
  assert.deepEqual(byStep['rebind-r2'].reasons, ['consumer-not-listed'], 'after the explicit rebinding only the consumer entry is missing');
  assert.equal(byStep.relist.available, true);
  assert.equal(lifecycle.bindings.length, 5, 'first, rebind, wrong target, restore, renew: history is kept');
  assert.ok(lifecycle.bindings.every((binding) => verifyBinding(binding, lifecycle.config.policy)));
  assert.equal(lifecycle.catalog.tokens[0].available, true);
  assert.equal(lifecycle.catalog.simulation, true);
  assert.match(lifecycle.catalog.caveat, /SIMULATED EVIDENCE/);
  assert.match(lifecycle.chain.label, /controlled by this example/);
});

test('revocation, expiry, wrong-target reports, a runtime change and an unavailable node each block the entry for the documented reason', () => {
  assert.deepEqual(byStep.revoke.reasons, ['approval-revoked', 'consumer-not-listed']);
  assert.equal(byStep.revoke.listed, false, 'isListed follows the registry decision');
  assert.equal(byStep.reapprove.available, true);
  assert.equal(byStep['wrong-target'].status, 'recheck-required');
  assert.ok(byStep['wrong-target'].reasons.includes('wrong-target'));
  assert.ok(!byStep['wrong-target'].reasons.includes('report-not-passed'), 'the wrong-target report passes on its own subject');
  assert.deepEqual(byStep['runtime-change'].reasons, ['runtime-changed']);
  assert.equal(byStep['runtime-change'].listed, true, 'the contract does not notice a runtime change; the policy does');
  assert.equal(byStep['node-unavailable'].status, 'unknown');
  assert.deepEqual(byStep['node-unavailable'].reasons, ['observation-missing', 'registry-unavailable', 'consumer-unavailable']);
  assert.equal(byStep['node-unavailable'].available, false);
  assert.deepEqual(byStep.expire.reasons, ['evidence-expired']);
  assert.equal(byStep.expire.listed, true, 'the contract still lists the token; the policy clock expired the evidence');
  assert.equal(byStep.renew.status, 'valid');
  assert.equal(byStep.renew.outcome.revision, '3');
});

test('a stranger with a self-approved release cannot replace or delist the entry (VerifiedTokenList v2)', () => {
  assert.equal(byStep['stranger-replace'].outcome.list, 'EntryOwnedByAnother');
  assert.equal(byStep['stranger-replace'].outcome.delist, 'EntryOwnedByAnother');
  assert.equal(byStep['stranger-replace'].available, true);
});

test('simulated reports are sealed, labelled and importable, and never claim the live scope', () => {
  assert.ok(lifecycle.reports.length >= 5);
  for (const report of lifecycle.reports) {
    assert.equal(verifyRun(report), true);
    assert.equal(validateImportedRun(report), report);
    assert.equal(report.mode, 'rehearsal');
    assert.equal(report.scope, 'local-rehearsal');
    assert.ok(report.limitations.some((item) => item.startsWith('SIMULATED')));
    assert.equal(report.network.name, 'Local rehearsal fixtures');
  }
  assert.equal(lifecycle.reports[0].status, 'failed');
  assert.equal(lifecycle.reports[1].status, 'passed');
});

test('the catalog document exposes availability only for a valid evaluation and keeps the reasons otherwise', async () => {
  const config = normalizeConfig(localConfig);
  const chain = await createLocalChain();
  const report = await chain.check(demoPlan('v1.0.1'));
  const releaseId = `0x${'ab'.repeat(32)}`;
  const first = createBinding({ policy: config.policy, report, releaseId, revision: '1', boundBy: 'operator (test)', id: 'b-1' });
  let history = appendBinding([], first, config.policy);
  assert.throws(() => appendBinding(history, first, config.policy), /already exists/);
  assert.throws(() => appendBinding(history, { ...first, id: 'b-2' }, config.policy), /intact binding/);
  const second = createBinding({ policy: config.policy, report, releaseId, revision: '2', boundBy: 'operator (test)', id: 'b-2' });
  history = appendBinding(history, second, config.policy);
  assert.equal(latestBinding(history, FIXTURE.token).id, 'b-2');
  assert.equal(history[0].revision, '1', 'the earlier binding is unchanged history');
  assert.ok(Object.isFrozen(history));
  const unbound = buildCatalog({ config, entries: [] });
  assert.deepEqual([unbound.tokens[0].available, unbound.tokens[0].status, unbound.tokens[0].reasons], [false, 'unbound', ['no-binding']]);
  const blocked = buildCatalog({ config, entries: [{ token: FIXTURE.token, binding: second, evaluation: { status: 'unknown', enable: false, reasons: [{ code: 'registry-unavailable' }], checks: [], evaluatedAt: 'x', checkpoint: {}, evaluationHash: 'y', nextAction: 'z' } }] });
  assert.equal(blocked.tokens[0].available, false);
  assert.deepEqual(blocked.tokens[0].reasons, ['registry-unavailable']);
  assert.equal(blocked.summary.available, 0);
  assert.throws(() => normalizeConfig({ ...localConfig, mode: 'testnet' }), /local catalog uses a local-rehearsal policy/);
  assert.throws(() => normalizeConfig({ ...localConfig, roles: { owner: { control: 'x' } } }), /roles.reviewer.control/);
  assert.throws(() => normalizeConfig({ ...localConfig, tokens: [{ ...localConfig.tokens[0], address: `0x${'ee'.repeat(20)}` }] }), /policy subject/);
});

test('the testnet configuration is a live policy over the deployed contracts and the recorded studio run', () => {
  const config = normalizeConfig(testnetConfig);
  assert.equal(config.mode, 'testnet');
  assert.equal(config.policy.simulation, false);
  assert.equal(config.policy.registry.address, '0xe949b200edf070b9d425b206ed24dc8fe5b7d339');
  assert.equal(config.policy.consumer.address, '0xd0bd833b4b8658b1230a0e9a99640935b3c65819');
  assert.equal(config.policy.evidence.requireStoredOnChain, true);
  assert.match(config.policy.reviewers.basis, /not independent review/);
  assert.match(config.roles.reviewer.control, /same project test account/);
});

test('the acceptance command fails on captured inputs that leave the verification incomplete, and passes on complete ones', async () => {
  const cli = new URL('examples/token-catalog/catalog.js', root).pathname;
  const options = { cwd: root.pathname, env: { ...process.env, NODE_NO_WARNINGS: '1' } };
  const unreachable = await run(process.execPath, [cli, 'acceptance', '--config', 'examples/token-catalog/config/testnet.json', '--fixture', 'examples/token-catalog/fixtures/unreachable.inputs.json', '--out', 'artifacts/local/token-catalog/acceptance-unreachable'], options).then(() => ({ code: 0 }), (error) => ({ code: error.code, stdout: error.stdout }));
  assert.equal(unreachable.code, 1, 'an unavailable verification never passes');
  assert.match(unreachable.stdout, /acceptance FAILED/);
  assert.match(unreachable.stdout, /unknown \(observation-missing, registry-unavailable/);
  const captured = await run(process.execPath, [cli, 'acceptance', '--config', 'examples/token-catalog/config/testnet.json', '--fixture', 'examples/token-catalog/fixtures/testnet-policy-verified-2026-10-24.inputs.json', '--out', 'artifacts/local/token-catalog/acceptance-captured'], options);
  assert.match(captured.stdout, /acceptance PASSED/);
  assert.match(captured.stdout, /AVAILABLE  valid/);
  const historical = await run(process.execPath, [cli, 'acceptance', '--config', 'examples/token-catalog/config/testnet.json', '--fixture', 'examples/token-catalog/fixtures/testnet-2026-10-24.inputs.json', '--out', 'artifacts/local/token-catalog/acceptance-historical'], options).then(() => ({ code: 0 }), (error) => ({ code: error.code, stdout: error.stdout }));
  assert.equal(historical.code, 1, 'the preserved older capture lacks the newly required provenance and identity evidence');
  assert.match(historical.stdout, /registry-domain-unverifiable/);
  assert.match(historical.stdout, /consumer-identity-unavailable/);
});
