#!/usr/bin/env node
// The browser journey behind product plan 2026-10-25, D-02 (the customer configuration):
// two separately named browser-local projects on the same asset, each with its own policy,
// release identity and candidate; one binds explicitly, evaluates live and exports the
// consumer configuration, which is validated with the separate consumer's own loader; the
// other has none of it. Run against a built site with playwright-cli (not part of `npm
// test`: it needs a browser, a served build and the public testnet nodes).
//
//   node test/browser/projects-journey.mjs [--site http://127.0.0.1:4183/] [--session projects] [--out <file>]
//
// The signed steps of project Alpha are the recorded 2026-10-25 lifecycle of pusd-catalog-v2
// (store #187145, submit revision 2 #187165, approve #187181, re-approve #187271), seeded
// into Alpha's session as receipts; no transaction is sent by this journey.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, setReleaseLabel, updatePolicy, noteReport, loadProjects, withProject, selectProject, studioProject, PROJECTS_KEY } from '../../src/projects.js';
import { emptySession, recordImport, applyStage, STORE_KEY, STORE_SCHEMA } from '../../src/studio-state.js';
import { ownPlanFromForm } from '../../src/own-plan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const SITE = option('--site', 'http://127.0.0.1:4183/').replace(/\/?$/, '/');
const SESSION = option('--session', 'projects');
const OUT = option('--out', null);
// Every CLI command is bounded: one that never returns (a stuck browser operation) ends the journey with a named failure and the observations so far.
const CLI_TIMEOUT_MS = 120_000;
const CONSUMER = option('--consumer', path.resolve(root, '../revivecheck-consumer-example'));
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const REPORT = readJson('public/reports/1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51.json');
const WRITES = readJson('public/lifecycle/registry-writes.json').items;
const EVIDENCE = readJson('public/lifecycle/evidence.json').items.find((item) => item.reportHash === REPORT.evidenceHash);
const REVIEWER = '0x95db300103ec8b45884b13ed85230fbf02114065', OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const T = '2026-10-25T12:00:00.000Z';
const observations = [];
const scratch = mkdtempSync(path.join(tmpdir(), 'revivecheck-projects-'));

function cli(...parts) {
  const result = spawnSync('playwright-cli', ['-s', SESSION, ...parts], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: CLI_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.error) throw new Error(`playwright-cli ${parts[0]} ${result.error.code === 'ETIMEDOUT' ? `did not return within ${CLI_TIMEOUT_MS / 1000} s and was killed` : `could not run: ${result.error.message}`}`);
  if (result.status !== 0) throw new Error(`playwright-cli ${parts[0]} failed: ${(result.stderr || result.stdout).slice(0, 600)}`);
  return result.stdout;
}
const evaluate = (js) => { const out = cli('--raw', 'eval', js).trim(); try { return JSON.parse(out); } catch { return out; } };
const json = (js) => JSON.parse(evaluate(`JSON.stringify((() => { ${js} })())`) || 'null');
async function waitFor(label, js, timeoutMs = 150_000) {
  const started = Date.now();
  for (;;) { const value = json(js); if (value) return value; if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 2000)); }
}
function runCode(body) { const file = path.join(scratch, `code-${Date.now()}.js`); writeFileSync(file, body); return cli('run-code', `--filename=${file}`); }
const assert = (condition, message, detail) => { observations.push({ ok: !!condition, message, ...(detail !== undefined ? { detail } : {}) }); if (!condition) throw new Error(`${message}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`); };
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);

