#!/usr/bin/env node
// The browser journey behind repair handoff 2026-10-26, R-02: a failed 18-decimal release is
// checked on Check my token and adopted into a new browser-local project; the corrected
// 6-decimal release (same name, same acceptance plan) is checked and adopted into the SAME
// project, whose current plan, release-artifact fingerprint, studio chooser, entry export
// and next check all describe 6 while the failed report stays as history. A reload keeps
// it. Run against a built site with playwright-cli (needs a browser, a served build and the
// public testnet nodes).
//
//   node test/browser/adopt-journey.mjs [--site http://127.0.0.1:4183/] [--session adopt] [--out <file>]
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const SITE = option('--site', 'http://127.0.0.1:4183/').replace(/\/?$/, '/');
const SESSION = option('--session', 'adopt');
const OUT = option('--out', null);
// Every CLI command is bounded: one that never returns (a stuck browser operation) ends the journey with a named failure and the observations so far.
const CLI_TIMEOUT_MS = 120_000;
const NAME = 'My pUSD list';
const observations = [];
const scratch = mkdtempSync(path.join(tmpdir(), 'revivecheck-adopt-'));
function cli(...parts) { const result = spawnSync('playwright-cli', ['-s', SESSION, ...parts], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: CLI_TIMEOUT_MS, killSignal: 'SIGKILL' }); if (result.error) throw new Error(`playwright-cli ${parts[0]} ${result.error.code === 'ETIMEDOUT' ? `did not return within ${CLI_TIMEOUT_MS / 1000} s and was killed` : `could not run: ${result.error.message}`}`); if (result.status !== 0) throw new Error(`playwright-cli ${parts[0]} failed: ${(result.stderr || result.stdout).slice(0, 600)}`); return result.stdout; }
const evaluate = (js) => { const out = cli('--raw', 'eval', js).trim(); try { return JSON.parse(out); } catch { return out; } };
const json = (js) => JSON.parse(evaluate(`JSON.stringify((() => { ${js} })())`) || 'null');
async function waitFor(label, js, timeoutMs = 180_000) { const started = Date.now(); for (;;) { const value = json(js); if (value) return value; if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 2000)); } }
function runCode(body) { const file = path.join(scratch, `code-${Date.now()}.js`); writeFileSync(file, body); return cli('run-code', `--filename=${file}`); }
const assert = (condition, message, detail) => { observations.push({ ok: !!condition, message, ...(detail !== undefined ? { detail } : {}) }); if (!condition) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); };
const stores = () => json(`const projects = JSON.parse(localStorage.getItem('revivecheck.projects.v1') || 'null'); const studio = JSON.parse(localStorage.getItem('revivecheck.studio.v2') || 'null'); const id = projects?.activeProjectId; const project = projects?.projects?.[id] ?? null; const session = studio?.sessions?.[id] ?? null; return { id, plan: project?.plan?.listing ?? null, planHash: project?.planHash ?? null, artifact: project?.releaseArtifactHash ?? null, reports: project?.reports?.map((item) => [item.reportHash.slice(0, 12), item.status]) ?? [], active: session?.active ? { hash: session.active.reportHash, status: session.active.status, artifact: session.active.releaseArtifactHash } : null, history: session?.history?.length ?? 0, checkDecimals: session?.check?.report?.input?.listing?.decimals ?? null, sessionPlanDecimals: session?.project?.plan?.listing?.decimals ?? null };`);

/** Check my token: the pUSD example with this project name and these decimals, checked live; returns the sealed report's hash and status. */
async function checkOnForm(decimals) {
  cli('goto', `${SITE}#/app/check`);
  await waitFor('the form', `return document.querySelector('#own-form-title') ? 1 : 0;`, 30_000);
  cli('click', "getByRole('button', { name: 'Fill with the pUSD example' })");
  runCode(`async page => { await page.getByLabel('Project name').fill(${JSON.stringify(NAME)}); await page.getByLabel('Decimals the release claims').fill(${JSON.stringify(String(decimals))}); }`);
  cli('click', "getByRole('button', { name: /Run the check|Check again/ })");
  const hash = await waitFor(`the ${decimals}-decimal check`, `const foot = document.querySelector('#own-result-title') && document.querySelector('.result-foot .mono'); return foot ? foot.getAttribute('title') : null;`);
  const status = evaluate(`document.querySelector('.card .result-head .badge')?.textContent`);
  return { hash, status };
}

