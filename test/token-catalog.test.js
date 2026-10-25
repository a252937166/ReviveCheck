import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { runLocalLifecycle, checkTranscript, EXPECTED } from '../examples/token-catalog/lib/lifecycle.js';
import { normalizeConfig, appendBinding, latestBinding, buildCatalog, approvedEntry, compareEntry, entryIdentity, assertEntryApproved, classifyBindings } from '../examples/token-catalog/lib/catalog.js';
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
  assert.equal(lifecycle.catalog.tokens[0].entry.match, true, 'the final catalog publishes the entry the renewed report approved');
  assert.equal(lifecycle.catalog.tokens[0].entry.source, 'approved-report');
  assert.equal(byStep['wrong-target'].entry.includes('address'), true, 'a report about another asset is also a different entry');
  assert.equal(byStep.list.entry, 'equals the approved report');
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
  const blocked = buildCatalog({ config, entries: [{ token: FIXTURE.token, binding: second, report, evaluation: { status: 'unknown', enable: false, reasons: [{ code: 'registry-unavailable' }], checks: [], evaluatedAt: 'x', checkpoint: {}, evaluationHash: 'y', nextAction: 'z' } }] });
  assert.equal(blocked.tokens[0].available, false);
  assert.deepEqual(blocked.tokens[0].reasons, ['registry-unavailable']);
  const unloaded = buildCatalog({ config, entries: [{ token: FIXTURE.token, binding: second, evaluation: { status: 'valid', enable: true, reasons: [], checks: [], evaluatedAt: 'x', checkpoint: {}, evaluationHash: 'y', nextAction: 'z' } }] });
  assert.deepEqual([unloaded.tokens[0].available, unloaded.tokens[0].reasons], [false, ['entry-unverified']], 'a binding whose report was not loaded publishes nothing');
  assert.equal(blocked.summary.available, 0);
  assert.throws(() => normalizeConfig({ ...localConfig, mode: 'testnet' }), /local catalog uses a local-rehearsal policy/);
  assert.throws(() => normalizeConfig({ ...localConfig, roles: { owner: { control: 'x' } } }), /roles.reviewer.control/);
  assert.throws(() => normalizeConfig({ ...localConfig, tokens: [{ ...localConfig.tokens[0], address: `0x${'ee'.repeat(20)}` }] }), /policy subject/);
});

// Assessment 2026-10-25, A-01: the entry the catalog publishes is derived from the approved
// report; a configured entry that differs is withheld under an unchanged approval.
test('a changed configured decimals value cannot stay available under an unchanged approval, and the differing field is named', async () => {
  const config = normalizeConfig(localConfig);
  const chain = await createLocalChain();
  const report = await chain.check(demoPlan('v1.0.1'));
  const approved = approvedEntry(report);
  assert.deepEqual(approved.entry, { chainId: 420420777, address: FIXTURE.token, symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6, assetId: '7777' });
  const releaseId = `0x${'ab'.repeat(32)}`;
  const binding = createBinding({ policy: config.policy, report, releaseId, revision: '1', boundBy: 'operator (test)', id: 'b-entry' });
  const valid = { status: 'valid', enable: true, reasons: [], checks: [{ id: 'registry.approvals', status: 'passed' }], evaluatedAt: '2026-10-25T00:00:00.000Z', checkpoint: {}, evaluationHash: 'e', nextAction: 'Enable.' };
  const published = buildCatalog({ config, entries: [{ token: FIXTURE.token, binding, report, evaluation: valid }] });
  assert.equal(published.tokens[0].available, true, 'the correct approved entry passes the normal path');
  assert.equal(published.tokens[0].entry.source, 'approved-report');
  assert.equal(published.tokens[0].entry.identity, entryIdentity(approved.entry));
  assert.deepEqual(published.tokens[0].reasons, []);
  const wrong = normalizeConfig({ ...localConfig, tokens: [{ ...localConfig.tokens[0], decimals: 18 }] });
  const withheld = buildCatalog({ config: wrong, entries: [{ token: FIXTURE.token, binding, report, evaluation: valid }] });
  assert.equal(withheld.tokens[0].available, false, 'a valid policy evaluation never publishes an entry the report did not approve');
  assert.equal(withheld.tokens[0].status, 'valid', 'the policy status is reported as it is; the business action is what changes');
  assert.deepEqual(withheld.tokens[0].reasons, ['entry-mismatch:decimals']);
  assert.deepEqual(withheld.tokens[0].entry.mismatches, [{ field: 'decimals', configured: 18, approved: 6 }]);
  assert.equal(withheld.tokens[0].entry.source, 'configuration (unverified; withheld)');
  assert.match(withheld.tokens[0].nextAction, /Do not publish this entry/);
  assert.equal(withheld.summary.available, 0);
  assert.throws(() => assertEntryApproved(wrong.tokens[0], report), /decimals \(configured 18, approved 6\)/);
  // Canonical property order and address casing do not create false mismatches.
  const spelled = normalizeConfig({ ...localConfig, tokens: [{ decimals: '6', name: 'Portaldot USD (test)', address: `0x${FIXTURE.token.slice(2).toUpperCase()}`, symbol: 'pUSD', assetId: 7777 }] });
  assert.equal(compareEntry(spelled.tokens[0], approved.entry).match, true);
  assert.equal(entryIdentity({ assetId: '7777', decimals: 6, name: 'Portaldot USD (test)', symbol: 'pUSD', address: `0x${FIXTURE.token.slice(2).toUpperCase()}`, chainId: '420420777' }), entryIdentity(approved.entry));
  // Missing approved metadata blocks publication: a passed report without a listing approves no entry.
  const bare = await chain.check({ ...demoPlan('v1.0.1'), listing: undefined });
  assert.equal(bare.status, 'passed');
  assert.match(approvedEntry(bare).reason, /no token-list entry/);
  const unverified = buildCatalog({ config, entries: [{ token: FIXTURE.token, binding: createBinding({ policy: config.policy, report: bare, releaseId, revision: '1', boundBy: 'operator (test)', id: 'b-bare' }), report: bare, evaluation: valid }] });
  assert.deepEqual([unverified.tokens[0].available, unverified.tokens[0].reasons], [false, ['entry-unverified']]);
  // An intact checksum never overrides a mismatch, and a broken seal never approves anything.
  const tampered = { ...report, input: { ...report.input, listing: { ...report.input.listing, decimals: 18 } } };
  assert.match(approvedEntry(tampered).reason, /integrity/);
  const failed = await chain.check(demoPlan('v1.0.0'));
  assert.equal(failed.status, 'failed');
  assert.match(approvedEntry(failed).reason, /did not pass/);
});

