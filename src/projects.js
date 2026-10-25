// Browser-local projects: a visitor's own supported release (a native-asset token-list
// entry on the V3 testnet) with its own policy draft, reviewer trust declaration,
// release identity, storage locator, binding candidate and explicit bindings. Nothing
// here reads the network or signs; the studio session of the project (src/studio-state.js)
// holds the receipts of what the visitor's wallet did, and the views below derive the
// candidate, the storage locator and the submission from those receipts, so there is
// one source of truth for each fact. A project is exported as a versioned bundle and as
// the consumer configuration the separate Token eligibility demo and the catalog
// release gate read; an import recomputes every fingerprint and verifies every binding,
// and imported reviewer trust is held apart until the visitor confirms it as their own
// policy choice. A checksum never makes a reviewer trustworthy.
import { normalizePolicy, policyHash, createBinding, verifyBinding, POLICY_SCHEMA, BINDING_SCHEMA } from '../lib/policy.js';
import { validateImportedRun, verifyRun } from '../lib/report.js';
import { REGISTRY } from '../lib/registry.js';
import { TOKEN_LIST } from '../lib/tokenlist.js';
import { NETWORKS } from '../lib/networks.js';
import { demoPlan } from '../lib/demo.js';
import { describeOwnPlan, importOwnPlan } from './own-plan.js';
import { DEMO_PROJECT, activeReport, stageReportHash } from './studio-state.js';

export const PROJECT_SCHEMA = 'revivecheck.project.v1';
export const PROJECT_STORE_SCHEMA = 'revivecheck.project-store.v1';
export const BUNDLE_SCHEMA = 'revivecheck.project-bundle.v1';
export const CONSUMER_CONFIG_SCHEMA = 'revivecheck-consumer.config.v1';
export const PROJECTS_KEY = 'revivecheck.projects.v1';
const TESTNET = NETWORKS.testnet;
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH64 = /^[a-f0-9]{64}$/;
const lower = (value) => String(value ?? '').toLowerCase();
const bare = (hash) => lower(hash).replace(/^0x/, '');
const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/** The policy defaults a new project starts from: the deployed registry, the active consumer, seven days of evidence age, fifteen minutes of read freshness. */
export const POLICY_DEFAULTS = Object.freeze({
  name: '', reviewers: { trusted: [], threshold: 1, basis: '', confirmed: true, imported: null },
  evidence: { maxAgeSeconds: 604800, maxObservationAgeSeconds: 900, requireInterfacesAgree: true, requireStoredOnChain: true, requireFreshSubject: false },
  consumer: { address: TOKEN_LIST.address, version: TOKEN_LIST.version, requireListed: true },
});
export const ROLE_DEFAULTS = Object.freeze({
  owner: 'the account that submits this project\'s release; its control is stated by the project operator',
  reviewer: 'the account(s) this project\'s policy trusts; its control is stated by the project operator',
  operator: 'the visitor running this browser; binds reports explicitly and signs nothing on behalf of others',
});

/** A release label for the registry: at most 31 bytes, from the project name. */
export function releaseLabelFor(name) {
  let label = slug(name) || 'release';
  while (new TextEncoder().encode(label).length > 31) label = label.slice(0, -1);
  return label.replace(/-+$/, '') || 'release';
}
const short = (hash) => String(hash || '').slice(0, 8);

