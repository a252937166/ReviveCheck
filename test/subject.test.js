import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizePolicy, policyHash, policyAssurance, createBinding, evaluateBinding, REASONS } from '../lib/policy.js';
import { subjectReadFrom, SUBJECT_FIELDS } from '../lib/subject.js';
import { decisionValidity } from '../lib/current.js';
import { buildDecisionEvidence, reconstructDecision, RECOVERY } from '../lib/decision.js';
import { releaseDiagnostics } from '../lib/catalog-release.js';

// Product plan 2026-10-25, D-04: an optional policy requirement that the subject's current
// metadata (symbol, name, decimals, address mapping) is read again at a finalized checkpoint
// through both interfaces and compared with the approved report. Unchanged metadata stays
// usable; a changed field under an otherwise standing approval is withheld; a missing,
// unsupported or disagreeing read is unknown; without the option nothing claims a fresh
// subject check, and every earlier policy keeps its fingerprint.
const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8').then(JSON.parse);
const config = await load('examples/token-catalog/config/testnet-v2.json');
const REPORT = await load('public/reports/1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51.json');
const SUBJECT = '0x00001e6100000000000000000000000000010000';
const capture = (await load('examples/token-catalog/data/testnet-v2/captures/12-reapprove-r2.inputs.json')).tokens[SUBJECT];
const RELEASE_ID = '0x28ab8a86a4d1ca4f5b38784d8f0a32c14ed163ae7f1ff9f4f5b5128fe5fdd927';
const STORAGE = { extrinsicHash: '0x80d46a8611bb486f3b71bdd6e9e15c96e522c536e2671c9f35d0a4496792feb3', blockHash: '0x18a28f38f2a66093eab90d11f438664428141cfade5df5ce031ff3f4519ce868' };
const NOW = capture.collectedAt;
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const fresh = { ...config.policy, evidence: { ...config.policy.evidence, requireFreshSubject: true } };
const CURRENT = { symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6 };
const subjectRead = (overrides = {}) => subjectReadFrom({ assetId: '7777', address: SUBJECT, values: CURRENT, block: capture.observation.finalized, observedAt: capture.observation.observedAt, ...overrides });
const bind = (policy) => createBinding({ policy, report: REPORT, releaseId: RELEASE_ID, revision: '2', boundBy: 'test operator', boundAt: REPORT.completedAt, storage: STORAGE, id: 'binding-r2' });
const evaluate = (policy, subject, now = NOW) => evaluateBinding({ policy, binding: bind(policy), report: REPORT, registry: capture.registry, observation: capture.observation, listing: capture.listing, evidence: capture.evidence, subject, now });
const codes = (evaluation) => evaluation.reasons.map((reason) => reason.code);

test('the option is schema-compatible: absent, it changes no fingerprint and claims no fresh subject check; present, the policy requires the read', () => {
  assert.equal(policyHash(config.policy), 'ce1388f97d27489c770615d720ed39893e6250788eada8c45de6d8ab2b0534fd', 'the recorded v2 policy hash is unchanged');
  assert.equal(policyHash({ ...config.policy, evidence: { ...config.policy.evidence, requireFreshSubject: false } }), policyHash(config.policy), 'false is the same policy as absent');
  assert.notEqual(policyHash(fresh), policyHash(config.policy), 'requiring the read is another policy');
  assert.equal(normalizePolicy(config.policy).evidence.requireFreshSubject, undefined);
  assert.equal(normalizePolicy(fresh).evidence.requireFreshSubject, true);
  assert.throws(() => normalizePolicy({ ...fresh, evidence: { ...fresh.evidence, requireFreshSubject: 'yes' } }), /requireFreshSubject/);
  assert.throws(() => normalizePolicy({ ...fresh, subject: { kind: 'contract', address: SUBJECT } }), /native-asset subject profile only/);
  assert.equal(policyAssurance(config.policy).subject, 'historical-report');
  assert.match(policyAssurance(config.policy).text, /seen only by a new check, or by a policy that sets evidence\.requireFreshSubject/);
  assert.equal(policyAssurance(fresh).subject, 'fresh-read');
  assert.match(policyAssurance(fresh).text, /read again at a finalized checkpoint/);
  const without = evaluate(config.policy, null);
  assert.equal(without.status, 'valid');
  assert.equal(without.checks.some((check) => check.id.startsWith('subject.')), false, 'a policy without the option makes no subject check and claims none');
  assert.equal(without.checkpoint.subject, undefined);
  for (const code of ['subject-unavailable', 'subject-domain-unverifiable', 'subject-domain-mismatch', 'subject-unsupported', 'subject-missing', 'subject-changed']) { assert.ok(REASONS[code], code); assert.ok(RECOVERY[code]?.who, `${code} names who acts`); }
});

