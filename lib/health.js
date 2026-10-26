// Evidence health and renewal as a workflow, read-only. `evidenceHealth` says, from the
// bound report, the policy, a registry read, a listing read, a network observation and
// (under a fresh-subject policy) a subject read, when the report expires, when each
// read's permission lapses, whether the approval and the listing stand on the bound
// revision, whether the subject still reports the approved metadata, whether a successor
// report exists, and which role acts next. `renewalPlan` derives the renewal stages from
// VERIFIED state: a stage is done only when a read that passes the evaluator's own
// predicates (domain, provenance, freshness, interface agreement) or an intact artifact
// shows it; a read that is stale, undated, unavailable, from another target or
// disagreeing makes the stage UNKNOWN, which stops the plan without suggesting a send; the
// next revision is the registry's current revision plus one (never assumed); a pending
// send on a signer is a stop condition; and nothing here broadcasts, migrates a binding
// or extends evidence age. `successorConsumerConfig` writes the configuration a consumer
// would use once the successor report is approved and bound, and `diffConsumerConfigs`
// lists what changed.
import { normalizePolicy, verifyBinding, evidencePredicates as P } from './policy.js';
import { verifyRun, validateImportedRun } from './report.js';
import { evidenceExpiry, RENEWAL_STEPS } from './decision.js';
import { approvedEntry } from './entry.js';
import { SUBJECT_FIELDS } from './subject.js';

export const HEALTH_SCHEMA = 'revivecheck.evidence-health.v2';
export const RENEWAL_PLAN_SCHEMA = 'revivecheck.renewal-plan.v2';
const lower = (value) => String(value ?? '').toLowerCase();
const bare = (hash) => lower(hash).replace(/^0x/, '');
const HASH = /^0x[0-9a-fA-F]{64}$/;
const clock = (value) => { const at = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value); if (!Number.isFinite(at)) throw new Error('now is a valid date.'); return at; };
const HOUR = 3600;
const semanticallyValid = (report) => { try { validateImportedRun(report); return true; } catch { return false; } };

/**
 * Screen one report as a successor of the bound one: intact and semantically valid,
 * passed, not the bound report, newer than it, in the policy's evidence scope, about the
 * policy's network and subject, under the pinned plan, on a supported runtime, and not
 * yet expired at `now`. Every predicate is named, so a refusal says why.
 */
export function screenSuccessor(report, { binding, report: bound, policy, now = new Date() }) {
  const normalized = normalizePolicy(policy);
  const at = clock(now);
  const since = Date.parse(bound?.completedAt ?? 0);
  const checks = {
    intact: verifyRun(report) && semanticallyValid(report),
    passed: P.passed(report),
    'not-the-bound-report': !!report?.evidenceHash && report.evidenceHash !== binding?.reportHash,
    'newer-than-bound': Number.isFinite(Date.parse(report?.completedAt)) && Date.parse(report.completedAt) > since,
    scope: P.scope(report, normalized),
    network: P.reportNetwork(report, normalized),
    subject: P.reportSubject(report, normalized),
    plan: P.plan(report, normalized),
    runtime: P.reportRuntime(report, normalized),
    'not-expired': P.reportAge(report, at, normalized),
  };
  const failed = Object.keys(checks).filter((key) => !checks[key]);
  return { ok: failed.length === 0, failed, passed: Object.keys(checks).filter((key) => checks[key]), expiresAt: checks.intact ? evidenceExpiry(report, normalized).expiresAt : null };
}

/** Candidate successor reports among `reports`: the ones `screenSuccessor` accepts, newest first. */
export function successorReports(reports, { binding, report, policy, now = new Date() }) {
  return (reports || [])
    .map((item) => ({ item, screen: (() => { try { return screenSuccessor(item, { binding, report, policy, now }); } catch { return { ok: false, failed: ['intact'] }; } })() }))
    .filter(({ screen }) => screen.ok)
    .sort((a, b) => Date.parse(b.item.completedAt) - Date.parse(a.item.completedAt))
    .map(({ item, screen }) => ({ reportHash: item.evidenceHash, release: item.release ?? null, completedAt: item.completedAt, blockNumber: item.network?.finalizedBlockNumber ?? null, expiresAt: screen.expiresAt, predicates: screen.passed }));
}