// The seed: Alpha (complete policy, the recorded r2 lifecycle as its session) and Beta (same asset, nothing else).
const form = (projectName) => ({ projectName, logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' });
const receipt = (item) => ({ route: 'native', extrinsicHash: item.extrinsicHash, blockHash: item.blockHash, blockNumber: String(item.blockNumber), success: true });
let alpha = setReleaseLabel(createProject({ name: 'Alpha list', plan: ownPlanFromForm(form('Alpha list')), at: T, policy: { reviewers: { trusted: [REVIEWER], basis: 'The project reviewer account named by Alpha; owner and reviewer are both project-controlled test accounts, so this shows role separation, not independent review.' } } }), 'pusd-catalog-v2', { at: T });
alpha = noteReport(alpha, REPORT, { source: 'import', at: T });
const beta = createProject({ name: 'Beta list', plan: ownPlanFromForm(form('Beta list')), at: T });
const submitR2 = WRITES.find((item) => item.action === 'submit' && item.revision === '2');
const approveR2 = WRITES.filter((item) => item.action === 'review' && item.revision === '2' && item.approved).at(-1);
let alphaSession = recordImport(emptySession(studioProject(alpha)), { plan: alpha.plan, report: REPORT, at: T });
alphaSession = applyStage(alphaSession, 'store', { reportHash: REPORT.evidenceHash, bytes: EVIDENCE.bytes, contentHash: EVIDENCE.contentHash ?? '0x', tx: receipt(EVIDENCE), retrieved: { verified: true, publisher: EVIDENCE.publisher, blockNumber: String(EVIDENCE.blockNumber) } });
alphaSession = applyStage(alphaSession, 'submit', { label: 'pusd-catalog-v2', releaseId: submitR2.releaseId, reportHash: REPORT.evidenceHash, from: submitR2.signer, sender: OWNER, tx: receipt(submitR2), readback: { address: '0xe949b200edf070b9d425b206ed24dc8fe5b7d339', releaseId: submitR2.releaseId, block: { number: String(submitR2.blockNumber) }, release: { exists: true, owner: OWNER, revision: '2', reportHash: `0x${REPORT.evidenceHash}` }, interfacesAgree: true } });
alphaSession = applyStage(alphaSession, 'approve', { releaseId: approveR2.releaseId, approved: true, reportHash: `0x${REPORT.evidenceHash}`, revision: '2', reviewer: REVIEWER, from: approveR2.signer, tx: receipt(approveR2) });
const memory = new Map();
const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
let projects = loadProjects({ storage });
projects = selectProject(withProject(withProject(projects, alpha), beta), alpha.id);
const studio = { schema: STORE_SCHEMA, activeProjectId: alpha.id, sessions: { [alpha.id]: alphaSession } };

try {
  cli('open', `${SITE}#/app/projects`);
  runCode(`async page => { await page.evaluate(([projects, studio]) => { localStorage.clear(); localStorage.setItem(${JSON.stringify(PROJECTS_KEY)}, projects); localStorage.setItem(${JSON.stringify(STORE_KEY)}, studio); }, ${JSON.stringify([JSON.stringify(projects), JSON.stringify(studio)])}); await page.reload(); }`);
  const list = await waitFor('the project list', `const items = [...document.querySelectorAll('.projects-list li')]; return items.length ? items.map((item) => ({ name: item.querySelector('strong').textContent, badges: [...item.querySelectorAll('.project-state .badge')].map((badge) => badge.textContent) })) : null;`, 30_000);
  assert(list.length === 3 && list.map((item) => item.name).join(',') === 'pUSD token list,Alpha list,Beta list', 'three projects: the demonstration and the two the visitor named', list);
  assert(list[1].badges.includes('policy complete') && list[1].badges.includes('candidate ready') && list[1].badges.includes('active in the studio'), 'Alpha: policy complete, candidate ready', list[1]);
  assert(list[2].badges.includes('policy incomplete') && !list[2].badges.includes('candidate ready') && list[2].badges.includes('no report'), 'Beta: nothing established, nothing borrowed', list[2]);

  // Alpha: the candidate names the exact report, revision 2 and the storage extrinsic; bind it; the binding appears.
  cli('goto', `${SITE}#/app/projects/${encodeURIComponent(alpha.id)}`);
  const candidate = await waitFor('Alpha\'s candidate', `const rows = [...document.querySelectorAll('.kv')]; const row = rows.find((item) => item.querySelector('dt')?.textContent === 'Binding candidate'); return row ? row.querySelector('dd').textContent : null;`, 30_000);
  assert(candidate.includes(REPORT.evidenceHash) && /revision 2/.test(candidate) && /stored in 0x80d4…92feb3/.test(candidate) && /Complete\./.test(candidate), 'the candidate shows the exact report hash, revision 2 and the storage extrinsic', candidate);
  const bindButton = json(`const button = [...document.querySelectorAll('button')].find((item) => item.textContent === 'Bind the candidate explicitly'); return button ? { disabled: button.disabled } : null;`);
  assert(bindButton && !bindButton.disabled, 'binding is possible: policy complete and candidate complete', bindButton);
  cli('click', "getByRole('button', { name: 'Bind the candidate explicitly' })");
  const bound = await waitFor('the binding notice', `return document.querySelector('.form-ok')?.textContent ?? null;`, 15_000);
  assert(/^Bound: .* names report 1faef921a720… on revision 2\.$/.test(bound), 'the binding names the exact report and revision', bound);
  const bindings = json(`return [...document.querySelectorAll('.binding-list li')].map((item) => item.textContent);`);
  assert(bindings.length === 1 && /current/.test(bindings[0]) && /revision 2/.test(bindings[0]), 'one current binding', bindings);

  // The consumer configuration downloads and passes the separate consumer's own loader.
  const downloadPath = path.join(scratch, 'consumer-config.json');
  runCode(`async page => { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Consumer configuration' }).click()]); await download.saveAs(${JSON.stringify(downloadPath)}); }`);
  const config = JSON.parse(readFileSync(downloadPath, 'utf8'));
  assert(config.schema === 'revivecheck-consumer.config.v1' && config.release.reportHash === REPORT.evidenceHash && config.release.revision === '2' && config.release.label === 'pusd-catalog-v2' && config.release.owner === OWNER && config.policy.reviewers.trusted[0] === REVIEWER, 'the exported configuration names Alpha\'s policy, the bound report, release and revision', { release: config.release, reviewers: config.policy.reviewers.trusted });
  const { loadConfig } = await import(path.join(CONSUMER, 'src/evaluate.js'));
  loadConfig(config, 'exported');
  observations.push({ ok: true, message: 'the separate consumer\'s loadConfig accepts the exported configuration' });

  // Evaluate live under Alpha's policy: the same evaluator the consumer runs.
  cli('click', "getByRole('button', { name: 'Evaluate now' })");
  const verdict = await waitFor('the live evaluation', `const el = document.querySelector('.decision-verdict'); const word = [...document.querySelectorAll('.decision-facts .badge')].map((b) => b.textContent); return el && !/Checking/.test(word.join(' ')) && !/Not checked/.test(el.textContent) ? { headline: el.textContent, badges: word, deadline: document.querySelector('.decision-deadline')?.textContent ?? null, reasons: [...document.querySelectorAll('.reason-list code')].map((c) => c.textContent) } : null;`);
  assert(/Available now|Withheld|Unknown/.test(verdict.headline), 'the evaluation settled with an explicit state', verdict);
  // Beta: nothing of Alpha appears.
  cli('goto', `${SITE}#/app/projects/${encodeURIComponent(beta.id)}`);
  const betaCandidate = await waitFor('Beta\'s page', `const rows = [...document.querySelectorAll('.kv')]; const row = rows.find((item) => item.querySelector('dt')?.textContent === 'Binding candidate'); return row && document.querySelector('h1')?.textContent === 'Beta list' ? row.querySelector('dd').textContent : null;`, 30_000);
  assert(/none yet/.test(betaCandidate) && !betaCandidate.includes(REPORT.evidenceHash), 'Beta has no candidate and nothing of Alpha', betaCandidate);
  const betaPolicy = text('.project-policy .form-error');
  assert(/reviewers\.trusted/.test(betaPolicy || ''), 'Beta\'s policy is incomplete and says which field', betaPolicy);
  const betaBindings = text('.card-body .muted');
  assert(json(`return document.querySelectorAll('.binding-list li').length;`) === 0, 'Beta has no binding', betaBindings);
  const consoleOut = cli('console', 'error');
  const errorCount = Number((consoleOut.match(/Errors: (\d+)/) || [])[1] ?? NaN);
  assert(errorCount === 0, 'no console errors during the journey', consoleOut.split('\n').filter((line) => line.trim()).slice(0, 6));
  const result = { ok: true, site: SITE, at: new Date().toISOString(), alpha: alpha.id, beta: beta.id, verdict, config: { release: config.release, policyName: config.policy.name }, observations };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, observations }, null, 2));
  if (OUT) writeFileSync(OUT, `${JSON.stringify({ ok: false, error: error.message, observations }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  spawnSync('playwright-cli', ['-s', SESSION, 'close'], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
}
