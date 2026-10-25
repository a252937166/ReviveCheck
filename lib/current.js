// What a consumer may do with one entry right now, kept apart from what it recorded
// earlier. One authoritative current state drives the business action; nothing else
// does. The states are explicit: `not-checked`, `checking`, then the evaluator's own
// `valid`, `recheck-required`, `expired` or `unknown`. Beginning a check removes the
// permission until a fresh acceptable result arrives; an answer to an earlier request,
// or to another selection, is ignored; a thrown error or a timeout is `unknown`, never
// the previous success; and a result older than the policy's observation limit lapses.
// The last verified result and the recorded snapshot stay available as history, each
// with its own checkpoint and time, and neither of them enables anything.
//
// Pure functions over a plain object, so the same reducer runs in a browser, in Node
// and in a test. Callers decide what a selection is (a token, a policy, a fixture).
export const CURRENT_SCHEMA = 'revivecheck.current-decision.v1';
export const CURRENT_STATES = Object.freeze(['not-checked', 'checking', 'valid', 'recheck-required', 'expired', 'unknown']);
const FINAL = new Set(['valid', 'recheck-required', 'expired', 'unknown']);
export const CURRENT_WORDS = Object.freeze({ 'not-checked': 'Not checked', checking: 'Checking', valid: 'Valid', 'recheck-required': 'Recheck required', expired: 'Expired', unknown: 'Unknown' });

const key = (selection) => JSON.stringify(selection ?? null);
const same = (a, b) => key(a) === key(b);

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
 * approved report). The answer is ignored unless it belongs to the latest request and
 * the current selection.
 */
export function settleCheck(decision, { request, selection = decision.selection, evaluation, entry = null, inputs = null, extra = null, settledAt = new Date().toISOString() }) {
  if (request !== decision.request || decision.state !== 'checking' || !same(selection, decision.selection)) return decision;
  if (!evaluation || !FINAL.has(evaluation.status)) return failCheck(decision, { request, selection, error: 'The evaluator returned no usable status.', kind: 'error' });
  const available = evaluation.enable === true && entry?.match === true;
  const current = { status: evaluation.status, available, evaluation, entry, inputs, extra, evaluatedAt: evaluation.evaluatedAt, settledAt };
  const lastVerified = available
    ? { evaluatedAt: evaluation.evaluatedAt, evaluationHash: evaluation.evaluationHash, checkpoint: evaluation.checkpoint, reportHash: evaluation.reportHash, revision: evaluation.revision, entryIdentity: entry.identity ?? null, selection }
    : decision.lastVerified;
  return { ...decision, state: evaluation.status, current, lastVerified, error: null, stale: false };
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
 * Time passed, or the tab came back: a result older than the policy's observation
 * limit no longer permits anything. The result itself stays visible as the last
 * answer, marked stale, until a new check replaces it.
 */
export function ageDecision(decision, { now = new Date(), maxObservationAgeSeconds }) {
  if (!decision.current || !Number.isFinite(Number(maxObservationAgeSeconds))) return decision;
  const age = (new Date(now).getTime() - Date.parse(decision.current.evaluatedAt)) / 1000;
  const stale = !(age >= -60 && age <= Number(maxObservationAgeSeconds));
  return stale === decision.stale ? decision : { ...decision, stale };
}

/** True only when the latest fresh result is valid, the entry equals the approved report, and the result has not lapsed. */
export const canAct = (decision) => decision.state === 'valid' && decision.current?.available === true && decision.stale !== true;

/** Words for a screen: what the state is, and why the action is or is not permitted. */
export function describeDecision(decision, { subject = 'the entry' } = {}) {
  const word = CURRENT_WORDS[decision.state] || decision.state;
  if (decision.state === 'not-checked') return { word, headline: 'Not checked yet', detail: `Nothing permits ${subject} until a check runs. Recorded results are history.`, actionable: false };
  if (decision.state === 'checking') return { word, headline: 'Checking', detail: `Permission is withdrawn while fresh reads are collected${decision.lastVerified ? '; the last verified result stays available as history' : ''}.`, actionable: false };
  if (decision.error) return { word, headline: decision.error.kind === 'timeout' ? 'Unknown: the check timed out' : 'Unknown: the check failed', detail: `${decision.error.message} Unavailable verification never counts as valid; read again.`, actionable: false };
  if (decision.stale) return { word, headline: 'Lapsed: older than the observation limit', detail: `The last result was evaluated at ${decision.current.evaluatedAt}; the policy accepts a newer observation only. Refresh before acting.`, actionable: false };
  if (canAct(decision)) return { word, headline: 'Available now', detail: `Every policy condition held at the recorded checkpoints and ${subject} equals the approved report. Validity is point in time; evaluate again before each use.`, actionable: true };
  const entryOnly = decision.state === 'valid' && decision.current?.entry?.match === false;
  return { word, headline: entryOnly ? 'Withheld: the entry differs from the approved report' : 'Withheld', detail: entryOnly ? `The policy holds, but ${subject} differs in ${decision.current.entry.mismatches.map((item) => item.field).join(', ')}; correct the configuration or approve a release that carries it.` : `The policy evaluation is ${word.toLowerCase()}; see the reasons and the next action.`, actionable: false };
}
