import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStudioRequests } from '../src/studio-requests.js';
import { readStudio, activateProject } from '../src/studio-store.js';
import { loadStudioStore, sessionFor, activeReport, clearSession, saveStudioStore, withSession, recordImport, emptySession } from '../src/studio-state.js';
import { loadProjects, saveProjects, withProject, selectProject, createProject, studioProject } from '../src/projects.js';
import { ownPlanFromForm } from '../src/own-plan.js';

// Repair follow-up 2026-10-26, R-05: the studio's read requests are owned above any mount
// of the studio page. Leaving the studio (unmount) and opening it again (a new mount with
// its own state) neither revives an older read nor loses a newer one: a read deferred
// across the remount is discarded when a newer request of the new mount, or a reset
// there, superseded it, and is applied to the new mount when it is still the latest; a
// finalized write receipt arriving after navigation belongs to its origin and is retained
// once; nothing is sent again. Two "mounts" are simulated with the real owner and store
// functions on an injectable storage; the answers are controllable promises.
const load = (hash) => readFile(new URL(`../public/reports/${hash}.json`, import.meta.url), 'utf8').then(JSON.parse);
const PASSED_A = await load('cbd78faa85f8759860d88366794e0c70052b74f9ed775be5bb37ad20118ed427');    // v1.0.1, 6 decimals, passed, 2026-10-23
const PASSED_B = await load('1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51');    // v1.0.1, 6 decimals, passed, 2026-10-25
const OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const RELEASE = '0x28ab8a86a4d1ca4f5b38784d8f0a32c14ed163ae7f1ff9f4f5b5128fe5fdd927';
const T = '2026-10-26T12:00:00.000Z';
const tx = (block, byte = '11') => ({ route: 'native', extrinsicHash: `0x${byte.repeat(32)}`, blockHash: `0x${'22'.repeat(32)}`, blockNumber: String(block), success: true });
const memoryStorage = () => { const memory = new Map(); return { getItem: (key) => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) }; };
const deferred = () => { let resolve; const promise = new Promise((res) => { resolve = res; }); return { promise, resolve }; };
const form = (projectName) => ({ projectName, logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' });
const storedSession = (storage, project) => sessionFor(loadStudioStore({ storage }), studioProject(project));

/** Alpha (empty session, active) and Beta (report A active). */
function twoProjects(storage) {
  const alpha = createProject({ name: 'Alpha list', plan: ownPlanFromForm(form('Alpha list')), at: T });
  const beta = createProject({ name: 'Beta list', plan: ownPlanFromForm(form('Beta list')), at: T });
  saveProjects(selectProject(withProject(withProject(loadProjects({ storage }), alpha), beta), alpha.id), { storage });
  saveStudioStore(withSession(loadStudioStore({ storage }), recordImport(emptySession(studioProject(beta)), { plan: beta.plan, report: PASSED_A, at: T })), { storage });
  return { alpha, beta };
}

/** One mount of the studio page, as `useStudio` runs it: state read from the store, refreshed by the owner's notifications while mounted, handlers bound to the active project at creation. */
function mount(requests, storage) {
  let state = readStudio({ storage });
  let mounted = true;
  const unsubscribe = requests.subscribe(({ projectId, applied }) => { if (mounted && applied && state.project.id === projectId) state = readStudio({ storage }); });
  return {
    get state() { return state; },
    begin: (key) => requests.begin(state.project.id, key),
    settle: (token, value) => requests.settle(token, value, { at: T }),
    apply: (key, value) => requests.apply(state.project.id, key, value, { at: T }),
    readback: (stage, extrinsicHash, patch) => requests.readback(state.project.id, stage, extrinsicHash, patch, { at: T }),
    reset: () => { requests.supersede(state.project.id); const cleared = clearSession(state.session, { at: T }); saveStudioStore(withSession(loadStudioStore({ storage }), cleared), { storage }); state = { ...state, session: cleared }; },
    switchProject: (id) => { activateProject(id, { storage }); state = readStudio({ storage }); },
    unmount: () => { mounted = false; unsubscribe(); },
  };
}

test('R05-G: a read deferred across an unmount and a remount cannot overwrite the newer answer of the new mount; the newer answer stays after a reload, whichever order they settle in', async () => {
  const storage = memoryStorage();
  const log = [];
  const requests = createStudioRequests({ storage, log: (line) => log.push(line) });
  const { alpha } = twoProjects(storage);
  const first = mount(requests, storage);
  const slow = deferred();
  const tokenA = first.begin('check');
  const answerA = slow.promise.then((report) => first.settle(tokenA, { choice: 'own', report }));
  first.unmount();                                                       // My projects is opened: the studio is gone
  const second = mount(requests, storage);                               // the studio is opened again: a new mount, the same owner
  assert.equal(second.state.session.active, null, 'the new mount starts from the stored session');
  const quick = deferred();
  const tokenB = second.begin('check');
  const answerB = quick.promise.then((report) => second.settle(tokenB, { choice: 'own', report }));
  assert.equal(tokenB.generation, tokenA.generation + 1, 'the new mount\'s request supersedes the old mount\'s');
  quick.resolve(PASSED_B);
  assert.equal((await answerB).applied, true);
  assert.equal(activeReport(second.state.session).evidenceHash, PASSED_B.evidenceHash, 'the new mount shows its answer');
  slow.resolve(PASSED_A);
  assert.deepEqual(await answerA, { applied: false, reason: 'superseded' }, 'the old mount\'s answer, settling later, is discarded');
  assert.equal(activeReport(second.state.session).evidenceHash, PASSED_B.evidenceHash, 'the screen keeps the newer answer');
  assert.equal(activeReport(storedSession(storage, alpha)).evidenceHash, PASSED_B.evidenceHash, 'so does the store');
  assert.equal(storedSession(storage, alpha).history.length, 0, 'the discarded answer is not history either');
  assert.equal(activeReport(readStudio({ storage }).session).evidenceHash, PASSED_B.evidenceHash, 'a reload shows the newer answer');
  assert.ok(log.some((line) => /request 1 .*discarded/.test(line)) && log.some((line) => /request 2 .*applied/.test(line)), log.join('\n'));
  // The other order: the old read settles first, then the new mount's; the new mount's still wins and the old one is still discarded (it was superseded when the new request began).
  const third = mount(requests, storage);
  const slowC = deferred();
  const tokenC = third.begin('check');
  const answerC = slowC.promise.then((report) => third.settle(tokenC, { choice: 'own', report }));
  third.unmount();
  const fourth = mount(requests, storage);
  const quickD = deferred();
  const tokenD = fourth.begin('check');
  const answerD = quickD.promise.then((report) => fourth.settle(tokenD, { choice: 'own', report }));
  slowC.resolve(PASSED_A);
  assert.equal((await answerC).applied, false);
  assert.equal(activeReport(fourth.state.session).evidenceHash, PASSED_B.evidenceHash, 'nothing changed on the screen');
  quickD.resolve(PASSED_A);
  assert.equal((await answerD).applied, true);
  assert.equal(activeReport(fourth.state.session).evidenceHash, PASSED_A.evidenceHash);
  assert.equal(storedSession(storage, alpha).history.length, 1, 'exactly the earlier applied answer is history');
});

test('R05-G: a reset in the new mount keeps the cleared session when the old mount\'s read settles afterwards, also after a reload', async () => {
  const storage = memoryStorage();
  const requests = createStudioRequests({ storage });
  const { alpha } = twoProjects(storage);
  const first = mount(requests, storage);
  first.apply('check', { choice: 'own', report: PASSED_A });
  const slow = deferred();
  const tokenA = first.begin('recheck');
  const answerA = slow.promise.then((value) => first.settle(tokenA, value));
  first.unmount();
  const second = mount(requests, storage);
  assert.equal(activeReport(second.state.session).evidenceHash, PASSED_A.evidenceHash);
  second.reset();
  assert.equal(second.state.session.active, null);
  slow.resolve({ choice: 'own', report: PASSED_B, comparison: { baselineHash: PASSED_A.evidenceHash } });
  assert.deepEqual(await answerA, { applied: false, reason: 'superseded' });
  assert.equal(second.state.session.active, null, 'the cleared session stays cleared on screen');
  assert.equal(storedSession(storage, alpha).active, null, 'and in the store');
  assert.equal(storedSession(storage, alpha).recheck, null);
  assert.equal(readStudio({ storage }).session.active, null, 'a reload restores nothing');
});

test('R05-G: an old mount\'s read that is still the latest request lands in the new mount, which shows it without having started it', async () => {
  const storage = memoryStorage();
  const requests = createStudioRequests({ storage });
  const { alpha } = twoProjects(storage);
  const first = mount(requests, storage);
  const slow = deferred();
  const tokenA = first.begin('check');
  const answerA = slow.promise.then((report) => first.settle(tokenA, { choice: 'own', report }));
  first.unmount();
  const second = mount(requests, storage);
  assert.equal(second.state.session.active, null);
  slow.resolve(PASSED_B);
  assert.equal((await answerA).applied, true, 'still the latest request of Alpha\'s check stage');
  assert.equal(activeReport(second.state.session).evidenceHash, PASSED_B.evidenceHash, 'the new mount was told and shows the answer');
  assert.equal(activeReport(storedSession(storage, alpha)).evidenceHash, PASSED_B.evidenceHash);
  // A later request in the new mount now supersedes it as usual.
  const tokenB = second.begin('check');
  assert.equal(requests.isCurrent(tokenA), false);
  assert.equal(requests.isCurrent(tokenB), true);
});

test('R05-G: a finalized write receipt and its readback arriving after navigation belong to their origin transaction and are retained once; an unrelated mount and project see nothing of them', () => {
  const storage = memoryStorage();
  const requests = createStudioRequests({ storage });
  const { alpha, beta } = twoProjects(storage);
  const first = mount(requests, storage);
  first.apply('check', { choice: 'own', report: PASSED_B });              // Alpha's active report is B
  const receipt = { label: 'alpha-list', releaseId: RELEASE, reportHash: PASSED_B.evidenceHash, from: '5GH8…', sender: OWNER, tx: tx(200100) };
  const landLater = () => first.apply('submit', receipt);                // the handler created in the first mount, for Alpha
  const readbackLater = () => first.readback('submit', receipt.tx.extrinsicHash, { readback: { release: { revision: '3', reportHash: `0x${PASSED_B.evidenceHash}` } } });
  first.unmount();
  const second = mount(requests, storage);
  second.switchProject(beta.id);                                         // Beta is on screen in the new mount
  const betaBefore = JSON.stringify(storedSession(storage, beta));
  landLater();
  readbackLater();
  assert.equal(JSON.stringify(storedSession(storage, beta)), betaBefore, 'Beta\'s session is byte-for-byte unchanged');
  assert.equal(activeReport(second.state.session).evidenceHash, PASSED_A.evidenceHash, 'the screen stays on Beta\'s report');
  const alphaSession = storedSession(storage, alpha);
  assert.equal(alphaSession.submit.tx.blockNumber, '200100', 'the receipt landed under Alpha');
  assert.equal(alphaSession.submit.readback.release.revision, '3', 'its readback is attached to its own transaction');
  const receipts = [alphaSession.submit, ...alphaSession.history.flatMap((entry) => Object.values(entry.stages))].filter((item) => item?.tx?.extrinsicHash === receipt.tx.extrinsicHash);
  assert.equal(receipts.length, 1, 'retained exactly once');
  const sends = new Set([alphaSession.submit, ...alphaSession.history.flatMap((entry) => Object.values(entry.stages))].map((item) => item?.tx?.extrinsicHash).filter(Boolean));
  assert.equal(sends.size, 1, 'one transaction was signed; navigation added none');
});