try {
  cli('open', `${SITE}#/app/check`);
  runCode(`async page => { await page.evaluate(() => localStorage.clear()); await page.reload(); }`);
  // 1. The failed 18-decimal release, adopted into a new project.
  const first = await checkOnForm(18);
  assert(first.status === 'Failed', 'the 18-decimal release fails the check', first);
  cli('click', "getByRole('button', { name: 'Use this report in my project' })");
  await waitFor('the studio of the new project', `return location.hash.startsWith('#/app/run') && document.querySelector('.project-select')?.value.startsWith('own-') ? 1 : 0;`, 30_000);
  const after18 = stores();
  assert(after18.id.startsWith('own-my-pusd-list-') && after18.plan.decimals === 18 && after18.active.hash === first.hash && after18.active.status === 'failed', 'the new project describes 18 and holds the failed report', after18);
  cli('goto', `${SITE}#/app/run/check`);
  const chooser18 = await waitFor('the chooser', `const pre = document.querySelector('.release-chooser pre'); return pre && pre.textContent.includes('"decimals"') ? pre.textContent : null;`, 30_000);
  assert(/"decimals": 18/.test(chooser18), 'the studio chooser shows the 18-decimal plan', chooser18.slice(0, 200));
  // 2. The corrected 6-decimal release, same name and acceptance plan: the same project, now describing 6.
  const second = await checkOnForm(6);
  assert(second.status === 'Passed' && second.hash !== first.hash, 'the corrected release passes with a new report', second);
  cli('click', "getByRole('button', { name: 'Use this report in my project' })");
  await waitFor('the studio again', `return location.hash.startsWith('#/app/run') && document.querySelector('.project-select')?.value.startsWith('own-') ? 1 : 0;`, 30_000);
  const after6 = stores();
  assert(after6.id === after18.id, 'R02-A: the same project', { before: after18.id, after: after6.id });
  assert(after6.plan.decimals === 6 && after6.planHash === after18.planHash && after6.artifact !== after18.artifact && after6.artifact === after6.active.artifact, 'R02-A: the current plan, artifact fingerprint and active report describe 6 consistently', after6);
  assert(after6.active.hash === second.hash && after6.active.status === 'passed', 'the corrected report is the active report', after6.active);
  assert(after6.history === 1 && after6.reports.length === 2, 'R02-D: the failed report stays referenced and its check is history', { history: after6.history, reports: after6.reports });
  assert(after6.sessionPlanDecimals === 6, 'the session\'s project plan follows the record', after6.sessionPlanDecimals);
  cli('goto', `${SITE}#/app/run/check`);
  const chooser6 = await waitFor('the chooser again', `const pre = document.querySelector('.release-chooser pre'); return pre && pre.textContent.includes('"decimals": 6') ? pre.textContent : null;`, 30_000);
  assert(/"decimals": 6/.test(chooser6) && !/"decimals": 18/.test(chooser6), 'the studio chooser shows the corrected plan', chooser6.slice(0, 200));
  const badges = json(`return Object.fromEntries(['store','submit','approve'].map((id) => [id, document.querySelector('.step-link[href="#/app/run/' + id + '"] .badge')?.textContent ?? null]));`);
  assert(badges.store === 'Wallet' && badges.submit === 'Wallet' && badges.approve === 'After Submit', 'R02-D: the corrected report inherits no approval, listing or prepared transaction', badges);
  // 3. The next check in the studio receives the corrected plan: the sealed input of the new report says 6.
  cli('click', "getByRole('button', { name: 'Check again' })");
  const third = await waitFor('the studio check on the corrected plan', `const store = JSON.parse(localStorage.getItem('revivecheck.studio.v2') || 'null'); const projects = JSON.parse(localStorage.getItem('revivecheck.projects.v1') || 'null'); const session = store?.sessions?.[projects?.activeProjectId]; return session?.active?.reportHash && session.active.reportHash !== ${JSON.stringify(second.hash)} ? { hash: session.active.reportHash, decimals: session.check.report.input.listing.decimals, status: session.active.status } : null;`);
  assert(third.decimals === 6 && third.status === 'passed', 'R02-B: the checker received the corrected plan (the sealed input of the new report)', third);
  // 4. The project page: the exported entry is the corrected one; the artifact fingerprint is shown.
  cli('goto', `${SITE}#/app/projects/${encodeURIComponent(after6.id)}`);
  const entry = await waitFor('the entry row', `const row = [...document.querySelectorAll('.kv')].find((item) => item.querySelector('dt')?.textContent === 'Entry'); return row ? row.querySelector('dd').textContent : null;`, 30_000);
  assert(/"decimals":6/.test(entry), 'R02-C: the project exports the corrected entry', entry);
  const head = evaluate(`document.querySelector('.page-head p')?.textContent`);
  assert(head.includes(after6.artifact.slice(0, 6)), 'the page names the current release-artifact fingerprint', head.slice(0, 160));
  // 5. A reload continues with the corrected plan.
  runCode(`async page => { await page.reload(); }`);
  await waitFor('the page after reload', `return document.querySelector('.page-head p') ? 1 : 0;`, 30_000);
  const reloaded = stores();
  assert(reloaded.id === after6.id && reloaded.plan.decimals === 6 && reloaded.active.hash === third.hash && reloaded.history === 2, 'R02-E: reload keeps the corrected plan, the latest report and the history', reloaded);
  const consoleOut = cli('console', 'error');
  const errorCount = Number((consoleOut.match(/Errors: (\d+)/) || [])[1] ?? NaN);
  assert(errorCount === 0, 'no console errors during the journey', consoleOut.split('\n').filter((line) => line.trim()).slice(0, 6));
  const result = { ok: true, site: SITE, at: new Date().toISOString(), project: after6.id, reports: { failed18: first.hash, passed6: second.hash, studioRecheck: third.hash }, observations };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, observations }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: false, error: error.message, observations }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  spawnSync('playwright-cli', ['-s', SESSION, 'close'], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
}
