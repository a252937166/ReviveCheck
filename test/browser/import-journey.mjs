#!/usr/bin/env node
// The browser journey behind repair handoff 2026-10-26, R-03: a bound project is exported
// from one browser profile and imported through the page's real import path into a
// COMPLETELY EMPTY second profile (no session, no receipts are seeded). After the reviewer
// trust is confirmed, the policy fingerprint equals the bundle's, the existing binding is
// intact, the consumer configuration exports and passes both loaders, a live evaluation
// settles, a reload keeps it, a second import of the same bundle stays a separate project,
// and a references-only bundle names its missing evidence instead of fabricating it. Needs
// a browser, a served build and the public testnet nodes.
//
//   node test/browser/import-journey.mjs [--site http://127.0.0.1:4183/] [--out <file>]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, setReleaseLabel, noteReport, loadProjects, withProject, selectProject, studioProject, projectView, exportBundle, PROJECTS_KEY } from '../../src/projects.js';
import { emptySession, recordImport, applyStage, STORE_KEY, STORE_SCHEMA } from '../../src/studio-state.js';
import { ownPlanFromForm } from '../../src/own-plan.js';
import { policyHash } from '../../lib/policy.js';
import { loadConsumerConfig } from '../../lib/catalog-release.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const SITE = option('--site', 'http://127.0.0.1:4183/').replace(/\/?$/, '/');
const OUT = option('--out', null);
const CONSUMER = option('--consumer', path.resolve(root, '../revivecheck-consumer-example'));
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const REPORT = readJson('public/reports/1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51.json');
const WRITES = readJson('public/lifecycle/registry-writes.json').items;
const EVIDENCE = readJson('public/lifecycle/evidence.json').items.find((item) => item.reportHash === REPORT.evidenceHash);
const REVIEWER = '0x95db300103ec8b45884b13ed85230fbf02114065', OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const T = '2026-10-26T09:00:00.000Z';
const observations = [];
const scratch = mkdtempSync(path.join(tmpdir(), 'revivecheck-import-'));
let session = 'import-a';
function cli(...parts) { const result = spawnSync('playwright-cli', ['-s', session, ...parts], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); if (result.status !== 0) throw new Error(`playwright-cli ${parts[0]} failed: ${(result.stderr || result.stdout).slice(0, 600)}`); return result.stdout; }
const evaluate = (js) => { const out = cli('--raw', 'eval', js).trim(); try { return JSON.parse(out); } catch { return out; } };
const json = (js) => JSON.parse(evaluate(`JSON.stringify((() => { ${js} })())`) || 'null');
async function waitFor(label, js, timeoutMs = 150_000) { const started = Date.now(); for (;;) { const value = json(js); if (value) return value; if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 2000)); } }
function runCode(body) { const file = path.join(scratch, `code-${Date.now()}-${Math.random().toString(36).slice(2)}.js`); writeFileSync(file, body); return cli('run-code', `--filename=${file}`); }
const assert = (condition, message, detail) => { observations.push({ ok: !!condition, message, ...(detail !== undefined ? { detail } : {}) }); if (!condition) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); };
const kv = (label) => evaluate(`(() => { const row = [...document.querySelectorAll('.kv')].find((item) => item.querySelector('dt')?.textContent === ${JSON.stringify(label)}); return row ? row.querySelector('dd').textContent : null; })()`);

