import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptySession, recordCheck, recordRecheck, recordImport, applyStage, stepStatuses, completion, migrateSession, loadStudioStore, saveStudioStore, sessionFor, withSession, activeReport, passedActiveReport, activePlan, ledgerRows, STORE_KEY, LEGACY_KEY, DEMO_PROJECT, SESSION_SCHEMA, REPORT_BOUND } from '../src/studio-state.js';
import { listReceipt } from '../src/receipts.js';
import { NETWORKS } from '../lib/networks.js';

// Product plan 2026-10-25, D-01: one explicit active report. A new failed check never
// falls back to an older passing report; a report handed over after another was
// approved never appears approved; a late answer for another report is history; the
// earlier flat session migrates with every unattributable stage filed as history.
const load = (hash) => readFile(new URL(`../public/reports/${hash}.json`, import.meta.url), 'utf8').then(JSON.parse);
const FAILED = await load('7f01ed85594c47523d44ecf4f87c3e42da920bff9925a33f4cd6fc0686b1dc14');     // v1.0.0, failed (18 decimals), 2026-10-23
const PASSED = await load('cbd78faa85f8759860d88366794e0c70052b74f9ed775be5bb37ad20118ed427');     // v1.0.1, passed, 2026-10-23
const PASSED_B = await load('1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51');   // v1.0.1, passed, 2026-10-25
const TESTNET = NETWORKS.testnet;
const V2 = { address: '0xedaf8a25bb583ad164a94191b762414277198df9', version: 2 };
const OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const RELEASE = '0xe3f6ab7784cbaa8f60171e5201fea4e27fa5cec3d6682e06d8fcb7d89181f808';
const tx = (block) => ({ route: 'native', extrinsicHash: `0x${'11'.repeat(32)}`, blockHash: `0x${'22'.repeat(32)}`, blockNumber: String(block), success: true });
const context = { network: TESTNET, consumer: V2 };
const T = '2026-10-25T12:00:00.000Z';

/** The recorded studio run, as a session: failed check, passed recheck, stored, submitted, approved and listed on the recheck report. */
function approvedSession(report = PASSED) {
  let session = recordCheck(emptySession(DEMO_PROJECT), { choice: 'v1.0.0', report: FAILED, at: T });
  session = recordRecheck(session, { choice: 'v1.0.1', report, comparison: { baselineHash: FAILED.evidenceHash, candidateHash: report.evidenceHash }, at: T });
  session = applyStage(session, 'store', { reportHash: report.evidenceHash, bytes: 9000, contentHash: '0xab', tx: tx(163481), retrieved: { verified: true } });
  session = applyStage(session, 'submit', { label: 'pusd-token-list', releaseId: RELEASE, reportHash: report.evidenceHash, from: '5GH8…', sender: OWNER, tx: tx(163485), readback: { release: { revision: '1', reportHash: `0x${report.evidenceHash}` } } });
  session = applyStage(session, 'approve', { releaseId: RELEASE, approved: true, reportHash: `0x${report.evidenceHash}`, revision: '1', reviewer: OWNER, from: '5GH8…', tx: tx(163489) });
  session = applyStage(session, 'consume', { ...listReceipt({ network: TESTNET, consumer: V2, token: report.input.listing.address, decimals: 6, releaseId: RELEASE, reportHash: report.evidenceHash, revision: '1', reviewer: OWNER, from: '5GH8…', sender: OWNER, tx: tx(163500) }), readback: { listed: true, list: V2.address, token: report.input.listing.address, interfacesAgree: true, block: { number: '163501' }, entry: { releaseId: RELEASE, reportHash: `0x${report.evidenceHash}`, reviewer: OWNER }, identity: { address: V2.address, interfacesAgree: true, version: 2, versionSource: 'on-chain-version-getter' } } });
  return session;
}

test('a passed recheck followed by its lifecycle is complete; a new failed check replaces the active report and nothing falls back', () => {
  const approved = approvedSession();
  assert.equal(approved.active.reportHash, PASSED.evidenceHash);
  assert.equal(passedActiveReport(approved)?.evidenceHash, PASSED.evidenceHash);
  const before = stepStatuses(approved, context);
  assert.deepEqual([before.store[1], before.submit[1], before.approve[1], before.consume[1]], ['On-chain', 'Revision 1', 'Approved', 'Listed']);
  assert.equal(completion(approved, context)?.revision, '1');

  const again = recordCheck(approved, { choice: 'v1.0.0', report: FAILED, at: '2026-10-25T12:30:00.000Z' });
  assert.equal(again.active.reportHash, FAILED.evidenceHash, 'the failed check is the active report');
  assert.equal(again.active.status, 'failed');
  assert.equal(passedActiveReport(again), null, 'no passing report is selected behind a failed check');
  assert.equal(activeReport(again).evidenceHash, FAILED.evidenceHash);
  for (const key of REPORT_BOUND) assert.equal(again[key], null, `${key} belongs to the previous report`);
  const after = stepStatuses(again, context);
  assert.deepEqual([after.store, after.submit, after.approve, after.consume].map((row) => row[0]), ['locked', 'locked', 'locked', 'locked']);
  assert.equal(completion(again, context), null);
  assert.equal(again.history.length, 1);
  assert.deepEqual(Object.keys(again.history[0].stages).sort(), ['approve', 'check', 'consume', 'recheck', 'store', 'submit'], 'the earlier check report is history too');
  assert.equal(again.history[0].active.reportHash, PASSED.evidenceHash, 'the history says which report the receipts belonged to');
  assert.match(again.history[0].reason, /new check .*failed/);
});

