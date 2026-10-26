#!/usr/bin/env node
// The authoritative release-status record, built offline from the published records.
// Every record this repository publishes must be intact and consistent with the
// others before a build is called a release: sealed reports hash to their names, the
// baseline manifest binds its report, the v1 sources and artifact still hash to the v1
// deployment record, the v2 manifest matches the sources in contracts/, the generated
// deployments module matches the records, the feed names the active token list, the
// catalog bindings verify, the recorded live lifecycle is backed by finalized receipts
// in the public records, the published catalogs equal their sources, and no authored
// file carries non-English text.
//
// The record separates levels that are easy to conflate: records intact, deployed,
// listed, evaluated, lifecycle complete, independently adopted. A green integrity
// check never implies a later level; each level names the evidence it rests on or
// the reason it is not established. Prints the status with the exact commit; exits 1
// on any failed integrity check. `--out <file>` also writes it.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyRun, validateImportedRun, fingerprint } from '../lib/report.js';
import { verifyBaseline } from '../lib/baseline.js';
import { REGISTRY } from '../lib/registry.js';
import { TOKEN_LIST, TOKEN_LIST_VERSIONS } from '../lib/tokenlist.js';
import { NETWORKS } from '../lib/networks.js';
import { normalizeManifest, checkArtifact, deploymentsFromRecords, renderDeploymentsModule } from '../lib/deployment.js';
import { verifyBinding } from '../lib/policy.js';
import { compileTokenList } from './compile-token-list.js';
import { compileReleaseRegistry } from './compile-release-registry.js';
import { normalizeConfig, classifyBindings, latestBinding, approvedEntry, compareEntry } from '../examples/token-catalog/lib/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const json = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const optional = async (file) => { try { return await json(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const text = (file) => readFile(path.join(root, file), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const HASH = /^0x[a-f0-9]{64}$/;
const checks = [];
async function check(id, work) {
  try { const detail = await work(); checks.push({ id, status: 'passed', detail: detail ?? '' }); }
  catch (error) { checks.push({ id, status: 'failed', detail: String(error?.message || error).slice(0, 400) }); }
}
// Hosting metadata is NOT evidence status. Which build the site serves is stated by the hosting manifest the
// deployment procedure writes beside the served files (hosting.json, scripts/hosting-manifest.mjs), never here,
// so this record and the site cannot contradict each other about "the current release".
const PUBLICATION = Object.freeze({
  site: 'https://revivecheck.axiqo.xyz/', hostingManifest: 'https://revivecheck.axiqo.xyz/hosting.json', hostingProcedure: 'docs/DEPLOYMENT.md', publicationRecords: ['docs/PUBLICATION_2026-10-24.md', 'docs/PUBLICATION_2026-10-25.md'],
  sourceRepository: 'https://github.com/a252937166/ReviveCheck', sourceBranch: 'main', build: 'https://dorahacks.io/build/50176', buildDescribes: 'the 2026-10-24 release; not yet updated',
  consumerExample: { repository: 'revivecheck-consumer-example (separate repository; published state is recorded in its README)', interface: 'Token eligibility demo (browser) and a command line, installed from the packed 0.5.3 artifact; prepares a versioned catalog release (revivecheck.catalog-release.v1) that a separate reader consumes; author-built, portability not adoption' },
  video: 'https://www.youtube.com/watch?v=CvpzlQfya4U', videoRecordedAgainst: '2026-10-24 release (v0.3): the v2 deployment and the simulated catalog lifecycle; it predates the live v2 lifecycle recorded on 2026-10-25',
  deck: 'docs/FINAL_DECK.md', historicalDeck: 'artifacts/ReviveCheck-Check-in-Deck.pdf', freeze: '2026-11-06T04:00:00Z (November 5, 2026, 23:00 EST)',
});

