#!/usr/bin/env node
// The browser journey behind product plan 2026-10-25, D-01 and D-02: run against a built
// site in a fresh Chromium profile with playwright-cli (not part of `npm test`, because it
// needs a browser, a served build and the public testnet nodes).
//
//   node test/browser/studio-journey.mjs [--site http://127.0.0.1:4183/] [--session journey] [--out <file>]
//
// What it proves, in one browser, in order:
//   1. An earlier flat studio session in which report A (the recorded 2026-10-23 recheck,
//      cbd78faa…) was submitted and approved migrates: the studio shows A approved.
//   2. Check my token seals report B live and "Use this report in my project" makes B the
//      active report of a NEW browser-local project: B is not approved, nothing of A's
//      lifecycle appears, and no completion is shown.
//   3. Switching back to the demonstration project shows A approved again: the two
//      projects do not mix.
//   4. In the demonstration project, a new failed check (v1.0.0, 18 decimals) replaces
//      the active report: Store, Submit and Approve lock, the completion disappears, and
//      A's receipts are listed as history. A reload preserves all of it.
// Exit 0 only when every assertion holds; the observations are printed as JSON.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const SITE = option('--site', 'http://127.0.0.1:4183/').replace(/\/?$/, '/');
const SESSION = option('--session', 'journey');
const OUT = option('--out', null);
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const FAILED_A = readJson('public/reports/7f01ed85594c47523d44ecf4f87c3e42da920bff9925a33f4cd6fc0686b1dc14.json');
const PASSED_A = readJson('public/reports/cbd78faa85f8759860d88366794e0c70052b74f9ed775be5bb37ad20118ed427.json');
const RUN = readJson('public/lifecycle/studio-run.json');
const EVIDENCE = readJson('public/lifecycle/evidence.json');
const OWNER_SS58 = '5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt', OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const observations = [];
const scratch = mkdtempSync(path.join(tmpdir(), 'revivecheck-journey-'));

