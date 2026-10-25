import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateBinding } from '../lib/policy.js';
import { buildDecisionEvidence, reconstructDecision, formatReconstruction, decisionSheetHtml, explainReason, evidenceExpiry, RENEWAL_STEPS, RECOVERY, DECISION_EVIDENCE_SCHEMA } from '../lib/decision.js';
import { entryDecision } from '../lib/entry.js';
import { REASONS } from '../lib/policy.js';

// Assessment 2026-10-25, O-07: a decision as a portable artifact another process can
// reconstruct. The fixtures are the real v2 catalog capture of step 12 (re-approval of
// revision 2) and the real sealed report 1faef921…; no network is read.
const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8').then(JSON.parse);
const config = await load('examples/token-catalog/config/testnet-v2.json');
const { bindings } = await load('examples/token-catalog/data/testnet-v2/bindings.json');
const capture = await load('examples/token-catalog/data/testnet-v2/captures/12-reapprove-r2.inputs.json');
const SUBJECT = '0x00001e6100000000000000000000000000010000';
const binding = bindings.find((item) => item.id === 'cfff0845-b6a1-4f77-a5c9-1245ae3df3f0');
const report = await load(`public/reports/${binding.reportHash}.json`);
const inputs = capture.tokens[SUBJECT];
const policy = config.policy;
const evaluation = evaluateBinding({ policy, binding, report, ...inputs, now: capture.now });
const configured = { ...config.tokens[0], chainId: policy.network.chainId }; // the catalog normalizes the chain ID from its policy
const producer = { name: 'test consumer', kind: 'test', control: 'project-controlled' };