test('the bind command refuses a configured entry that is not the approved one, before any binding is written', async () => {
  const cli = new URL('examples/token-catalog/catalog.js', root).pathname;
  const dir = 'artifacts/local/token-catalog/test-entry-mismatch';
  await rm(new URL(dir, root), { recursive: true, force: true });
  await mkdir(new URL(`${dir}/reports`, root), { recursive: true });
  const chain = await createLocalChain();
  const report = await chain.check(demoPlan('v1.0.1'));
  await writeFile(new URL(`${dir}/reports/${report.evidenceHash}.json`, root), JSON.stringify(report));
  const config = { ...localConfig, tokens: [{ ...localConfig.tokens[0], decimals: 18 }], data: dir, reports: `${dir}/reports` };
  await writeFile(new URL(`${dir}/config.json`, root), JSON.stringify(config));
  const options = { cwd: root.pathname, env: { ...process.env, NODE_NO_WARNINGS: '1' } };
  const refused = await run(process.execPath, [cli, 'bind', '--config', `${dir}/config.json`, '--token', FIXTURE.token, '--report', report.evidenceHash, '--release-id', `0x${'ab'.repeat(32)}`, '--revision', '1'], options).then(() => ({ code: 0 }), (error) => ({ code: error.code, stderr: error.stderr }));
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /not the approved entry: decimals \(configured 18, approved 6\)/);
  await assert.rejects(readFile(new URL(`${dir}/bindings.json`, root)), /ENOENT/, 'nothing was bound');
  await writeFile(new URL(`${dir}/config.json`, root), JSON.stringify({ ...config, tokens: localConfig.tokens }));
  const accepted = await run(process.execPath, [cli, 'bind', '--config', `${dir}/config.json`, '--token', FIXTURE.token, '--report', report.evidenceHash, '--release-id', `0x${'ab'.repeat(32)}`, '--revision', '1'], options);
  assert.match(accepted.stdout, /1 in history, 1 under the current policy/);
});

test('bindings made under a superseded policy are kept as history, never selected, and an unlisted policy is an error', async () => {
  const config = normalizeConfig(localConfig);
  const chain = await createLocalChain();
  const report = await chain.check(demoPlan('v1.0.1'));
  const other = { ...localConfig.policy, evidence: { ...localConfig.policy.evidence, maxAgeSeconds: 3600 } };
  const old = createBinding({ policy: other, report, releaseId: `0x${'ab'.repeat(32)}`, revision: '1', boundBy: 'operator (test)', id: 'b-old' });
  const current = createBinding({ policy: config.policy, report, releaseId: `0x${'ab'.repeat(32)}`, revision: '2', boundBy: 'operator (test)', id: 'b-new' });
  assert.throws(() => classifyBindings([old, current], config), /neither uses nor lists as superseded/);
  const tolerant = normalizeConfig({ ...localConfig, supersededPolicies: [{ policyHash: old.policyHash, note: 'shorter age limit' }] });
  const history = classifyBindings([old, current], tolerant);
  assert.deepEqual(history.current.map((item) => item.id), ['b-new']);
  assert.deepEqual(history.historical.map((item) => [item.id, item.historical.note]), [['b-old', 'shorter age limit']]);
  assert.equal(latestBinding(history.current, FIXTURE.token).id, 'b-new');
  assert.throws(() => classifyBindings([{ ...old, revision: '9' }], tolerant), /not intact/);
  const catalog = buildCatalog({ config: tolerant, entries: [], history });
  assert.equal(catalog.history.historical[0].id, 'b-old');
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