// 1. Integrity of every published record.
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
  if (!v1.listings?.length) throw new Error('the v1 record lost its recorded listing');
  return `v1 at ${v1.contract} (#${v1.deploy.blockNumber}), sources ${v1.sourceSha256.slice(0, 12)}…, ${v1.listings.length} recorded listing kept`;
});
const manifest = normalizeManifest(await json('deployments/token-list-v2.manifest.json'));
let v2Record = null;
await check('token-list.v2.manifest', async () => {
  const { extra, ...artifact } = await compileTokenList();
  checkArtifact(manifest, artifact);
  if (manifest.constructor.registry !== REGISTRY.address) throw new Error('the manifest does not reuse the deployed ReleaseRegistry');
  v2Record = await optional(manifest.records.record);
  if (v2Record && (v2Record.manifestHash !== manifest.manifestHash || v2Record.sourceSha256 !== artifact.sourceSha256)) throw new Error('the v2 record was written for other sources or another manifest');
  if (v2Record && (v2Record.verification?.checks || []).some((item) => item.status !== 'passed')) throw new Error('the v2 record carries a failed verification check');
  return `v2 sources ${artifact.sourceSha256.slice(0, 12)}… match the manifest (${(artifact.deployedBytecode.length - 2) / 2} runtime bytes)${v2Record ? `; deployed at ${v2Record.address}, ${v2Record.verification?.checks?.length ?? 0} verification checks passed` : '; not deployed'}`;
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
let feed = null;
await check('feed.consistent', async () => {
  feed = await json('public/api/registry.json');
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
  return `${bindings.length} historical v1 binding${bindings.length === 1 ? '' : 's'} verify under policy ${config.policyHash.slice(0, 12)}…`;
});

// 2. The v2 catalog: binding, listing, evaluation and the published entry.
const levels = { listed: null, evaluated: null, lifecycle: null };
let v2 = { config: null, binding: null, listing: null, catalog: null, evaluation: null, lifecycle: null };
await check('catalog.v2.binding-listing-evaluation', async () => {
  const pending = (why) => { levels.listed = levels.listed ?? { established: false, why }; levels.evaluated = { established: false, why }; return `${why} Pending.`; };
  if (!v2Record || TOKEN_LIST_VERSIONS.active !== 'v2') return pending('The verified v2 consumer is not active.');
  const configFile = await optional('examples/token-catalog/config/testnet-v2.json');
  if (!configFile) return pending('The separate v2 catalog configuration has not been created.');
  const config = normalizeConfig(configFile);
  v2.config = config;
  if (config.mode !== 'testnet' || config.policy.consumer?.address !== v2Record.address || config.policy.consumer.version !== 2 || config.policy.registry.address !== REGISTRY.address) throw new Error('The v2 catalog policy does not name the verified v2 consumer and reused registry.');
  const history = await optional(path.join(config.data, 'bindings.json'));
  if (!history?.bindings?.length) return pending('The separate v2 catalog has no explicit binding.');
  const classified = classifyBindings(history.bindings, config);
  for (const binding of history.bindings) validateImportedRun(await json(`public/reports/${binding.reportHash}.json`));
  const binding = latestBinding(classified.current, config.policy.subject.address);
  if (!binding) return pending(`No v2 binding under the current policy names the configured token (${classified.historical.length} historical).`);
  v2.binding = binding;
  const listing = (v2Record.listings || []).find((item) => item.token === config.policy.subject.address && item.releaseId === binding.releaseId && item.reportHash === `0x${binding.reportHash}` && config.policy.reviewers.trusted.includes(String(item.reviewer).toLowerCase()) && item.readback?.listed === true && item.readback?.interfacesAgree === true && HASH.test(item.extrinsicHash || ''));
  if (!listing) return pending('The v2 deployment record has no finalized listing with agreeing readback for the bound report, revision and a trusted reviewer.');
  v2.listing = listing;
  levels.listed = { established: true, extrinsicHash: listing.extrinsicHash, blockNumber: listing.blockNumber, reportHash: binding.reportHash, releaseId: binding.releaseId, revision: binding.revision, reviewer: listing.reviewer, readbackBlock: listing.readback.block?.number ?? null };
  const catalog = await optional(path.join(config.data, 'catalog.json'));
  const evaluation = await optional(path.join(config.data, 'evaluations', `${config.policy.subject.address}.json`));
  if (!catalog || !evaluation) return pending('The v2 catalog has not recorded its live policy evaluation.');
  const { evaluationHash, ...payload } = evaluation;
  if (fingerprint(payload) !== evaluationHash || evaluation.policyHash !== config.policyHash || evaluation.reportHash !== binding.reportHash || evaluation.bindingId !== binding.id || evaluation.releaseId !== binding.releaseId || evaluation.revision !== binding.revision || evaluation.simulation !== false) throw new Error('The v2 evaluation does not verify or does not bind the exact v2 policy and report.');
  const entry = catalog.tokens?.find((item) => item.address === config.policy.subject.address);
  if (catalog.simulation !== false || catalog.policy?.hash !== config.policyHash || catalog.policy?.consumer?.address !== v2Record.address || entry?.evaluation?.evaluationHash !== evaluationHash) throw new Error('The v2 catalog and its evaluation disagree.');
  // The published entry is re-derived here from the bound report; the catalog's own comparison is not trusted blindly.
  const report = await json(`public/reports/${binding.reportHash}.json`);
  const comparison = compareEntry(config.tokens[0], approvedEntry(report).entry);
  if (!comparison.match || entry.entry?.match !== true || entry.entry?.source !== 'approved-report') return pending(`The published entry differs from the approved report (${comparison.reason || entry.entry?.reason}).`);
  if (evaluation.status !== 'valid' || evaluation.enable !== true || entry.available !== true || !Array.isArray(evaluation.checks) || !evaluation.checks.length || evaluation.checks.some((item) => item.status !== 'passed')) return pending(`The recorded v2 policy evaluation is ${evaluation.status || 'unknown'}, not valid.`);
  const checkpoint = evaluation.checkpoint?.listing;
  if (!HASH.test(checkpoint?.nativeHash || '') || !HASH.test(checkpoint?.evmHash || '') || BigInt(checkpoint.number) < BigInt(listing.blockNumber) || !Number.isFinite(Date.parse(evaluation.evaluatedAt))) throw new Error('The v2 evaluation lacks a dated finalized listing checkpoint after the listing.');
  v2.catalog = catalog; v2.evaluation = evaluation;
  levels.evaluated = { established: true, evaluationHash, evaluatedAt: evaluation.evaluatedAt, checkpoint, checks: evaluation.checks.length, policyHash: config.policyHash, bindingId: binding.id, entryIdentity: entry.entry.identity, scope: 'a recorded point-in-time evaluation; nothing monitors continuously' };
  return `v2 listing ${listing.extrinsicHash} and policy evaluation ${evaluationHash} verify at #${checkpoint.number}; the published entry equals the approved report`;
});

// 3. The recorded live lifecycle: every receipt in the public records, every capture present, the expected transitions observed.
const EXPECTED_STEPS = ['submit', 'review:approved', 'list', 'submit', 'review:approved', 'list', 'review:changes', 'review:approved'];
await check('lifecycle.v2.recorded', async () => {
  const fail = (why) => { levels.lifecycle = { established: false, why }; return `${why} Pending.`; };
  if (!v2.config) return fail('No v2 catalog configuration.');
  const lifecycle = await optional(path.join(v2.config.data, 'lifecycle.json'));
  if (!lifecycle?.steps?.length) return fail('No live lifecycle has been recorded for the v2 catalog.');
  if (lifecycle.policyHash !== v2.config.policyHash) throw new Error('lifecycle.json was recorded under another policy');
  const writes = (await optional('public/lifecycle/registry-writes.json'))?.items || [];
  const stored = (await optional('public/lifecycle/evidence.json'))?.items || [];
  const listings = v2Record?.listings || [];
  const receipts = [];
  for (const step of lifecycle.steps) {
    if (!(await optional(step.capture))) throw new Error(`step ${step.index} (${step.step}) has no captured inputs at ${step.capture}`);
    const capture = await json(step.capture);
    if (capture.policyHash !== v2.config.policyHash) throw new Error(`capture of step ${step.index} was made under another policy`);
    for (const receipt of step.receipts) {
      const record = receipt.kind === 'store' ? stored.find((item) => item.extrinsicHash === receipt.extrinsicHash && item.reportHash === receipt.reportHash)
        : receipt.kind === 'list' ? listings.find((item) => item.extrinsicHash === receipt.extrinsicHash && item.reportHash === `0x${receipt.reportHash}`)
        : writes.find((item) => item.extrinsicHash === receipt.extrinsicHash && item.action === receipt.kind && item.reportHash === `0x${receipt.reportHash}` && (receipt.kind !== 'review' || item.approved === receipt.approved));
      if (!record) throw new Error(`step ${step.index} (${step.step}) names receipt ${receipt.extrinsicHash} that no public record carries`);
      if (String(record.blockNumber) !== String(receipt.blockNumber)) throw new Error(`step ${step.index}: receipt block differs from the record`);
      receipts.push(`${receipt.kind}${receipt.kind === 'review' ? (receipt.approved ? ':approved' : ':changes') : ''}`);
    }
  }
  const observed = receipts.filter((kind) => kind !== 'store');
  if (JSON.stringify(observed) !== JSON.stringify(EXPECTED_STEPS)) throw new Error(`the recorded receipts ${observed.join(', ')} are not the expected sequence ${EXPECTED_STEPS.join(', ')}`);
  const statuses = lifecycle.steps.map((step) => `${step.step}=${step.status}${step.available ? '+' : '-'}`);
  const final = lifecycle.steps.at(-1);
  if (final.status !== 'valid' || final.available !== true || final.listing?.listed !== true) throw new Error('the lifecycle does not end in a valid, listed, available entry');
  const transitions = { invalidated: lifecycle.steps.some((step) => step.reasons.includes('revision-superseded') && step.listing?.listed === false), approvalAloneInsufficient: lifecycle.steps.some((step) => step.step === 'approve-r2' && step.reasons.includes('revision-superseded')), rebound: lifecycle.steps.some((step) => step.step === 'rebind-r2' && JSON.stringify(step.reasons) === JSON.stringify(['consumer-not-listed'])), restored: lifecycle.steps.some((step) => step.step === 'relist-r2' && step.status === 'valid'), revoked: lifecycle.steps.some((step) => step.reasons.includes('approval-revoked') && step.listing?.listed === false), recovered: final.step === 'reapprove-r2' };
  const missing = Object.entries(transitions).filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) throw new Error(`the recorded lifecycle lacks ${missing.join(', ')}`);
  v2.lifecycle = lifecycle;
  const signers = new Set(lifecycle.steps.flatMap((step) => step.receipts.map((receipt) => receipt.signer)));
  levels.lifecycle = { established: true, steps: lifecycle.steps.length, receipts: receipts.length, signers: [...signers], transitions, first: lifecycle.steps[0].at, last: final.at, lastCheckpoint: final.listing?.block ?? null, scope: 'live Portaldot V3 testnet transactions signed by two project-controlled accounts (owner and reviewer); role separation, not independent review. Expiry, unsupported-runtime and node-outage cases remain local simulations.' };
  return `${lifecycle.steps.length} live steps, ${receipts.length} receipts each found in the public records; ${statuses.join(', ')}`;
});
await check('roles.separated', async () => {
  const reviewer = await optional('docs/REVIEWER_WALLET_PUBLIC.json');
  if (!reviewer?.ss58Address) throw new Error('no public record of the reviewer account');
  if (reviewer.mnemonic || reviewer.seed || reviewer.secret) throw new Error('the public reviewer record carries secret material');
  const funding = (await optional('public/lifecycle/funding.json'))?.items?.find((item) => item.to === reviewer.ss58Address);
  if (!funding || !HASH.test(funding.extrinsicHash || '')) throw new Error('the reviewer account has no recorded funding transfer');
  const writes = (await optional('public/lifecycle/registry-writes.json'))?.items || [];
  const owner = await json('docs/WALLET_PUBLIC.json');
  const decisions = writes.filter((item) => item.action === 'review' && item.signer === reviewer.ss58Address);
  const submissions = writes.filter((item) => item.action === 'submit' && item.signer === owner.ss58Address);
  if (!decisions.length || !submissions.length) throw new Error('no recorded registry writes signed by distinct owner and reviewer accounts');
  if (v2.config && !decisions.every((item) => v2.config.policy.reviewers.trusted.includes(item.sender))) throw new Error('a reviewer decision was signed by an account the v2 policy does not trust');
  if (decisions.some((item) => item.sender === submissions[0].sender)) throw new Error('owner and reviewer resolve to the same EVM address');
  return `owner ${owner.ss58Address} signed ${submissions.length} submissions, reviewer ${reviewer.ss58Address} signed ${decisions.length} decisions (funded in #${funding.blockNumber}); both are project-controlled`;
});
await check('catalog.published', async () => {
  const dirs = ['testnet-v2', 'testnet-v2-wrong-entry'];
  for (const dir of dirs) {
    for (const file of ['catalog.json', 'bindings.json']) {
      const [source, published] = await Promise.all([text(`examples/token-catalog/data/${dir}/${file}`), text(`public/catalog/${dir}/${file}`)]);
      if (source !== published) throw new Error(`public/catalog/${dir}/${file} differs from its source; run catalog.js publish`);
    }
  }
  const wrong = await json('public/catalog/testnet-v2-wrong-entry/catalog.json');
  if (wrong.tokens[0].available !== false || !wrong.tokens[0].reasons.includes('entry-mismatch:decimals') || wrong.tokens[0].status !== 'valid') throw new Error('the wrong-entry demonstration no longer shows a valid policy with a withheld entry');
  const historical = await json('public/catalog/testnet/catalog.json');
  if (historical.policy?.consumer?.address !== v1.contract) throw new Error('the published historical catalog does not name the v1 consumer');
  return `${dirs.join(' and ')} published unchanged; the wrong-entry demonstration withholds a valid approval (${wrong.tokens[0].reasons.join(', ')}); v1 published as history`;
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

// 4. The record.
let commit = null;
try { commit = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(); } catch { /* not a git checkout */ }
const intact = checks.every((item) => item.status === 'passed');
const writes = (await optional('public/lifecycle/registry-writes.json'))?.items || [];
const stored = (await optional('public/lifecycle/evidence.json'))?.items || [];
const funding = (await optional('public/lifecycle/funding.json'))?.items || [];
const transactions = [
  ...(v2Record ? [{ kind: 'deploy', what: 'VerifiedTokenList v2 instantiated', extrinsicHash: v2Record.deploy?.extrinsicHash, blockNumber: v2Record.deploy?.blockNumber, finalizedAt: v2Record.deploy?.finalizedAt, signer: v2Record.deployer?.ss58 ?? v2Record.deployer ?? null }] : []),
  ...funding.map((item) => ({ kind: 'transfer', what: `${item.amountTpot} tPOT to the reviewer account`, extrinsicHash: item.extrinsicHash, blockNumber: item.blockNumber, finalizedAt: item.finalizedAt, signer: item.from })),
  ...stored.map((item) => ({ kind: 'store', what: `report ${item.reportHash.slice(0, 12)}… stored (${item.bytes} bytes)`, extrinsicHash: item.extrinsicHash, blockNumber: item.blockNumber, finalizedAt: item.finalizedAt, signer: item.publisher })),
  ...writes.map((item) => ({ kind: item.action === 'submit' ? 'submit' : item.approved ? 'approve' : 'changes-requested', what: item.action === 'submit' ? `${item.label} revision ${item.revision} · ${item.reportHash.slice(0, 14)}…` : `revision ${item.revision} ${item.approved ? 'approved' : 'changes requested'} · ${item.reportHash.slice(0, 14)}…`, extrinsicHash: item.extrinsicHash, blockNumber: item.blockNumber, finalizedAt: item.finalizedAt, signer: item.signer ?? null })),
  ...(v2Record?.listings || []).map((item) => ({ kind: 'list', what: `pUSD listed on v2 · ${item.reportHash.slice(0, 14)}…`, extrinsicHash: item.extrinsicHash, blockNumber: item.blockNumber, finalizedAt: item.finalizedAt, signer: null })),
  ...(v1.listings || []).map((item) => ({ kind: 'list', what: `pUSD listed on v1 (historical) · ${String(item.reportHash).slice(0, 14)}…`, extrinsicHash: item.extrinsicHash, blockNumber: item.blockNumber, finalizedAt: item.finalizedAt, signer: null })),
].filter((item) => item.extrinsicHash).sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
const lastStep = v2.lifecycle?.steps?.at(-1) || null;
const status = {
  schema: 'revivecheck.release-status.v2', checkedAt: new Date().toISOString(), commit, status: intact ? 'ok' : 'failed',
  network: { key: 'testnet', name: NETWORKS.testnet.name, chainId: NETWORKS.testnet.chainId, genesisHash: NETWORKS.testnet.genesisHash, runtime: lastStep?.observation?.runtime ?? 'portaldot-v3/3002', lastObservedAt: lastStep?.observation?.observedAt ?? null, lastFinalized: lastStep?.observation?.finalized ?? null },
  consumer: { active: TOKEN_LIST_VERSIONS.active, version: TOKEN_LIST.version, address: TOKEN_LIST.address, deployBlock: TOKEN_LIST.deploy.blockNumber, registry: REGISTRY.address, knownIssue: TOKEN_LIST.knownIssue, historical: { version: 1, address: v1.contract, deployBlock: v1.deploy.blockNumber, knownIssue: TOKEN_LIST_VERSIONS.v1?.knownIssue ?? null } },
  levels: [
    { level: 'records-intact', established: intact, evidence: `${checks.filter((item) => item.status === 'passed').length} of ${checks.length} integrity checks passed`, boundary: 'Integrity of the published files. It implies nothing about deployment, listing, evaluation or adoption.' },
    { level: 'deployed', established: !!v2Record && TOKEN_LIST_VERSIONS.active === 'v2', evidence: v2Record ? { address: v2Record.address, extrinsicHash: v2Record.deploy?.extrinsicHash, blockNumber: v2Record.deploy?.blockNumber, verification: v2Record.verification?.checks?.length ?? null } : null, boundary: 'The contract exists with verified code, version, registry and curator. It implies no listing or decision.' },
    { level: 'listed', established: levels.listed?.established === true, evidence: levels.listed, boundary: 'The consumer carries the entry on a trusted approval of the exact bound report, read back through both interfaces. It implies no current policy decision.' },
    { level: 'evaluated', established: levels.evaluated?.established === true, evidence: levels.evaluated, boundary: 'The policy evaluated valid and the published entry equals the approved report at the recorded checkpoint and time. Validity is point-in-time; evaluate again before each use.' },
    { level: 'lifecycle-complete', established: levels.lifecycle?.established === true, evidence: levels.lifecycle, boundary: 'The revision invalidation, re-approval, explicit rebinding, relisting, revocation and restoration happened on the testnet with finalized receipts. Two project-controlled signers show role separation, not independent review.' },
    { level: 'independently-adopted', established: false, evidence: { secondConsumer: 'a self-built second consumer (DEX allow-list) installed from the packed artifact is recorded separately; it shows portability, not adoption', externalBuilder: null, pilot: 'docs/PILOT_PROTOCOL.md: not yet run' }, boundary: 'No builder outside the project has installed, configured or used ReviveCheck. Nothing here claims adoption, revenue or an organizer decision.' },
  ],
  checks,
  catalogV2: levels.evaluated?.established ? { ready: true, evidenceScope: 'recorded live listing, policy evaluation and a complete recorded lifecycle on the v2 consumer with distinct owner and reviewer signers; expiry, unsupported runtime and node outage remain local simulations', policyHash: v2.config.policyHash, bindingId: v2.binding.id, reportHash: v2.binding.reportHash, version: 2, address: v2Record.address, listing: v2.listing.extrinsicHash, evaluatedAt: v2.evaluation.evaluatedAt, checkpoint: v2.evaluation.checkpoint?.listing ?? null } : { ready: false, why: levels.evaluated?.why ?? levels.listed?.why ?? 'not established' },
  completedTransactions: transactions,
  publication: PUBLICATION,
  pending: [
    ...(levels.listed?.established ? [] : [{ item: 'v2 listing', why: levels.listed?.why }]),
    ...(levels.evaluated?.established ? [] : [{ item: 'v2 evaluation', why: levels.evaluated?.why }]),
    ...(levels.lifecycle?.established ? [] : [{ item: 'live v2 lifecycle', why: levels.lifecycle?.why }]),
    { item: 'Independent adoption', why: 'No external builder has installed or configured ReviveCheck; the second consumer and the benchmark are author-run.' },
    { item: 'Maintainer pilot', why: 'docs/PILOT_PROTOCOL.md describes the study; no participant has run it.' },
    { item: 'Video and DoraHacks build', why: 'The video, recorded on 2026-10-24, and the DoraHacks build description still describe the 2026-10-24 release; the hosted build is identified by hosting.json on the site, not by this record.' },
    { item: 'Evidence renewal', why: `The bound report ${v2.binding?.reportHash ? `${v2.binding.reportHash.slice(0, 12)}…` : ''} is acceptable under the seven-day policy until ${v2.binding ? new Date(Date.parse((await json(`public/reports/${v2.binding.reportHash}.json`)).completedAt) + v2.config.policy.evidence.maxAgeSeconds * 1000).toISOString() : 'unknown'}; docs/RENEWAL.md is the runbook. No renewal transaction has been sent.` },
  ],
};
if (outIndex >= 0) await writeFile(path.resolve(root, args[outIndex + 1]), `${JSON.stringify(status, null, 2)}\n`);
console.log(JSON.stringify(status, null, 2));
if (status.status !== 'ok') process.exitCode = 1;