// The seed of profile A: Alpha, established by the recorded 2026-10-25 lifecycle of pusd-catalog-v2 (receipts, no transaction sent here).
const form = (projectName) => ({ projectName, logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' });
const receipt = (item) => ({ route: 'native', extrinsicHash: item.extrinsicHash, blockHash: item.blockHash, blockNumber: String(item.blockNumber), success: true });
let alpha = setReleaseLabel(createProject({ name: 'Alpha list', plan: ownPlanFromForm(form('Alpha list')), at: T, policy: { reviewers: { trusted: [REVIEWER], basis: 'The project reviewer account named by Alpha; owner and reviewer are both project-controlled test accounts, so this shows role separation, not independent review.' } } }), 'pusd-catalog-v2', { at: T });
alpha = noteReport(alpha, REPORT, { source: 'import', at: T });
const submitR2 = WRITES.find((item) => item.action === 'submit' && item.revision === '2');
const approveR2 = WRITES.filter((item) => item.action === 'review' && item.revision === '2' && item.approved).at(-1);
let alphaSession = recordImport(emptySession(studioProject(alpha)), { plan: alpha.plan, report: REPORT, at: T });
alphaSession = applyStage(alphaSession, 'store', { reportHash: REPORT.evidenceHash, bytes: EVIDENCE.bytes, contentHash: EVIDENCE.contentHash ?? '0x', tx: receipt(EVIDENCE), retrieved: { verified: true, publisher: EVIDENCE.publisher, blockNumber: String(EVIDENCE.blockNumber) } });
alphaSession = applyStage(alphaSession, 'submit', { label: 'pusd-catalog-v2', releaseId: submitR2.releaseId, reportHash: REPORT.evidenceHash, from: submitR2.signer, sender: OWNER, tx: receipt(submitR2), readback: { address: '0xe949b200edf070b9d425b206ed24dc8fe5b7d339', releaseId: submitR2.releaseId, block: { number: String(submitR2.blockNumber) }, release: { exists: true, owner: OWNER, revision: '2', reportHash: `0x${REPORT.evidenceHash}` }, interfacesAgree: true } });
alphaSession = applyStage(alphaSession, 'approve', { releaseId: approveR2.releaseId, approved: true, reportHash: `0x${REPORT.evidenceHash}`, revision: '2', reviewer: REVIEWER, from: approveR2.signer, tx: receipt(approveR2) });
const memory = new Map();
const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
const projects = selectProject(withProject(loadProjects({ storage }), alpha), alpha.id);
const studio = { schema: STORE_SCHEMA, activeProjectId: alpha.id, sessions: { [alpha.id]: alphaSession } };

try {
  // Profile A: bind through the page, export the bundle.
  cli('open', `${SITE}#/app/projects/${encodeURIComponent(alpha.id)}`);
  runCode(`async page => { await page.evaluate(([projects, studio]) => { localStorage.clear(); localStorage.setItem(${JSON.stringify(PROJECTS_KEY)}, projects); localStorage.setItem(${JSON.stringify(STORE_KEY)}, studio); }, ${JSON.stringify([JSON.stringify(projects), JSON.stringify(studio)])}); await page.reload(); }`);
  await waitFor('Alpha\'s page', `return document.querySelector('h1')?.textContent === 'Alpha list' && [...document.querySelectorAll('button')].some((item) => item.textContent === 'Bind the candidate explicitly') ? 1 : 0;`, 30_000);
  cli('click', "getByRole('button', { name: 'Bind the candidate explicitly' })");
  await waitFor('the binding', `return /^Bound:/.test(document.querySelector('.form-ok')?.textContent ?? '') ? 1 : 0;`, 15_000);
  const bundlePath = path.join(scratch, 'bundle.json');
  runCode(`async page => { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Project bundle' }).click()]); await download.saveAs(${JSON.stringify(bundlePath)}); }`);
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  assert(bundle.schema === 'revivecheck.project-bundle.v1' && bundle.bindings.length === 1 && bundle.release.owner === OWNER && bundle.sealedReports.length >= 1 && typeof bundle.policyHash === 'string', 'the exported bundle carries the binding, the declared owner and the sealed report', { owner: bundle.release.owner, bindings: bundle.bindings.length, policyHash: bundle.policyHash });
  const policyShown = evaluate(`document.querySelector('.project-policy > p:last-of-type')?.textContent`);
  spawnSync('playwright-cli', ['-s', session, 'close'], { encoding: 'utf8' });

  // Profile B: completely empty. Import through the page's own text path; nothing is seeded.
  session = 'import-b';
  cli('open', `${SITE}#/app/projects`);
  runCode(`async page => { await page.evaluate(() => localStorage.clear()); await page.reload(); }`);
  await waitFor('the empty project list', `const items = document.querySelectorAll('.projects-list li'); return items.length === 1 && localStorage.getItem(${JSON.stringify(STORE_KEY)}) === null ? 1 : 0;`, 30_000);
  runCode(`async page => { await page.fill('.import-area', ${JSON.stringify(JSON.stringify(bundle))}); }`);
  cli('click', "getByRole('button', { name: 'Import from text' })");
  await waitFor('the imported project page', `return document.querySelector('h1')?.textContent === 'Alpha list' && location.hash.startsWith('#/app/projects/own-') ? 1 : 0;`, 30_000);
  const importedId = decodeURIComponent(evaluate(`location.hash.slice('#/app/projects/'.length)`));
  // R03-D: before confirmation, the policy is incomplete for the trust reason, and the evaluation is blocked.
  const trustNotice = evaluate(`document.querySelector('.project-policy .form-error')?.textContent`);
  assert(/Imported reviewer trust/.test(trustNotice || ''), 'R03-D: the imported reviewer trust waits for confirmation', trustNotice);
  const evaluateDisabled = json(`const b = [...document.querySelectorAll('button')].find((item) => /Evaluate now/.test(item.textContent)); return b ? { present: true } : null;`);
  assert(evaluateDisabled, 'the evaluation control exists', evaluateDisabled);
  cli('click', "getByRole('button', { name: 'Evaluate now' })");
  const blocked = await waitFor('the blocked evaluation', `return document.querySelector('[aria-labelledby="evaluate-title"] .form-error')?.textContent ?? null;`, 15_000);
  assert(/confirm it as your own policy choice/.test(blocked), 'R03-D: evaluation before confirmation is refused with the trust reason', blocked);
  const declared = kv('Declared by the imported bundle');
  assert(declared && declared.includes(OWNER.slice(0, 6)) && /declaration/.test(declared) && /Not a receipt of this browser/.test(declared), 'the declarations are shown as declarations, apart from receipts', declared?.slice(0, 200));
  const submitted = kv('Submitted');
  assert(/not submitted in this browser/.test(submitted || ''), 'no submission receipt is fabricated', submitted);
  cli('click', "getByRole('button', { name: 'Confirm these reviewers as my choice' })");
  const policyLine = await waitFor('the complete policy', `const p = document.querySelector('.project-policy > p:last-of-type'); return p && /Policy complete/.test(p.textContent) ? p.textContent : null;`, 15_000);
  assert(policyLine.includes(bundle.policyHash.slice(0, 8)) && /declared by the imported bundle/.test(policyLine), 'R03-A: the effective policy has the bundle\'s fingerprint, with the owner from the declaration', policyLine);
  const bindings = json(`return [...document.querySelectorAll('.binding-list li')].map((item) => item.textContent);`);
  assert(bindings.length === 1 && /current/.test(bindings[0]) && bindings[0].includes(`policy ${bundle.bindings[0].policyHash.slice(0, 5)}…${bundle.bindings[0].policyHash.slice(-5)}`) && bundle.bindings[0].policyHash === bundle.policyHash, 'R03-A: the existing binding is intact and current under that policy', bindings);
  // R03-B, R03-C: the configuration exports without any session, and both loaders accept it.
  const configPath = path.join(scratch, 'config.json');
  runCode(`async page => { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Consumer configuration' }).click()]); await download.saveAs(${JSON.stringify(configPath)}); }`);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert(config.release.owner === OWNER && config.release.reportHash === REPORT.evidenceHash && config.release.revision === '2' && policyHash(config.policy) === bundle.policyHash, 'R03-B: the exported configuration names the declared owner, the bound report and the same policy', { release: config.release, hash: policyHash(config.policy) });
  const { loadConfig } = await import(path.join(CONSUMER, 'src/evaluate.js'));
  loadConfig(config, 'exported');
  assert(loadConsumerConfig(config, 'exported').policyHash === bundle.policyHash, 'R03-C: the consumer loader and the release-gate loader accept it');
  // Fresh evaluation decides on the chain, not on the declarations.
  cli('click', "getByRole('button', { name: 'Evaluate now' })");
  const verdict = await waitFor('the live evaluation', `const el = document.querySelector('.decision-verdict'); const words = [...document.querySelectorAll('.decision-facts .badge')].map((b) => b.textContent); return el && !/Checking/.test(words.join(' ')) && !/Not checked/.test(el.textContent) ? { headline: el.textContent, badges: words, reasons: [...document.querySelectorAll('.reason-list code')].map((c) => c.textContent) } : null;`);
  assert(/Available now|Withheld|Unknown|Lapsed/.test(verdict.headline), 'R03-C: the evaluation settled on fresh reads with an explicit state', verdict);
  // R03-G: a reload keeps all of it.
  runCode(`async page => { await page.reload(); }`);
  await waitFor('the page after reload', `return document.querySelector('h1')?.textContent === 'Alpha list' ? 1 : 0;`, 30_000);
  const afterReload = { policy: evaluate(`document.querySelector('.project-policy > p:last-of-type')?.textContent`), bindings: json(`return document.querySelectorAll('.binding-list li').length;`), declared: kv('Declared by the imported bundle') };
  assert(/Policy complete/.test(afterReload.policy || '') && afterReload.policy.includes(bundle.policyHash.slice(0, 8)) && afterReload.bindings === 1 && !!afterReload.declared, 'R03-G: a reload preserves the policy, the binding and the declaration', afterReload);
  // R03-F: importing the same bundle again keeps the first project and makes a separate copy.
  cli('goto', `${SITE}#/app/projects`);
  await waitFor('the list', `return document.querySelector('.import-area') ? 1 : 0;`, 30_000);
  runCode(`async page => { await page.fill('.import-area', ${JSON.stringify(JSON.stringify(bundle))}); }`);
  cli('click', "getByRole('button', { name: 'Import from text' })");
  await waitFor('the copy', `return document.querySelector('h1')?.textContent === 'Alpha list (imported)' ? 1 : 0;`, 30_000);
  const ids = json(`const projects = JSON.parse(localStorage.getItem(${JSON.stringify(PROJECTS_KEY)})); return Object.keys(projects.projects);`);
  assert(ids.includes(importedId) && ids.some((id) => id !== importedId && id.startsWith(importedId)), 'R03-F: the existing project is preserved and the second import is a separate project', ids);
  const original = json(`const projects = JSON.parse(localStorage.getItem(${JSON.stringify(PROJECTS_KEY)})); const p = projects.projects[${JSON.stringify(importedId)}]; return { confirmed: p.policy.reviewers.confirmed, bindings: p.bindings.length, owner: p.release.owner };`);
  assert(original.confirmed === true && original.bindings === 1 && original.owner === OWNER, 'the original keeps its confirmed trust and binding', original);
  // R03-H: a references-only bundle (no sealed report) keeps its declarations and names the missing evidence; nothing is fabricated.
  const sparse = exportBundle(alpha, projectView(alpha, alphaSession), { reports: [], at: T });
  sparse.project.name = 'Sparse list';
  cli('goto', `${SITE}#/app/projects`);
  await waitFor('the list again', `return document.querySelector('.import-area') ? 1 : 0;`, 30_000);
  runCode(`async page => { await page.fill('.import-area', ${JSON.stringify(JSON.stringify(sparse))}); }`);
  cli('click', "getByRole('button', { name: 'Import from text' })");
  await waitFor('the sparse project', `return document.querySelector('h1')?.textContent === 'Sparse list' ? 1 : 0;`, 30_000);
  const sparseReport = kv('Active report');
  const missing = kv('Missing evidence');
  assert(/none/.test(sparseReport || '') && missing && missing.includes(REPORT.evidenceHash) && /nothing is fabricated/.test(missing), 'R03-H: a references-only bundle shows no report and names the missing evidence', { sparseReport, missing: missing?.slice(0, 160) });
  const sparseDeclared = kv('Declared by the imported bundle');
  assert(sparseDeclared && sparseDeclared.includes(OWNER.slice(0, 6)), 'R03-H: its declarations survive', sparseDeclared?.slice(0, 120));
  const consoleOut = cli('console', 'error');
  const errorCount = Number((consoleOut.match(/Errors: (\d+)/) || [])[1] ?? NaN);
  assert(errorCount === 0, 'no console errors during the journey', consoleOut.split('\n').filter((line) => line.trim()).slice(0, 6));
  const result = { ok: true, site: SITE, at: new Date().toISOString(), policyHash: bundle.policyHash, importedId, verdict, policyShownInA: policyShown, observations };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, observations }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: false, error: error.message, observations }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  spawnSync('playwright-cli', ['-s', session, 'close'], { encoding: 'utf8' });
}