/** A new project from a supported plan (the Check my token form's effective plan). */
export function createProject({ name, plan, id = null, at = new Date().toISOString(), policy = {}, roles = {} }) {
  const described = describeOwnPlan(plan);
  const projectName = String(name ?? plan.name ?? '').trim();
  if (!projectName || projectName.length > 120) throw new Error('A project name of 1 to 120 characters is required.');
  const projectId = id || `own-${slug(projectName).slice(0, 48) || 'project'}-${short(described.planHash)}`;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(projectId)) throw new Error('A project id is a safe identifier.');
  return {
    schema: PROJECT_SCHEMA, id: projectId, name: projectName, kind: 'own', createdAt: at, updatedAt: at,
    plan: described.plan, planHash: described.planHash, releaseArtifactHash: described.releaseArtifactHash,
    policy: { ...POLICY_DEFAULTS, name: policy.name || `${projectName} policy`, ...policy, reviewers: { ...POLICY_DEFAULTS.reviewers, ...(policy.reviewers || {}) }, evidence: { ...POLICY_DEFAULTS.evidence, ...(policy.evidence || {}) }, consumer: policy.consumer === null ? null : { ...POLICY_DEFAULTS.consumer, ...(policy.consumer || {}) } },
    release: { label: releaseLabelFor(projectName) },
    roles: { owner: { control: roles.owner?.control || ROLE_DEFAULTS.owner }, reviewer: { control: roles.reviewer?.control || ROLE_DEFAULTS.reviewer }, operator: { control: roles.operator?.control || ROLE_DEFAULTS.operator } },
    reports: [], bindings: [], imported: null,
  };
}

/** The demonstration project: the pUSD token list the studio has always run; its plan is one of the two demo releases. */
export function demoProjectRecord(at = '2026-10-23T00:00:00.000Z') {
  const plan = demoPlan('v1.0.1');
  const project = createProject({ name: DEMO_PROJECT.name, plan, id: DEMO_PROJECT.id, at, policy: { name: 'pUSD token list policy (studio demonstration)' } });
  return { ...project, kind: 'demo', release: { label: 'pusd-token-list' } };
}

/** Record that a report was produced for this project (its exact hash and result); the report itself lives in the studio session or a file. */
export function noteReport(project, report, { source = 'check', at = new Date().toISOString() } = {}) {
  if (!report?.evidenceHash) return project;
  if (project.reports.some((item) => item.reportHash === report.evidenceHash)) return project;
  const reference = { reportHash: report.evidenceHash, release: report.release ?? null, status: report.status, completedAt: report.completedAt ?? null, blockNumber: report.network?.finalizedBlockNumber ?? null, planHash: report.binding?.planHash ?? null, releaseArtifactHash: report.binding?.releaseArtifactHash ?? null, source, notedAt: at };
  return { ...project, reports: [...project.reports, reference], updatedAt: at };
}

export function updatePolicy(project, patch, { at = new Date().toISOString() } = {}) {
  const policy = { ...project.policy, ...patch, reviewers: { ...project.policy.reviewers, ...(patch.reviewers || {}) }, evidence: { ...project.policy.evidence, ...(patch.evidence || {}) }, consumer: patch.consumer === null ? null : patch.consumer ? { ...(project.policy.consumer || POLICY_DEFAULTS.consumer), ...patch.consumer } : project.policy.consumer };
  return { ...project, policy, updatedAt: at };
}
export const updateRoles = (project, roles, { at = new Date().toISOString() } = {}) => ({ ...project, roles: { owner: { ...project.roles.owner, ...(roles.owner || {}) }, reviewer: { ...project.roles.reviewer, ...(roles.reviewer || {}) }, operator: { ...project.roles.operator, ...(roles.operator || {}) } }, updatedAt: at });
export const renameProject = (project, name, { at = new Date().toISOString() } = {}) => { const next = String(name ?? '').trim(); if (!next || next.length > 120) throw new Error('A project name of 1 to 120 characters is required.'); return { ...project, name: next, updatedAt: at }; };
export const setReleaseLabel = (project, label, { at = new Date().toISOString() } = {}) => { const text = String(label ?? '').trim(); if (!text || new TextEncoder().encode(text).length > 31) throw new Error('A release label is 1 to 31 bytes.'); return { ...project, release: { ...project.release, label: text }, updatedAt: at }; };
/** The visitor confirms imported reviewer trust as this project's own policy choice. */
export const confirmReviewers = (project, { at = new Date().toISOString() } = {}) => updatePolicy(project, { reviewers: { confirmed: true, confirmedAt: at } }, { at });

