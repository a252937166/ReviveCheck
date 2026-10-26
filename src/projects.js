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
import { REGISTRY, releaseIdOf } from '../lib/registry.js';
import { TOKEN_LIST } from '../lib/tokenlist.js';
import { NETWORKS } from '../lib/networks.js';
import { DEMO_RELEASES, demoPlan } from '../lib/demo.js';
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
    release: { label: releaseLabelFor(projectName), owner: null, releaseId: null, declared: null },
    roles: { owner: { control: roles.owner?.control || ROLE_DEFAULTS.owner }, reviewer: { control: roles.reviewer?.control || ROLE_DEFAULTS.reviewer }, operator: { control: roles.operator?.control || ROLE_DEFAULTS.operator } },
    reports: [], bindings: [], imported: null,
  };
}

/** The demonstration project: the pUSD token list the studio has always run; its plan is one of the two demo releases. */
export function demoProjectRecord(at = '2026-10-23T00:00:00.000Z') {
  const plan = demoPlan('v1.0.1');
  const project = createProject({ name: DEMO_PROJECT.name, plan, id: DEMO_PROJECT.id, at, policy: { name: 'pUSD token list policy (studio demonstration)' } });
  return { ...project, kind: 'demo', release: { label: 'pusd-token-list', owner: null, releaseId: null, declared: null } };
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
 * Adopt a report and the plan it was made on as the project's CURRENT release content:
 * the normalized plan, the acceptance-plan fingerprint and the release-artifact
 * fingerprint come from the adopted input; identity, policy, roles, label, report
 * references and binding history stay. The report must describe exactly this plan (both
 * fingerprints), or the pair is refused: a project is never made to look coherent by
 * relabelling evidence. A plan with another acceptance-plan fingerprint is another project.
 */
export function adoptPlan(project, { plan, report, at = new Date().toISOString() }) {
  if (project.kind !== 'own') throw new Error('Only a browser-local project adopts a plan; the demonstration project checks its own releases.');
  const described = describeOwnPlan(plan);
  if (!report?.evidenceHash || !verifyRun(report)) throw new Error('The adopted report is not an intact sealed report.');
  if (report.binding?.planHash !== described.planHash) throw new Error(`The report was made under plan ${String(report.binding?.planHash ?? 'none').slice(0, 12)}…, not this plan (${described.planHash.slice(0, 12)}…); a report describes the plan it was sealed on only.`);
  if (report.binding?.releaseArtifactHash !== described.releaseArtifactHash) throw new Error(`The report verified release artifact ${String(report.binding?.releaseArtifactHash ?? 'none').slice(0, 12)}…, not this listing (${described.releaseArtifactHash.slice(0, 12)}…); the entry a project publishes is the one its report verified.`);
  if (described.planHash !== project.planHash) throw new Error('The plan has another acceptance-plan fingerprint than this project; it belongs to a new project.');
  return { ...project, plan: described.plan, planHash: described.planHash, releaseArtifactHash: described.releaseArtifactHash, updatedAt: at };
}

/** The plan a studio check runs for this project: the demonstration offers its two releases and an edit of them; an own project offers its CURRENT plan only, never a substitute. */
export function planForCheck(project, choice, custom = null) {
  if (project.kind === 'own') { if (!project.plan) throw new Error('This project has no plan; define it on Check my token.'); return project.plan; }
  if (choice === 'custom') { const base = demoPlan('v1.0.1'); return { ...base, release: 'custom', sourceRevision: 'pusd-token-list@custom', listing: { ...base.listing, symbol: custom?.symbol, name: custom?.name, decimals: Number(custom?.decimals) } }; }
  return demoPlan(DEMO_RELEASES[choice] ? choice : 'v1.0.0');
}

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
  // Imported declarations stay apart from this browser's receipts; evidence the project references but holds no sealed copy of is named, never fabricated.
  const declared = project.release?.declared ?? null;
  const known = new Set([session?.check?.report?.evidenceHash, session?.recheck?.report?.evidenceHash].filter(Boolean));
  const missingEvidence = [...new Set([...project.bindings.map((item) => item.reportHash), ...project.reports.map((item) => item.reportHash)])].filter((hash) => !known.has(hash));
  return { report, active, storage, submission, review, candidate, missing, declared, missingEvidence, bindings: project.bindings, latestBinding: project.bindings.at(-1) ?? null };
}

/**
 * The complete policy of a project (`revivecheck.policy.v1`), from its draft, its plan and
 * the owner the submission established. Throws naming the first missing or invalid field;
 * imported reviewer trust that the visitor has not confirmed is such a field.
 */