test('unchanged current metadata stays valid; a changed asserted field under a standing approval is withheld as recheck-required', () => {
  const unchanged = evaluate(fresh, subjectRead());
  assert.equal(unchanged.status, 'valid', JSON.stringify(unchanged.reasons));
  assert.deepEqual(unchanged.checks.filter((check) => check.id.startsWith('subject.')).map((check) => [check.id, check.status]), [['subject.read', 'passed'], ['subject.provenance', 'passed'], ['subject.domain', 'passed'], ['subject.fresh', 'passed'], ['subject.supported', 'passed'], ['subject.exists', 'passed'], ['subject.interfaces', 'passed'], ['subject.metadata', 'passed']]);
  assert.deepEqual(unchanged.checkpoint.subject, capture.observation.finalized);
  for (const [field, value] of [['decimals', 18], ['symbol', 'PUSD'], ['name', 'Portaldot USD']]) {
    const changed = evaluate(fresh, subjectRead({ values: { ...CURRENT, [field]: value } }));
    assert.equal(changed.status, 'recheck-required', field);
    assert.deepEqual(codes(changed), ['subject-changed'], field);
    const check = changed.checks.find((item) => item.id === 'subject.metadata');
    assert.match(check.observed, new RegExp(`${field}: now ${JSON.stringify(value)}, approved`), field);
    assert.match(changed.nextAction, /^Do not enable/);
  }
  const otherAsset = evaluate(fresh, subjectRead({ assetId: '7778', address: '0x00001e6200000000000000000000000000010000' }));
  assert.ok(codes(otherAsset).includes('subject-domain-mismatch'), JSON.stringify(codes(otherAsset)));
  assert.equal(SUBJECT_FIELDS.length, 4);
});

test('a missing, unsupported, stale, disagreeing or absent-asset read never passes', () => {
  const missing = evaluate(fresh, null);
  assert.equal(missing.status, 'unknown');
  assert.deepEqual(codes(missing), ['subject-unavailable']);
  const failed = evaluate(fresh, { error: 'the node did not answer' });
  assert.deepEqual(codes(failed), ['subject-unavailable']);
  const unsupported = evaluate(fresh, subjectRead({ supported: false, runtime: 'portaldot-v3/3003', values: null }));
  assert.equal(unsupported.status, 'unknown');
  assert.ok(codes(unsupported).includes('subject-unsupported'), JSON.stringify(codes(unsupported)));
  const stale = evaluate(fresh, subjectRead({ observedAt: plus(NOW, -901_000) }));
  assert.ok(codes(stale).includes('observation-stale'), JSON.stringify(codes(stale)));
  assert.equal(stale.status, 'unknown');
  const disagreeing = evaluate(fresh, subjectRead({ evmValues: { decimals: 18 } }));
  assert.equal(disagreeing.status, 'unknown', 'the interfaces disagree: act on neither');
  assert.ok(codes(disagreeing).includes('interfaces-disagree'));
  const gone = evaluate(fresh, subjectRead({ exists: false, values: null }));
  assert.equal(gone.status, 'recheck-required');
  assert.deepEqual(codes(gone), ['subject-missing']);
});

test('the subject read bounds the permission deadline and travels in the decision evidence, which reconstructs', () => {
  const read = subjectRead({ observedAt: plus(capture.observation.observedAt, -300_000) });
  const inputs = { observation: capture.observation, registry: capture.registry, listing: capture.listing, evidence: capture.evidence, subject: read };
  const validity = decisionValidity({ policy: fresh, report: REPORT, inputs, evaluatedAt: NOW });
  assert.equal(validity.limitedBy, 'subject', 'the oldest required read sets the deadline');
  assert.equal(validity.validUntil, plus(read.observedAt, 900_000));
  const without = decisionValidity({ policy: config.policy, report: REPORT, inputs, evaluatedAt: NOW });
  assert.equal(without.deadlines.subject, null, 'not required: not a limit');
  assert.equal(without.limitedBy, 'observation');
  const evaluation = evaluate(fresh, read);
  const document = buildDecisionEvidence({ producer: { name: 'test', kind: 'consumer' }, policy: fresh, binding: bind(fresh), report: REPORT, evaluation, inputs, configuredEntry: { chainId: 420420777, address: SUBJECT, symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6, assetId: '7777' } });
  assert.equal(document.outcome.available, true);
  assert.equal(document.validity.limitedBy, 'subject');
  assert.deepEqual(document.checkpoints.subject, read.block);
  assert.equal(document.inputs.subject.native.decimals, 6);
  assert.equal(reconstructDecision(document).ok, true, JSON.stringify(reconstructDecision(document).checks.filter((check) => !check.ok)));
  const changed = buildDecisionEvidence({ producer: { name: 'test', kind: 'consumer' }, policy: fresh, binding: bind(fresh), report: REPORT, evaluation: evaluate(fresh, subjectRead({ values: { ...CURRENT, decimals: 18 } })), inputs: { ...inputs, subject: subjectRead({ values: { ...CURRENT, decimals: 18 } }) }, configuredEntry: { chainId: 420420777, address: SUBJECT, symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6, assetId: '7777' } });
  assert.equal(changed.outcome.available, false);
  assert.ok(changed.outcome.explanations.some((item) => item.code === 'subject-changed' && /release owner, then reviewer/.test(item.who)));
  const diagnostics = releaseDiagnostics(changed);
  const diagnostic = diagnostics.find((item) => item.code === 'subject-changed');
  assert.equal(diagnostic.pointer, '/evaluation/checks/subject.metadata');
  assert.equal(diagnostic.checkpointKind, 'subject');
  assert.deepEqual(diagnostic.checkpoint, read.block);
  assert.equal(reconstructDecision(changed).ok, true);
});
