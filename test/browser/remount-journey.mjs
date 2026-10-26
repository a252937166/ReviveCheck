#!/usr/bin/env node
// The browser journey behind the repair follow-up of 2026-10-26, R-05: a check started
// in the studio keeps running while the visitor leaves for My projects (the studio page
// unmounts) and opens the studio again (a new mount). A newer check started there wins
// over the older one whatever order their answers arrive in: the older answer is
// discarded at settlement, never archived, and a reload keeps the newer one. A session
// cleared in the new mount while the older check is still running stays cleared when its
// answer arrives. The page reports every applied or discarded answer on the console
// (request number, project, hash), which is how the journey knows that the older answer
// really arrived and was discarded rather than lost. Leaving and returning takes several
// seconds and a check on a warm node can finish sooner, so the FIRST EVM RPC answer of
// the older check is held back (`--hold <ms>`, 25 s by default; the checker bounds each
// read at 60 s and the run at 75 s) until the newer check has started; when the older
// answer nevertheless arrives before the newer check starts, the race was not exercised
// and the journey fails saying so, instead of passing on a case it did not test. Needs a
// browser, a served build and the public testnet nodes.
//
//   node test/browser/remount-journey.mjs [--site http://127.0.0.1:4183/] [--session remount] [--hold 25000] [--out <file>]
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProject, loadProjects, withProject, selectProject, PROJECTS_KEY } from '../../src/projects.js';
import { STORE_KEY, STORE_SCHEMA } from '../../src/studio-state.js';
import { ownPlanFromForm } from '../../src/own-plan.js';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const SITE = option('--site', 'http://127.0.0.1:4183/').replace(/\/?$/, '/');
const SESSION = option('--session', 'remount');
const OUT = option('--out', null);
const HOLD_MS = Number(option('--hold', '25000'));
// Every CLI command is bounded: one that never returns (a stuck browser operation) ends the journey with a named failure and the observations so far.
const CLI_TIMEOUT_MS = 120_000;
const T = '2026-10-26T12:00:00.000Z';
const observations = [];
const scratch = mkdtempSync(path.join(tmpdir(), 'revivecheck-remount-'));
function cli(...parts) {
  const result = spawnSync('playwright-cli', ['-s', SESSION, ...parts], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: CLI_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.error) throw new Error(`playwright-cli ${parts[0]} ${result.error.code === 'ETIMEDOUT' ? `did not return within ${CLI_TIMEOUT_MS / 1000} s and was killed` : `could not run: ${result.error.message}`}`);
  if (result.status !== 0) throw new Error(`playwright-cli ${parts[0]} failed: ${(result.stderr || result.stdout).slice(0, 600)}`);
  return result.stdout;
}
const evaluate = (js) => { const out = cli('--raw', 'eval', js).trim(); try { return JSON.parse(out); } catch { return out; } };
const json = (js) => JSON.parse(evaluate(`JSON.stringify((() => { ${js} })())`) || 'null');
async function waitFor(label, js, timeoutMs = 240_000) { const started = Date.now(); for (;;) { const value = json(js); if (value) return value; if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 2000)); } }
function runCode(body) { const file = path.join(scratch, `code-${Date.now()}-${Math.random().toString(36).slice(2)}.js`); writeFileSync(file, body); return cli('run-code', `--filename=${file}`); }
const assert = (condition, message, detail) => { observations.push({ ok: !!condition, message, ...(detail !== undefined ? { detail } : {}) }); if (!condition) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); };
const sessionOf = (id) => json(`const store = JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEY)}) || 'null'); const session = store?.sessions?.[${JSON.stringify(id)}] ?? null; return session ? { active: session.active?.reportHash ?? null, history: session.history?.length ?? 0, archivedChecks: (session.history || []).filter((entry) => entry.stages?.check).length } : { active: null, history: 0, archivedChecks: 0, missing: true };`);
const screen = () => json(`return { hash: location.hash, project: document.querySelector('.project-select')?.value ?? null, active: document.querySelector('.ledger-active .mono')?.textContent ?? null, busy: !!document.querySelector('.working') };`);
/** The studio's own account of every settled answer: `{ generation, project, applied, hash }` per console line, in order. */
const answers = () => { const out = cli('console'); const found = []; for (const match of out.matchAll(/studio: the (\w+) answer of request (\d+) for (\S+) (applied(?: \(([a-f0-9]{64})\))?|arrived after a later request or a reset; discarded)/g)) found.push({ key: match[1], generation: Number(match[2]), project: match[3], applied: match[4].startsWith('applied'), hash: match[5] ?? null }); return found; };
async function waitForAnswers(label, predicate, timeoutMs = 300_000) { const started = Date.now(); for (;;) { const found = answers(); if (predicate(found)) return found; if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(found)}`); await new Promise((resolve) => setTimeout(resolve, 3000)); } }
const studioReady = () => waitFor('the studio', `return location.hash.startsWith('#/app/run') && document.querySelector('.project-select')?.value === ${JSON.stringify(alpha.id)} && [...document.querySelectorAll('button')].some((item) => /^(Run the check|Check again)$/.test(item.textContent)) ? 1 : 0;`, 30_000);
const leaveAndReturn = async () => {
  cli('goto', `${SITE}#/app/projects`);
  await waitFor('My projects (the studio unmounted)', `return location.hash.startsWith('#/app/projects') && !document.querySelector('.project-select') ? 1 : 0;`, 30_000);
  cli('goto', `${SITE}#/app/run/check`);
  await studioReady();
};
/** Hold the first EVM RPC answer of the next check back by HOLD_MS so that it is still in flight after the visitor left and returned; later answers pass at once. */
const holdNextCheck = () => { if (HOLD_MS > 0) runCode(`async page => { let held = false; await page.route((url) => url.href.startsWith('https://test-evm-rpc-v3.portaldot.dev'), async (route) => { if (!held) { held = true; await new Promise((resolve) => setTimeout(resolve, ${HOLD_MS})); } await route.continue(); }); }`); };
const releaseHold = () => { if (HOLD_MS > 0) runCode(`async page => { await page.unrouteAll({ behavior: 'ignoreErrors' }); }`); };

