// What a consumer may do with one entry right now, kept apart from what it recorded
// earlier. One authoritative current state drives the business action; nothing else
// does. The states are explicit: `not-checked`, `checking`, then the evaluator's own
// `valid`, `recheck-required`, `expired` or `unknown`. Beginning a check removes the
// permission until a fresh acceptable result arrives; an answer to an earlier request,
// or to another selection, is ignored; a thrown error or a timeout is `unknown`, never
// the previous success; and a result lapses at the deadline its own evidence sets.
// The last verified result and the recorded snapshot stay available as history, each
// with its own checkpoint and time, and neither of them enables anything.
//
// The deadline is derived from the evidence the result was made on, not from the
// moment the evaluator answered: the bound report stops being acceptable at
// `completedAt + maxAgeSeconds`, and each required read at `observedAt +
// maxObservationAgeSeconds`. The earliest of those is `validUntil`; a result whose
// deadline cannot be derived (a missing or invalid required timestamp) permits nothing.
// `canAct` checks the clock it is handed, so a business action verifies the deadline
// at the moment it acts, not only when a timer last ran. The boundary is the
// evaluator's: valid at the deadline, invalid one millisecond later. The evaluator's
// sixty-second allowance for timestamps in the future is not expiry grace; it never
// extends a deadline. Nothing here detects a change on the chain: a revocation after
// the last read is seen only by a new check.
//
// Pure functions over a plain object, so the same reducer runs in a browser, in Node
// and in a test. Callers decide what a selection is (a token, a policy, a fixture).
import { normalizePolicy } from './policy.js';

export const CURRENT_SCHEMA = 'revivecheck.current-decision.v1';
export const CURRENT_STATES = Object.freeze(['not-checked', 'checking', 'valid', 'recheck-required', 'expired', 'unknown']);
const FINAL = new Set(['valid', 'recheck-required', 'expired', 'unknown']);
export const CURRENT_WORDS = Object.freeze({ 'not-checked': 'Not checked', checking: 'Checking', valid: 'Valid', 'recheck-required': 'Recheck required', expired: 'Expired', unknown: 'Unknown' });
/** The limits a deadline can come from, in the order they are reported. */
export const VALIDITY_LIMITS = Object.freeze(['report', 'observation', 'registry', 'listing', 'subject']);
const LIMIT_WORDS = Object.freeze({ report: "the report's age limit", observation: 'the network read', registry: 'the registry read', listing: 'the listing read', subject: 'the subject read' });

const key = (selection) => JSON.stringify(selection ?? null);
const same = (a, b) => key(a) === key(b);
const clock = (now) => { const at = now instanceof Date ? now.getTime() : new Date(now).getTime(); if (!Number.isFinite(at)) throw new Error('now is a valid date.'); return at; };

/**
 * When a result stops permitting anything, derived from its own evidence under the
 * policy: the report's completion time plus `evidence.maxAgeSeconds`, and the
 * observation time of each required read plus `evidence.maxObservationAgeSeconds`
 * (the listing read is required only when the policy requires a listed consumer
 * entry, the subject read only when it requires a fresh subject). `validUntil` is the earliest required deadline, or null when any required
 * timestamp or limit is missing or invalid; `limitedBy` names the limit that set it.
 * `lapsesAt` is the earliest deadline that could be derived at all, used to date a
 * withheld answer; it never grants permission. Sealed reports and hashed
 * evaluations are read, never changed.
 */
export function decisionValidity({ policy, report, inputs = null, evaluatedAt = null } = {}) {
  let normalized = null;
  try { normalized = policy ? normalizePolicy(policy) : null; } catch { normalized = null; }
  const maxAgeSeconds = normalized?.evidence.maxAgeSeconds ?? null;
  const maxObservationAgeSeconds = normalized?.evidence.maxObservationAgeSeconds ?? null;
  const requireListing = normalized ? normalized.consumer?.requireListed === true : true; // without a policy, nothing is known to be optional
  const requireSubject = normalized ? normalized.evidence.requireFreshSubject === true : true;
  const sources = {
    report: { at: report?.completedAt, limitSeconds: maxAgeSeconds, required: true },
    observation: { at: inputs?.observation?.observedAt, limitSeconds: maxObservationAgeSeconds, required: true },
    registry: { at: inputs?.registry?.observedAt, limitSeconds: maxObservationAgeSeconds, required: true },
    listing: { at: inputs?.listing?.observedAt, limitSeconds: maxObservationAgeSeconds, required: requireListing },
    subject: { at: inputs?.subject?.observedAt, limitSeconds: maxObservationAgeSeconds, required: requireSubject },
  };
  const missing = normalized ? [] : ['policy'];
  const deadlines = {};
  for (const kind of VALIDITY_LIMITS) {
    const source = sources[kind];
    if (!source.required) { deadlines[kind] = null; continue; }
    const at = typeof source.at === 'string' || source.at instanceof Date ? Date.parse(source.at instanceof Date ? source.at.toISOString() : source.at) : NaN;
    const limitOk = Number.isSafeInteger(source.limitSeconds) && source.limitSeconds > 0;
    if (!Number.isFinite(at) || !limitOk) { missing.push(kind); deadlines[kind] = { at: typeof source.at === 'string' ? source.at : null, limitSeconds: limitOk ? source.limitSeconds : null, until: null }; continue; }
    deadlines[kind] = { at: new Date(at).toISOString(), limitSeconds: source.limitSeconds, until: new Date(at + source.limitSeconds * 1000).toISOString() };
  }
  const known = VALIDITY_LIMITS.filter((kind) => deadlines[kind]?.until).map((kind) => [kind, Date.parse(deadlines[kind].until)]).sort((a, b) => a[1] - b[1]);
  const earliest = known[0] ?? null;
  const complete = missing.length === 0 && earliest !== null;
  const evaluated = evaluatedAt ? Date.parse(evaluatedAt) : NaN;
  const fallback = Number.isFinite(evaluated) && Number.isSafeInteger(maxObservationAgeSeconds) ? evaluated + maxObservationAgeSeconds * 1000 : NaN;
  const lapses = earliest ? earliest[1] : fallback;
  return Object.freeze({
    validUntil: complete ? new Date(earliest[1]).toISOString() : null,
    limitedBy: complete ? earliest[0] : null,
    lapsesAt: Number.isFinite(lapses) ? new Date(lapses).toISOString() : null,
    deadlines: Object.freeze(deadlines), missing: Object.freeze(missing), maxAgeSeconds, maxObservationAgeSeconds,
  });
}

