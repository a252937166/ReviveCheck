import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialDecision, beginCheck, settleCheck, failCheck, changeSelection, ageDecision, canAct, checkPermission, decisionValidity, describeDecision, CURRENT_STATES, VALIDITY_LIMITS } from '../lib/current.js';
import { evaluateBinding } from '../lib/policy.js';

// Assessment 2026-10-25, O-02: one authoritative current evaluation. A refresh removes
// the permission until a fresh acceptable result exists; a failed, timed-out, stale or
// orphaned refresh never leaves a green state presented as current.
//
// Remaining fixes 2026-10-25, item 1: a current permission never outlives the evidence
// it rests on. The deadline comes from the bound report's age and from each required
// read's observation time under the policy limits, never from the evaluation time; it
// is checked against the clock at the moment of acting, with the evaluator's boundary.
const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8').then(JSON.parse);
const config = await load('examples/token-catalog/config/testnet-v2.json');
const policy = config.policy;                         // maxAgeSeconds 604800, maxObservationAgeSeconds 900, consumer.requireListed true
const report = await load('public/reports/1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51.json');
const EXPIRY = '2026-11-01T09:29:17.646Z';            // report.completedAt + 7 days
const T = '2026-10-25T10:00:00.000Z';
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const reads = (observation, registry = observation, listing = observation) => ({ observation: { observedAt: observation }, registry: { observedAt: registry }, listing: { observedAt: listing } });

const evaluation = (status, at = T, extra = {}) => ({ schema: 'revivecheck.policy-evaluation.v1', status, enable: status === 'valid', reasons: status === 'valid' ? [] : [{ code: extra.code || 'approval-revoked', status, text: 'x' }], evaluatedAt: at, evaluationHash: `h-${status}-${at}`, checkpoint: { registry: { number: '1' }, observation: { number: '1' }, listing: { number: '1' } }, reportHash: 'r', revision: '2', ...extra });
const entryOk = { match: true, mismatches: [], identity: 'e1' };
const entryBad = { match: false, mismatches: [{ field: 'decimals', configured: 18, approved: 6 }], identity: null };
const selection = { token: '0xabc', fixture: null };

/** A check settled at `at` on reads taken `readAge` seconds earlier, with the real policy and report. */
function settle(decision, { at = T, status = 'valid', entry = entryOk, inputs = reads(plus(at, -2000)), policy: usedPolicy = policy, report: usedReport = report, settledAt = at } = {}) {
  return settleCheck(decision, { request: decision.request, evaluation: evaluation(status, at), entry, inputs, policy: usedPolicy, report: usedReport, settledAt });
}
function verified(options = {}) {
  const decision = settle(beginCheck(initialDecision({ selection, recorded: { status: 'valid' } })), options);
  assert.equal(canAct(decision, { now: options.at ?? T }), true);
  return decision;
}

test('nothing permits the action before a check; a recorded snapshot is history', () => {
  const decision = initialDecision({ selection, recorded: { status: 'valid', available: true } });
  assert.equal(decision.state, 'not-checked');
  assert.equal(canAct(decision), false);
  assert.equal(checkPermission(decision).reason, 'not-checked');
  assert.deepEqual(CURRENT_STATES, ['not-checked', 'checking', 'valid', 'recheck-required', 'expired', 'unknown']);
  assert.match(describeDecision(decision).detail, /Recorded results are history/);
});

test('beginning a refresh withdraws the permission; the last verified result stays as history with its own deadline', () => {
  const before = verified();
  const during = beginCheck(before);
  assert.equal(during.state, 'checking');
  assert.equal(canAct(during, { now: T }), false);
  assert.equal(checkPermission(during, { now: T }).reason, 'checking');
  assert.equal(during.current, null);
  assert.equal(during.lastVerified.evaluationHash, before.current.evaluation.evaluationHash);
  assert.equal(during.lastVerified.validUntil, before.current.validity.validUntil);
  assert.match(describeDecision(during).detail, /withdrawn/);
});

test('recorded-valid to fresh-revoked, fresh-expired and unsupported runtime: each withholds and keeps the last verified result apart', () => {
  for (const [status, code] of [['recheck-required', 'approval-revoked'], ['expired', 'evidence-expired'], ['recheck-required', 'runtime-unsupported']]) {
    const before = verified();
    const during = beginCheck(before);
    const after = settleCheck(during, { request: during.request, evaluation: evaluation(status, plus(T, 300_000), { code }), entry: entryOk, inputs: reads(plus(T, 298_000)), policy, report, settledAt: plus(T, 300_000) });
    assert.equal(after.state, status);
    assert.equal(canAct(after, { now: plus(T, 300_000) }), false);
    assert.equal(checkPermission(after, { now: plus(T, 300_000) }).reason, 'withheld');
    assert.equal(after.current.available, false);
    assert.equal(after.lastVerified.evaluatedAt, T, 'the earlier success is kept, dated, as history');
    assert.notEqual(after.lastVerified.evaluationHash, after.current.evaluation.evaluationHash);
  }
});

