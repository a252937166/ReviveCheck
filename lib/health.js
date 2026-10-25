// Evidence health and renewal as a workflow, read-only. `evidenceHealth` says, from the
// bound report, the policy, a registry read, a listing read and a network observation,
// when the report expires, when each read's permission lapses, whether the approval and
// the listing stand on the bound revision, whether a successor report exists, and which
// role acts next. `renewalPlan` derives the renewal stages from VERIFIED state: a stage is
// done only when a chain read or an intact artifact shows it, the next revision is the
// registry's current revision plus one (never assumed), a pending send on a signer is a
// stop condition, and nothing here broadcasts, migrates a binding or extends evidence age.
// `successorConsumerConfig` writes the configuration a consumer would use once the
// successor report is approved and bound, and `diffConsumerConfigs` lists what changed.
import { normalizePolicy, verifyBinding } from './policy.js';
import { verifyRun } from './report.js';
import { evidenceExpiry, RENEWAL_STEPS } from './decision.js';

export const HEALTH_SCHEMA = 'revivecheck.evidence-health.v1';
export const RENEWAL_PLAN_SCHEMA = 'revivecheck.renewal-plan.v1';
const lower = (value) => String(value ?? '').toLowerCase();
const bare = (hash) => lower(hash).replace(/^0x/, '');
const clock = (value) => { const at = value instanceof Date ? value.getTime() : Date.parse(value); if (!Number.isFinite(at)) throw new Error('now is a valid date.'); return at; };
const HOUR = 3600;

/** Candidate successor reports: intact, passed, same plan fingerprint and subject, newer than the bound report; newest first. */
export function successorReports(reports, { binding, report, policy }) {
  const normalized = normalizePolicy(policy);
  const since = Date.parse(report?.completedAt ?? 0);
  return (reports || [])
    .filter((item) => verifyRun(item) && item.status === 'passed' && item.evidenceHash !== binding?.reportHash && item.binding?.planHash === normalized.planHash && lower(item.input?.listing?.address) === normalized.subject.address && Date.parse(item.completedAt) > since)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
    .map((item) => ({ reportHash: item.evidenceHash, release: item.release ?? null, completedAt: item.completedAt, blockNumber: item.network?.finalizedBlockNumber ?? null, expiresAt: evidenceExpiry(item, normalized).expiresAt }));
}

/**
 * The health of one binding at `now`. `registry`, `listing` and `observation` are the reads
 * `collectPolicyInputs` returns (each may carry `error`); `reports` are the sealed reports
 * known locally, scanned for a successor. `freezeAt` (optional) is a date the evidence has
 * to cover, so a planned gap is stated instead of discovered.
 */