/** The state before any check. `recorded` is an earlier published snapshot, kept for display only. */
export function initialDecision({ selection = null, recorded = null } = {}) {
  return { schema: CURRENT_SCHEMA, state: 'not-checked', request: 0, selection, startedAt: null, current: null, lastVerified: null, recorded, error: null, stale: false };
}

/** A check begins: the request number identifies its answer, and any current permission is withdrawn now. */
export function beginCheck(decision, { selection = decision.selection, startedAt = new Date().toISOString() } = {}) {
  return { ...decision, state: 'checking', request: decision.request + 1, selection, startedAt, current: null, error: null, stale: false };
}

/**
 * A check answered. `evaluation` is a `revivecheck.policy-evaluation.v1` document,
 * `entry` the entry decision (`match` true only when the configured entry equals the
 * approved report), `policy` and `report` the artifacts the evaluation was made on and
 * `inputs` the reads it used; together they set the deadline. The answer is ignored
 * unless it belongs to the latest request and the current selection. A result is
 * available only while it is valid, the entry matches, and its deadline is known and
 * not yet passed at `settledAt`.
 */
export function settleCheck(decision, { request, selection = decision.selection, evaluation, entry = null, inputs = null, extra = null, policy = null, report = null, settledAt = new Date().toISOString() }) {
  if (request !== decision.request || decision.state !== 'checking' || !same(selection, decision.selection)) return decision;
  if (!evaluation || !FINAL.has(evaluation.status)) return failCheck(decision, { request, selection, error: 'The evaluator returned no usable status.', kind: 'error' });
  const validity = decisionValidity({ policy, report, inputs, evaluatedAt: evaluation.evaluatedAt });
  const available = evaluation.enable === true && entry?.match === true && validity.validUntil !== null;
  const current = { status: evaluation.status, available, evaluation, entry, inputs, extra, validity, evaluatedAt: evaluation.evaluatedAt, settledAt };
  const lastVerified = available
    ? { evaluatedAt: evaluation.evaluatedAt, evaluationHash: evaluation.evaluationHash, checkpoint: evaluation.checkpoint, reportHash: evaluation.reportHash, revision: evaluation.revision, entryIdentity: entry.identity ?? null, selection, validUntil: validity.validUntil, limitedBy: validity.limitedBy }
    : decision.lastVerified;
  return ageDecision({ ...decision, state: evaluation.status, current, lastVerified, error: null, stale: false }, { now: settledAt });
}

/** A check failed: thrown, timed out or aborted. The result is `unknown`; nothing earlier is revived. */
export function failCheck(decision, { request, selection = decision.selection, error, kind = 'error' }) {
  if (request !== decision.request || decision.state !== 'checking' || !same(selection, decision.selection)) return decision;
  return { ...decision, state: 'unknown', current: null, error: { kind, message: String(error?.message || error || 'The check failed.'), at: new Date().toISOString() }, stale: false };
}

/** The selection changed (another token, policy or fixture): the current result no longer applies and an in-flight answer is orphaned. */
export function changeSelection(decision, selection) {
  if (same(selection, decision.selection)) return decision;
  return { ...decision, state: 'not-checked', request: decision.request + 1, selection, startedAt: null, current: null, error: null, stale: false };
}

/**
 * Time passed, or the tab came back: a result past its own deadline no longer permits
 * anything. The result itself stays visible as the last answer, marked stale, until a
 * new check replaces it. Callers run this on a timer, on visibility changes and at the
 * deadline itself; `canAct` does not depend on it having run.
 */