/**
 * The state of one read against the evaluator's predicates: `fresh` only when it is dated,
 * within the freshness window, about the expected target and (when required) agreeing
 * across interfaces; otherwise `unavailable`, `undated`, `stale`, `wrong-target`,
 * `disagreeing` or `unsupported`, each with its detail. Only a `fresh` read proves anything.
 */
function readState(read, kind, { policy, at, domain, dated, required = true, supported = () => true, interfaces = (value) => P.interfacesAgree(value, policy) }) {
  if (!required) return { kind, state: 'not-required', usable: false, predicates: {} };
  if (!read || read.error) return { kind, state: 'unavailable', usable: false, error: read?.error ?? 'not read', observedAt: null, lapsesAt: null, predicates: {} };
  const observed = Date.parse(read.observedAt);
  const lapses = Number.isFinite(observed) ? observed + policy.evidence.maxObservationAgeSeconds * 1000 : NaN;
  const predicates = { dated: dated(read), fresh: P.fresh(read.observedAt, at, policy), domain: domain(read), interfaces: interfaces(read), supported: supported(read) };
  const state = !predicates.dated ? 'undated' : !predicates.domain ? 'wrong-target' : !predicates.fresh ? 'stale' : !predicates.supported ? 'unsupported' : !predicates.interfaces ? 'disagreeing' : 'fresh';
  const detail = { undated: 'the read does not identify its target or its time', 'wrong-target': `the read names another target (${kind === 'registry' ? `${read.address}, ${read.releaseId}` : kind === 'listing' ? `${read.list}, ${read.token}` : kind === 'subject' ? `${read.subject}, asset ${read.assetId}` : `chain ${read.chainId}`}) than this policy and binding`, stale: 'older than the policy allows', unsupported: read.note ?? `unsupported on ${read.runtime ?? 'an unknown runtime'}`, disagreeing: 'the EVM RPC and ReviveApi disagree; act on neither', fresh: null }[state];
  return { kind, state, usable: state === 'fresh', observedAt: read.observedAt ?? null, lapsesAt: Number.isFinite(lapses) ? new Date(lapses).toISOString() : null, secondsLeft: Number.isFinite(lapses) ? Math.floor((lapses - at) / 1000) : null, block: read.block ?? read.finalized ?? null, predicates, ...(detail ? { detail } : {}) };
}

/** The reads of a binding, each judged by the evaluator's predicates. */
function judgeReads({ policy, binding, registry, listing, observation, subject, at }) {
  return {
    // The network observation is one finalized-head read, not a two-interface comparison; the evaluator applies no interface predicate to it.
    observation: readState(observation, 'observation', { policy, at, dated: (read) => Number.isFinite(Date.parse(read.observedAt)), domain: (read) => P.observationNetwork(read, policy), interfaces: () => true }),
    registry: readState(registry, 'registry', { policy, at, dated: P.registryDated, domain: (read) => P.registryDomain(read, policy, binding) }),
    listing: readState(listing, 'listing', { policy, at, required: policy.consumer?.requireListed === true, dated: P.listingDated, domain: (read) => P.listingDomain(read, policy) }),
    // A vanished asset has no metadata to compare across interfaces; it is reported as missing, not as disagreeing.
    subject: readState(subject, 'subject', { policy, at, required: policy.evidence.requireFreshSubject === true, dated: P.subjectDated, domain: (read) => P.subjectDomain(read, policy), supported: (read) => read.supported === true, interfaces: (read) => read.exists === false || P.interfacesAgree(read, policy) }),
  };
}