/**
 * What the studio session established for this project: the active report, where it is
 * stored, which release and revision it was submitted as, the review state, and the
 * binding candidate those facts make. Nothing here is an approval: the candidate names
 * the exact report hash, release and revision the operator WOULD bind.
 */
export function projectView(project, session = null) {
  const report = session ? activeReport(session) : null;
  const active = session?.active ?? null;
  const bound = (key) => session?.[key] && (!active || bare(stageReportHash(key, session[key]) ?? active.reportHash) === bare(active.reportHash)) ? session[key] : null;
  const store = bound('store'), submit = bound('submit'), approve = bound('approve');
  const storage = store?.tx?.extrinsicHash && store.reportHash ? { reportHash: store.reportHash, extrinsicHash: lower(store.tx.extrinsicHash), blockHash: store.tx.blockHash ? lower(store.tx.blockHash) : null, blockNumber: store.tx.blockNumber ?? null, verified: store.retrieved?.verified ?? null } : null;
  const submission = submit?.tx ? { label: submit.label, releaseId: lower(submit.releaseId), revision: submit.readback?.release?.revision ?? null, reportHash: submit.reportHash, owner: lower(submit.sender || ''), blockNumber: submit.tx.blockNumber ?? null } : null;
  const review = approve?.tx && lower(approve.releaseId) === submission?.releaseId ? { approved: approve.approved === true, revision: approve.revision, reviewer: lower(approve.reviewer || ''), reportHash: bare(approve.reportHash), blockNumber: approve.tx.blockNumber ?? null } : null;
  const missing = [];
  if (!report) missing.push('a report (run the check)');
  else if (report.status !== 'passed') missing.push('a passed report (fix the release and recheck)');
  if (!submission) missing.push('a submission to the registry (Submit)');
  else if (!submission.revision) missing.push('the submission\'s revision read back');
  if (project.policy.evidence.requireStoredOnChain && !storage) missing.push('the stored report\'s extrinsic (Store)');
  const candidate = report && submission?.revision ? { reportHash: report.evidenceHash, release: report.release ?? null, releaseId: submission.releaseId, revision: String(submission.revision), storage: storage ? { extrinsicHash: storage.extrinsicHash, blockHash: storage.blockHash } : null, reviewed: review ? (review.approved ? 'approved by the named reviewer in this browser' : 'changes requested in this browser') : 'no review receipt in this browser', complete: missing.length === 0 } : null;
  return { report, active, storage, submission, review, candidate, missing, bindings: project.bindings, latestBinding: project.bindings.at(-1) ?? null };
}

/**
 * The complete policy of a project (`revivecheck.policy.v1`), from its draft, its plan and
 * the owner the submission established. Throws naming the first missing or invalid field;
 * imported reviewer trust that the visitor has not confirmed is such a field.
 */
