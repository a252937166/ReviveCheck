#!/usr/bin/env node
// Offline release check. Every record this repository publishes must be intact and
// consistent with the others before a build is called a release: sealed reports hash
// to their names, the baseline manifest binds its report, the v1 sources and artifact
// still hash to the v1 deployment record, the v2 manifest matches the sources in
// contracts/, the generated deployments module matches the records, the feed names the
// active token list, the catalog bindings verify, and no authored file carries
// non-English text. Prints the status with the exact commit; exits 1 on any failure.
// Deployment-dependent work (the v2 deployment) is listed as pending, never as done.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyRun } from '../lib/report.js';
import { verifyBaseline } from '../lib/baseline.js';
import { REGISTRY } from '../lib/registry.js';
import { TOKEN_LIST, TOKEN_LIST_VERSIONS } from '../lib/tokenlist.js';
import { normalizeManifest, checkArtifact, deploymentsFromRecords, renderDeploymentsModule } from '../lib/deployment.js';
import { verifyBinding } from '../lib/policy.js';
import { compileTokenList } from './compile-token-list.js';
import { compileReleaseRegistry } from './compile-release-registry.js';
import { normalizeConfig } from '../examples/token-catalog/lib/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const json = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const text = (file) => readFile(path.join(root, file), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const checks = [];
async function check(id, work) {
  try { const detail = await work(); checks.push({ id, status: 'passed', detail: detail ?? '' }); }
  catch (error) { checks.push({ id, status: 'failed', detail: String(error?.message || error).slice(0, 400) }); }
}

await check('reports.sealed', async () => {
  const files = (await readdir(path.join(root, 'public/reports'))).filter((file) => /^[a-f0-9]{64}\.json$/.test(file));
  for (const file of files) { const report = await json(`public/reports/${file}`); if (!verifyRun(report) || `${report.evidenceHash}.json` !== file) throw new Error(`${file} does not verify`); }
  const index = await json('public/reports/index.json');
  for (const entry of index.reports) if (!files.includes(`${entry.evidenceHash}.json`)) throw new Error(`index names a missing report ${entry.evidenceHash}`);
  return `${files.length} sealed reports verify; ${index.reports.length} indexed`;
});
await check('baseline.bound', async () => {
  const manifest = await json('public/baselines/current-2026-10-23.json');
  const report = await json(`public/reports/${manifest.reportHash}.json`);
  if (!verifyBaseline(manifest, report)) throw new Error('the baseline manifest does not bind its report');
  return `${manifest.id} binds ${manifest.reportHash.slice(0, 12)}…`;
});
const v1 = await json('public/lifecycle/token-list.json');
await check('token-list.v1.sources', async () => {
  const joined = (await Promise.all(['ReviveCheckGuard.sol', 'VerifiedTokenList.sol'].map((file) => text(`contracts/deployed/v1/${file}`)))).join('\n');
  const artifact = await json('artifacts/VerifiedTokenList.json');
  if (sha256(joined) !== v1.sourceSha256) throw new Error('contracts/deployed/v1 no longer hash to the v1 record');
  if (artifact.sourceSha256 !== v1.sourceSha256 || (artifact.deployedBytecode.length - 2) / 2 !== v1.runtimeBytes) throw new Error('artifacts/VerifiedTokenList.json is no longer the v1 artifact');
  return `v1 at ${v1.contract} (#${v1.deploy.blockNumber}), sources ${v1.sourceSha256.slice(0, 12)}…`;
});
const manifest = normalizeManifest(await json('deployments/token-list-v2.manifest.json'));
let v2Record = null;
await check('token-list.v2.manifest', async () => {
  const { extra, ...artifact } = await compileTokenList();
  checkArtifact(manifest, artifact);
  if (manifest.constructor.registry !== REGISTRY.address) throw new Error('the manifest does not reuse the deployed ReleaseRegistry');
  try { v2Record = await json(manifest.records.record); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (v2Record && (v2Record.manifestHash !== manifest.manifestHash || v2Record.sourceSha256 !== artifact.sourceSha256)) throw new Error('the v2 record was written for other sources or another manifest');
  return `v2 sources ${artifact.sourceSha256.slice(0, 12)}… match the manifest (${(artifact.deployedBytecode.length - 2) / 2} runtime bytes)${v2Record ? `; deployed at ${v2Record.address}` : '; not deployed'}`;
});
await check('token-list.deployments-module', async () => {
  const rendered = renderDeploymentsModule(deploymentsFromRecords({ v1, v2: v2Record ? { ...v2Record, recordPath: manifest.records.record } : null, active: TOKEN_LIST_VERSIONS.active }));
  if (rendered !== await text(manifest.activation.module)) throw new Error(`${manifest.activation.module} differs from a fresh render of the records`);
  if (TOKEN_LIST_VERSIONS.active === 'v2' && !v2Record) throw new Error('v2 is active without a record');
  return `active ${TOKEN_LIST_VERSIONS.active} at ${TOKEN_LIST.address}`;
});
await check('registry.record', async () => {
  const record = await json('public/lifecycle/registry.json');
  const artifact = await compileReleaseRegistry();
  if (record.contract !== REGISTRY.address || record.sourceSha256 !== REGISTRY.sourceSha256 || artifact.sourceSha256 !== record.sourceSha256) throw new Error('the registry record, library constant and sources disagree');
  return `registry at ${record.contract} (#${record.deploy.blockNumber}), sources ${record.sourceSha256.slice(0, 12)}…`;
});
await check('feed.consistent', async () => {
  const feed = await json('public/api/registry.json');
  if (feed.registry.address !== REGISTRY.address) throw new Error('the feed names another registry');
  if (feed.tokenList?.address !== TOKEN_LIST.address) throw new Error(`the feed indexes ${feed.tokenList?.address}, the active token list is ${TOKEN_LIST.address}; rebuild it with scripts/index-registry.js`);
  for (const file of ['public/lifecycle/reference.json', 'public/lifecycle/studio-run.json', 'public/lifecycle/evidence.json', 'public/lifecycle/release-gate.json']) await json(file);
  return `feed indexed to #${feed.indexedTo}: ${feed.releases.length} releases, ${feed.listings.length} listings, ${feed.evidence.length} stored reports`;
});
await check('catalog.bindings', async () => {
  const config = normalizeConfig(await json('examples/token-catalog/config/testnet.json'));
  normalizeConfig(await json('examples/token-catalog/config/local.json'));
  const { bindings } = await json(path.join(config.data, 'bindings.json'));
  for (const binding of bindings) {
    if (!verifyBinding(binding, config.policy)) throw new Error(`binding ${binding.id} does not verify under the catalog policy`);
    const report = await json(`public/reports/${binding.reportHash}.json`);
    if (!verifyRun(report)) throw new Error(`bound report ${binding.reportHash} does not verify`);
  }
  return `${bindings.length} testnet binding${bindings.length === 1 ? '' : 's'} verify under policy ${config.policyHash.slice(0, 12)}…`;
});
await check('language.english', async () => {
  // Built from code points so this file carries no non-English character itself: Hiragana and Katakana, CJK ideographs (extension A and unified), Hangul syllables.
  const range = (from, to) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
  const cjk = new RegExp(`[${range(0x3040, 0x30ff)}${range(0x3400, 0x4dbf)}${range(0x4e00, 0x9fff)}${range(0xac00, 0xd7af)}]`);
  const skip = new Set(['docs/OBSIDIAN_INPUTS.md']); // vault note titles are identifiers of files outside this repository
  const found = [];
  async function walk(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (!['node_modules', 'dist', 'scratchpad', 'video', '.git', 'artifacts', 'public', '.impeccable', '.private', '.revivecheck'].includes(entry.name)) await walk(relative); continue; }
      if (!/\.(md|js|jsx|json|yml|sol|html|css)$/.test(entry.name) || skip.has(relative)) continue;
      if (cjk.test(await text(relative))) found.push(relative);
    }
  }
  await walk('.');
  if (found.length) throw new Error(`non-English text in ${found.join(', ')}`);
  return 'no non-English text in authored files (vault note identifiers in docs/OBSIDIAN_INPUTS.md excepted)';
});