export function ageDecision(decision, { now = new Date() } = {}) {
  if (!decision.current) return decision;
  const at = clock(now);
  const lapses = Date.parse(decision.current.validity?.lapsesAt);
  const stale = Number.isFinite(lapses) ? at > lapses : decision.stale === true;
  return stale === decision.stale ? decision : { ...decision, stale };
}

/**
 * Whether the latest result permits the action at `now`: a fresh `valid` result, an
 * entry equal to the approved report, a derived deadline, and a clock at or before it.
 * The reason says what denies it: `not-checked`, `checking`, `failed`, `withheld`,
 * `validity-unknown` or `lapsed`.
 */
export function checkPermission(decision, { now = new Date() } = {}) {
  const at = clock(now);
  const validity = decision.current?.validity ?? null;
  const until = Date.parse(validity?.validUntil);
  const base = { validUntil: validity?.validUntil ?? null, limitedBy: validity?.limitedBy ?? null, secondsLeft: Number.isFinite(until) ? Math.max(0, Math.floor((until - at) / 1000)) : null };
  if (decision.state === 'not-checked') return { allowed: false, reason: 'not-checked', ...base };
  if (decision.state === 'checking') return { allowed: false, reason: 'checking', ...base };
  if (!decision.current) return { allowed: false, reason: 'failed', ...base };
  if (decision.state !== 'valid' || decision.current.available !== true) return { allowed: false, reason: validity?.validUntil === null && decision.state === 'valid' && decision.current.entry?.match === true ? 'validity-unknown' : 'withheld', ...base };
  if (!Number.isFinite(until)) return { allowed: false, reason: 'validity-unknown', ...base };
  if (decision.stale === true || at > until) return { allowed: false, reason: 'lapsed', ...base, secondsLeft: 0 };
  return { allowed: true, reason: null, ...base };
}

/** True only when `checkPermission` allows the action at `now`. */
export const canAct = (decision, options) => checkPermission(decision, options).allowed;

const lapseWords = (validity) => validity?.limitedBy ? `${LIMIT_WORDS[validity.limitedBy]} ended it at ${validity.validUntil}` : validity?.lapsesAt ? `its evidence stopped being acceptable at ${validity.lapsesAt}` : 'its deadline passed';

/** Words for a screen: what the state is, and why the action is or is not permitted at `now`. */
export function describeDecision(decision, { subject = 'the entry', now = new Date() } = {}) {
  const word = CURRENT_WORDS[decision.state] || decision.state;
  if (decision.state === 'not-checked') return { word, headline: 'Not checked yet', detail: `Nothing permits ${subject} until a check runs. Recorded results are history.`, actionable: false };
  if (decision.state === 'checking') return { word, headline: 'Checking', detail: `Permission is withdrawn while fresh reads are collected${decision.lastVerified ? '; the last verified result stays available as history' : ''}.`, actionable: false };
  if (decision.error) return { word, headline: decision.error.kind === 'timeout' ? 'Unknown: the check timed out' : 'Unknown: the check failed', detail: `${decision.error.message} Unavailable verification never counts as valid; read again.`, actionable: false };
  const permission = checkPermission(decision, { now });
  const validity = decision.current?.validity ?? null;
  if (permission.reason === 'lapsed') {
    const cause = validity?.limitedBy === 'report' ? 'the report expired' : 'the reads are older than the observation limit';
    return decision.current.available
      ? { word, headline: `Lapsed: ${cause}`, detail: `The result evaluated at ${decision.current.evaluatedAt} permitted ${subject} until ${validity.validUntil}; ${lapseWords(validity)}. Nothing permits it now. Refresh to read again; a change on the chain since the last read is seen only by a new check.`, actionable: false }
      : { word, headline: 'Withheld, and the answer has lapsed', detail: `The policy evaluation was ${word.toLowerCase()} and ${lapseWords(validity)}. Refresh before relying on any of it.`, actionable: false };
  }
  if (permission.allowed) return { word, headline: 'Available now', detail: `Every policy condition held at the recorded checkpoints and ${subject} equals the approved report. This holds until ${validity.validUntil} (${LIMIT_WORDS[validity.limitedBy]}), and only for what was read: a change on the chain since then is seen by a new check only.`, actionable: true };
  if (permission.reason === 'validity-unknown') return { word, headline: 'Withheld: the validity deadline cannot be derived', detail: `The evaluation is valid, but the deadline of its evidence is unknown (missing: ${(validity?.missing ?? ['the evidence']).join(', ')}), so nothing permits ${subject}. Read again with dated inputs.`, actionable: false };
  const entryOnly = decision.state === 'valid' && decision.current?.entry?.match === false;
  return { word, headline: entryOnly ? 'Withheld: the entry differs from the approved report' : 'Withheld', detail: entryOnly ? `The policy holds, but ${subject} differs in ${decision.current.entry.mismatches.map((item) => item.field).join(', ')}; correct the configuration or approve a release that carries it.` : `The policy evaluation is ${word.toLowerCase()}; see the reasons and the next action.`, actionable: false };
}
