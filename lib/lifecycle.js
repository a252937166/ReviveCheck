import { randomUUID } from 'node:crypto';
import { fingerprint, verifyRun, buildRunBinding } from './report.js';

const decisionValues = ['accepted', 'changes-requested'];
export function verifyReview(review) {
  try {
    if (!review || typeof review !== 'object' || Array.isArray(review)) return false;
    const { receiptHash, ...payload } = review;
    const keys = ['schema', 'id', 'reportHash', 'reviewer', 'decision', 'comment', 'createdAt', 'identity'];
    return Object.keys(payload).length === keys.length && keys.every(key => Object.hasOwn(payload, key)) && payload.schema === 'revivecheck.review.v1' && payload.identity === 'self-declared' && /^[A-Za-z0-9._-]{1,120}$/.test(payload.id) && /^[a-f0-9]{64}$/.test(payload.reportHash) && typeof payload.reviewer === 'string' && payload.reviewer.trim().length > 0 && payload.reviewer.length <= 120 && decisionValues.includes(payload.decision) && typeof payload.comment === 'string' && payload.comment.length <= 4000 && typeof payload.createdAt === 'string' && Number.isFinite(Date.parse(payload.createdAt)) && /^[a-f0-9]{64}$/.test(receiptHash) && fingerprint(payload) === receiptHash;
  } catch { return false; }
}
export function createReview(run, input) {
  if (!verifyRun(run)) throw new Error('Review requires an intact saved report.');
  if (!input || typeof input !== 'object') throw new Error('Review details are required.');
  const payload = { schema: 'revivecheck.review.v1', id: randomUUID(), reportHash: run.evidenceHash, reviewer: typeof input.reviewer === 'string' ? input.reviewer.trim() : '', decision: input.decision, comment: typeof input.comment === 'string' ? input.comment.trim() : '', createdAt: new Date().toISOString(), identity: 'self-declared' };
  const review = { ...payload, receiptHash: fingerprint(payload) };
  if (!verifyReview(review)) throw new Error('Use a reviewer name, accepted/changes-requested decision, and a comment of at most 4000 characters.');
  return review;
}
export function lifecycleForRun(run, { project, runs = [], reviews = [], shares = [] } = {}) {
  const intact = verifyRun(run);
  const binding = buildRunBinding(run);
  const relatedReviews = reviews.filter(review => review.reportHash === run.evidenceHash && verifyReview(review));
  const latestByReviewer = new Map(relatedReviews.map(review => [review.reviewer, review]));
  const reviewStatus = !relatedReviews.length ? 'unreviewed' : [...latestByReviewer.values()].some(review => review.decision === 'changes-requested') ? 'changes-requested' : 'accepted';
  const prepared = shares.filter(share => share.reportHash === run.evidenceHash);
  const reasons = [];
  let freshness = 'current-snapshot';
  if (project) {
    const current = buildRunBinding({ input: project });
    if (binding.planHash !== current.planHash) { freshness = 'plan-changed'; reasons.push('The current project has a different acceptance plan.'); }
    else if (binding.contractAddress !== current.contractAddress || String(run.input?.expectedChainId) !== String(project.expectedChainId)) { freshness = 'target-changed'; reasons.push('Current deployment or expected network differs from this saved report.'); }
    else if (String(run.release || '') !== String(project.release || '') || binding.sourceRevision !== current.sourceRevision) { freshness = 'release-changed'; reasons.push('The project release or declared source revision changed.'); }
  }
  const later = runs.filter(other => other.projectId === run.projectId && other.mode === 'live' && verifyRun(other) && Date.parse(other.completedAt || other.startedAt) > Date.parse(run.completedAt || run.startedAt)).sort((a, b) => Date.parse(b.completedAt || b.startedAt) - Date.parse(a.completedAt || a.startedAt))[0];
  if (later && run.mode === 'live') {
    const latestEnvironment = buildRunBinding(later).environment;
    const drift = Object.keys(binding.environment).filter(key => key in latestEnvironment && binding.environment[key] !== latestEnvironment[key]);
    if (drift.length) { freshness = 'environment-changed'; reasons.push(`A later saved observation changed ${drift.join(', ')}. Recheck the current target.`); }
  }
  const verification = { status: !intact ? 'integrity-invalid' : run.mode === 'rehearsal' ? 'sample' : run.status, integrity: intact ? 'valid' : 'invalid', scope: run.scope, caveat: 'Integrity is not an authenticated RPC source, security audit, or guarantee of future execution.' };
  const publishing = { status: prepared.length ? 'share-prepared' : 'not-shared', count: prepared.length, caveat: 'A locally prepared share is not proof of public hosting or recipient access.' };
  const review = { status: reviewStatus, count: relatedReviews.length, identity: 'self-declared', official: false, reportHash: run.evidenceHash, caveat: 'Review receipts express self-declared opinions on this exact report; identities and official authority are not verified.' };
  const canRecheck = !!project && !project.archivedAt;
  const kind = !intact ? 'import-original' : freshness !== 'current-snapshot' ? 'recheck' : run.mode === 'rehearsal' ? 'run-live' : run.status !== 'passed' ? 'fix' : reviewStatus === 'changes-requested' ? 'address-review' : !prepared.length ? 'share' : reviewStatus === 'unreviewed' ? 'request-review' : 'recheck';
  const labels = { 'import-original': 'Import the original intact report', recheck: 'Create a new live check', 'run-live': 'Check your real project', fix: 'Resolve the first blocking check and rerun', 'address-review': 'Address review feedback and create a new run', share: 'Prepare a shareable report', 'request-review': 'Ask a reviewer to inspect this report' };
  return { verification, publishing, review, freshness: { status: freshness, reasons, caveat: 'No known change in saved observations does not prove the live environment is unchanged.' }, recheck: { available: canRecheck, mode: 'live', endpoint: canRecheck ? `/api/projects/${project.id}/recheck` : null }, nextAction: { kind, label: labels[kind], reason: reasons[0] || run.checks?.find(check => check.status !== 'passed')?.remediation || review.caveat, projectId: project?.id || null } };
}
export function workspaceLifecycle(state) {
  return Object.fromEntries(state.runs.map(run => [run.id, lifecycleForRun(run, { project: state.projects.find(project => project.id === run.projectId), runs: state.runs, reviews: state.reviews, shares: state.shares })]));
}