export function evidenceHealth({ policy, binding, report, registry = null, listing = null, observation = null, reports = [], now = new Date(), freezeAt = null, plannedRenewalAt = null }) {
  const normalized = normalizePolicy(policy);
  const at = clock(now);
  const expiry = evidenceExpiry(report, normalized, at);
  const limit = normalized.evidence.maxObservationAgeSeconds;
  const readState = (read, kind) => {
    if (!read || read.error) return { kind, state: 'unavailable', error: read?.error ?? 'not read', observedAt: null, lapsesAt: null };
    const observed = Date.parse(read.observedAt);
    const lapses = Number.isFinite(observed) ? observed + limit * 1000 : NaN;
    return { kind, state: Number.isFinite(lapses) ? (at <= lapses ? 'fresh' : 'stale') : 'undated', observedAt: read.observedAt ?? null, lapsesAt: Number.isFinite(lapses) ? new Date(lapses).toISOString() : null, secondsLeft: Number.isFinite(lapses) ? Math.floor((lapses - at) / 1000) : null, block: read.block ?? read.finalized ?? null };
  };
  const reads = { observation: readState(observation, 'observation'), registry: readState(registry, 'registry'), listing: normalized.consumer?.requireListed ? readState(listing, 'listing') : { kind: 'listing', state: 'not-required' } };
  const registryOk = registry && !registry.error && registry.release;
  const trusted = normalized.reviewers.trusted;
  const decisions = registryOk ? (registry.decisions || {}) : {};
  const approvedBy = trusted.filter((reviewer) => decisions[reviewer]?.reviewed === true && decisions[reviewer]?.approved === true);
  const changesBy = trusted.filter((reviewer) => decisions[reviewer]?.reviewed === true && decisions[reviewer]?.approved === false);
  const approval = !registryOk ? { state: 'unknown', detail: registry?.error ?? 'the registry was not read' }
    : !registry.release.exists ? { state: 'missing', detail: 'the release is not in the registry' }
      : { state: approvedBy.length >= normalized.reviewers.threshold && changesBy.length === 0 ? 'approved' : changesBy.length ? 'changes-requested' : 'pending', revision: registry.release.revision, reportHash: bare(registry.release.reportHash), approvedBy, changesBy, threshold: normalized.reviewers.threshold, detail: `${approvedBy.length} of ${trusted.length} trusted reviewer(s) approved revision ${registry.release.revision}${changesBy.length ? `; ${changesBy.length} requested changes` : ''}` };
  const bound = { reportHash: binding?.reportHash ?? null, revision: binding?.revision ?? null, releaseId: binding?.releaseId ?? null, intact: verifyBinding(binding, normalized), onCurrentRevision: registryOk && registry.release.exists ? String(registry.release.revision) === String(binding?.revision) && bare(registry.release.reportHash) === bare(binding?.reportHash) : null };
  const listingOk = listing && !listing.error && typeof listing.listed === 'boolean';
  const listed = !normalized.consumer?.requireListed ? { state: 'not-required' } : !listingOk ? { state: 'unknown', detail: listing?.error ?? 'the consumer was not read' }
    : { state: listing.listed ? (bare(listing.entry?.reportHash) === bare(binding?.reportHash) && lower(listing.entry?.releaseId) === lower(binding?.releaseId) ? 'listed-on-bound-report' : 'listed-on-another-report') : 'not-listed', entry: listing.entry ?? null };
  const successors = successorReports(reports, { binding, report, policy: normalized });
  const nextRevision = registryOk && registry.release.exists ? String(Number(registry.release.revision) + 1) : null;
  const warnings = [];
  if (expiry.expired) warnings.push({ code: 'evidence-expired', text: `The bound report expired at ${expiry.expiresAt}; every evaluation is expired until a new report is approved and bound.` });
  else if (expiry.secondsLeft <= 48 * HOUR) warnings.push({ code: 'evidence-expiring', text: `The bound report expires in ${(expiry.secondsLeft / HOUR).toFixed(1)} hours (${expiry.expiresAt}).` });
  if (freezeAt && Number.isFinite(Date.parse(freezeAt)) && Date.parse(expiry.expiresAt) < Date.parse(freezeAt)) warnings.push({ code: 'gap-before-freeze', text: `The evidence expires at ${expiry.expiresAt}, before ${freezeAt}${plannedRenewalAt ? `; with renewal planned at ${plannedRenewalAt} the entry is withheld from ${expiry.expiresAt} until the successor is bound and listed` : '; renew before then or state the gap'}.` });
  if (plannedRenewalAt && Number.isFinite(Date.parse(plannedRenewalAt)) && Date.parse(plannedRenewalAt) > Date.parse(expiry.expiresAt)) warnings.push({ code: 'planned-gap', text: `Renewal is planned for ${plannedRenewalAt}, after the expiry at ${expiry.expiresAt}: a denial period of ${((Date.parse(plannedRenewalAt) - Date.parse(expiry.expiresAt)) / 86400000).toFixed(1)} days is expected and should be stated publicly.` });
  if (bound.onCurrentRevision === false) warnings.push({ code: 'revision-superseded', text: `The registry holds revision ${registry.release.revision} (${bare(registry.release.reportHash).slice(0, 12)}…); the binding names revision ${binding?.revision}.` });
  if (approval.state === 'changes-requested') warnings.push({ code: 'approval-revoked', text: 'A trusted reviewer requested changes on the current revision.' });
  if (listed.state === 'not-listed' || listed.state === 'listed-on-another-report') warnings.push({ code: 'not-listed', text: `The consumer ${listed.state === 'not-listed' ? 'does not list the subject' : 'lists the subject on another report'}.` });
  for (const read of Object.values(reads)) if (read.state === 'stale' || read.state === 'unavailable') warnings.push({ code: `read-${read.state}`, text: `The ${read.kind} read is ${read.state}${read.error ? ` (${read.error})` : ''}; read again before relying on anything.` });
  // Who acts next: the first stage of the renewal whose verified state is missing, given the health.
  let nextRole;
  if (expiry.expired || expiry.secondsLeft <= 48 * HOUR || bound.onCurrentRevision === false || approval.state === 'changes-requested') {
    if (!successors.length) nextRole = { role: 'release owner', action: 'check the release again and publish the new sealed report', stage: 'check' };
    else if (!(registryOk && registry.release.exists && bare(registry.release.reportHash) === successors[0].reportHash)) nextRole = { role: 'release owner', action: `store and submit the successor report ${successors[0].reportHash.slice(0, 12)}… as revision ${nextRevision ?? '?'}`, stage: 'submit' };
    else if (approval.state !== 'approved') nextRole = { role: 'trusted reviewer', action: `approve the exact hash of revision ${registry.release.revision}`, stage: 'approve' };
    else nextRole = { role: 'consumer operator', action: 'bind the approved successor report explicitly, then the owner lists it again', stage: 'bind' };
  } else if (approval.state === 'pending') nextRole = { role: 'trusted reviewer', action: `approve the exact hash of revision ${registry.release.revision}`, stage: 'approve' };
  else if (listed.state === 'not-listed') nextRole = { role: 'release owner', action: 'list the subject on the approved revision', stage: 'list' };
  else nextRole = { role: 'consumer', action: 'evaluate before each use; nothing to renew yet', stage: 'evaluate' };
  return Object.freeze({
    schema: HEALTH_SCHEMA, at: new Date(at).toISOString(), policyName: normalized.name, subject: normalized.subject.address,
    report: { reportHash: binding?.reportHash ?? report?.evidenceHash ?? null, completedAt: expiry.completedAt, maxAgeSeconds: expiry.maxAgeSeconds, expiresAt: expiry.expiresAt, secondsLeft: expiry.secondsLeft, expired: expiry.expired === true },
    reads, approval, bound, listed, successors, nextRevision, nextRole, warnings,
    freeze: freezeAt ? { at: freezeAt, covered: Date.parse(expiry.expiresAt) >= Date.parse(freezeAt) } : null, plannedRenewalAt,
    note: 'Refreshing the registry does not renew the report\'s age; a successor report never inherits an approval; nothing moves a binding. This view reads; it signs nothing.',
  });
}