export function policyFor(project, view = null) {
  const draft = project.policy;
  if (draft.reviewers?.confirmed === false) throw new Error('The reviewer trust was imported with this project; confirm it as your own policy choice before the policy can be used.');
  // The release owner: established by this browser's own submission, or declared by the imported bundle (verified against the registry when the project is evaluated, never by importing).
  const owner = view?.submission?.owner || project.release?.owner || null;
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
    release: { label: project.release.label, owner: status.policy?.registry?.owner ?? view?.submission?.owner ?? project.release?.owner ?? null, releaseId: view?.submission?.releaseId ?? project.release?.releaseId ?? null, submission: view?.submission ?? project.release?.declared?.submission ?? null, review: view?.review ?? null },
    storage: view?.storage ?? project.release?.declared?.storage ?? null, candidate: view?.candidate ?? null,
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
  // The durable declarations of the release line (owner, release ID, storage locator): validated, cross-checked against each other, the label and the bindings, and kept as declarations until the chain is read.
  const declaredOwner = lower(parsed.release?.owner ?? parsed.release?.submission?.owner ?? parsed.policy?.registry?.owner ?? '') || null;
  if (declaredOwner && !H160.test(declaredOwner)) throw new Error('The declared release owner is an H160 address.');
  if (declaredOwner && parsed.policy?.registry?.owner && lower(parsed.policy.registry.owner) !== declaredOwner) throw new Error(`The bundle declares owner ${declaredOwner} but its policy names ${lower(parsed.policy.registry.owner)}; the declarations contradict each other.`);
  const declaredReleaseId = lower(parsed.release?.releaseId ?? parsed.release?.submission?.releaseId ?? '') || null;
  if (declaredReleaseId && !/^0x[0-9a-f]{64}$/.test(declaredReleaseId)) throw new Error('The declared release ID is a 0x-prefixed 32-byte hash.');
  if (declaredReleaseId && declaredOwner) { let derived = null; try { derived = lower(releaseIdOf(declaredOwner, project.release.label)); } catch { derived = null; } if (derived !== declaredReleaseId) throw new Error(`The declared release ID ${declaredReleaseId.slice(0, 12)}… does not derive from the declared owner and the label "${project.release.label}"; the declarations contradict each other.`); }
  const declaredStorage = parsed.storage ?? parsed.release?.declared?.storage ?? null;
  if (declaredStorage && (!/^0x[0-9a-f]{64}$/.test(lower(declaredStorage.extrinsicHash ?? '')) || (declaredStorage.blockHash && !/^0x[0-9a-f]{64}$/.test(lower(declaredStorage.blockHash))))) throw new Error('The declared storage locator names a 0x-prefixed 32-byte extrinsic hash and, when given, block hash.');
  for (const binding of bindings) if (declaredReleaseId && lower(binding.releaseId) !== declaredReleaseId) throw new Error(`Binding ${binding.id} names release ${lower(binding.releaseId).slice(0, 12)}…, not the declared release ${declaredReleaseId.slice(0, 12)}…; the declarations contradict each other.`);
  const latest = bindings.at(-1) ?? null;
  if (latest?.storage?.extrinsicHash && declaredStorage?.extrinsicHash && lower(latest.storage.extrinsicHash) !== lower(declaredStorage.extrinsicHash)) throw new Error(`The latest binding names stored evidence ${lower(latest.storage.extrinsicHash).slice(0, 12)}…, the bundle declares ${lower(declaredStorage.extrinsicHash).slice(0, 12)}…; the declarations contradict each other.`);
  const declared = declaredOwner || declaredReleaseId || declaredStorage || parsed.release?.submission || parsed.release?.review
    ? { at, exportedAt: parsed.exportedAt ?? null, source: 'bundle', owner: declaredOwner, releaseId: declaredReleaseId, submission: parsed.release?.submission ?? null, review: parsed.release?.review ?? null, storage: declaredStorage ? { reportHash: declaredStorage.reportHash ?? null, extrinsicHash: lower(declaredStorage.extrinsicHash), blockHash: declaredStorage.blockHash ? lower(declaredStorage.blockHash) : null, blockNumber: declaredStorage.blockNumber ?? null } : null, note: 'Declared by the exporter; verified against the registry, the consumer and chain data when the project is evaluated on fresh reads, not by importing.' }
    : null;
  const missingEvidence = [...new Set([...bindings.map((binding) => binding.reportHash), ...references.map((reference) => reference.reportHash)])].filter((hash) => !sealed.some((report) => report.evidenceHash === hash));
  project = { ...project, release: { ...project.release, owner: declaredOwner, releaseId: declaredReleaseId, declared }, bindings, imported: { at, exportedAt: parsed.exportedAt ?? null, policyHash: parsed.policyHash ?? null, bindings: bindings.length, sealedReports: sealed.length, missingEvidence } };
  return { project, sealedReports: sealed, missingEvidence, reviewerTrust: { trusted: draft.reviewers?.trusted ?? [], basis: draft.reviewers?.basis ?? '', confirmed: false } };
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