export function policyFor(project, view = null) {
  const draft = project.policy;
  if (draft.reviewers?.confirmed === false) throw new Error('The reviewer trust was imported with this project; confirm it as your own policy choice before the policy can be used.');
  const owner = view?.submission?.owner;
  const policy = {
    schema: POLICY_SCHEMA, name: draft.name || `${project.name} policy`,
    network: { key: 'testnet', chainId: TESTNET.chainId, genesisHash: TESTNET.genesisHash },
    runtime: { specName: 'portaldot-v3', specVersions: ['3002'] },
    subject: { kind: 'native-asset', assetId: project.plan.nativeAsset.assetId, address: project.plan.listing.address },
    planHash: project.planHash,
    evidence: { scope: 'portaldot-testnet-readonly', maxAgeSeconds: Number(draft.evidence.maxAgeSeconds), maxObservationAgeSeconds: Number(draft.evidence.maxObservationAgeSeconds), requireInterfacesAgree: draft.evidence.requireInterfacesAgree !== false, requireStoredOnChain: draft.evidence.requireStoredOnChain === true, ...(draft.evidence.requireFreshSubject === true ? { requireFreshSubject: true } : {}) },
    reviewers: { trusted: draft.reviewers.trusted, threshold: Number(draft.reviewers.threshold || 1), basis: draft.reviewers.basis },
    registry: { address: REGISTRY.address, ...(H160.test(owner || '') ? { owner } : {}), label: project.release.label },
    ...(draft.consumer ? { consumer: { address: draft.consumer.address, requireListed: draft.consumer.requireListed !== false, ...(draft.consumer.version !== undefined && draft.consumer.version !== '' ? { version: Number(draft.consumer.version) } : {}) } } : {}),
  };
  return normalizePolicy(policy);
}
/** Whether the policy is complete, and the first reason it is not. */
export function policyStatus(project, view = null) {
  try { const policy = policyFor(project, view); return { complete: true, policy, policyHash: policyHash(policy), error: null }; } catch (error) { return { complete: false, policy: null, policyHash: null, error: error.message }; }
}

/**
 * Bind the candidate explicitly: an act of the operator, recorded in the project with the
 * exact report, release, revision and storage locator the candidate names. The report
 * must be the candidate's, and the policy complete.
 */
export function bindCandidate(project, { view, report, boundBy, note = '', at = new Date().toISOString(), id }) {
  const candidate = view?.candidate;
  if (!candidate) throw new Error(`Nothing to bind yet: ${view?.missing?.join('; ') || 'no candidate'}.`);
  if (!candidate.complete) throw new Error(`The candidate is incomplete: ${view.missing.join('; ')}.`);
  if (report?.evidenceHash !== candidate.reportHash) throw new Error('The report handed in is not the candidate report.');
  const policy = policyFor(project, view);
  const binding = createBinding({ policy, report, releaseId: candidate.releaseId, revision: candidate.revision, boundBy, note, storage: candidate.storage, boundAt: at, ...(id ? { id } : {}) });
  if (project.bindings.some((item) => item.bindingHash === binding.bindingHash)) throw new Error('This exact binding already exists.');
  return { project: { ...project, bindings: [...project.bindings, binding], updatedAt: at }, binding };
}

/** The entry this project intends to publish, from its plan (the release content), never from anything else. */
export const entryFor = (project) => ({ chainId: project.plan.listing.chainId, address: project.plan.listing.address, symbol: project.plan.listing.symbol, name: project.plan.listing.name, decimals: project.plan.listing.decimals, assetId: project.plan.nativeAsset.assetId });

/**
 * The consumer configuration (`revivecheck-consumer.config.v1`) the separate Token
 * eligibility demo and the catalog release gate read: this project's policy, the exact
 * report, release and revision of its latest binding, the storage locator, the entry and
 * the role statements. Nothing is filled in from the demonstration.
 */
export function consumerConfigFor(project, view) {
  const status = policyStatus(project, view);
  if (!status.complete) throw new Error(status.error);
  const binding = view?.latestBinding;
  if (!binding) throw new Error('Bind the candidate explicitly first; the configuration names the bound report, release and revision.');
  if (!verifyBinding(binding, status.policy)) throw new Error('The latest binding was made under another policy; bind again under the current one.');
  if (status.policy.evidence.requireStoredOnChain && !binding.storage?.extrinsicHash) throw new Error('The policy requires stored evidence, but the binding names no storage extrinsic; store the report and bind again.');
  const reviewer = status.policy.reviewers.trusted[0];
  return {
    schema: CONSUMER_CONFIG_SCHEMA, name: `${project.name} (${status.policy.subject.address}, Portaldot V3 testnet)`,
    policy: status.policy,
    release: { label: project.release.label, owner: status.policy.registry.owner ?? view?.submission?.owner ?? null, releaseId: binding.releaseId, revision: binding.revision, reportHash: binding.reportHash, storage: binding.storage ? { extrinsicHash: binding.storage.extrinsicHash, blockHash: binding.storage.blockHash } : null },
    boundBy: binding.boundBy,
    entry: entryFor(project),
    roles: { owner: { address: status.policy.registry.owner ?? null, control: project.roles.owner.control }, reviewer: { address: reviewer, control: project.roles.reviewer.control }, operator: { control: project.roles.operator.control } },
    provenance: { projectId: project.id, planHash: project.planHash, releaseArtifactHash: project.releaseArtifactHash, bindingHash: binding.bindingHash, exportedAt: new Date().toISOString(), source: 'ReviveCheck App, My projects' },
  };
}

