import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, demoProjectRecord, noteReport, updatePolicy, policyFor, policyStatus, projectView, bindCandidate, consumerConfigFor, exportBundle, importBundle, confirmReviewers, releaseLabelFor, setReleaseLabel, loadProjects, saveProjects, withProject, selectProject, removeProject, listProjects, studioProject, BUNDLE_SCHEMA, CONSUMER_CONFIG_SCHEMA } from '../src/projects.js';
import { emptySession, recordImport, applyStage, DEMO_PROJECT } from '../src/studio-state.js';
import { ownPlanFromForm } from '../src/own-plan.js';
import { verifyBinding, evaluateBinding } from '../lib/policy.js';
import { loadConfigShape } from './helpers/consumer-config.js';

// Product plan 2026-10-25, D-02: two separately named projects on the same asset, each
// with its own policy, release identity, storage locator and binding candidate; switching
// never mixes them; the exported configuration is the one the separate consumer reads;
// a bundle round-trips with its fingerprints and holds imported reviewer trust apart.
const load = (hash) => readFile(new URL(`../public/reports/${hash}.json`, import.meta.url), 'utf8').then(JSON.parse);
const REPORT = await load('1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51');
const REVIEWER = '0x95db300103ec8b45884b13ed85230fbf02114065', OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const RELEASE = '0x28ab8a86a4d1ca4f5b38784d8f0a32c14ed163ae7f1ff9f4f5b5128fe5fdd927';
const T = '2026-10-25T12:00:00.000Z';
// These versioned captures are also the source of the separate consumer's valid-r2
// and revoked-r2 fixtures. Read their raw evidence and clock without another checkout.
async function consumerCapture(name) {
  const capture = JSON.parse(await readFile(new URL(`../examples/token-catalog/data/testnet-v2/captures/${name}.inputs.json`, import.meta.url), 'utf8'));
  const { observation, registry, listing, evidence } = capture.tokens['0x00001e6100000000000000000000000000010000'];
  return { inputs: { observation, registry, listing, evidence }, now: capture.now };
}
const form = (projectName) => ({ projectName, logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' });
const tx = (block) => ({ route: 'native', extrinsicHash: `0x${'31'.repeat(32)}`, blockHash: `0x${'32'.repeat(32)}`, blockNumber: String(block), success: true });

/** A project whose studio session holds the report, its storage, its submission and its approval. */
function established(name) {
  const plan = ownPlanFromForm(form(name));
  // The release label is part of the policy: the registry's release ID is derived from the owner and the label, so the label names the real release.
  let project = setReleaseLabel(createProject({ name, plan, at: T, policy: { reviewers: { trusted: [REVIEWER], basis: 'A separate account named by this project; its control is stated in the roles.' } } }), 'pusd-catalog-v2', { at: T });
  let session = recordImport(emptySession(studioProject(project)), { plan, report: REPORT, at: T });
  session = applyStage(session, 'store', { reportHash: REPORT.evidenceHash, bytes: 9000, contentHash: '0xab', tx: { ...tx(187145), extrinsicHash: '0x80d46a8611bb486f3b71bdd6e9e15c96e522c536e2671c9f35d0a4496792feb3', blockHash: '0x18a28f38f2a66093eab90d11f438664428141cfade5df5ce031ff3f4519ce868' }, retrieved: { verified: true } });
  session = applyStage(session, 'submit', { label: project.release.label, releaseId: RELEASE, reportHash: REPORT.evidenceHash, from: '5GH8…', sender: OWNER, tx: tx(187165), readback: { release: { revision: '2', reportHash: `0x${REPORT.evidenceHash}` } } });
  session = applyStage(session, 'approve', { releaseId: RELEASE, approved: true, reportHash: `0x${REPORT.evidenceHash}`, revision: '2', reviewer: REVIEWER, from: '5Dtq…', tx: tx(187181) });
  project = noteReport(project, REPORT, { source: 'import', at: T });
  return { project, session };
}

test('a project derives its identity from the plan; the policy is complete only when every field is declared', () => {
  const plan = ownPlanFromForm(form('Alpha list'));
  const project = createProject({ name: 'Alpha list', plan, at: T });
  assert.equal(project.planHash, 'ce76c98f90e2851aff534febe6c39a4802fbef32e478a665d3e4109352222191');
  assert.match(project.id, /^own-alpha-list-ce76c98f$/);
  assert.equal(project.release.label, 'alpha-list');
  assert.equal(releaseLabelFor('A very long project name that goes past thirty-one bytes'), 'a-very-long-project-name-that-g');
  const status = policyStatus(project);
  assert.equal(status.complete, false);
  assert.match(status.error, /reviewers\.trusted/);
  const withReviewer = updatePolicy(project, { reviewers: { trusted: [REVIEWER] } });
  assert.match(policyStatus(withReviewer).error, /basis/);
  const complete = updatePolicy(withReviewer, { reviewers: { basis: 'A separate account named by this project.' } });
  const policy = policyFor(complete);
  assert.equal(policy.subject.address, plan.listing.address);
  assert.equal(policy.planHash, project.planHash);
  assert.equal(policy.registry.label, 'alpha-list');
  assert.equal(policy.registry.owner, undefined, 'no owner until a submission established one');
  assert.equal(policy.consumer.version, 2);
  assert.equal(policy.evidence.requireStoredOnChain, true);
  const demo = demoProjectRecord();
  assert.equal(demo.id, DEMO_PROJECT.id);
  assert.equal(demo.kind, 'demo');
  assert.equal(demo.release.label, 'pusd-token-list');
});

test('two projects on the same asset keep separate policies, release identities and candidates; nothing of one appears in the other', () => {
  const alpha = established('Alpha list');
  const beta = { project: updatePolicy(createProject({ name: 'Beta list', plan: ownPlanFromForm(form('Beta list')), at: T }), { reviewers: { trusted: [OWNER], basis: 'Beta trusts the owner account (mechanism only).' }, evidence: { requireStoredOnChain: false } }), session: emptySession(studioProject(createProject({ name: 'Beta list', plan: ownPlanFromForm(form('Beta list')), at: T }))) };
  assert.notEqual(alpha.project.id, beta.project.id);
  assert.equal(alpha.project.planHash, beta.project.planHash, 'the same supported plan: the same acceptance-plan fingerprint');
  const alphaView = projectView(alpha.project, alpha.session);
  const betaView = projectView(beta.project, beta.session);
  assert.equal(alphaView.candidate.reportHash, REPORT.evidenceHash);
  assert.equal(alphaView.candidate.revision, '2');
  assert.equal(alphaView.candidate.storage.extrinsicHash, '0x80d46a8611bb486f3b71bdd6e9e15c96e522c536e2671c9f35d0a4496792feb3');
  assert.equal(alphaView.candidate.complete, true);
  assert.equal(alphaView.review.approved, true);
  assert.equal(betaView.candidate, null, 'Beta has checked nothing: no candidate, nothing borrowed from Alpha');
  assert.deepEqual(betaView.missing, ['a report (run the check)', 'a submission to the registry (Submit)']);
  const alphaPolicy = policyFor(alpha.project, alphaView), betaPolicy = policyFor(beta.project, betaView);
  assert.notEqual(alphaPolicy.registry.label, betaPolicy.registry.label);
  assert.deepEqual(alphaPolicy.reviewers.trusted, [REVIEWER]);
  assert.deepEqual(betaPolicy.reviewers.trusted, [OWNER]);
  assert.equal(alphaPolicy.registry.owner, OWNER, 'the owner comes from Alpha\'s own submission');
  assert.equal(betaPolicy.registry.owner, undefined);
});

test('binding the candidate is an explicit act; the consumer configuration names exactly the bound report, release, revision and storage', async () => {
  const { project, session } = established('Alpha list');
  const view = projectView(project, session);
  assert.throws(() => bindCandidate(project, { view, report: { ...REPORT, evidenceHash: 'ff'.repeat(32) }, boundBy: 'operator' }), /not the candidate report/);
  const { project: bound, binding } = bindCandidate(project, { view, report: REPORT, boundBy: 'the visitor (browser-local project operator)', note: 'first binding', at: T, id: 'alpha-binding-1' });
  assert.equal(verifyBinding(binding, policyFor(bound, view)), true);
  assert.equal(binding.releaseId, RELEASE);
  assert.equal(binding.revision, '2');
  assert.equal(binding.storage.extrinsicHash, '0x80d46a8611bb486f3b71bdd6e9e15c96e522c536e2671c9f35d0a4496792feb3');
  assert.throws(() => bindCandidate(bound, { view, report: REPORT, boundBy: 'the visitor (browser-local project operator)', note: 'first binding', at: T, id: 'alpha-binding-1' }), /already exists/, 'the identical act is not recorded twice');
  const again = bindCandidate(bound, { view, report: REPORT, boundBy: 'the visitor (browser-local project operator)', note: 'bound again', at: '2026-10-25T12:05:00.000Z', id: 'alpha-binding-2' });
  assert.equal(again.project.bindings.length, 2, 'a rebinding is a new entry; the first stays as history');
  const config = consumerConfigFor(bound, projectView(bound, session));
  assert.equal(config.schema, CONSUMER_CONFIG_SCHEMA);
  assert.equal(config.release.reportHash, REPORT.evidenceHash);
  assert.equal(config.release.revision, '2');
  assert.equal(config.release.releaseId, RELEASE);
  assert.equal(config.release.owner, OWNER);
  assert.equal(config.release.storage.extrinsicHash, binding.storage.extrinsicHash);
  assert.deepEqual(config.entry, { chainId: 420420777, address: '0x00001e6100000000000000000000000000010000', symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6, assetId: '7777' });
  assert.equal(config.roles.reviewer.address, REVIEWER);
  loadConfigShape(config);
  // The separate consumer's evaluator accepts it: the same evaluation the Token eligibility demo makes, offline on the captured reads.
  const fixture = await consumerCapture('12-reapprove-r2');
  const evaluation = evaluateBinding({ policy: config.policy, binding, report: REPORT, ...fixture.inputs, now: fixture.now });
  assert.equal(evaluation.status, 'valid', JSON.stringify(evaluation.reasons));
  const broken = { ...bound, bindings: [{ ...binding, storage: null }] };
  assert.throws(() => consumerConfigFor(broken, projectView(broken, session)), /another policy/, 'a binding whose hash no longer recomputes is refused');
  const unbound = { ...bound, bindings: [] };
  assert.throws(() => consumerConfigFor(unbound, projectView(unbound, session)), /Bind the candidate explicitly first/);
});

test('a bundle round-trips with recomputed fingerprints; an altered bundle is refused; imported reviewer trust waits for confirmation', () => {
  const { project, session } = established('Alpha list');
  const view = projectView(project, session);
  const { project: bound } = bindCandidate(project, { view, report: REPORT, boundBy: 'operator', at: T, id: 'alpha-binding-1' });
  const bundle = exportBundle(bound, projectView(bound, session), { reports: [REPORT], at: T });
  assert.equal(bundle.schema, BUNDLE_SCHEMA);
  assert.equal(bundle.policyHash, policyStatus(bound, view).policyHash);
  assert.equal(bundle.sealedReports.length, 1);
  assert.equal(bundle.candidate.reportHash, REPORT.evidenceHash);
  const imported = importBundle(JSON.stringify(bundle), { at: '2026-10-25T13:00:00.000Z' });
  assert.equal(imported.project.planHash, bound.planHash);
  assert.equal(imported.project.releaseArtifactHash, bound.releaseArtifactHash);
  assert.equal(imported.project.release.label, 'pusd-catalog-v2');
  assert.equal(imported.project.bindings.length, 1);
  assert.equal(imported.sealedReports[0].evidenceHash, REPORT.evidenceHash);
  assert.deepEqual(imported.reviewerTrust.trusted, [REVIEWER]);
  assert.equal(imported.reviewerTrust.confirmed, false);
  assert.match(policyStatus(imported.project).error, /confirm it as your own policy choice/);
  const confirmed = confirmReviewers(imported.project, { at: '2026-10-25T13:01:00.000Z' });
  assert.equal(policyStatus(confirmed, projectView(confirmed, session)).complete, true);
  assert.equal(policyStatus(confirmed, projectView(confirmed, session)).policyHash, bundle.policyHash, 'the same declarations give the same policy hash');
  const altered = { ...bundle, plan: { ...bundle.plan, listing: { ...bundle.plan.listing, decimals: 18 } } };
  assert.throws(() => importBundle(JSON.stringify(altered)), /releaseArtifactHash does not match/);
  const tamperedBinding = { ...bundle, bindings: [{ ...bundle.bindings[0], revision: '3' }] };
  assert.throws(() => importBundle(JSON.stringify(tamperedBinding)), /not intact/);
  const foreignBinding = { ...bundle, bindings: [{ ...bundle.bindings[0] }], policy: { ...bundle.policy, name: 'another policy' }, policyHash: undefined };
  assert.throws(() => importBundle(JSON.stringify(foreignBinding)), /not made under the bundle's policy/);
  assert.throws(() => importBundle('{"schema":"other"}'), /declares schema/);
  assert.throws(() => importBundle('nope'), /not valid JSON/);
});

test('the browser store holds the demonstration project and the visitor\'s own; removing one never touches the demonstration', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  let store = loadProjects({ storage });
  assert.equal(store.activeProjectId, DEMO_PROJECT.id);
  const alpha = createProject({ name: 'Alpha list', plan: ownPlanFromForm(form('Alpha list')), at: T });
  store = selectProject(withProject(store, alpha), alpha.id);
  saveProjects(store, { storage });
  const reread = loadProjects({ storage });
  assert.equal(reread.activeProjectId, alpha.id);
  assert.deepEqual(listProjects(reread).map((project) => project.id), [DEMO_PROJECT.id, alpha.id]);
  assert.throws(() => removeProject(reread, DEMO_PROJECT.id), /cannot be removed/);
  const removed = removeProject(reread, alpha.id);
  assert.equal(removed.activeProjectId, DEMO_PROJECT.id);
  assert.equal(selectProject(removed, 'missing').activeProjectId, DEMO_PROJECT.id, 'selecting an unknown project changes nothing');
  assert.equal(studioProject(alpha).plan.listing.symbol, 'pUSD');
  assert.equal(studioProject(demoProjectRecord()).plan, undefined, 'the demonstration project offers the demo releases, not one fixed plan');
});

// Repair handoff 2026-10-26, R-03: a bundle imported into a browser that holds nothing
// of the original session keeps the policy fingerprint (through the declared owner), the
// existing binding and the exports; declarations stay declarations; contradictions fail.
test('R03-A to R03-E, R03-H: the bundle round-trips into an empty browser with the same policy hash and an intact binding; exports work; declarations are cross-checked; a references-only bundle names its missing evidence', async () => {
  const { loadConsumerConfig } = await import('../lib/catalog-release.js');
  const { project, session } = established('Alpha list');
  const view = projectView(project, session);
  const { project: bound } = bindCandidate(project, { view, report: REPORT, boundBy: 'operator', at: T, id: 'alpha-binding-1' });
  const bundle = exportBundle(bound, projectView(bound, session), { reports: [REPORT], at: T });
  assert.equal(bundle.release.owner, OWNER, 'the bundle declares the owner the submission established');
  assert.equal(bundle.release.releaseId, RELEASE);
  assert.equal(bundle.storage.extrinsicHash, '0x80d46a8611bb486f3b71bdd6e9e15c96e522c536e2671c9f35d0a4496792feb3');
  // A completely empty browser: no session, no receipts. Only the sealed report the bundle embeds is handed to the new session, as the page does.
  const imported = importBundle(JSON.stringify(bundle), { at: '2026-10-26T09:00:00.000Z' });
  assert.deepEqual(imported.missingEvidence, []);
  assert.equal(imported.project.release.owner, OWNER);
  assert.equal(imported.project.release.releaseId, RELEASE);
  assert.equal(imported.project.release.declared.source, 'bundle');
  assert.match(imported.project.release.declared.note, /not by importing/);
  const freshSession = recordImport(emptySession(studioProject(imported.project)), { plan: imported.project.plan, report: imported.sealedReports[0], at: '2026-10-26T09:00:00.000Z' });
  const freshView = projectView(imported.project, freshSession);
  assert.equal(freshView.submission, null, 'no submission receipt in this browser');
  assert.equal(freshView.candidate, null, 'no candidate is fabricated from declarations');
  assert.equal(freshView.declared.owner, OWNER, 'the declaration is shown as a declaration');
  assert.deepEqual(freshView.missingEvidence, []);
  // R03-D: before the reviewers are confirmed, nothing evaluates.
  assert.match(policyStatus(imported.project, freshView).error, /confirm it as your own policy choice/);
  const confirmed = confirmReviewers(imported.project, { at: '2026-10-26T09:01:00.000Z' });
  const status = policyStatus(confirmed, freshView);
  assert.equal(status.complete, true, status.error);
  assert.equal(status.policyHash, bundle.policyHash, 'R03-A: the effective policy fingerprint survives the empty browser');
  assert.equal(status.policy.registry.owner, OWNER);
  assert.equal(verifyBinding(confirmed.bindings[0], status.policy), true, 'the existing binding is intact under the reconstructed policy');
  // R03-B, R03-C: the configuration exports without the original session, and both loaders accept it; fresh evaluation decides.
  const config = consumerConfigFor(confirmed, freshView);
  assert.equal(config.release.owner, OWNER);
  assert.equal(config.release.reportHash, REPORT.evidenceHash);
  assert.equal(config.release.revision, '2');
  loadConfigShape(config);
  assert.equal(loadConsumerConfig(config, 'exported').policyHash, bundle.policyHash);
  const fixture = await consumerCapture('12-reapprove-r2');
  const evaluation = evaluateBinding({ policy: config.policy, binding: confirmed.bindings[0], report: REPORT, ...fixture.inputs, now: fixture.now });
  assert.equal(evaluation.status, 'valid', JSON.stringify(evaluation.reasons));
  const revoked = await consumerCapture('11-revoke-r2');
  const withheld = evaluateBinding({ policy: config.policy, binding: confirmed.bindings[0], report: REPORT, ...revoked.inputs, now: revoked.now });
  assert.equal(withheld.enable, false, 'R03-F: a revoked imported release stays inspectable and unavailable');
  // The same bundle a second time gives the same project identity; the page keeps an existing one apart by renaming the copy (browser journey).
  assert.equal(importBundle(JSON.stringify(bundle)).project.id, imported.project.id);
  // R03-E: contradicting declarations fail explicitly; a declaration never bypasses the chain.
  assert.throws(() => importBundle(JSON.stringify({ ...bundle, release: { ...bundle.release, owner: REVIEWER } })), /declares owner .* but its policy names/);
  const foreignPolicyOwner = { ...bundle, policy: { ...bundle.policy, registry: { ...bundle.policy.registry, owner: REVIEWER } }, policyHash: undefined, release: { ...bundle.release, owner: REVIEWER, submission: { ...bundle.release.submission, owner: REVIEWER } } };
  assert.throws(() => importBundle(JSON.stringify(foreignPolicyOwner)), /not made under the bundle's policy|does not derive/);
  assert.throws(() => importBundle(JSON.stringify({ ...bundle, release: { ...bundle.release, releaseId: `0x${'ab'.repeat(32)}`, submission: { ...bundle.release.submission, releaseId: `0x${'ab'.repeat(32)}` } } })), /does not derive from the declared owner/);
  assert.throws(() => importBundle(JSON.stringify({ ...bundle, storage: { ...bundle.storage, extrinsicHash: `0x${'cd'.repeat(32)}` } })), /latest binding names stored evidence/);
  assert.throws(() => importBundle(JSON.stringify({ ...bundle, release: { ...bundle.release, owner: 'not-an-address', submission: { ...bundle.release.submission, owner: 'not-an-address' } }, policy: { ...bundle.policy, registry: { address: bundle.policy.registry.address, label: bundle.policy.registry.label } }, policyHash: undefined })), /H160 address|not made under/);
  assert.throws(() => importBundle(JSON.stringify({ ...bundle, storage: { ...bundle.storage, blockHash: '0x12' } })), /storage locator/);
  // R03-H: a references-only bundle keeps its declarations and names the evidence it lacks; nothing is fabricated.
  const referencesOnly = exportBundle(bound, projectView(bound, session), { reports: [], at: T });
  assert.equal(referencesOnly.sealedReports.length, 0);
  const sparse = importBundle(JSON.stringify(referencesOnly), { at: '2026-10-26T09:02:00.000Z' });
  assert.deepEqual(sparse.missingEvidence, [REPORT.evidenceHash]);
  assert.deepEqual(sparse.project.imported.missingEvidence, [REPORT.evidenceHash]);
  assert.equal(sparse.project.release.owner, OWNER, 'the declarations survive');
  assert.equal(sparse.project.bindings.length, 1);
  const sparseView = projectView(confirmReviewers(sparse.project), emptySession(studioProject(sparse.project)));
  assert.equal(sparseView.report, null, 'no report is fabricated');
  assert.deepEqual(sparseView.missingEvidence, [REPORT.evidenceHash]);
  assert.equal(policyStatus(confirmReviewers(sparse.project), sparseView).policyHash, bundle.policyHash, 'the policy is still the same policy');
});
