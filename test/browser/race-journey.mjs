#!/usr/bin/env node
// The browser journey behind repair handoff 2026-10-26, R-05: a check started in project
// Alpha whose answer arrives after the visitor switched to project Beta lands in Alpha's
// session, while Beta's report, record and badges are byte-for-byte unchanged; a second
// check started in Alpha after the first supersedes it, so the earlier answer is
// discarded; a reload restores nothing superseded. The race window is the check's own
// latency on the public nodes (tens of seconds through both interfaces) against a project
// switch that takes about a second; the ordering is asserted from timestamps (the switch
// happened before the report was sealed), never assumed, and `--delay <ms>` can hold the
// first EVM RPC answer of each check back further (0 by default: the checker bounds each
// read, so a long artificial delay fails the check instead of delaying it). Needs a
// browser, a served build and the public testnet nodes.
//
//   node test/browser/race-journey.mjs [--site http://127.0.0.1:4183/] [--session race] [--out <file>]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, loadProjects, withProject, selectProject, studioProject, PROJECTS_KEY } from '../../src/projects.js';
import { emptySession, recordImport, STORE_KEY, STORE_SCHEMA } from '../../src/studio-state.js';
import { ownPlanFromForm } from '../../src/own-plan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const SITE = option('--site', 'http://127.0.0.1:4183/').replace(/\/?$/, '/');
const SESSION = option('--session', 'race');
const OUT = option('--out', null);
const DELAY_MS = Number(option('--delay', '0'));
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const PASSED_A = readJson('public/reports/cbd78faa85f8759860d88366794e0c70052b74f9ed775be5bb37ad20118ed427.json');
const T = '2026-10-26T09:00:00.000Z';
const observations = [];
const scratch = mkdtempSync(path.join(tmpdir(), 'revivecheck-race-'));
function cli(...parts) { const result = spawnSync('playwright-cli', ['-s', SESSION, ...parts], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); if (result.status !== 0) throw new Error(`playwright-cli ${parts[0]} failed: ${(result.stderr || result.stdout).slice(0, 600)}`); return result.stdout; }
const evaluate = (js) => { const out = cli('--raw', 'eval', js).trim(); try { return JSON.parse(out); } catch { return out; } };
const json = (js) => JSON.parse(evaluate(`JSON.stringify((() => { ${js} })())`) || 'null');
async function waitFor(label, js, timeoutMs = 240_000) { const started = Date.now(); for (;;) { const value = json(js); if (value) return value; if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 2000)); } }
function runCode(body) { const file = path.join(scratch, `code-${Date.now()}-${Math.random().toString(36).slice(2)}.js`); writeFileSync(file, body); return cli('run-code', `--filename=${file}`); }
const assert = (condition, message, detail) => { observations.push({ ok: !!condition, message, ...(detail !== undefined ? { detail } : {}) }); if (!condition) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); };
const sessionOf = (id) => json(`const store = JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEY)}) || 'null'); const session = store?.sessions?.[${JSON.stringify(id)}] ?? null; return session ? { active: session.active?.reportHash ?? null, startedAt: session.check?.report?.startedAt ?? null, history: session.history?.length ?? 0, json: JSON.stringify(session) } : null;`);
const recordOf = (id) => evaluate(`JSON.stringify(JSON.parse(localStorage.getItem(${JSON.stringify(PROJECTS_KEY)})).projects[${JSON.stringify(id)}])`);
const screen = () => json(`return { project: document.querySelector('.project-select')?.value ?? null, active: document.querySelector('.ledger-active .mono')?.textContent ?? null, busy: !!document.querySelector('.working'), badges: Object.fromEntries(['check','store','submit','approve'].map((id) => [id, document.querySelector('.step-link[href="#/app/run/' + id + '"] .badge')?.textContent ?? null])) };`);