/** What a usable subject read says against the approved report: unchanged, changed (which fields), missing; or unknown. */
function subjectState(read, reads, report, policy) {
  if (policy.evidence.requireFreshSubject !== true) return { state: 'not-required', detail: 'this policy does not require a fresh subject read; the approved report verified the metadata at its checkpoint, and no check of the current values is claimed here' };
  if (!reads.subject.usable) return { state: 'unknown', detail: `the subject read is ${reads.subject.state}${reads.subject.detail ? ` (${reads.subject.detail})` : ''}; the current metadata is unknown` };
  if (read.exists !== true) return { state: 'missing', detail: 'the native asset does not exist at the checkpoint read' };
  const approved = approvedEntry(report);
  if (!approved.entry) return { state: 'unknown', detail: `the bound report approves no entry: ${approved.reason}` };
  const current = read.native ?? null;
  if (!current) return { state: 'unknown', detail: 'no current values were read' };
  const differing = SUBJECT_FIELDS.filter((field) => (field === 'address' ? lower(current.address) !== approved.entry.address : current[field] !== approved.entry[field]));
  return differing.length
    ? { state: 'changed', detail: differing.map((field) => `${field}: now ${JSON.stringify(current[field])}, approved ${JSON.stringify(approved.entry[field])}`).join('; '), differing, checkpoint: read.block ?? null }
    : { state: 'unchanged', detail: 'symbol, name, decimals and address equal the approved report at the checkpoint read', checkpoint: read.block ?? null };
}

/**
 * The health of one binding at `now`. `registry`, `listing`, `observation` and `subject`
 * are the reads `collectPolicyInputs` returns (each may carry `error`); `reports` are the
 * sealed reports known locally, screened for a successor. `freezeAt` (optional) is a date
 * the evidence has to cover, so a planned gap is stated instead of discovered.
 */