function cli(...parts) {
  const result = spawnSync('playwright-cli', ['-s', SESSION, ...parts], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`playwright-cli ${parts[0]} failed: ${(result.stderr || result.stdout).slice(0, 600)}`);
  return result.stdout;
}
// `--raw eval` prints the evaluated value JSON-encoded once more, so a string comes back quoted.
const evaluate = (js) => { const out = cli('--raw', 'eval', js).trim(); try { return JSON.parse(out); } catch { return out; } };
const json = (js) => JSON.parse(evaluate(`JSON.stringify((() => { ${js} })())`) || 'null');
async function waitFor(label, js, timeoutMs = 150_000) {
  const started = Date.now();
  for (;;) {
    const value = json(js);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
function runCode(body) { const file = path.join(scratch, `code-${Date.now()}.js`); writeFileSync(file, body); return cli('run-code', `--filename=${file}`); }
const assert = (condition, message, detail) => { observations.push({ ok: !!condition, message, ...(detail !== undefined ? { detail } : {}) }); if (!condition) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); };
const badge = (step) => evaluate(`document.querySelector('.step-link[href="#/app/run/${step}"] .badge')?.textContent`);
const state = () => json(`return { hash: location.hash, project: document.querySelector('.project-select')?.value ?? null, active: document.querySelector('.ledger-active .mono')?.textContent ?? null, completion: !!document.querySelector('.completion'), completionText: document.querySelector('.completion strong')?.textContent ?? null, history: document.querySelector('.ledger-history summary')?.textContent ?? null, badges: Object.fromEntries(['check','recheck','store','submit','approve','consume','promote','watch'].map((id) => [id, document.querySelector('.step-link[href="#/app/run/' + id + '"] .badge')?.textContent ?? null])) };`);

try {
  // 1. A fresh profile with the earlier flat session: report A checked (failed), rechecked (passed), stored, submitted and approved, from the recorded 2026-10-23 studio run.
  cli('open', `${SITE}#/app/run`);
  const stored = EVIDENCE.items.find((item) => item.reportHash === PASSED_A.evidenceHash);
  const legacy = {
    check: { choice: 'v1.0.0', custom: { symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6 }, report: FAILED_A },
    recheck: { choice: 'v1.0.1', custom: { symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6 }, report: PASSED_A, comparison: { baselineHash: FAILED_A.evidenceHash, candidateHash: PASSED_A.evidenceHash, compatible: true, comparisonKind: 'same-target', summary: { improved: 1, regressed: 0, unchanged: 3, changed: 0 }, changes: [], caveat: 'A changed check result records an observation difference, not proof of the cause or an application code fix.' } },
    store: { reportHash: PASSED_A.evidenceHash, bytes: stored.bytes, contentHash: stored.contentHash ?? '0x', tx: { route: 'native', extrinsicHash: stored.extrinsicHash, blockHash: stored.blockHash, blockNumber: String(stored.blockNumber), success: true }, retrieved: { verified: true, publisher: stored.publisher, blockNumber: String(stored.blockNumber) } },
    submit: { label: RUN.release.label, releaseId: RUN.release.releaseId, reportHash: PASSED_A.evidenceHash, from: OWNER_SS58, sender: OWNER, tx: { route: 'native', extrinsicHash: RUN.submit.extrinsicHash, blockHash: RUN.submit.blockHash, blockNumber: RUN.submit.blockNumber, success: true }, readback: { address: '0xe949b200edf070b9d425b206ed24dc8fe5b7d339', releaseId: RUN.release.releaseId, block: RUN.readback.block, release: { exists: true, owner: OWNER, revision: RUN.release.revision, reportHash: RUN.readback.reportHash }, interfacesAgree: true } },
    approve: { releaseId: RUN.release.releaseId, approved: true, reportHash: RUN.readback.reportHash, revision: RUN.release.revision, reviewer: RUN.approve.reviewer, from: OWNER_SS58, tx: { route: 'native', extrinsicHash: RUN.approve.extrinsicHash, blockHash: RUN.approve.blockHash, blockNumber: RUN.approve.blockNumber, success: true } },
  };
  runCode(`async page => { await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem('revivecheck.studio.v1', seed); }, ${JSON.stringify(JSON.stringify(legacy))}); await page.reload(); }`);
  await waitFor('the studio after migration', `return document.querySelector('.ledger-active') ? 1 : 0;`, 30_000);
  let seen = state();
  assert(seen.project === 'demo-pusd-token-list', 'the migrated session belongs to the demonstration project', seen.project);
  assert(seen.active?.startsWith(PASSED_A.evidenceHash.slice(0, 6)), 'report A (the passed recheck) is the active report after migration', seen.active);
  assert(seen.badges.approve === 'Approved' && seen.badges.submit === 'Revision 1' && seen.badges.store === 'On-chain', 'A is shown submitted, approved and stored', seen.badges);
  assert(seen.completion && /Revision 1 of “pusd-token-list” is approved on-chain/.test(seen.completionText), 'the completion banner names A', seen.completionText);
  assert(json(`return localStorage.getItem('revivecheck.studio.v1') === null ? 1 : 0;`) === 1, 'the earlier session key was consumed by the migration');

  // 2. Check my token: report B sealed live, then handed to a new project.
  cli('goto', `${SITE}#/app/check`);
  cli('click', "getByRole('button', { name: 'Fill with the pUSD example' })");
  cli('click', "getByRole('button', { name: 'Run the check' })");
  const reportB = await waitFor('the live check on Check my token', `const foot = document.querySelector('#own-result-title') && document.querySelector('.result-foot .mono'); return foot ? foot.getAttribute('title') : null;`);
  assert(/^[a-f0-9]{64}$/.test(reportB) && reportB !== PASSED_A.evidenceHash, 'report B is a new sealed report', reportB);
  const statusB = evaluate(`document.querySelector('#own-result-title ~ * .result-head .badge, .card .result-head .badge')?.textContent`);
  cli('click', "getByRole('button', { name: 'Use this report in my project' })");
  await waitFor('the studio of the new project', `return location.hash.startsWith('#/app/run') && document.querySelector('.project-select') && document.querySelector('.project-select').value.startsWith('own-') ? 1 : 0;`, 30_000);
  seen = state();
  assert(seen.project.startsWith('own-pusd-token-list-'), 'a browser-local project was created for the plan', seen.project);
  assert(seen.active?.startsWith(reportB.slice(0, 6)), 'report B is the active report of the new project', seen.active);
  assert(seen.badges.approve === 'After Submit' && seen.badges.submit === (statusB === 'Passed' ? 'Wallet' : 'Needs a pass') && seen.badges.consume === 'After Approve', 'B is not approved: no submission, no approval, nothing from A', seen.badges);
  assert(!seen.completion, 'no completion is shown for B', seen.completion);
  assert(seen.history === null, 'the new project has no history of its own', seen.history);

  // 3. Switching back to the demonstration project shows A approved again.
  runCode(`async page => { await page.selectOption('.project-select', 'demo-pusd-token-list'); }`);
  await waitFor('the demonstration project', `return document.querySelector('.project-select')?.value === 'demo-pusd-token-list' ? 1 : 0;`, 15_000);
  seen = state();
  assert(seen.active?.startsWith(PASSED_A.evidenceHash.slice(0, 6)) && seen.badges.approve === 'Approved' && seen.completion, 'the demonstration project still shows A approved; nothing of B appears', seen);

  // 4. A new failed check in the demonstration project replaces the active report.
  cli('goto', `${SITE}#/app/run/check`);
  cli('click', "getByRole('radio', { name: /v1\\.0\\.0/ })");
  cli('click', "getByRole('button', { name: 'Check again' })");
  const reportC = await waitFor('the live v1.0.0 check', `const active = document.querySelector('.ledger-active .mono'); return active && !active.textContent.startsWith('${PASSED_A.evidenceHash.slice(0, 6)}') ? active.textContent : null;`);
  seen = state();
  assert(seen.active === reportC && seen.badges.check === 'Failed', 'the new v1.0.0 check failed and is the active report', seen.badges);
  assert(seen.badges.store === 'Needs a pass' && seen.badges.submit === 'Needs a pass' && seen.badges.approve === 'After Submit' && seen.badges.consume === 'After Approve', 'nothing falls back to A: the write steps are locked behind the failed active report', seen.badges);
  assert(!seen.completion, 'the completion banner is gone', seen.completion);
  assert(/History · 1 earlier entry/.test(seen.history || ''), "A's receipts are listed as history", seen.history);
  cli('goto', `${SITE}#/app/run/submit`);
  const submitLock = await waitFor('the Submit step', `return location.hash === '#/app/run/submit' && document.querySelector('.locked p') ? document.querySelector('.locked p').textContent : null;`, 15_000);
  assert(/did not pass, and no earlier report is used in its place/.test(submitLock || ''), 'the Submit step says why it is locked', submitLock);
  // Reload: the same answers.
  runCode(`async page => { await page.reload(); }`);
  await waitFor('the studio after reload', `return document.querySelector('.ledger-active') ? 1 : 0;`, 30_000);
  const after = state();
  assert(after.active === reportC && after.badges.approve === 'After Submit' && !after.completion && /1 earlier entry/.test(after.history || ''), 'a reload preserves the active report, the locks and the history', after);
  const consoleOut = cli('console', 'error');
  const errorCount = Number((consoleOut.match(/Errors: (\d+)/) || [])[1] ?? NaN);
  assert(errorCount === 0, 'no console errors during the journey', consoleOut.split('\n').filter((line) => line.trim()).slice(0, 6));
  const stores = json(`const store = JSON.parse(localStorage.getItem('revivecheck.studio.v2')); const projects = JSON.parse(localStorage.getItem('revivecheck.projects.v1')); return { sessions: Object.keys(store.sessions), projects: Object.keys(projects.projects), active: projects.activeProjectId };`);
  assert(stores.sessions.length === 2 && stores.projects.length === 2, 'two projects, two separate sessions', stores);
  console.log(JSON.stringify({ ok: true, site: SITE, at: new Date().toISOString(), reportA: PASSED_A.evidenceHash, reportB, reportC, observations, stores }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: true, site: SITE, at: new Date().toISOString(), reportA: PASSED_A.evidenceHash, reportB, reportC, observations, stores }, null, 2)}\n`);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, observations }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: false, error: error.message, observations }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  spawnSync('playwright-cli', ['-s', SESSION, 'close'], { encoding: 'utf8' });
}