// The seed: Alpha, a browser-local project on the pUSD asset with an empty session, active.
const form = (projectName) => ({ projectName, logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' });
const alpha = createProject({ name: 'Alpha list', plan: ownPlanFromForm(form('Alpha list')), at: T });
const memory = new Map();
const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
const projects = selectProject(withProject(loadProjects({ storage }), alpha), alpha.id);
const studio = { schema: STORE_SCHEMA, activeProjectId: alpha.id, sessions: {} };

try {
  cli('open', `${SITE}#/app/run/check`);
  runCode(`async page => { await page.evaluate(([projects, studio]) => { localStorage.clear(); localStorage.setItem(${JSON.stringify(PROJECTS_KEY)}, projects); localStorage.setItem(${JSON.stringify(STORE_KEY)}, studio); }, ${JSON.stringify([JSON.stringify(projects), JSON.stringify(studio)])}); await page.reload(); }`);
  await studioReady();
  // 1. Check A starts in the first mount (its first EVM answer held back); the visitor leaves for My projects and comes back: a new mount.
  holdNextCheck();
  cli('click', "getByRole('button', { name: /^(Run the check|Check again)$/ })");
  const startedA = new Date().toISOString();
  await leaveAndReturn();
  releaseHold();
  const remounted = screen();
  const beforeB = answers();
  assert(remounted.project === alpha.id, 'the studio is open again on Alpha, a new mount', { remounted, startedA });
  assert(!beforeB.some((item) => item.generation === 1), 'the race is exercised: check A is still in flight when the new mount starts check B (otherwise the hold was too short; pass a longer --hold)', { answers: beforeB, holdMs: HOLD_MS, kind: 'harness' });
  // 2. Check B starts in the new mount: it supersedes A whatever order the answers arrive in.
  cli('click', "getByRole('button', { name: /^(Run the check|Check again)$/ })");
  const startedB = new Date().toISOString();
  const settled = await waitForAnswers('both answers of A (request 1) and B (request 2)', (found) => found.some((item) => item.generation === 1) && found.some((item) => item.generation === 2));
  const a = settled.find((item) => item.generation === 1), b = settled.find((item) => item.generation === 2);
  assert(a.applied === false && b.applied === true && /^[a-f0-9]{64}$/.test(b.hash), 'R05-G: the older answer was discarded and the newer applied, in whichever order they arrived', { order: settled.map((item) => `${item.generation}:${item.applied ? 'applied' : 'discarded'}`), startedA, startedB });
  const stored = sessionOf(alpha.id);
  assert(stored.active === b.hash && stored.archivedChecks === 0, 'R05-G: the store holds the newer answer as the active report and no archived check from the discarded one', { stored, b: b.hash });
  const shown = await waitFor('the new mount showing the answer', `return (document.querySelector('.ledger-active .mono')?.textContent ?? '').startsWith(${JSON.stringify(b.hash.slice(0, 6))}) ? 1 : 0;`, 30_000);
  assert(shown === 1, 'R05-G: the mount that started B shows B; the discarded A changed nothing on screen', screen());
  // 3. A reload keeps B.
  runCode(`async page => { await page.reload(); }`);
  await studioReady();
  const reloaded = sessionOf(alpha.id);
  assert(reloaded.active === b.hash && screen().active?.startsWith(b.hash.slice(0, 6)), 'R05-G: after a reload the newer answer is still the active report', { reloaded, screen: screen() });
  // 4. Check C starts (its first EVM answer held back), the visitor leaves and returns, and clears the session in the new mount while C still runs: C's answer, arriving later, is discarded and the cleared session stays cleared, also after a reload.
  // The reload above started a new page context: the request numbering restarts at 1 there (no request of the earlier context can be in flight, its code is gone), and the console holds the new context's lines only, so C is the first new line.
  const linesBeforeC = answers().length;
  holdNextCheck();
  cli('click', "getByRole('button', { name: 'Check again' })");
  await leaveAndReturn();
  releaseHold();
  assert(answers().length === linesBeforeC, 'the race is exercised: check C is still in flight when the new mount clears the session', { answers: answers(), holdMs: HOLD_MS, kind: 'harness' });
  cli('click', "getByRole('button', { name: 'Clear session' })");                 // the page asks for confirmation; the CLI holds the dialog as a modal state
  cli('dialog-accept');
  await waitFor('the cleared session', `const store = JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEY)}) || 'null'); const session = store?.sessions?.[${JSON.stringify(alpha.id)}]; return session && !session.active ? 1 : 0;`, 30_000);
  const afterReset = await waitForAnswers('the answer of C (the first request of the reloaded context)', (found) => found.length > linesBeforeC);
  const c = afterReset[linesBeforeC];
  assert(c.key === 'check' && c.applied === false, 'R05-G: the answer of the check that was running when the new mount cleared the session is discarded', afterReset.map((item) => `${item.generation}:${item.applied ? 'applied' : 'discarded'}`));
  const cleared = sessionOf(alpha.id);
  assert(cleared.active === null, 'R05-G: the cleared session stays cleared when the older answer arrives', cleared);
  runCode(`async page => { await page.reload(); }`);
  await studioReady();
  assert(sessionOf(alpha.id).active === null && screen().active === null, 'R05-G: a reload restores nothing', { stored: sessionOf(alpha.id), screen: screen() });
  const consoleOut = cli('console', 'error');
  const errorCount = Number((consoleOut.match(/Errors: (\d+)/) || [])[1] ?? NaN);
  assert(errorCount === 0, 'no console errors during the journey', consoleOut.split('\n').filter((line) => line.trim()).slice(0, 6));
  const result = { ok: true, site: SITE, at: new Date().toISOString(), alpha: alpha.id, holdMs: HOLD_MS, answers: afterReset, started: { a: startedA, b: startedB }, observations };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  let consoleTail = null;
  try { consoleTail = cli('console').split('\n').filter((line) => line.trim()).slice(-20); } catch { consoleTail = null; }
  console.log(JSON.stringify({ ok: false, error: error.message, observations, consoleTail }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: false, error: error.message, observations, consoleTail }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  spawnSync('playwright-cli', ['-s', SESSION, 'close'], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
}