export function evidenceHealth({ policy, binding, report, registry = null, listing = null, observation = null, subject = null, reports = [], now = new Date(), freezeAt = null, plannedRenewalAt = null }) {
  const normalized = normalizePolicy(policy);
  const at = clock(now);
  const expiry = evidenceExpiry(report, normalized, at);
  const reads = judgeReads({ policy: normalized, binding, registry, listing, observation, subject, at });
  const registryOk = reads.registry.usable && typeof registry.release?.exists === 'boolean';
  const trusted = normalized.reviewers.trusted;
  const decided = registryOk && registry.release.exists ? P.approvals(registry, normalized) : null;
  const approval = !registryOk ? { state: 'unknown', detail: `the registry read is ${reads.registry.state}${reads.registry.error ? ` (${reads.registry.error})` : reads.registry.detail ? ` (${reads.registry.detail})` : ''}; the approval state is unknown` }
    : !registry.release.exists ? { state: 'missing', detail: 'the release is not in the registry' }
      : { state: decided.ok ? 'approved' : decided.changes.length ? 'changes-requested' : decided.unread.length ? 'unknown' : 'pending', revision: registry.release.revision, reportHash: bare(registry.release.reportHash), approvedBy: decided.approved, changesBy: decided.changes, unread: decided.unread, threshold: normalized.reviewers.threshold, detail: `${decided.approved.length} of ${trusted.length} trusted reviewer(s) approved revision ${registry.release.revision}${decided.changes.length ? `; ${decided.changes.length} requested changes` : ''}${decided.unread.length ? `; ${decided.unread.length} not read` : ''}`, predicates: ['registry-dated', 'registry-domain', 'registry-fresh', 'registry-interfaces', 'trusted-decisions-read'] };
  const bound = { reportHash: binding?.reportHash ?? null, revision: binding?.revision ?? null, releaseId: binding?.releaseId ?? null, intact: verifyBinding(binding, normalized), onCurrentRevision: registryOk && registry.release.exists ? P.registryRevision(registry, binding) : null };
  const listingOk = reads.listing.usable && typeof listing.listed === 'boolean';
  const listed = !normalized.consumer?.requireListed ? { state: 'not-required' } : !listingOk ? { state: 'unknown', detail: `the consumer read is ${reads.listing.state}${reads.listing.error ? ` (${reads.listing.error})` : reads.listing.detail ? ` (${reads.listing.detail})` : ''}` }
    : { state: listing.listed ? (P.listingEntry(listing, normalized, binding) ? 'listed-on-bound-report' : 'listed-on-another-report') : 'not-listed', entry: listing.entry ?? null, predicates: ['listing-dated', 'listing-domain', 'listing-fresh', 'listing-interfaces'] };
  const subjectNow = subjectState(subject, reads, report, normalized);
  const successors = successorReports(reports, { binding, report, policy: normalized, now: at });
  const nextRevision = registryOk && registry.release.exists ? String(Number(registry.release.revision) + 1) : null;
  const warnings = [];
  if (expiry.expired) warnings.push({ code: 'evidence-expired', text: `The bound report expired at ${expiry.expiresAt}; every evaluation is expired until a new report is approved and bound.` });
  else if (expiry.secondsLeft <= 48 * HOUR) warnings.push({ code: 'evidence-expiring', text: `The bound report expires in ${(expiry.secondsLeft / HOUR).toFixed(1)} hours (${expiry.expiresAt}).` });
  if (freezeAt && Number.isFinite(Date.parse(freezeAt)) && Date.parse(expiry.expiresAt) < Date.parse(freezeAt)) warnings.push({ code: 'gap-before-freeze', text: `The evidence expires at ${expiry.expiresAt}, before ${freezeAt}${plannedRenewalAt ? `; with renewal planned at ${plannedRenewalAt} the entry is withheld from ${expiry.expiresAt} until the successor is bound and listed` : '; renew before then or state the gap'}.` });
  if (plannedRenewalAt && Number.isFinite(Date.parse(plannedRenewalAt)) && Date.parse(plannedRenewalAt) > Date.parse(expiry.expiresAt)) warnings.push({ code: 'planned-gap', text: `Renewal is planned for ${plannedRenewalAt}, after the expiry at ${expiry.expiresAt}: a denial period of ${((Date.parse(plannedRenewalAt) - Date.parse(expiry.expiresAt)) / 86400000).toFixed(1)} days is expected and should be stated publicly.` });
  if (bound.onCurrentRevision === false) warnings.push({ code: 'revision-superseded', text: `The registry holds revision ${registry.release.revision} (${bare(registry.release.reportHash).slice(0, 12)}…); the binding names revision ${binding?.revision}.` });
  if (approval.state === 'changes-requested') warnings.push({ code: 'approval-revoked', text: 'A trusted reviewer requested changes on the current revision.' });
  if (listed.state === 'not-listed' || listed.state === 'listed-on-another-report') warnings.push({ code: 'not-listed', text: `The consumer ${listed.state === 'not-listed' ? 'does not list the subject' : 'lists the subject on another report'}.` });
  if (subjectNow.state === 'changed') warnings.push({ code: 'subject-changed', text: `The subject now reports other metadata than the approved report verified (${subjectNow.detail}); the standing approval does not cover the new values.` });
  if (subjectNow.state === 'missing') warnings.push({ code: 'subject-missing', text: 'The native asset no longer exists at the checkpoint read.' });
  for (const read of Object.values(reads)) if (['stale', 'unavailable', 'undated', 'wrong-target', 'disagreeing', 'unsupported'].includes(read.state)) warnings.push({ code: `read-${read.state}`, text: `The ${read.kind} read is ${read.state}${read.error ? ` (${read.error})` : read.detail ? ` (${read.detail})` : ''}; nothing it would show is claimed. Read again before relying on anything.` });
  // Who acts next. A new check is read-only and is suggested whenever the evidence is ending; a send is never suggested from unknown state.
  const unknownReads = Object.values(reads).filter((read) => read.state !== 'fresh' && read.state !== 'not-required').map((read) => read.kind);
  const renewalDue = expiry.expired || expiry.secondsLeft <= 48 * HOUR || bound.onCurrentRevision === false || approval.state === 'changes-requested' || subjectNow.state === 'changed' || subjectNow.state === 'missing';
  let nextRole;
  if (renewalDue && !successors.length) nextRole = { role: 'release owner', action: 'check the release again and publish the new sealed report', stage: 'check' };
  else if (unknownReads.length) nextRole = { role: 'operator', action: `read the ${unknownReads.join(', ')} again; the current state is unknown and no send follows from it`, stage: 'read' };
  else if (renewalDue) {
    if (!(registry.release.exists && bare(registry.release.reportHash) === successors[0].reportHash)) nextRole = { role: 'release owner', action: `store and submit the successor report ${successors[0].reportHash.slice(0, 12)}… as revision ${nextRevision ?? '?'}`, stage: 'submit' };
    else if (approval.state !== 'approved') nextRole = { role: 'trusted reviewer', action: `approve the exact hash of revision ${registry.release.revision}`, stage: 'approve' };
    else nextRole = { role: 'consumer operator', action: 'bind the approved successor report explicitly, then the owner lists it again', stage: 'bind' };
  } else if (approval.state === 'pending') nextRole = { role: 'trusted reviewer', action: `approve the exact hash of revision ${registry.release.revision}`, stage: 'approve' };
  else if (listed.state === 'not-listed') nextRole = { role: 'release owner', action: 'list the subject on the approved revision', stage: 'list' };
  else nextRole = { role: 'consumer', action: 'evaluate before each use; nothing to renew yet', stage: 'evaluate' };
  return Object.freeze({
    schema: HEALTH_SCHEMA, at: new Date(at).toISOString(), policyName: normalized.name, subject: normalized.subject.address,
    report: { reportHash: binding?.reportHash ?? report?.evidenceHash ?? null, completedAt: expiry.completedAt, maxAgeSeconds: expiry.maxAgeSeconds, expiresAt: expiry.expiresAt, secondsLeft: expiry.secondsLeft, expired: expiry.expired === true },
    reads, approval, bound, listed, subjectState: subjectNow, successors, nextRevision, nextRole, warnings,
    freeze: freezeAt ? { at: freezeAt, covered: Date.parse(expiry.expiresAt) >= Date.parse(freezeAt) } : null, plannedRenewalAt,
    note: 'Refreshing the registry does not renew the report\'s age; a successor report never inherits an approval; nothing moves a binding. A read that is stale, unavailable, from another target or disagreeing proves nothing and is reported as such. This view reads; it signs nothing.',
  });
}