test('importing report B after report A was approved never shows B approved; A stays as history with its receipts', () => {
  const approved = approvedSession();
  const plan = PASSED_B.input;
  const imported = recordImport(approved, { plan, report: PASSED_B, at: '2026-10-25T13:00:00.000Z' });
  assert.equal(imported.active.reportHash, PASSED_B.evidenceHash);
  assert.equal(imported.active.source, 'import');
  assert.equal(imported.check.choice, 'own');
  assert.deepEqual(imported.check.custom.plan, plan);
  assert.equal(activePlan(imported).listing.address, plan.listing.address);
  assert.equal(imported.approve, null);
  assert.equal(imported.submit, null);
  assert.equal(imported.recheck, null, 'the earlier recheck belonged to the earlier lifecycle');
  const statuses = stepStatuses(imported, context);
  assert.deepEqual([statuses.store[1], statuses.submit[1], statuses.approve[1], statuses.consume[1]], ['Wallet', 'Wallet', 'After Submit', 'After Approve']);
  assert.equal(completion(imported, context), null, 'B is not approved by A\'s approval');
  assert.equal(imported.history.at(-1).stages.approve.reportHash, `0x${PASSED.evidenceHash}`);
  // Reload: the same session read back gives the same answers.
  const reloaded = migrateSession(JSON.parse(JSON.stringify(imported)));
  assert.equal(reloaded.schema, SESSION_SCHEMA);
  assert.equal(completion(reloaded, context), null);
  assert.equal(stepStatuses(reloaded, context).approve[1], 'After Submit');
});

test('a late answer that names another report is history, not the current stage; an answer that names the active report applies', () => {
  const session = recordImport(approvedSession(), { plan: PASSED_B.input, report: PASSED_B, at: T });
  const lateStore = applyStage(session, 'store', { reportHash: PASSED.evidenceHash, bytes: 1, contentHash: '0x', tx: tx(1) });
  assert.equal(lateStore.store, null, 'the store answer for report A does not complete report B');
  assert.match(lateStore.history.at(-1).reason, /store answered for report cbd78faa85f8/);
  const lateApprove = applyStage(session, 'approve', { releaseId: RELEASE, approved: true, reportHash: `0x${PASSED.evidenceHash}`, revision: '2', reviewer: OWNER, tx: tx(2) });
  assert.equal(lateApprove.approve, null);
  assert.equal(completion(lateApprove, context), null);
  const applied = applyStage(session, 'store', { reportHash: PASSED_B.evidenceHash, bytes: 1, contentHash: '0x', tx: tx(3) });
  assert.equal(applied.store.tx.blockNumber, '3');
  const updated = applyStage(applied, 'store', (value) => ({ ...value, retrieved: { verified: true } }));
  assert.equal(updated.store.retrieved.verified, true, 'an updater over the current stage applies');
  assert.equal(stepStatuses(updated, context).store[1], 'On-chain');
  const orphanWithoutActive = applyStage(emptySession(DEMO_PROJECT), 'promote', { from: PASSED.evidenceHash, report: PASSED });
  assert.equal(orphanWithoutActive.promote, null);
  assert.match(orphanWithoutActive.history[0].reason, /no report was active/);
  assert.throws(() => applyStage(session, 'check', {}), /recordCheck/);
  assert.throws(() => applyStage(session, 'nope', {}), /Unknown stage/);
});

test('an approval is current only for the active submission\'s release and the registry\'s current revision; otherwise it is history', () => {
  const approved = approvedSession();
  const otherRelease = applyStage(approved, 'approve', { releaseId: `0x${'77'.repeat(32)}`, approved: true, reportHash: `0x${PASSED.evidenceHash}`, revision: '4', reviewer: OWNER, tx: tx(5) });
  assert.equal(stepStatuses(otherRelease, context).approve[1], 'Historical', 'a decision pasted for another release does not approve this submission');
  assert.equal(completion(otherRelease, context), null);
  const superseded = stepStatuses(approved, { ...context, registry: { release: { exists: true, revision: '2', reportHash: `0x${PASSED_B.evidenceHash}` } } });
  assert.equal(superseded.approve[1], 'Historical', 'the registry moved on to revision 2');
  assert.equal(superseded.consume[1], 'Historical');
  assert.equal(completion(approved, { ...context, registry: { release: { exists: true, revision: '2', reportHash: `0x${PASSED_B.evidenceHash}` } } }), null);
  const current = stepStatuses(approved, { ...context, registry: { release: { exists: true, revision: '1', reportHash: `0x${PASSED.evidenceHash}` } } });
  assert.equal(current.approve[1], 'Approved');
  assert.equal(current.consume[1], 'Listed');
  const rows = ledgerRows(approved);
  assert.deepEqual(rows.map((row) => row.key), ['check', 'recheck', 'store', 'submit', 'approve', 'consume']);
  assert.ok(rows.every((row) => row.active));
});

