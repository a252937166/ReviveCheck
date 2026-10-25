import test from 'node:test';
import assert from 'node:assert/strict';
import { initialDecision, beginCheck, settleCheck, failCheck, changeSelection, ageDecision, canAct, describeDecision, CURRENT_STATES } from '../lib/current.js';

// Assessment 2026-10-25, O-02: one authoritative current evaluation. A refresh removes
// the permission until a fresh acceptable result exists; a failed, timed-out, stale or
// orphaned refresh never leaves a green state presented as current.
const evaluation = (status, at = '2026-10-25T10:00:00.000Z', extra = {}) => ({ schema: 'revivecheck.policy-evaluation.v1', status, enable: status === 'valid', reasons: status === 'valid' ? [] : [{ code: extra.code || 'approval-revoked', status, text: 'x' }], evaluatedAt: at, evaluationHash: `h-${status}-${at}`, checkpoint: { registry: { number: '1' }, observation: { number: '1' }, listing: { number: '1' } }, reportHash: 'r', revision: '2', ...extra });
const entryOk = { match: true, mismatches: [], identity: 'e1' };
const entryBad = { match: false, mismatches: [{ field: 'decimals', configured: 18, approved: 6 }], identity: null };
const selection = { token: '0xabc', fixture: null };

function verified() {
  let decision = beginCheck(initialDecision({ selection, recorded: { status: 'valid' } }));
  decision = settleCheck(decision, { request: decision.request, evaluation: evaluation('valid'), entry: entryOk });
  assert.equal(canAct(decision), true);
  return decision;
}

test('nothing permits the action before a check; a recorded snapshot is history', () => {
  const decision = initialDecision({ selection, recorded: { status: 'valid', available: true } });
  assert.equal(decision.state, 'not-checked');
  assert.equal(canAct(decision), false);
  assert.deepEqual(CURRENT_STATES, ['not-checked', 'checking', 'valid', 'recheck-required', 'expired', 'unknown']);
  assert.match(describeDecision(decision).detail, /Recorded results are history/);
});

test('beginning a refresh withdraws the permission; the last verified result stays as history', () => {
  const before = verified();
  const during = beginCheck(before);
  assert.equal(during.state, 'checking');
  assert.equal(canAct(during), false);
  assert.equal(during.current, null);
  assert.equal(during.lastVerified.evaluationHash, before.current.evaluation.evaluationHash);
  assert.match(describeDecision(during).detail, /withdrawn/);
});

test('recorded-valid to fresh-revoked, fresh-expired and unsupported runtime: each withholds and keeps the last verified result apart', () => {
  for (const [status, code] of [['recheck-required', 'approval-revoked'], ['expired', 'evidence-expired'], ['recheck-required', 'runtime-unsupported']]) {
    const before = verified();
    const during = beginCheck(before);
    const after = settleCheck(during, { request: during.request, evaluation: evaluation(status, '2026-10-25T10:05:00.000Z', { code }), entry: entryOk });
    assert.equal(after.state, status);
    assert.equal(canAct(after), false);
    assert.equal(after.current.available, false);
    assert.equal(after.lastVerified.evaluatedAt, '2026-10-25T10:00:00.000Z', 'the earlier success is kept, dated, as history');
    assert.notEqual(after.lastVerified.evaluationHash, after.current.evaluation.evaluationHash);
  }
});

test('a valid policy with a differing entry is withheld and names the field', () => {
  const during = beginCheck(initialDecision({ selection }));
  const after = settleCheck(during, { request: during.request, evaluation: evaluation('valid'), entry: entryBad });
  assert.equal(after.state, 'valid');
  assert.equal(canAct(after), false);
  assert.equal(after.lastVerified, null);
  assert.match(describeDecision(after).headline, /entry differs/);
  assert.match(describeDecision(after).detail, /decimals/);
});

test('a thrown error or a timeout is unknown; no previous green survives it', () => {
  for (const kind of ['error', 'timeout']) {
    const during = beginCheck(verified());
    const after = failCheck(during, { request: during.request, error: new Error('Portaldot V3 Testnet did not answer in time'), kind });
    assert.equal(after.state, 'unknown');
    assert.equal(after.current, null);
    assert.equal(canAct(after), false);
    assert.equal(after.error.kind, kind);
    assert.match(describeDecision(after).headline, kind === 'timeout' ? /timed out/ : /failed/);
    assert.match(describeDecision(after).detail, /never counts as valid/);
  }
});

test('a slower answer for an earlier request, or for another selection, never replaces the latest result', () => {
  const first = beginCheck(initialDecision({ selection }));
  const firstRequest = first.request;
  const second = beginCheck(first);
  const settledSecond = settleCheck(second, { request: second.request, evaluation: evaluation('recheck-required', '2026-10-25T10:06:00.000Z'), entry: entryOk });
  const lateFirst = settleCheck(settledSecond, { request: firstRequest, evaluation: evaluation('valid', '2026-10-25T10:05:00.000Z'), entry: entryOk });
  assert.equal(lateFirst, settledSecond, 'the orphaned valid answer changed nothing');
  assert.equal(canAct(lateFirst), false);

  const other = beginCheck(initialDecision({ selection }));
  const switched = changeSelection(other, { token: '0xdef', fixture: null });
  assert.equal(switched.state, 'not-checked');
  const orphan = settleCheck(switched, { request: other.request, selection, evaluation: evaluation('valid'), entry: entryOk });
  assert.equal(orphan, switched, 'an answer for the previous selection is ignored');
  const orphanFail = failCheck(switched, { request: other.request, selection, error: 'late failure' });
  assert.equal(orphanFail, switched);
  assert.equal(changeSelection(switched, { token: '0xdef', fixture: null }), switched, 'the same selection is a no-op');
});

test('a result older than the observation limit lapses, and a new check restores the permission', () => {
  const fresh = verified();
  const soon = ageDecision(fresh, { now: '2026-10-25T10:10:00.000Z', maxObservationAgeSeconds: 900 });
  assert.equal(canAct(soon), true);
  const later = ageDecision(fresh, { now: '2026-10-25T10:16:00.000Z', maxObservationAgeSeconds: 900 });
  assert.equal(later.stale, true);
  assert.equal(canAct(later), false);
  assert.match(describeDecision(later).headline, /Lapsed/);
  assert.equal(later.current.evaluation.status, 'valid', 'the lapsed answer stays visible as what it was');
  const again = beginCheck(later);
  assert.equal(again.stale, false);
  const restored = settleCheck(again, { request: again.request, evaluation: evaluation('valid', '2026-10-25T10:17:00.000Z'), entry: entryOk });
  assert.equal(canAct(restored), true);
});

test('an evaluator result without a usable status is a failure, not a success', () => {
  const during = beginCheck(initialDecision({ selection }));
  const after = settleCheck(during, { request: during.request, evaluation: { status: 'green', enable: true }, entry: entryOk });
  assert.equal(after.state, 'unknown');
  assert.equal(canAct(after), false);
});
