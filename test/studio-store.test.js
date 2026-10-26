import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adoptReport, applyToProject, readStudio, activateProject } from '../src/studio-store.js';
import { createRequestFence, beginRequest, requestIsCurrent, supersedeRequests, READ_STAGES, loadStudioStore, sessionFor, activeReport, stepStatuses, completion, clearSession, saveStudioStore, withSession, recordImport, applyStage, emptySession } from '../src/studio-state.js';
import { loadProjects, saveProjects, withProject, selectProject, createProject, projectView, entryFor, planForCheck, studioProject, consumerConfigFor } from '../src/projects.js';
import { ownPlanFromForm } from '../src/own-plan.js';
import { NETWORKS } from '../lib/networks.js';

// Repair handoff 2026-10-26, R-02 and R-05, on the persisted stores with an injectable
// storage and controllable promises (no sleeps, no network): adopting a corrected report
// updates the existing project's current release content; an asynchronous answer lands in
// the session of the project it started in, whatever project is active when it arrives; a
// later request wins over an earlier one settling later; a reset discards in-flight reads;
// a finalized receipt is retained once under its origin; a readback attaches to its own
// transaction only; nothing is ever sent again by any of this.
const load = (hash) => readFile(new URL(`../public/reports/${hash}.json`, import.meta.url), 'utf8').then(JSON.parse);
const FAILED_18 = await load('7f01ed85594c47523d44ecf4f87c3e42da920bff9925a33f4cd6fc0686b1dc14');   // v1.0.0, 18 decimals, failed, 2026-10-23
const PASSED_A = await load('cbd78faa85f8759860d88366794e0c70052b74f9ed775be5bb37ad20118ed427');    // v1.0.1, 6 decimals, passed, 2026-10-23
const PASSED_B = await load('1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51');    // v1.0.1, 6 decimals, passed, 2026-10-25
const TESTNET = NETWORKS.testnet;
const V2 = { address: '0xedaf8a25bb583ad164a94191b762414277198df9', version: 2 };
const OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const RELEASE = '0x28ab8a86a4d1ca4f5b38784d8f0a32c14ed163ae7f1ff9f4f5b5128fe5fdd927';
const T = '2026-10-26T10:00:00.000Z';
const context = { network: TESTNET, consumer: V2 };
const tx = (block, byte = '11') => ({ route: 'native', extrinsicHash: `0x${byte.repeat(32)}`, blockHash: `0x${'22'.repeat(32)}`, blockNumber: String(block), success: true });
const memoryStorage = () => { const memory = new Map(); return { getItem: (key) => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const form = (projectName) => ({ projectName, logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' });

/** Two browser-local projects on the same asset: Alpha (empty session) and Beta (report A active); Alpha is the active project. */
function twoProjects(storage) {
  const alpha = createProject({ name: 'Alpha list', plan: ownPlanFromForm(form('Alpha list')), at: T });
  const beta = createProject({ name: 'Beta list', plan: ownPlanFromForm(form('Beta list')), at: T });
  saveProjects(selectProject(withProject(withProject(loadProjects({ storage }), alpha), beta), alpha.id), { storage });
  const studio = loadStudioStore({ storage });
  saveStudioStore(withSession(studio, recordImport(emptySession(studioProject(beta)), { plan: beta.plan, report: PASSED_A, at: T })), { storage });
  return { alpha, beta };
}

/** The studio hook's routing, as the page runs it: a fence per browser, answers routed to their origin, the screen following only the active project. */
function studio(storage) {
  const fence = createRequestFence();
  let state = readStudio({ storage });
  const route = (projectId, key, value) => { const result = applyToProject({ projectId, key, value, storage, at: T }); if (state.project.id === projectId) state = { ...state, project: result.project ?? state.project, session: result.session }; return result; };
  return {
    get state() { return state; },
    begin: (key) => beginRequest(fence, state.project.id, key),
    settle: (token, value) => READ_STAGES.includes(token.key) && !requestIsCurrent(fence, token) ? { applied: false, reason: 'superseded' } : { applied: true, ...route(token.projectId, token.key, value) },
    apply: (key, value, origin = state.project.id) => route(origin, key, value),
    readback: (stage, extrinsicHash, patch, origin = state.project.id) => route(origin, 'readback', { stage, extrinsicHash, patch }),
    switchProject: (id) => { activateProject(id, { storage }); state = readStudio({ storage }); },
    reset: () => { supersedeRequests(fence, state.project.id); const cleared = clearSession(state.session, { at: T }); saveStudioStore(withSession(loadStudioStore({ storage }), cleared), { storage }); state = { ...state, session: cleared }; },
    reload: () => { state = readStudio({ storage }); },
  };
}
const storedSession = (storage, project) => sessionFor(loadStudioStore({ storage }), studioProject(project));

test('R05-A: a check started in Alpha and answered after the switch to Beta lands in Alpha; Beta\'s report, record, badges and exports are unchanged', async () => {
  const storage = memoryStorage();
  const { alpha, beta } = twoProjects(storage);
  const page = studio(storage);
  assert.equal(page.state.project.id, alpha.id);
  const pending = deferred();
  const token = page.begin('check');
  const answered = pending.promise.then((report) => page.settle(token, { choice: 'own', custom: null, report }));
  page.switchProject(beta.id);
  const betaBefore = { session: JSON.stringify(storedSession(storage, beta)), record: JSON.stringify(loadProjects({ storage }).projects[beta.id]), badges: stepStatuses(page.state.session, context), entry: entryFor(loadProjects({ storage }).projects[beta.id]) };
  pending.resolve(PASSED_B);
  const outcome = await answered;
  assert.equal(outcome.applied, true, 'the answer is applied: to its origin');
  assert.equal(page.state.project.id, beta.id, 'the screen stays on Beta');
  assert.equal(activeReport(page.state.session).evidenceHash, PASSED_A.evidenceHash, 'the screen still shows Beta\'s report');
  assert.equal(JSON.stringify(storedSession(storage, beta)), betaBefore.session, 'Beta\'s stored session is byte-for-byte unchanged');
  assert.equal(JSON.stringify(loadProjects({ storage }).projects[beta.id]), betaBefore.record, 'Beta\'s project record is unchanged');
  assert.deepEqual(stepStatuses(page.state.session, context), betaBefore.badges);
  assert.deepEqual(entryFor(loadProjects({ storage }).projects[beta.id]), betaBefore.entry);
  const alphaSession = storedSession(storage, alpha);
  assert.equal(activeReport(alphaSession).evidenceHash, PASSED_B.evidenceHash, 'Alpha\'s session holds the answer');
  assert.equal(alphaSession.active.projectId, PASSED_B.projectId ?? null);
  assert.ok(loadProjects({ storage }).projects[alpha.id].reports.some((item) => item.reportHash === PASSED_B.evidenceHash), 'Alpha\'s record notes it');
  assert.ok(!loadProjects({ storage }).projects[beta.id].reports.some((item) => item.reportHash === PASSED_B.evidenceHash), 'Beta\'s record does not');
  page.switchProject(alpha.id);
  assert.equal(activeReport(page.state.session).evidenceHash, PASSED_B.evidenceHash, 'switching back shows Alpha\'s answer');
  assert.throws(() => consumerConfigFor(loadProjects({ storage }).projects[beta.id], projectView(loadProjects({ storage }).projects[beta.id], storedSession(storage, beta))), /reviewers\.trusted/, 'Beta\'s export is as incomplete as before, for its own reason');
});

test('R05-B, R05-C: of two checks in one project the latest-started wins whatever order they settle in; a reset discards in-flight answers; a reload restores nothing superseded', async () => {
  const storage = memoryStorage();
  const { alpha } = twoProjects(storage);
  const page = studio(storage);
  const first = deferred(), second = deferred();
  const token1 = page.begin('check');
  const answer1 = first.promise.then((report) => page.settle(token1, { choice: 'own', report }));
  const token2 = page.begin('check');
  const answer2 = second.promise.then((report) => page.settle(token2, { choice: 'own', report }));
  second.resolve(PASSED_B);
  assert.equal((await answer2).applied, true);
  first.resolve(PASSED_A);
  const late = await answer1;
  assert.deepEqual(late, { applied: false, reason: 'superseded' }, 'request 1 settling after request 2 is discarded');
  assert.equal(activeReport(page.state.session).evidenceHash, PASSED_B.evidenceHash);
  assert.equal(activeReport(storedSession(storage, alpha)).evidenceHash, PASSED_B.evidenceHash);
  assert.equal(storedSession(storage, alpha).history.length, 0, 'no history entry for the discarded answer');
  page.reload();
  assert.equal(activeReport(page.state.session).evidenceHash, PASSED_B.evidenceHash, 'a reload keeps request 2 active');
  // A reset while a check is in flight: the answer is discarded and the cleared session survives a reload.
  const third = deferred();
  const token3 = page.begin('recheck');
  const answer3 = third.promise.then((value) => page.settle(token3, value));
  page.reset();
  assert.equal(page.state.session.active, null);
  third.resolve({ choice: 'own', report: PASSED_A, comparison: { baselineHash: PASSED_B.evidenceHash } });
  assert.equal((await answer3).applied, false);
  page.reload();
  assert.equal(page.state.session.active, null, 'the superseded answer did not come back');
  assert.equal(storedSession(storage, alpha).recheck, null);
  // A read answer for a project that was switched away and back keeps its generation: still current, still applied.
  const token4 = page.begin('check');
  page.switchProject(twoProjects(storage).beta.id);
  page.switchProject(alpha.id);
  assert.equal(page.settle(token4, { choice: 'own', report: PASSED_A }).applied, true);
  assert.equal(activeReport(page.state.session).evidenceHash, PASSED_A.evidenceHash);
});

test('R05-D: a finalized receipt arriving after navigation is retained once under its origin and cannot approve the report of another project', () => {
  const storage = memoryStorage();
  const { alpha, beta } = twoProjects(storage);
  const page = studio(storage);
  page.apply('check', { choice: 'own', report: PASSED_B });              // Alpha's active report is B
  page.switchProject(beta.id);                                           // Beta (report A) is on screen
  const receipt = { label: 'alpha-list', releaseId: RELEASE, reportHash: PASSED_B.evidenceHash, from: '5GH8…', sender: OWNER, tx: tx(200100) };
  page.apply('submit', receipt, alpha.id);                               // the submit of Alpha's report settles now
  page.apply('approve', { releaseId: RELEASE, approved: true, reportHash: `0x${PASSED_B.evidenceHash}`, revision: '3', reviewer: OWNER, from: '5Dtq…', tx: tx(200120, '33') }, alpha.id);
  const betaSession = storedSession(storage, beta);
  assert.equal(betaSession.submit, null, 'nothing of Alpha\'s lifecycle in Beta');
  assert.equal(betaSession.approve, null);
  assert.equal(completion(page.state.session, context), null, 'Beta\'s report A is not approved by Alpha\'s approval');
  assert.equal(stepStatuses(page.state.session, context).approve[1], 'After Submit');
  const alphaSession = storedSession(storage, alpha);
  assert.equal(alphaSession.submit.tx.blockNumber, '200100');
  assert.equal(alphaSession.approve.revision, '3');
  assert.equal(completion(alphaSession, { ...context, registry: { release: { exists: true, revision: '3', reportHash: `0x${PASSED_B.evidenceHash}` } } })?.revision, '3', 'Alpha\'s own report is approved in Alpha');
  const receipts = [alphaSession.submit, ...alphaSession.history.flatMap((entry) => Object.values(entry.stages))].filter((item) => item?.tx?.extrinsicHash === receipt.tx.extrinsicHash);
  assert.equal(receipts.length, 1, 'the receipt is retained exactly once');
});

test('R05-F: a delayed readback stays attached to its own transaction when a later submission is active; a replaced receipt is history, never dropped, and no send count grows', () => {
  const storage = memoryStorage();
  const { alpha } = twoProjects(storage);
  const page = studio(storage);
  page.apply('check', { choice: 'own', report: PASSED_B });
  const tx1 = tx(200100, '41'), tx2 = tx(200130, '42');
  page.apply('submit', { label: 'alpha-list', releaseId: RELEASE, reportHash: PASSED_B.evidenceHash, from: '5GH8…', sender: OWNER, tx: tx1 });
  page.apply('submit', { label: 'alpha-list', releaseId: RELEASE, reportHash: PASSED_B.evidenceHash, from: '5GH8…', sender: OWNER, tx: tx2 });
  let session = storedSession(storage, alpha);
  assert.equal(session.submit.tx.extrinsicHash, tx2.extrinsicHash);
  assert.equal(session.history.length, 1, 'the first submission moved to the history');
  assert.match(session.history[0].reason, /replaced by a later submit/);
  assert.equal(session.history[0].stages.submit.tx.extrinsicHash, tx1.extrinsicHash);
  // The readback of transaction 1 arrives late: it attaches to transaction 1 in the history, never to transaction 2.
  page.readback('submit', tx1.extrinsicHash, { readback: { release: { revision: '3', reportHash: `0x${PASSED_B.evidenceHash}` } } });
  session = storedSession(storage, alpha);
  assert.equal(session.submit.readback, undefined, 'the current receipt (transaction 2) has no readback of transaction 1');
  assert.equal(session.history[0].stages.submit.readback.release.revision, '3', 'transaction 1 carries its readback, as history');
  // The readback of transaction 2 attaches to the current receipt.
  page.readback('submit', tx2.extrinsicHash, { readback: { release: { revision: '4', reportHash: `0x${PASSED_B.evidenceHash}` } } });
  session = storedSession(storage, alpha);
  assert.equal(session.submit.readback.release.revision, '4');
  // A readback for a transaction this session never recorded is an orphan with nothing attached.
  page.readback('submit', `0x${'43'.repeat(32)}`, { readback: { release: { revision: '9' } } });
  session = storedSession(storage, alpha);
  assert.equal(session.submit.readback.release.revision, '4', 'the current receipt is untouched');
  assert.match(session.history.at(-1).reason, /no matching receipt/);
  const sends = new Set([session.submit, ...session.history.flatMap((entry) => Object.values(entry.stages))].map((item) => item?.tx?.extrinsicHash).filter(Boolean));
  assert.equal(sends.size, 2, 'two transactions were signed by the visitor; navigation, timeouts and readbacks added none');
});

test('R02-A to R02-F: adopting the corrected 6-decimal report into the project created from the failed 18-decimal one updates its current plan and fingerprints, keeps everything else, inherits no approval, and refuses a mismatched pair', () => {
  const storage = memoryStorage();
  const name = 'My pUSD list';
  const first = adoptReport({ plan: FAILED_18.input, report: FAILED_18, projectName: name, at: T, storage });
  assert.equal(first.created, true);
  assert.equal(first.project.plan.listing.decimals, 18);
  assert.equal(first.project.releaseArtifactHash, FAILED_18.binding.releaseArtifactHash);
  // The same name and acceptance plan, corrected to 6 decimals: the same project, now describing 6.
  const second = adoptReport({ plan: PASSED_B.input, report: PASSED_B, projectName: name, at: '2026-10-26T10:05:00.000Z', storage });
  assert.equal(second.created, false);
  assert.equal(second.project.id, first.project.id, 'the same project identity');
  assert.equal(second.project.plan.listing.decimals, 6);
  assert.equal(second.project.planHash, first.project.planHash, 'the acceptance-plan fingerprint is stable across listing content');
  assert.equal(second.project.releaseArtifactHash, PASSED_B.binding.releaseArtifactHash, 'the release-artifact fingerprint follows the adopted listing');
  assert.notEqual(second.project.releaseArtifactHash, first.project.releaseArtifactHash);
  assert.equal(second.project.createdAt, first.project.createdAt);
  assert.deepEqual(second.project.reports.map((item) => item.reportHash), [FAILED_18.evidenceHash, PASSED_B.evidenceHash], 'both reports stay referenced, in order');
  assert.equal(activeReport(second.session).evidenceHash, PASSED_B.evidenceHash);
  assert.equal(second.session.history.length, 1, 'the failed check is history');
  assert.equal(second.session.history[0].stages.check.report.evidenceHash, FAILED_18.evidenceHash);
  // Every downstream default resolves from the updated project: the studio check and recheck plan, the entry, the session's own plan.
  const stored = loadProjects({ storage }).projects[second.project.id];
  assert.equal(stored.plan.listing.decimals, 6, 'the persisted record describes 6');
  const checked = [];
  const checker = (plan) => { checked.push(plan.listing.decimals); return PASSED_B; };
  checker(planForCheck(stored, 'own'));
  assert.deepEqual(checked, [6], 'the next check receives the corrected plan');
  assert.equal(entryFor(stored).decimals, 6, 'the exported entry is the corrected one');
  assert.equal(storedSession(storage, stored).project.plan.listing.decimals, 6, 'the session\'s project plan follows the record');
  assert.equal(readStudio({ storage }).project.id, stored.id, 'the project is active');
  // Adopting the same report again duplicates nothing.
  const again = adoptReport({ plan: PASSED_B.input, report: PASSED_B, projectName: name, at: '2026-10-26T10:06:00.000Z', storage });
  assert.equal(again.session.history.length, 1);
  assert.equal(again.project.reports.length, 2);
  assert.equal(activeReport(readStudio({ storage }).session).evidenceHash, PASSED_B.evidenceHash, 'a reload continues with the corrected report');
  // An approval of the earlier passed report does not reach the corrected one.
  const beforeApproval = adoptReport({ plan: PASSED_A.input, report: PASSED_A, projectName: 'Approved line', at: T, storage });
  const approvedSession = applyStage(applyStage(beforeApproval.session, 'submit', { label: 'approved-line', releaseId: RELEASE, reportHash: PASSED_A.evidenceHash, from: '5GH8…', sender: OWNER, tx: tx(1), readback: { release: { revision: '1', reportHash: `0x${PASSED_A.evidenceHash}` } } }, { at: T }), 'approve', { releaseId: RELEASE, approved: true, reportHash: `0x${PASSED_A.evidenceHash}`, revision: '1', reviewer: OWNER, from: '5Dtq…', tx: tx(2) }, { at: T });
  saveStudioStore(withSession(loadStudioStore({ storage }), approvedSession), { storage });
  assert.equal(completion(storedSession(storage, beforeApproval.project), context)?.revision, '1');
  const corrected = adoptReport({ plan: PASSED_B.input, report: PASSED_B, projectName: 'Approved line', at: '2026-10-26T10:07:00.000Z', storage });
  assert.equal(corrected.project.id, beforeApproval.project.id);
  assert.equal(completion(corrected.session, context), null, 'the corrected report inherits no approval');
  assert.equal(corrected.session.approve, null);
  assert.equal(corrected.session.history.at(-1).stages.approve.reportHash, `0x${PASSED_A.evidenceHash}`, 'the earlier approval stays as history of the earlier report');
  assert.equal(loadProjects({ storage }).projects[corrected.project.id].bindings.length, 0, 'no binding was created or moved');
  // A mismatched pair is refused: a plan the report did not describe (another listing, or another field such as the symbol).
  assert.throws(() => adoptReport({ plan: PASSED_B.input, report: FAILED_18, projectName: name, storage }), /not this listing/);
  assert.throws(() => adoptReport({ plan: { ...PASSED_B.input, listing: { ...PASSED_B.input.listing, symbol: 'PUSD' } }, report: PASSED_B, projectName: name, storage }), /not this listing/);
  assert.throws(() => adoptReport({ plan: PASSED_B.input, report: { ...PASSED_B, evidenceHash: 'ab'.repeat(32) }, projectName: name, storage }), /not an intact sealed report/);
  assert.equal(loadProjects({ storage }).projects[stored.id].plan.listing.decimals, 6, 'a refused adoption changes nothing');
});