/**
 * The renewal stages with their verified state. `successor` is the successor report (or
 * null); `storage` the retrieval of the successor from chain data (`{ verified, reportHash,
 * extrinsicHash, blockHash, … }`, `{ error }` when the retrieval failed, `{ notRecorded:
 * true }` when no store of the successor is recorded, or null when none was attempted);
 * `registry`, `listing`, `subject` fresh reads; `bindings` the binding history;
 * `pendingSends` the per-account pending transaction state ({ address, pending }) read
 * from `system.accountNextIndex` against the account nonce. A stage is `done` only when
 * its evidence passes the evaluator's predicates; `unknown` when the evidence that would
 * prove it is stale, unavailable, from another target or disagreeing; `pending` when the
 * evidence is usable and shows the stage not yet performed. The next stage to perform is
 * the first pending one, and only when no stage is unknown; an unknown stage or a pending
 * send stops the plan, and never turns into an instruction to send again.
 */
export function renewalPlan({ policy, binding, report, successor = null, storage = null, registry = null, listing = null, subject = null, observation = null, bindings = [], pendingSends = [], now = new Date(), releaseLabel = null }) {
  const normalized = normalizePolicy(policy);
  const at = clock(now);
  const successorHash = successor?.evidenceHash ?? null;
  const screen = successor ? screenSuccessor(successor, { binding, report, policy: normalized, now: at }) : { ok: false, failed: ['no successor report'], passed: [] };
  const successorOk = screen.ok;
  const reads = judgeReads({ policy: normalized, binding: successorHash ? { ...binding, reportHash: successorHash, revision: null } : binding, registry, listing, observation, subject, at });
  const registryUsable = reads.registry.usable && typeof registry.release?.exists === 'boolean';
  const registryExists = registryUsable && registry.release.exists === true;
  const currentRevision = registryExists ? String(registry.release.revision) : null;
  const registryHoldsSuccessor = registryExists && !!successorHash && bare(registry.release.reportHash) === successorHash;
  const nextRevision = registryExists ? String(Number(currentRevision) + 1) : null;
  const trusted = normalized.reviewers.trusted;
  const decided = registryHoldsSuccessor ? P.approvals(registry, normalized) : null;
  const successorBinding = successorHash && registryHoldsSuccessor ? (bindings || []).find((item) => item.reportHash === successorHash && verifyBinding(item, normalized) && String(item.revision) === currentRevision && lower(item.releaseId) === lower(binding?.releaseId)) ?? null : null;
  const listingUsable = reads.listing.usable && typeof listing.listed === 'boolean';
  const listedOnSuccessor = listingUsable && !!successorHash && P.listingEntry(listing, normalized, { releaseId: binding?.releaseId, reportHash: successorHash });
  const storageState = !normalized.evidence.requireStoredOnChain ? 'not-required'
    : !successorOk ? 'pending'
      : storage === null ? 'unknown'
        : storage.notRecorded ? 'pending'
          : storage.error ? 'unknown'
            : storage.verified === true && bare(storage.reportHash) === successorHash && HASH.test(storage.extrinsicHash || '') ? 'done'
              : storage.verified === true ? 'pending' : 'unknown';
  const readWord = (read) => `the ${read.kind} read is ${read.state}${read.error ? ` (${read.error})` : read.detail ? ` (${read.detail})` : ''}`;
  const stop = (pendingSends || []).filter((item) => Number(item.pending) > 0);
  const roles = Object.fromEntries(RENEWAL_STEPS.map((step) => [step.step, step]));
  const stage = (id, status, verified, command) => ({ stage: id, role: roles[id].role, action: roles[id].action, status, verified, command });
  const label = releaseLabel ?? normalized.registry.label ?? '<label>';
  const submitStatus = !successorOk ? 'pending' : !registryUsable ? 'unknown' : registryHoldsSuccessor ? 'done' : 'pending';
  const stages = [
    stage('check', successorOk ? 'done' : 'pending', successorOk ? { reportHash: successorHash, completedAt: successor.completedAt, release: successor.release ?? null, predicates: screen.passed } : { reason: successor ? `the successor report fails: ${screen.failed.join(', ')}` : 'no successor report', failed: screen.failed }, `node scripts/publish-report.js --release ${report?.release ?? 'v1.0.1'} --role renewal --previous ${binding?.reportHash ?? '<bound report>'}`),
    stage('store', storageState, storageState === 'done' ? { extrinsicHash: lower(storage.extrinsicHash), blockHash: storage.blockHash ? lower(storage.blockHash) : null, blockNumber: storage.blockNumber ?? null, predicates: ['retrieved-from-chain-data', 'content-hash-equals-successor', 'extrinsic-named'] } : { reason: storageState === 'not-required' ? 'the policy does not require stored evidence' : !successorOk ? 'no successor report to store' : storage === null ? 'the successor was not retrieved from chain data; retrieve it before deciding whether to store it' : storage.notRecorded ? (storage.reason ?? 'no store of the successor is recorded; store it') : storage.error ?? ((storage.reasons || []).join(' ') || (storage.verified === true ? 'the extrinsic holds another report than the successor' : 'not verified')) }, `node scripts/store-evidence.js --report ${successorHash ?? '<successor hash>'}`),
    stage('submit', submitStatus, submitStatus === 'done' ? { revision: currentRevision, reportHash: successorHash, predicates: ['registry-dated', 'registry-domain', 'registry-fresh', 'registry-interfaces', 'report-hash-equals-successor'] } : { reason: !successorOk ? 'no successor report to submit' : !registryUsable ? `${readWord(reads.registry)}; whether the successor was submitted is unknown` : registryExists ? `the registry holds revision ${currentRevision} with ${bare(registry.release.reportHash).slice(0, 12)}…; the successor would open revision ${nextRevision}` : 'the release is not in the registry' }, `node scripts/registry-write.js --action submit --label ${label} --report ${successorHash ?? '<successor hash>'} --previous-report ${binding?.reportHash ?? '<bound report>'}`),
    stage('approve', submitStatus !== 'done' ? submitStatus : decided.ok ? 'done' : 'pending', submitStatus === 'done' && decided.ok ? { revision: currentRevision, approvedBy: decided.approved, predicates: ['registry-dated', 'registry-domain', 'registry-fresh', 'registry-interfaces', 'trusted-decisions-read', 'threshold-met', 'no-changes-requested'] } : { reason: submitStatus === 'unknown' ? `${readWord(reads.registry)}; the approval state is unknown` : submitStatus === 'pending' ? 'the successor is not the current revision' : decided.changes.length ? 'a trusted reviewer requested changes on the successor revision' : decided.unread.length ? 'not every trusted decision was read' : 'no trusted approval of the successor revision yet' }, `node scripts/registry-write.js --action review --release-id ${binding?.releaseId ?? '<release id>'} --report ${successorHash ?? '<successor hash>'} --journal artifacts/local/registry-review-r${nextRevision ?? 'N'}.json`),
    stage('bind', submitStatus !== 'done' ? submitStatus : successorBinding ? 'done' : 'pending', successorBinding ? { id: successorBinding.id, revision: successorBinding.revision, bindingHash: successorBinding.bindingHash, predicates: ['binding-intact-under-this-policy', 'binding-names-successor', 'binding-on-current-revision', 'binding-on-this-release'] } : { reason: submitStatus === 'unknown' ? `${readWord(reads.registry)}; the current revision is unknown` : submitStatus === 'pending' ? 'the successor is not the current revision' : 'no intact binding of the successor on the current revision under this policy' }, `node examples/token-catalog/catalog.js bind --config <config> --token ${normalized.subject.address} --report ${successorHash ?? '<successor hash>'} --release-id ${binding?.releaseId ?? '<release id>'} --revision ${registryHoldsSuccessor ? currentRevision : nextRevision ?? 'N'} --by "<who>" --storage-extrinsic ${storage?.extrinsicHash ?? '<store extrinsic>'} --storage-block ${storage?.blockHash ?? '<store block>'}`),
    stage('list', !normalized.consumer?.requireListed ? 'not-required' : !successorOk ? 'pending' : !listingUsable ? 'unknown' : listedOnSuccessor ? 'done' : 'pending', listedOnSuccessor ? { entry: listing.entry, block: listing.block, predicates: ['listing-dated', 'listing-domain', 'listing-fresh', 'listing-interfaces', 'listed-on-successor', 'trusted-reviewer-named'] } : { reason: !normalized.consumer?.requireListed ? 'the policy does not require a listing' : !successorOk ? 'no successor report to list' : !listingUsable ? `${readWord(reads.listing)}; whether the successor is listed is unknown` : listing.listed ? 'the consumer lists another report, release or reviewer' : 'not listed' }, `node scripts/list-token.js --label ${label} --decimals ${report?.input?.listing?.decimals ?? '<decimals>'}`),
    stage('evaluate', 'pending', { reason: 'evaluate after each stage; a valid result holds at its checkpoints and time only' }, 'node examples/token-catalog/catalog.js build --config <config> --capture <captures/NN-step.inputs.json>'),
  ];
  const unknown = stages.filter((item) => item.status === 'unknown');
  const next = unknown.length ? null : stages.find((item) => item.status === 'pending') ?? null;
  const reasons = [];
  if (stop.length) reasons.push(`a pending transaction is in the pool for ${stop.map((item) => `${item.address} (${item.pending})`).join(', ')}; wait until it is finalized or dropped before any send`);
  if (unknown.length) reasons.push(`the state of ${unknown.map((item) => item.stage).join(', ')} is unknown (${unknown.map((item) => item.verified.reason).join('; ')}); read again before any send, and never send again merely because a result could not be established`);
  return Object.freeze({
    schema: RENEWAL_PLAN_SCHEMA, at: new Date(at).toISOString(), policyName: normalized.name, subject: normalized.subject.address,
    bound: { reportHash: binding?.reportHash ?? null, revision: binding?.revision ?? null, releaseId: binding?.releaseId ?? null },
    reads, registry: registryExists ? { revision: currentRevision, reportHash: bare(registry.release.reportHash), block: registry.block ?? null } : { error: registry?.error ?? (registry ? `the registry read is ${reads.registry.state}` : 'not read') },
    successor: successorOk ? { reportHash: successorHash, completedAt: successor.completedAt, release: successor.release ?? null, predicates: screen.passed } : null, successorScreen: successor ? screen : null, nextRevision,
    stages, next, stop: reasons.length ? { reason: reasons.join('. '), kinds: [...(stop.length ? ['pending-send'] : []), ...(unknown.length ? ['unknown-state'] : [])], accounts: stop, stages: unknown.map((item) => item.stage) } : null,
    guards: ['dry-run every step first; add --broadcast with an explicit cap only after the dry-run reports what it will do', 'one coordinated signer per account; confirm system.accountNextIndex equals the account nonce before each send', 'journal the hash before sending; wait for finality; read back through both interfaces', 'a pending or uncertain send is a stop condition, not a retry instruction', 'an unknown stage is read again, never performed again on the assumption that it did not happen'],
    preserves: ['the earlier reports, decisions, bindings, listings, captures and recorded steps stay as history; nothing is rewritten', 'a successor report never inherits the old approval; the old binding never moves on its own'],
  });
}