test('the evidence document carries every item a second reader needs, hashed, and reconstructs consistently', () => {
  const document = buildDecisionEvidence({ producer, policy, binding, report, evaluation, inputs, configuredEntry: configured });
  assert.equal(document.schema, DECISION_EVIDENCE_SCHEMA);
  assert.equal(document.outcome.available, true);
  assert.equal(document.outcome.status, 'valid');
  assert.deepEqual(document.outcome.reasons, []);
  assert.equal(document.identity.reportHash, '1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51');
  assert.equal(document.identity.revision, '2');
  assert.equal(document.identity.evaluationHash, evaluation.evaluationHash);
  assert.equal(document.identity.policyHash, config.policyHash ?? document.identity.policyHash);
  assert.ok(document.identity.entryIdentity);
  assert.deepEqual(document.reviewerTrust.trusted, ['0x95db300103ec8b45884b13ed85230fbf02114065']);
  assert.match(document.reviewerTrust.basis, /not independent review/);
  assert.equal(document.storage.extrinsicHash, binding.storage.extrinsicHash);
  assert.equal(document.storage.blockNumber, '187145');
  assert.equal(document.evidenceAge.expiresAt, '2026-11-01T09:29:17.646Z');
  assert.equal(document.checkpoints.registry.number, '187279');
  assert.equal(document.checkpoints.report.number, report.binding.checkpoint.number);
  assert.equal(document.links.report, `https://revivecheck.axiqo.xyz/?report=${report.evidenceHash}#/review`);
  assert.match(document.links.storage, /scanner-testnet-v3\.portaldot\.dev\/#\/extrinsics\/0x80d46a86/);
  assert.equal(document.qr.length, 2);
  assert.equal(document.inputs.evidence.run, undefined, 'the report travels once');
  assert.equal(document.inputs.evidence.runHash, report.evidenceHash);
  assert.match(document.caveat, /not proof of current eligibility/);
  const result = reconstructDecision(document);
  assert.equal(result.ok, true, formatReconstruction(result));
  assert.equal(result.rederived.available, true);
  assert.equal(result.rederived.evaluationHash, evaluation.evaluationHash);
  assert.match(formatReconstruction(result, 'x'), /consistent: the stated decision follows/);
});

test('a withheld decision explains what failed, which observed value caused it, who acts and what happens next', () => {
  const wrong = { ...configured, decimals: 18 };
  const document = buildDecisionEvidence({ producer, policy, binding, report, evaluation, inputs, configuredEntry: wrong });
  assert.equal(document.outcome.available, false);
  assert.deepEqual(document.outcome.reasons, ['entry-mismatch:decimals']);
  assert.equal(document.outcome.explanations[0].who, 'operator');
  assert.equal(document.outcome.explanations[0].observed, '18');
  assert.match(document.outcome.nextAction, /^Do not publish/);
  assert.equal(reconstructDecision(document).ok, true);

  const revoked = await_revoked();
  assert.ok(revoked.outcome.reasons.includes('approval-revoked'));
  const explanation = revoked.outcome.explanations.find((item) => item.code === 'approval-revoked');
  assert.equal(explanation.who, 'reviewer');
  assert.match(explanation.then, /approve the exact hash again/);
  assert.match(explanation.observed, /requested changes/);
  assert.equal(reconstructDecision(revoked).ok, true);
});

function await_revoked() {
  const revokedInputs = { ...inputs, registry: { ...inputs.registry, decisions: { '0x95db300103ec8b45884b13ed85230fbf02114065': { reviewer: '0x95db300103ec8b45884b13ed85230fbf02114065', reviewed: true, approved: false } } }, listing: { ...inputs.listing, listed: false, entry: null } };
  const revokedEvaluation = evaluateBinding({ policy, binding, report, ...revokedInputs, now: capture.now });
  return buildDecisionEvidence({ producer, policy, binding, report, evaluation: revokedEvaluation, inputs: revokedInputs, configuredEntry: configured });
}

test('tampering is caught: a changed outcome, entry, input or report fails reconstruction', () => {
  const document = buildDecisionEvidence({ producer, policy, binding, report, evaluation, inputs, configuredEntry: configured });
  const edited = (mutate) => { const copy = structuredClone(document); mutate(copy); return copy; };
  assert.equal(reconstructDecision(edited((copy) => { copy.outcome.available = false; })).ok, false, 'document hash');
  const reseal = (mutate) => { const { evidenceHash, ...rest } = structuredClone(document); mutate(rest); return rest; };
  for (const [what, mutate] of [
    ['outcome', (copy) => { copy.outcome.available = false; }],
    ['entry', (copy) => { copy.entry.configured.decimals = 18; }],
    ['registry input', (copy) => { copy.inputs.registry.release.revision = '3'; }],
    ['report', (copy) => { copy.report.status = 'failed'; }],
    ['policy', (copy) => { copy.policy.reviewers.trusted = ['0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b']; }],
  ]) {
    const { fingerprint } = await_fingerprint();
    const payload = reseal(mutate);
    const resealed = { ...payload, evidenceHash: fingerprint(payload) };
    const result = reconstructDecision(resealed);
    assert.equal(result.ok, false, `${what}: ${formatReconstruction(result)}`);
  }
});

function await_fingerprint() { return { fingerprint: (payload) => fingerprintSync(payload) }; }
import { fingerprint as fingerprintSync } from '../lib/report.js';

test('the document refuses artifacts that do not belong together', () => {
  const other = bindings.find((item) => item.id === '4896a5a5-1fc6-4160-9049-7a01b11a8591');
  assert.throws(() => buildDecisionEvidence({ producer, policy, binding: other, report, evaluation, inputs, configuredEntry: configured }), /not the bound report/);
  assert.throws(() => buildDecisionEvidence({ producer, policy, binding, report, evaluation: { ...evaluation, bindingId: 'x' }, inputs, configuredEntry: configured }), /not made for this policy and binding/);
  assert.throws(() => buildDecisionEvidence({ producer: {}, policy, binding, report, evaluation, inputs, configuredEntry: configured }), /producer\.name/);
});

test('the human-readable sheet names the verdict, the hashes, the differing field and the QR links', () => {
  const document = buildDecisionEvidence({ producer, policy, binding, report, evaluation, inputs, configuredEntry: { ...configured, decimals: 18 } });
  const html = decisionSheetHtml(document, { qrSvgs: { [document.links.report]: '<svg><title>qr</title></svg>' } });
  assert.match(html, /Withheld/);
  assert.match(html, new RegExp(document.identity.reportHash));
  assert.match(html, /class="mismatch"/);
  assert.match(html, /<svg><title>qr<\/title><\/svg>/);
  assert.match(html, /Who acts:<\/strong> operator/);
  assert.doesNotMatch(html, /<script/);
});

test('every evaluator reason and the entry reasons have a recovery; the renewal checklist names each role', () => {
  for (const code of Object.keys(REASONS)) { assert.ok(RECOVERY[code], code); const explained = explainReason(code); assert.ok(explained.who && explained.then && explained.text, code); }
  assert.equal(explainReason('entry-mismatch:decimals').who, 'operator');
  assert.deepEqual(RENEWAL_STEPS.map((step) => step.step), ['check', 'store', 'submit', 'approve', 'bind', 'list', 'evaluate']);
  assert.ok(RENEWAL_STEPS.some((step) => step.role === 'trusted reviewer'));
  const expiry = evidenceExpiry(report, policy, '2026-11-01T09:29:17.646Z');
  assert.equal(expiry.expired, false, 'acceptable at the limit');
  assert.equal(expiry.secondsLeft, 0);
  assert.equal(evidenceExpiry(report, policy, '2026-11-01T09:29:17.647Z').expired, true);
  assert.equal(entryDecision(configured, report).match, true);
});