test('the earlier flat session migrates: the latest report is active, stages that name it are kept, everything else is history', () => {
  const legacy = {
    check: { choice: 'v1.0.0', custom: { symbol: 'pUSD' }, report: FAILED },
    recheck: { choice: 'v1.0.1', report: PASSED, comparison: { baselineHash: FAILED.evidenceHash } },
    store: { reportHash: PASSED.evidenceHash, bytes: 1, contentHash: '0x', tx: tx(1) },
    submit: { label: 'pusd-token-list', releaseId: RELEASE, reportHash: PASSED.evidenceHash, tx: tx(2) },
    approve: { releaseId: RELEASE, approved: true, reportHash: `0x${PASSED.evidenceHash}`, revision: '1', reviewer: OWNER, tx: tx(3) },
    remark: { decision: 'accepted', tx: tx(4) },                                        // no report named: history
    promote: { from: FAILED.evidenceHash, report: FAILED },                           // another report: history
    verified: { verified: true, reportHash: PASSED.evidenceHash, decision: 'accepted' },
  };
  const session = migrateSession(legacy, DEMO_PROJECT, { at: T });
  assert.equal(session.schema, SESSION_SCHEMA);
  assert.equal(session.active.reportHash, PASSED.evidenceHash);
  assert.equal(session.active.migrated, true);
  assert.equal(session.store.tx.blockNumber, '1');
  assert.equal(session.approve.revision, '1');
  assert.equal(session.remark, null);
  assert.equal(session.promote, null);
  assert.equal(session.verified.verified, true, 'a lookup result is not a receipt and is kept');
  assert.equal(session.history.length, 2);
  assert.match(session.history[0].reason, /remark .* named no report/);
  assert.match(session.history[1].reason, /promote .* named report 7f01ed85594c/);
  assert.equal(stepStatuses(session, context).approve[1], 'Approved');
  // The failed check as the latest report: nothing from the passed one speaks.
  const failedLast = migrateSession({ check: { choice: 'v1.0.1', report: PASSED }, recheck: { choice: 'v1.0.0', report: { ...FAILED, completedAt: '2026-10-26T00:00:00.000Z', evidenceHash: FAILED.evidenceHash } }, submit: legacy.submit, approve: legacy.approve }, DEMO_PROJECT, { at: T });
  assert.equal(failedLast.active.reportHash, FAILED.evidenceHash);
  assert.equal(failedLast.submit, null);
  assert.equal(failedLast.approve, null);
  assert.equal(passedActiveReport(failedLast), null);
  // An own-plan legacy session becomes its own project.
  const own = migrateSession({ check: { choice: 'own', custom: { plan: PASSED_B.input }, report: PASSED_B } }, DEMO_PROJECT, { at: T });
  assert.equal(own.project.kind, 'own');
  assert.equal(own.project.name, PASSED_B.input.name);
  assert.equal(migrateSession(null).active, null);
});

test('the browser store keeps one session per project and migrates the legacy key once', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  storage.setItem(LEGACY_KEY, JSON.stringify({ check: { choice: 'v1.0.0', report: FAILED }, recheck: { choice: 'v1.0.1', report: PASSED }, approve: { releaseId: RELEASE, approved: true, reportHash: `0x${PASSED.evidenceHash}`, revision: '1', tx: tx(3) } }));
  const store = loadStudioStore({ storage, at: T });
  assert.equal(store.activeProjectId, DEMO_PROJECT.id);
  assert.equal(memory.has(LEGACY_KEY), false, 'the legacy session is consumed');
  assert.equal(store.migratedFrom.key, LEGACY_KEY);
  const demo = sessionFor(store, DEMO_PROJECT);
  assert.equal(demo.active.reportHash, PASSED.evidenceHash);
  assert.equal(demo.approve.revision, '1');
  const own = sessionFor(store, { id: 'own-my-list', name: 'My list', kind: 'own', plan: PASSED_B.input });
  assert.equal(own.active, null, 'another project starts empty; nothing of the demo leaks into it');
  const next = withSession(store, recordImport(own, { plan: PASSED_B.input, report: PASSED_B, at: T }));
  saveStudioStore(next, { storage });
  const reread = loadStudioStore({ storage, at: T });
  assert.equal(reread.sessions['own-my-list'].active.reportHash, PASSED_B.evidenceHash);
  assert.equal(reread.sessions[DEMO_PROJECT.id].active.reportHash, PASSED.evidenceHash, 'the demo session is untouched by the other project');
  assert.equal(JSON.parse(memory.get(STORE_KEY)).schema, 'revivecheck.studio-store.v1');
});