/** The portable bundle: everything above plus the report references, the studio-established facts and, when given, the sealed reports themselves. */
export function exportBundle(project, view = null, { reports = [], at = new Date().toISOString() } = {}) {
  const status = policyStatus(project, view);
  const embedded = reports.filter((report) => verifyRun(report) && (project.reports.some((item) => item.reportHash === report.evidenceHash) || project.bindings.some((binding) => binding.reportHash === report.evidenceHash)));
  return {
    schema: BUNDLE_SCHEMA, exportedAt: at, network: { key: 'testnet', chainId: TESTNET.chainId, genesisHash: TESTNET.genesisHash },
    project: { id: project.id, name: project.name, kind: project.kind, createdAt: project.createdAt, updatedAt: project.updatedAt },
    plan: project.plan, planHash: project.planHash, releaseArtifactHash: project.releaseArtifactHash,
    policyDraft: project.policy, policy: status.policy, policyHash: status.policyHash, policyError: status.error,
    release: { label: project.release.label, submission: view?.submission ?? null, review: view?.review ?? null },
    storage: view?.storage ?? null, candidate: view?.candidate ?? null,
    reports: project.reports, bindings: project.bindings, roles: project.roles,
    consumerIdentity: project.policy.consumer, sealedReports: embedded,
    note: 'A bundle carries the project\'s own declarations and references. Its fingerprints are recomputed on import; chain evidence (registry, listing, stored report) is verified when the project is evaluated, not by importing this file. Reviewer trust in it is a declaration of the exporter and must be confirmed by the importer.',
  };
}

/**
 * Import a bundle: a supported plan under this form's limits, recomputed fingerprints,
 * a policy that validates when complete, bindings that verify under that policy, sealed
 * reports that verify. Reviewer trust comes back unconfirmed.
 */