test('a valid policy with a differing entry is withheld and names the field', () => {
  const during = beginCheck(initialDecision({ selection }));
  const after = settle(during, { entry: entryBad });
  assert.equal(after.state, 'valid');
  assert.equal(canAct(after, { now: T }), false);
  assert.equal(after.lastVerified, null);
  assert.match(describeDecision(after, { now: T }).headline, /entry differs/);
  assert.match(describeDecision(after, { now: T }).detail, /decimals/);
});

test('a thrown error or a timeout is unknown; no previous green survives it', () => {
  for (const kind of ['error', 'timeout']) {
    const during = beginCheck(verified());
    const after = failCheck(during, { request: during.request, error: new Error('Portaldot V3 Testnet did not answer in time'), kind });
    assert.equal(after.state, 'unknown');
    assert.equal(after.current, null);
    assert.equal(canAct(after, { now: T }), false);
    assert.equal(checkPermission(after, { now: T }).reason, 'failed');
    assert.equal(after.error.kind, kind);
    assert.match(describeDecision(after).headline, kind === 'timeout' ? /timed out/ : /failed/);
    assert.match(describeDecision(after).detail, /never counts as valid/);
  }
});

test('a slower answer for an earlier request, or for another selection, never replaces the latest result', () => {
  const first = beginCheck(initialDecision({ selection }));
  const firstRequest = first.request;
  const second = beginCheck(first);
  const settledSecond = settle(second, { status: 'recheck-required', at: plus(T, 360_000) });
  const lateFirst = settleCheck(settledSecond, { request: firstRequest, evaluation: evaluation('valid', plus(T, 300_000)), entry: entryOk, inputs: reads(plus(T, 299_000)), policy, report });
  assert.equal(lateFirst, settledSecond, 'the orphaned valid answer changed nothing');
  assert.equal(canAct(lateFirst, { now: plus(T, 360_000) }), false);

  const other = beginCheck(initialDecision({ selection }));
  const switched = changeSelection(other, { token: '0xdef', fixture: null });
  assert.equal(switched.state, 'not-checked');
  const orphan = settleCheck(switched, { request: other.request, selection, evaluation: evaluation('valid'), entry: entryOk, inputs: reads(T), policy, report });
  assert.equal(orphan, switched, 'an answer for the previous selection is ignored');
  const orphanFail = failCheck(switched, { request: other.request, selection, error: 'late failure' });
  assert.equal(orphanFail, switched);
  assert.equal(changeSelection(switched, { token: '0xdef', fixture: null }), switched, 'the same selection is a no-op');
});

test('a result lapses at the deadline its reads set, not at the evaluation time plus the limit, and a new check restores the permission', () => {
  const fresh = verified({ inputs: reads(plus(T, -120_000)) });           // reads two minutes before the evaluation
  assert.equal(fresh.current.validity.validUntil, plus(T, 780_000), 'observedAt + 900 s, 120 s less than evaluatedAt + 900 s');
  assert.equal(fresh.current.validity.limitedBy, 'observation');
  const soon = ageDecision(fresh, { now: plus(T, 600_000) });
  assert.equal(canAct(soon, { now: plus(T, 600_000) }), true);
  const later = ageDecision(fresh, { now: plus(T, 780_001) });
  assert.equal(later.stale, true);
  assert.equal(canAct(later, { now: plus(T, 780_001) }), false);
  assert.match(describeDecision(later, { now: plus(T, 780_001) }).headline, /^Lapsed: the reads are older than the observation limit/);
  assert.equal(later.current.evaluation.status, 'valid', 'the lapsed answer stays visible as what it was');
  const again = beginCheck(later);
  assert.equal(again.stale, false);
  const restored = settle(again, { at: plus(T, 900_000) });
  assert.equal(canAct(restored, { now: plus(T, 900_000) }), true);
});

test('an evaluator result without a usable status is a failure, not a success', () => {
  const during = beginCheck(initialDecision({ selection }));
  const after = settleCheck(during, { request: during.request, evaluation: { status: 'green', enable: true }, entry: entryOk, inputs: reads(T), policy, report });
  assert.equal(after.state, 'unknown');
  assert.equal(canAct(after), false);
});

// --- Remaining fixes 2026-10-25, item 1: the deadline comes from the evidence. ---