// The seed: Alpha (empty session, active) and Beta (report A active), two browser-local projects on the same asset.
const form = (projectName) => ({ projectName, logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' });
const alpha = createProject({ name: 'Alpha list', plan: ownPlanFromForm(form('Alpha list')), at: T });
const beta = createProject({ name: 'Beta list', plan: ownPlanFromForm(form('Beta list')), at: T });
const memory = new Map();
const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
const projects = selectProject(withProject(withProject(loadProjects({ storage }), alpha), beta), alpha.id);
const studio = { schema: STORE_SCHEMA, activeProjectId: alpha.id, sessions: { [beta.id]: recordImport(emptySession(studioProject(beta)), { plan: beta.plan, report: PASSED_A, at: T }) } };

try {
  cli('open', `${SITE}#/app/run/check`);
  runCode(`async page => { await page.evaluate(([projects, studio]) => { localStorage.clear(); localStorage.setItem(${JSON.stringify(PROJECTS_KEY)}, projects); localStorage.setItem(${JSON.stringify(STORE_KEY)}, studio); }, ${JSON.stringify([JSON.stringify(projects), JSON.stringify(studio)])}); await page.reload(); }`);
  await waitFor('the studio on Alpha', `return document.querySelector('.project-select')?.value === ${JSON.stringify(alpha.id)} && [...document.querySelectorAll('button')].some((item) => item.textContent === 'Run the check') ? 1 : 0;`, 30_000);
  // Delay every EVM RPC answer: the check cannot finish before the visitor has switched projects.
  if (DELAY_MS > 0) runCode(`async page => { let pending = 0; await page.route((url) => url.href.startsWith('https://test-evm-rpc-v3.portaldot.dev'), async (route) => { const first = pending === 0; pending += 1; if (first) { await new Promise((resolve) => setTimeout(resolve, ${DELAY_MS})); } await route.continue(); if (first) setTimeout(() => { pending = 0; }, ${DELAY_MS}); }); }`);
  const betaBefore = { session: sessionOf(beta.id), record: recordOf(beta.id) };
  // R05-A: start Alpha's check, switch to Beta while it runs.
  cli('click', "getByRole('button', { name: 'Run the check' })");
  runCode(`async page => { await page.selectOption('.project-select', ${JSON.stringify(beta.id)}); }`);
  const switchedAt = new Date().toISOString();
  const onBeta = await waitFor('Beta on screen', `return document.querySelector('.project-select')?.value === ${JSON.stringify(beta.id)} ? 1 : 0;`, 15_000);
  assert(onBeta === 1 && screen().active?.startsWith(PASSED_A.evidenceHash.slice(0, 6)), 'Beta is on screen with its own report while Alpha\'s check is in flight', screen());
  const alphaAnswer = await waitFor('Alpha\'s answer in the store', `const store = JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEY)}) || 'null'); const session = store?.sessions?.[${JSON.stringify(alpha.id)}]; return session?.active?.reportHash ? { hash: session.active.reportHash, startedAt: session.check.report.startedAt, completedAt: session.check.report.completedAt } : null;`);
  assert(Date.parse(alphaAnswer.completedAt) > Date.parse(switchedAt), 'the report was sealed after the switch: the answer really arrived late', { switchedAt, completedAt: alphaAnswer.completedAt });
  const betaAfter = { session: sessionOf(beta.id), record: recordOf(beta.id), screen: screen() };
  assert(betaAfter.session.json === betaBefore.session.json, 'R05-A: Beta\'s stored session is byte-for-byte unchanged by Alpha\'s late answer', { before: betaBefore.session.active, after: betaAfter.session.active });
  assert(betaAfter.record === betaBefore.record, 'R05-A: Beta\'s project record is unchanged', JSON.parse(betaAfter.record).reports);
  assert(betaAfter.screen.project === beta.id && betaAfter.screen.active?.startsWith(PASSED_A.evidenceHash.slice(0, 6)) && betaAfter.screen.badges.store === 'Wallet', 'R05-A: the screen still shows Beta\'s report and badges', betaAfter.screen);
  assert(/^[a-f0-9]{64}$/.test(alphaAnswer.hash) && alphaAnswer.hash !== PASSED_A.evidenceHash, 'Alpha\'s session holds the answer of the check it started', alphaAnswer);
  const alphaRecord = JSON.parse(recordOf(alpha.id));
  assert(alphaRecord.reports.some((item) => item.reportHash === alphaAnswer.hash), 'Alpha\'s record notes its report', alphaRecord.reports.map((item) => item.reportHash.slice(0, 12)));
  runCode(`async page => { await page.selectOption('.project-select', ${JSON.stringify(alpha.id)}); }`);
  await waitFor('Alpha on screen', `return document.querySelector('.project-select')?.value === ${JSON.stringify(alpha.id)} && document.querySelector('.ledger-active .mono')?.textContent.startsWith(${JSON.stringify(alphaAnswer.hash.slice(0, 6))}) ? 1 : 0;`, 15_000);
  // R05-B: two checks in Alpha; the second starts while the first (delayed) is in flight by remounting the step through a project switch and back; the earlier answer is discarded.
  cli('click', "getByRole('button', { name: 'Check again' })");
  runCode(`async page => { await page.selectOption('.project-select', ${JSON.stringify(beta.id)}); await page.selectOption('.project-select', ${JSON.stringify(alpha.id)}); }`);
  await waitFor('Alpha again', `return document.querySelector('.project-select')?.value === ${JSON.stringify(alpha.id)} && !document.querySelector('.working') ? 1 : 0;`, 15_000);
  const secondStart = new Date().toISOString();
  cli('click', "getByRole('button', { name: 'Check again' })");
  const settled = await waitFor('both answers', `const store = JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEY)}) || 'null'); const session = store?.sessions?.[${JSON.stringify(alpha.id)}]; return session?.active?.reportHash && session.active.reportHash !== ${JSON.stringify(alphaAnswer.hash)} && !document.querySelector('.working') ? { hash: session.active.reportHash, startedAt: session.check.report.startedAt, history: session.history.length, archivedChecks: session.history.filter((entry) => entry.stages.check).length } : null;`);
  // The first of the two checks started earlier; wait until the clock has passed the point where its answer, had it been applied, would show (its own latency), then look again.
  await waitFor('the earlier check to have had time to settle', `return 1;`, 1_000).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  const final = sessionOf(alpha.id);
  assert(final.active === settled.hash && Date.parse(final.startedAt) >= Date.parse(secondStart) - 2000, 'R05-B: the latest-started check is the active report', { final: final.active, settled: settled.hash, startedAt: final.startedAt, secondStart });
  assert(final.history === 1, 'R05-B: exactly one earlier report is history (the first answer); the superseded second-run answer was discarded, not archived', { history: final.history });
  // R05-C: a reload restores nothing superseded.
  runCode(`async page => { ${DELAY_MS > 0 ? "await page.unroute((url) => url.href.startsWith('https://test-evm-rpc-v3.portaldot.dev'));" : ''} await page.reload(); }`);
  await waitFor('the studio after reload', `return document.querySelector('.ledger-active') ? 1 : 0;`, 30_000);
  const reloaded = { alpha: sessionOf(alpha.id), beta: sessionOf(beta.id), screen: screen() };
  assert(reloaded.alpha.active === settled.hash && reloaded.beta.json === betaBefore.session.json && reloaded.screen.active?.startsWith(settled.hash.slice(0, 6)), 'R05-C: after a reload Alpha shows the latest answer and Beta is still untouched', { alpha: reloaded.alpha.active, screen: reloaded.screen.active });
  const consoleOut = cli('console', 'error');
  const errorCount = Number((consoleOut.match(/Errors: (\d+)/) || [])[1] ?? NaN);
  assert(errorCount === 0, 'no console errors during the journey', consoleOut.split('\n').filter((line) => line.trim()).slice(0, 6));
  const result = { ok: true, site: SITE, at: new Date().toISOString(), alpha: alpha.id, beta: beta.id, delayMs: DELAY_MS, answers: { first: alphaAnswer.hash, latest: settled.hash }, observations };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  let consoleTail = null;
  try { consoleTail = cli('console').split('\n').filter((line) => line.trim()).slice(-20); } catch { consoleTail = null; }
  console.log(JSON.stringify({ ok: false, error: error.message, observations, consoleTail }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: false, error: error.message, observations, consoleTail }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  spawnSync('playwright-cli', ['-s', SESSION, 'close'], { encoding: 'utf8' });
}