/**
 * The renewal stages with their verified state. `successor` is the successor report (or
 * null); `storage` the retrieval of the successor from chain data; `registry`, `listing`
 * fresh reads; `bindings` the binding history; `pendingSends` the per-account pending
 * transaction state ({ address, pending: number }) read from `system.accountNextIndex`
 * against the account nonce. A stage is done only when its evidence is verified; the next
 * stage to perform is the first pending one; a pending send stops the plan.
 */
export function renewalPlan({ policy, binding, report, successor = null, storage = null, registry = null, listing = null, bindings = [], pendingSends = [], now = new Date(), releaseLabel = null }) {
  const normalized = normalizePolicy(policy);
  const at = clock(now);
  const successorHash = successor?.evidenceHash ?? null;
  const successorOk = !!successor && verifyRun(successor) && successor.status === 'passed' && successor.binding?.planHash === normalized.planHash;
  const registryOk = registry && !registry.error && registry.release?.exists;
  const currentRevision = registryOk ? String(registry.release.revision) : null;
  const registryHoldsSuccessor = registryOk && successorHash && bare(registry.release.reportHash) === successorHash;
  const nextRevision = registryOk ? String(Number(currentRevision) + 1) : null;
  const trusted = normalized.reviewers.trusted;
  const approvedSuccessor = registryHoldsSuccessor && trusted.filter((reviewer) => registry.decisions?.[reviewer]?.reviewed === true && registry.decisions?.[reviewer]?.approved === true).length >= normalized.reviewers.threshold && !trusted.some((reviewer) => registry.decisions?.[reviewer]?.reviewed === true && registry.decisions?.[reviewer]?.approved === false);
  const successorBinding = successorHash ? (bindings || []).find((item) => item.reportHash === successorHash && verifyBinding(item, normalized) && registryHoldsSuccessor && String(item.revision) === currentRevision) ?? null : null;
  const listedOnSuccessor = normalized.consumer?.requireListed ? (listing && !listing.error && listing.listed === true && bare(listing.entry?.reportHash) === successorHash && trusted.includes(lower(listing.entry?.reviewer))) : null;
  const storedSuccessor = normalized.evidence.requireStoredOnChain ? (storage && !storage.error && storage.verified === true && bare(storage.reportHash) === successorHash) : null;
  const stop = (pendingSends || []).filter((item) => Number(item.pending) > 0);
  const roles = Object.fromEntries(RENEWAL_STEPS.map((step) => [step.step, step]));
  const stage = (id, done, verified, command) => ({ stage: id, role: roles[id].role, action: roles[id].action, status: done === true ? 'done' : done === null ? 'not-required' : 'pending', verified, command });
  const label = releaseLabel ?? normalized.registry.label ?? '<label>';
  const stages = [
    stage('check', successorOk, successorOk ? { reportHash: successorHash, completedAt: successor.completedAt, release: successor.release ?? null } : { reason: successor ? 'the successor report does not verify, did not pass or was made under another plan' : 'no successor report' }, `node scripts/publish-report.js --release ${report?.release ?? 'v1.0.1'} --role renewal --previous ${binding?.reportHash ?? '<bound report>'}`),
    stage('store', normalized.evidence.requireStoredOnChain ? storedSuccessor === true : null, storedSuccessor ? { extrinsicHash: storage.extrinsicHash, blockNumber: storage.blockNumber ?? null } : { reason: !normalized.evidence.requireStoredOnChain ? 'the policy does not require stored evidence' : storage?.error ?? (storage ? (storage.reasons || []).join(' ') || 'not verified' : 'no retrieval of the successor') }, `node scripts/store-evidence.js --report ${successorHash ?? '<successor hash>'}`),
    stage('submit', registryHoldsSuccessor === true, registryHoldsSuccessor ? { revision: currentRevision, reportHash: successorHash } : { reason: registryOk ? `the registry holds revision ${currentRevision} with ${bare(registry.release.reportHash).slice(0, 12)}…; the successor would open revision ${nextRevision}` : registry?.error ?? 'the registry was not read' }, `node scripts/registry-write.js --action submit --label ${label} --report ${successorHash ?? '<successor hash>'} --previous-report ${binding?.reportHash ?? '<bound report>'}`),
    stage('approve', approvedSuccessor === true, approvedSuccessor ? { revision: currentRevision, approvedBy: trusted.filter((reviewer) => registry.decisions?.[reviewer]?.approved === true) } : { reason: registryHoldsSuccessor ? 'no trusted approval of the successor revision yet' : 'the successor is not the current revision' }, `node scripts/registry-write.js --action review --release-id ${binding?.releaseId ?? '<release id>'} --report ${successorHash ?? '<successor hash>'} --journal artifacts/local/registry-review-r${nextRevision ?? 'N'}.json`),
    stage('bind', !!successorBinding, successorBinding ? { id: successorBinding.id, revision: successorBinding.revision, bindingHash: successorBinding.bindingHash } : { reason: registryHoldsSuccessor ? 'no intact binding of the successor on the current revision under this policy' : 'the successor is not the current revision' }, `node examples/token-catalog/catalog.js bind --config <config> --token ${normalized.subject.address} --report ${successorHash ?? '<successor hash>'} --release-id ${binding?.releaseId ?? '<release id>'} --revision ${registryHoldsSuccessor ? currentRevision : nextRevision ?? 'N'} --by "<who>" --storage-extrinsic ${storage?.extrinsicHash ?? '<store extrinsic>'} --storage-block ${storage?.blockHash ?? '<store block>'}`),
    stage('list', normalized.consumer?.requireListed ? listedOnSuccessor === true : null, listedOnSuccessor ? { entry: listing.entry, block: listing.block } : { reason: !normalized.consumer?.requireListed ? 'the policy does not require a listing' : listing?.error ?? (listing?.listed ? 'the consumer lists another report' : 'not listed') }, `node scripts/list-token.js --label ${label} --decimals ${report?.input?.listing?.decimals ?? '<decimals>'}`),
    stage('evaluate', false, { reason: 'evaluate after each stage; a valid result holds at its checkpoints and time only' }, 'node examples/token-catalog/catalog.js build --config <config> --capture <captures/NN-step.inputs.json>'),
  ];
  const next = stages.find((item) => item.status === 'pending') ?? null;
  return Object.freeze({
    schema: RENEWAL_PLAN_SCHEMA, at: new Date(at).toISOString(), policyName: normalized.name, subject: normalized.subject.address,
    bound: { reportHash: binding?.reportHash ?? null, revision: binding?.revision ?? null, releaseId: binding?.releaseId ?? null },
    registry: registryOk ? { revision: currentRevision, reportHash: bare(registry.release.reportHash), block: registry.block ?? null } : { error: registry?.error ?? 'not read' },
    successor: successorOk ? { reportHash: successorHash, completedAt: successor.completedAt, release: successor.release ?? null } : null, nextRevision,
    stages, next, stop: stop.length ? { reason: `a pending transaction is in the pool for ${stop.map((item) => `${item.address} (${item.pending})`).join(', ')}; wait until it is finalized or dropped before any send`, accounts: stop } : null,
    guards: ['dry-run every step first; add --broadcast with an explicit cap only after the dry-run reports what it will do', 'one coordinated signer per account; confirm system.accountNextIndex equals the account nonce before each send', 'journal the hash before sending; wait for finality; read back through both interfaces', 'a pending or uncertain send is a stop condition, not a retry instruction'],
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