test('evaluated one second before the report expires, the permission ends at the report deadline: valid at it, denied one millisecond later', () => {
  const at = plus(EXPIRY, -1000);
  const decision = verified({ at, inputs: reads(plus(at, -5000)) });
  assert.equal(decision.current.validity.validUntil, EXPIRY, 'the report deadline is earlier than every read deadline');
  assert.equal(decision.current.validity.limitedBy, 'report');
  assert.equal(decision.current.validity.deadlines.report.until, EXPIRY);
  assert.equal(canAct(decision, { now: EXPIRY }), true, 'the evaluator accepts an age equal to its limit');
  assert.equal(canAct(decision, { now: plus(EXPIRY, 1) }), false, 'one millisecond past the limit is denied');
  assert.equal(checkPermission(decision, { now: plus(EXPIRY, 1) }).reason, 'lapsed');
  assert.equal(checkPermission(decision, { now: EXPIRY }).secondsLeft, 0);
  const aged = ageDecision(decision, { now: plus(EXPIRY, 2000) });
  assert.equal(aged.stale, true);
  const words = describeDecision(aged, { now: plus(EXPIRY, 2000) });
  assert.match(words.headline, /^Lapsed: the report expired/, 'report expiry is told apart from stale reads');
  assert.match(words.detail, /seen only by a new check/);
});

test('reads already 899 seconds old at the evaluation leave one second of permission under a 900-second limit', () => {
  const decision = verified({ at: T, inputs: reads(plus(T, -899_000)) });
  assert.equal(decision.current.validity.validUntil, plus(T, 1000));
  assert.equal(canAct(decision, { now: plus(T, 1000) }), true);
  assert.equal(canAct(decision, { now: plus(T, 1001) }), false);
  assert.equal(ageDecision(decision, { now: plus(T, 2000) }).stale, true, 'two seconds later the answer has lapsed');
  assert.equal(canAct(ageDecision(decision, { now: plus(T, 2000) }), { now: plus(T, 2000) }), false);
});

test('differently dated network, registry and listing reads: the earliest deadline wins and is named', () => {
  const decision = verified({ at: T, inputs: reads(plus(T, -100_000), plus(T, -300_000), plus(T, -200_000)) });
  const { validity } = decision.current;
  assert.equal(validity.limitedBy, 'registry');
  assert.equal(validity.validUntil, plus(T, 600_000));
  assert.deepEqual(VALIDITY_LIMITS, ['report', 'observation', 'registry', 'listing', 'subject']);
  assert.equal(validity.deadlines.subject, null, 'the subject read is not required by this policy');
  assert.equal(validity.deadlines.observation.until, plus(T, 800_000));
  assert.equal(validity.deadlines.listing.until, plus(T, 700_000));
  assert.equal(validity.deadlines.report.until, EXPIRY);
  assert.equal(canAct(decision, { now: plus(T, 600_000) }), true);
  assert.equal(canAct(decision, { now: plus(T, 600_001) }), false);
  const listingLast = verified({ at: T, inputs: reads(plus(T, -100_000), plus(T, -200_000), plus(T, -300_000)) });
  assert.equal(listingLast.current.validity.limitedBy, 'listing');
  const policyWithoutListing = { ...policy, consumer: { ...policy.consumer, requireListed: false } };
  const unlisted = verified({ at: T, inputs: reads(plus(T, -100_000), plus(T, -200_000), plus(T, -300_000)), policy: policyWithoutListing });
  assert.equal(unlisted.current.validity.limitedBy, 'registry', 'a listing read the policy does not require does not set the deadline');
  assert.equal(unlisted.current.validity.deadlines.listing, null);
});

test('a missing or invalid required timestamp, report, or policy never produces a current permission', () => {
  const cases = {
    'no network observation time': { inputs: { observation: {}, registry: { observedAt: T }, listing: { observedAt: T } }, missing: 'observation' },
    'an unparseable registry time': { inputs: { observation: { observedAt: T }, registry: { observedAt: 'yesterday' }, listing: { observedAt: T } }, missing: 'registry' },
    'a numeric listing time': { inputs: { observation: { observedAt: T }, registry: { observedAt: T }, listing: { observedAt: Date.parse(T) } }, missing: 'listing' },
    'no listing read while the policy requires one': { inputs: { observation: { observedAt: T }, registry: { observedAt: T }, listing: null }, missing: 'listing' },
    'no inputs at all': { inputs: null, missing: 'observation' },
    'an undated report': { inputs: reads(T), report: { ...report, completedAt: undefined }, missing: 'report' },
    'no report': { inputs: reads(T), report: null, missing: 'report' },
    'no policy': { inputs: reads(T), policy: null, missing: 'policy' },
    'a policy that does not validate': { inputs: reads(T), policy: { ...policy, evidence: { ...policy.evidence, maxAgeSeconds: 0 } }, missing: 'policy' },
  };
  for (const [what, { inputs, missing, ...overrides }] of Object.entries(cases)) {
    const decision = settle(beginCheck(initialDecision({ selection })), { at: T, inputs, ...overrides });
    assert.equal(decision.state, 'valid', what);
    assert.equal(decision.current.available, false, what);
    assert.equal(decision.current.validity.validUntil, null, what);
    assert.ok(decision.current.validity.missing.includes(missing), `${what}: ${decision.current.validity.missing.join(', ')}`);
    assert.equal(canAct(decision, { now: T }), false, what);
    assert.equal(checkPermission(decision, { now: T }).reason, 'validity-unknown', what);
    assert.match(describeDecision(decision, { now: T }).headline, /validity deadline cannot be derived/, what);
    assert.equal(decision.lastVerified, null, `${what}: an undated result is never recorded as verified`);
    assert.equal(canAct(ageDecision(decision, { now: plus(T, 1000) }), { now: plus(T, 1000) }), false, what);
  }
});