/** The consumer configuration a consumer would use once the successor is approved and bound. The policy stays the same. */
export function successorConsumerConfig(config, { report, revision, storage }) {
  if (!verifyRun(report) || report.status !== 'passed') throw new Error('The successor is an intact, passed report.');
  if (!/^[1-9]\d*$/.test(String(revision ?? ''))) throw new Error('The successor revision is a positive integer.');
  return { ...config, release: { ...config.release, revision: String(revision), reportHash: report.evidenceHash, storage: storage?.extrinsicHash ? { extrinsicHash: lower(storage.extrinsicHash), blockHash: storage.blockHash ? lower(storage.blockHash) : null } : null }, provenance: { ...(config.provenance || {}), successorOf: { reportHash: config.release?.reportHash ?? null, revision: config.release?.revision ?? null }, preparedAt: new Date().toISOString(), note: 'Prepared by the renewal workflow; activates only when the operator adopts it after the successor is approved, bound and listed.' } };
}

/** What changed between two consumer configurations, as lines a person reads. */
export function diffConsumerConfigs(before, after) {
  const lines = [];
  const walk = (a, b, prefix) => {
    const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
    for (const key of keys) {
      const left = a?.[key], right = b?.[key];
      const pointer = `${prefix}/${key}`;
      if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) walk(left, right, pointer);
      else if (JSON.stringify(left) !== JSON.stringify(right)) lines.push({ pointer, before: left === undefined ? null : left, after: right === undefined ? null : right });
    }
  };
  walk(before, after, '');
  return { changed: lines, unchanged: lines.length === 0, policyUnchanged: JSON.stringify(before?.policy) === JSON.stringify(after?.policy), summary: lines.map((line) => `${line.pointer}: ${JSON.stringify(line.before)} → ${JSON.stringify(line.after)}`) };
}