export function importBundle(text, { at = new Date().toISOString() } = {}) {
  let parsed;
  try { parsed = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('The import is not valid JSON.'); }
  if (parsed?.schema !== BUNDLE_SCHEMA) throw new Error(`A project bundle declares schema ${BUNDLE_SCHEMA}.`);
  const { plan, planHash, releaseArtifactHash } = importOwnPlan(parsed.plan);
  if (parsed.planHash !== undefined && parsed.planHash !== planHash) throw new Error('The stated planHash does not match the plan; the bundle was altered after export.');
  if (parsed.releaseArtifactHash !== undefined && parsed.releaseArtifactHash !== releaseArtifactHash) throw new Error('The stated releaseArtifactHash does not match the listing; the bundle was altered after export.');
  const name = String(parsed.project?.name ?? plan.name ?? '').trim();
  const draft = parsed.policyDraft || {};
  let project = createProject({ name, plan, at, policy: { ...draft, reviewers: { ...(draft.reviewers || {}), confirmed: false, imported: { at, basis: draft.reviewers?.basis ?? '', trusted: draft.reviewers?.trusted ?? [] } } }, roles: parsed.roles || {} });
  if (parsed.release?.label) project = setReleaseLabel(project, parsed.release.label, { at });
  const sealed = Array.isArray(parsed.sealedReports) ? parsed.sealedReports : [];
  for (const report of sealed) validateImportedRun(report);
  const references = Array.isArray(parsed.reports) ? parsed.reports : [];
  for (const reference of references) if (!HASH64.test(reference?.reportHash || '')) throw new Error('A report reference names a 64-hex report hash.');
  project = { ...project, reports: references.map((reference) => ({ ...reference, source: `${reference.source ?? 'check'} (imported)` })) };
  const bindings = Array.isArray(parsed.bindings) ? parsed.bindings : [];
  for (const binding of bindings) {
    if (binding?.schema !== BINDING_SCHEMA || !verifyBinding(binding)) throw new Error(`Binding ${binding?.id ?? '?'} is not intact.`);
    if (binding.subject !== plan.listing.address) throw new Error(`Binding ${binding.id} is about ${binding.subject}, not this plan's ${plan.listing.address}.`);
    if (!references.some((reference) => reference.reportHash === binding.reportHash) && !sealed.some((report) => report.evidenceHash === binding.reportHash)) throw new Error(`Binding ${binding.id} names report ${binding.reportHash.slice(0, 12)}…, which the bundle neither references nor embeds.`);
  }
  // Bindings verify under the exporter's stated policy; whether that policy is this project's is decided when the reviewers are confirmed.
  if (parsed.policy) {
    let stated;
    try { stated = normalizePolicy(parsed.policy); } catch (error) { throw new Error(`The bundle's policy does not validate: ${error.message}`); }
    if (parsed.policyHash !== undefined && policyHash(stated) !== parsed.policyHash) throw new Error('The stated policyHash does not match the policy; the bundle was altered after export.');
    for (const binding of bindings) if (!verifyBinding(binding, stated)) throw new Error(`Binding ${binding.id} was not made under the bundle's policy.`);
  }
  project = { ...project, bindings, imported: { at, exportedAt: parsed.exportedAt ?? null, policyHash: parsed.policyHash ?? null, bindings: bindings.length, sealedReports: sealed.length } };
  return { project, sealedReports: sealed, reviewerTrust: { trusted: draft.reviewers?.trusted ?? [], basis: draft.reviewers?.basis ?? '', confirmed: false } };
}

// ---- The browser store ----
export function loadProjects({ storage = globalThis.localStorage } = {}) {
  let store = null;
  try { store = JSON.parse(storage?.getItem(PROJECTS_KEY) ?? 'null'); } catch { store = null; }
  if (!store || store.schema !== PROJECT_STORE_SCHEMA || typeof store.projects !== 'object' || store.projects === null) store = { schema: PROJECT_STORE_SCHEMA, activeProjectId: DEMO_PROJECT.id, projects: {} };
  if (!store.projects[DEMO_PROJECT.id]) store.projects[DEMO_PROJECT.id] = demoProjectRecord();
  if (!store.projects[store.activeProjectId]) store.activeProjectId = DEMO_PROJECT.id;
  return store;
}
export function saveProjects(store, { storage = globalThis.localStorage } = {}) {
  try { storage?.setItem(PROJECTS_KEY, JSON.stringify(store)); } catch { /* the store lives in memory only */ }
  return store;
}
export const withProject = (store, project) => ({ ...store, projects: { ...store.projects, [project.id]: project } });
export const selectProject = (store, id) => store.projects[id] ? { ...store, activeProjectId: id } : store;
export function removeProject(store, id) {
  if (id === DEMO_PROJECT.id) throw new Error('The demonstration project cannot be removed.');
  const { [id]: removed, ...projects } = store.projects;
  return { ...store, projects, activeProjectId: store.activeProjectId === id ? DEMO_PROJECT.id : store.activeProjectId };
}
/** The project record as the studio sees it: id, name, kind and plan. */
export const studioProject = (project) => ({ id: project.id, name: project.name, kind: project.kind, ...(project.kind === 'own' ? { plan: project.plan } : {}) });
export const listProjects = (store) => Object.values(store.projects).sort((a, b) => (a.kind === 'demo' ? -1 : b.kind === 'demo' ? 1 : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