test('the derived deadline agrees with evaluateBinding on the real capture: valid at the deadline, not one millisecond later', async () => {
  const { bindings } = await load('examples/token-catalog/data/testnet-v2/bindings.json');
  const capture = await load('examples/token-catalog/data/testnet-v2/captures/12-reapprove-r2.inputs.json');
  const binding = bindings.find((item) => item.id === 'cfff0845-b6a1-4f77-a5c9-1245ae3df3f0');
  const inputs = capture.tokens['0x00001e6100000000000000000000000000010000'];
  const atCapture = evaluateBinding({ policy, binding, report, ...inputs, now: capture.now });
  assert.equal(atCapture.status, 'valid');
  const validity = decisionValidity({ policy, report, inputs, evaluatedAt: atCapture.evaluatedAt });
  assert.equal(validity.limitedBy, 'observation');
  assert.equal(validity.validUntil, plus(inputs.observation.observedAt, 900_000));
  assert.equal(evaluateBinding({ policy, binding, report, ...inputs, now: validity.validUntil }).status, 'valid', 'the evaluator accepts the reads at exactly the deadline');
  const after = evaluateBinding({ policy, binding, report, ...inputs, now: plus(validity.validUntil, 1) });
  assert.equal(after.status, 'unknown');
  assert.ok(after.reasons.some((reason) => reason.code === 'observation-stale'), 'one millisecond later the evaluator calls the read stale');
  const decision = settleCheck(beginCheck(initialDecision({ selection })), { request: 1, evaluation: atCapture, entry: entryOk, inputs, policy, report, settledAt: capture.now });
  assert.equal(canAct(decision, { now: validity.validUntil }), true);
  assert.equal(canAct(decision, { now: plus(validity.validUntil, 1) }), false);
  const expired = evaluateBinding({ policy, binding, report, ...inputs, now: plus(EXPIRY, 1) });
  assert.equal(expired.status, 'expired', 'the report limit is the evaluator\'s too');
});

test('a background tab, or an action between timer ticks, cannot use an expired permission: the clock is checked when acting', () => {
  const decision = verified({ at: T, inputs: reads(plus(T, -2000)) });
  const deadline = decision.current.validity.validUntil;
  assert.equal(decision.stale, false, 'no timer has run');
  assert.equal(canAct(decision, { now: plus(deadline, 1) }), false, 'denied although the stale flag was never updated');
  assert.equal(checkPermission(decision, { now: plus(deadline, 1) }).reason, 'lapsed');
  assert.equal(canAct(decision, { now: deadline }), true);
  assert.match(describeDecision(decision, { now: plus(deadline, 1) }).headline, /^Lapsed/, 'the words follow the clock too');
  const resumed = ageDecision(decision, { now: plus(deadline, 3_600_000) });
  assert.equal(resumed.stale, true);
  assert.equal(canAct(resumed, { now: plus(deadline, 3_600_000) }), false);
  assert.throws(() => canAct(decision, { now: 'not a time' }), /valid date/);
});

test('a result that settles after its own deadline is stale on arrival, and the sixty-second future allowance adds no grace', () => {
  const late = settle(beginCheck(initialDecision({ selection })), { at: T, inputs: reads(plus(T, -899_000)), settledAt: plus(T, 1001) });
  assert.equal(late.current.available, true, 'the evaluator said valid at its time');
  assert.equal(late.stale, true, 'but the deadline had passed when the answer arrived');
  assert.equal(canAct(late, { now: plus(T, 1001) }), false);
  const future = verified({ at: T, inputs: reads(plus(T, 30_000)) });   // reads dated 30 s ahead of the evaluator's clock
  assert.equal(future.current.validity.validUntil, plus(T, 930_000), 'the deadline follows the read time; nothing adds sixty seconds');
  assert.equal(canAct(future, { now: plus(T, 930_001) }), false);
});