let commit = null;
try { commit = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(); } catch { /* not a git checkout */ }
let estimate = null;
try { const files = (await readdir(path.join(root, 'deployments'))).filter((file) => /^token-list-v2\.estimate-.*\.json$/.test(file)).sort(); if (files.length) estimate = await json(`deployments/${files.at(-1)}`); } catch { /* no estimate yet */ }
const status = {
  schema: 'revivecheck.release-status.v1', checkedAt: new Date().toISOString(), commit, status: checks.every((item) => item.status === 'passed') ? 'ok' : 'failed', checks,
  deployed: { registry: { address: REGISTRY.address, block: REGISTRY.deploy.blockNumber }, tokenList: { active: TOKEN_LIST_VERSIONS.active, version: TOKEN_LIST.version, address: TOKEN_LIST.address, block: TOKEN_LIST.deploy.blockNumber, knownIssue: TOKEN_LIST.knownIssue } },
  pending: [
    ...(v2Record ? [] : [{ item: 'VerifiedTokenList v2 deployment', why: 'needs testnet tPOT for the code deposit', estimate: estimate ? { estimatedAt: estimate.estimatedAt, maxStorageDepositTpot: estimate.maxStorageDepositTpot, estimatedFeeTpot: estimate.estimatedFeeTpot, estimatedCostTpot: estimate.estimatedCostTpot, availableTpot: estimate.availableTpot, shortfallTpot: estimate.shortfallTpot } : null, command: 'node scripts/deploy-token-list.js (estimate) · --broadcast --max-cost-tpot <n> (sign) · node scripts/activate-token-list.js --write (activate)' }]),
    ...(TOKEN_LIST_VERSIONS.active === 'v1' ? [{ item: 'Token Catalog on v2', why: 'the testnet catalog consumes the v1 list until v2 is deployed and activated; the local lifecycle already runs on v2' }] : []),
  ],
};
if (outIndex >= 0) await writeFile(path.resolve(root, args[outIndex + 1]), `${JSON.stringify(status, null, 2)}\n`);
console.log(JSON.stringify(status, null, 2));
if (status.status !== 'ok') process.exitCode = 1;
