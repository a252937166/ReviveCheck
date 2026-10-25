// A decision as a portable artifact. A consumer that refused or admitted an entry
// hands over one document from which another process, with no access to the consumer
// or the network, re-derives the decision: the exact report, the policy, the binding,
// the inputs that were read, the evaluation, the entry comparison and the outcome,
// each with a recomputable hash. Every refusal names what failed, which observed value
// caused it, who can act and what must happen next. Integrity of this document is not
// proof of current eligibility, of authenticated reviewer identity or of an
// independent audit; the caveat travels with it.
import { EVALUATION_SCHEMA, REASONS, evaluateBinding, normalizePolicy, verifyBinding } from './policy.js';
import { fingerprint, validateImportedRun, verifyRun } from './report.js';
import { entryDecision, entryIdentity } from './entry.js';
import { NETWORKS, blockUrl, extrinsicUrl } from './networks.js';
import { PUBLIC_REVIEW_URL } from './share.js';

export const DECISION_EVIDENCE_SCHEMA = 'revivecheck.decision-evidence.v1';
const HASH64 = /^[a-f0-9]{64}$/;
const lower = (value) => String(value ?? '').toLowerCase();

/** Who can act on each refusal and what must happen next. Policy codes are the evaluator's; entry codes are the publisher's. */
export const RECOVERY = Object.freeze({
  'evidence-unverifiable': { who: 'operator', then: 'Fetch the original report and binding artifacts and evaluate again. Nothing on-chain needs to change.' },
  'wrong-scope': { who: 'release owner', then: 'Produce a report in the evidence scope the policy accepts, submit it, and obtain approval of its exact hash.' },
  'wrong-target': { who: 'release owner', then: 'Check the policy subject itself; a report about another target cannot be bound to it.' },
  'plan-changed': { who: 'release owner', then: 'Check the subject with the acceptance plan the policy names. The new report needs its own approval and an explicit binding.' },
  'report-not-passed': { who: 'release owner', then: 'Fix the release, check it again, and submit the passing report for approval.' },
  'runtime-unsupported': { who: 'release owner', then: 'Recheck on a runtime the policy supports. Approvals of the old report do not carry over.' },
  'observation-missing': { who: 'operator', then: 'Read the network again. A read failure calls for another read, not for another approval.' },
  'observation-stale': { who: 'operator', then: 'Observe the network again. No approval or binding changes.' },
  'observation-mismatch': { who: 'operator', then: 'Point the evaluator at the network the policy names and read again.' },
  'runtime-changed': { who: 'release owner, then reviewer, then operator', then: 'Recheck on the current runtime, submit the new report, have a trusted reviewer approve its exact hash, then bind it explicitly.' },
  'evidence-expired': { who: 'release owner, then reviewer, then operator', then: 'Renew the evidence: check again, store the new report, submit it as a new revision, have a trusted reviewer approve its exact hash, bind it explicitly, relist and read back. An approval never extends evidence age.' },
  'registry-unavailable': { who: 'operator', then: 'Read the ReleaseRegistry again through both interfaces. Unavailable is not a decision.' },
  'registry-domain-unverifiable': { who: 'operator', then: 'Read the expected registry contract and release again.' },
  'registry-domain-mismatch': { who: 'operator', then: 'Correct the policy or the binding so that they name the registry and release the read came from.' },
  'interfaces-disagree': { who: 'operator', then: 'Act on neither value. Read again at a later finalized block and compare.' },
  'release-missing': { who: 'release owner', then: 'Submit the report to the registry; a trusted reviewer then approves its exact hash.' },
  'owner-mismatch': { who: 'operator', then: 'Confirm which account owns the release; the policy names another owner.' },
  'revision-superseded': { who: 'reviewer, then operator', then: 'A trusted reviewer approves the exact hash of the current revision; the operator then binds that report explicitly. The old binding stays as history.' },
  'approval-missing': { who: 'reviewer', then: 'A trusted reviewer approves the exact report hash of the current revision.' },
  'approval-revoked': { who: 'reviewer', then: 'The reviewer who requested changes resolves them: after the fix, approve the exact hash again, or approve a new revision.' },
  'consumer-unavailable': { who: 'operator', then: 'Read the consumer contract again through both interfaces.' },
  'consumer-domain-unverifiable': { who: 'operator', then: 'Read the expected consumer contract and token again.' },
  'consumer-domain-mismatch': { who: 'operator', then: 'Correct the policy so that it names the consumer contract and token the read came from.' },
  'consumer-identity-unavailable': { who: 'operator', then: 'Read the consumer identity again at the listing checkpoint through both interfaces.' },
  'consumer-identity-mismatch': { who: 'operator', then: 'Point the policy at the verified consumer deployment and version it intends.' },
  'consumer-not-listed': { who: 'release owner', then: 'List the token on the approved revision. The contract accepts the call only while the approval stands.' },
  'consumer-entry-mismatch': { who: 'release owner', then: 'Relist the token on the release, report and reviewer the binding names.' },
  'storage-unverified': { who: 'operator', then: 'Retrieve the stored report again from the extrinsic the binding names; supply its block hash when the explorer has not indexed it.' },
  'storage-mismatch': { who: 'release owner', then: 'Store the bound report on-chain; the extrinsic named holds another report.' },
  'entry-unverified': { who: 'operator', then: 'Bind a passed native-asset report whose token.listing check confirmed every published field.' },
  'no-binding': { who: 'operator', then: 'Bind an approved report to the entry explicitly.' },
});
const ENTRY_MISMATCH = Object.freeze({ who: 'operator', then: 'Correct the configured field to the approved value, or check and approve a release that carries the configured value and bind that report explicitly.' });

/** One refusal, explained: the documented meaning, the status it forces, who acts and what happens next. */
export function explainReason(code, { observed = null } = {}) {
  if (code.startsWith('entry-mismatch:')) {
    const field = code.slice('entry-mismatch:'.length);
    return { code, status: 'withheld', text: `The configured ${field} differs from the value the approved report verified. The entry is withheld.`, observed, ...ENTRY_MISMATCH };
  }
  const reason = REASONS[code];
  const recovery = RECOVERY[code] || { who: 'operator', then: 'Consult the policy documentation for this code.' };
  return { code, status: reason?.status ?? 'withheld', text: reason?.text ?? (code === 'entry-unverified' ? 'The bound report approves no complete entry, so nothing can be published from it.' : code === 'no-binding' ? 'No report is bound to this entry yet.' : code), observed, ...recovery };
}

/** The renewal sequence, role by role. Nothing in it is silent: no approval migrates, no binding moves on its own. */
export const RENEWAL_STEPS = Object.freeze([
  { step: 'check', role: 'release owner', action: 'Run a fresh live check of the release. The result is a new sealed report with its own SHA-256; the old report stays published as history.' },
  { step: 'store', role: 'release owner', action: 'Store the new report on-chain through remark.store, when the policy requires stored evidence, and retrieve it to verify.' },
  { step: 'submit', role: 'release owner', action: 'Submit the new report hash as a new revision of the same release. The registry clears the standing approval and the consumer stops listing the token.' },
  { step: 'approve', role: 'trusted reviewer', action: 'Approve the exact hash of the new revision. The approval of the old hash does not carry over.' },
  { step: 'bind', role: 'consumer operator', action: 'Bind the new report explicitly under the policy. The old binding stays in the history; nothing follows the release forward on its own.' },
  { step: 'list', role: 'release owner', action: 'List the token again on the new revision and read the listing back through both interfaces.' },
  { step: 'evaluate', role: 'consumer', action: 'Evaluate before each use. A valid result holds at its checkpoints and time only.' },
]);

/** When the bound report stops being acceptable under the policy clock, and how much time is left at `now`. */
export function evidenceExpiry(report, policy, now = new Date()) {
  const normalized = normalizePolicy(policy);
  const completedAt = Date.parse(report?.completedAt);
  if (!Number.isFinite(completedAt)) return { completedAt: null, maxAgeSeconds: normalized.evidence.maxAgeSeconds, expiresAt: null, secondsLeft: null, expired: null };
  const expires = completedAt + normalized.evidence.maxAgeSeconds * 1000;
  const at = new Date(now).getTime();
  return { completedAt: new Date(completedAt).toISOString(), maxAgeSeconds: normalized.evidence.maxAgeSeconds, expiresAt: new Date(expires).toISOString(), secondsLeft: Math.round((expires - at) / 1000), expired: at > expires, maxObservationAgeSeconds: normalized.evidence.maxObservationAgeSeconds };
}

const withoutRun = (evidence) => { if (!evidence || typeof evidence !== 'object') return evidence ?? null; const { run, ...rest } = evidence; return run ? { ...rest, runHash: run.evidenceHash ?? null } : rest; };

/**
 * Build the portable decision document. `inputs` are the raw reads the evaluation used
 * (`collectPolicyInputs` or a fixture); the stored-evidence read loses its embedded
 * report copy because the report travels once, in full. Throws when the pieces do not
 * belong together: the document never describes a decision that was not made on these
 * exact artifacts.
 */
export function buildDecisionEvidence({ producer, policy, binding, report, evaluation, inputs = {}, configuredEntry, extra = {}, generatedAt = new Date().toISOString() }) {
  if (!producer?.name) throw new Error('producer.name says which application made the decision.');
  const normalized = normalizePolicy(policy);
  const policyHash = fingerprint(normalized);
  if (!verifyBinding(binding, normalized)) throw new Error('The binding does not verify under this policy.');
  if (!verifyRun(report) || report.evidenceHash !== binding.reportHash) throw new Error('The report is not the bound report, or fails its integrity check.');
  if (evaluation?.schema !== EVALUATION_SCHEMA || evaluation.policyHash !== policyHash || evaluation.bindingId !== binding.id) throw new Error('The evaluation was not made for this policy and binding.');
  const { evaluationHash, ...payload } = evaluation;
  if (fingerprint(payload) !== evaluationHash) throw new Error('The evaluation fails its own hash.');
  const entry = entryDecision(configuredEntry, report);
  const available = evaluation.enable === true && entry.match === true;
  const reasons = [...new Set([...evaluation.reasons.map((reason) => reason.code), ...entry.reasons])];
  const observedFor = (code) => evaluation.checks.find((check) => check.status !== 'passed' && REASONS[code] && evaluation.reasons.some((reason) => reason.code === code) && check.observed)?.observed ?? (code.startsWith('entry-mismatch:') ? String(entry.configured?.[code.split(':')[1]]) : null);
  const nextAction = available ? evaluation.nextAction : evaluation.enable ? 'Do not publish this entry: correct the configuration to the approved values, or check and approve a release that carries the configured values.' : evaluation.nextAction;
  const network = NETWORKS[normalized.network.key] || null;
  const storage = binding.storage ? { ...binding.storage, blockNumber: inputs.evidence?.blockNumber ?? null, extrinsicIndex: inputs.evidence?.extrinsicIndex ?? null, publisher: inputs.evidence?.publisher ?? null, contentHash: inputs.evidence?.contentHash ?? null, verified: inputs.evidence?.verified ?? null } : null;
  const expiry = evidenceExpiry(report, normalized, evaluation.evaluatedAt);
  const links = {
    report: `${PUBLIC_REVIEW_URL}?report=${report.evidenceHash}#/review`,
    storage: network && storage?.extrinsicHash ? extrinsicUrl(network, storage.extrinsicHash) : null,
    reportBlock: network ? blockUrl(network, report.binding?.checkpoint?.nativeHash) : null,
    registryBlock: network ? blockUrl(network, evaluation.checkpoint?.registry?.nativeHash) : null,
    listingBlock: network ? blockUrl(network, evaluation.checkpoint?.listing?.nativeHash) : null,
    observationBlock: network ? blockUrl(network, evaluation.checkpoint?.observation?.nativeHash) : null,
  };
  const document = {
    schema: DECISION_EVIDENCE_SCHEMA, generatedAt, producer,
    outcome: { available, status: evaluation.status, reasons, explanations: reasons.map((code) => explainReason(code, { observed: observedFor(code) })), nextAction },
    entry,
    identity: { policyHash, policyName: normalized.name, bindingId: binding.id, bindingHash: binding.bindingHash, reportHash: report.evidenceHash, releaseId: binding.releaseId, revision: binding.revision, evaluationHash, entryIdentity: entry.approved ? entryIdentity(entry.approved) : null },
    release: { label: normalized.registry.label ?? null, owner: normalized.registry.owner ?? null, registry: normalized.registry.address, releaseId: binding.releaseId, revision: binding.revision, release: report.release ?? null },
    reviewerTrust: { trusted: normalized.reviewers.trusted, threshold: normalized.reviewers.threshold, basis: normalized.reviewers.basis },
    storage,
    evidenceAge: { completedAt: expiry.completedAt, maxAgeSeconds: expiry.maxAgeSeconds, expiresAt: expiry.expiresAt, secondsLeftAtEvaluation: expiry.secondsLeft },
    observation: { maxObservationAgeSeconds: normalized.evidence.maxObservationAgeSeconds, observedAt: inputs.observation?.observedAt ?? null, runtime: inputs.observation?.runtime ?? null },
    evaluatedAt: evaluation.evaluatedAt,
    checkpoints: { registry: evaluation.checkpoint?.registry ?? null, observation: evaluation.checkpoint?.observation ?? null, listing: evaluation.checkpoint?.listing ?? null, report: report.binding?.checkpoint ?? null },
    links, qr: Object.entries({ 'Exact report in ReviveCheck': links.report, 'Stored report extrinsic on the official explorer': links.storage }).filter(([, url]) => url).map(([label, url]) => ({ label, url })),
    policy: normalized, binding, report, evaluation,
    inputs: { observation: inputs.observation ?? null, registry: inputs.registry ?? null, listing: inputs.listing ?? null, evidence: withoutRun(inputs.evidence) },
    extra,
    caveat: 'Integrity of this document shows that the decision follows from these exact artifacts at the recorded checkpoints and time. It is not proof of current eligibility, of the reviewer\'s identity beyond the policy\'s trust basis, or of an independent audit. A self-declared review receipt or a signed remark is not a ReleaseRegistry approval.',
  };
  return Object.freeze({ ...document, evidenceHash: fingerprint(document) });
}

/**
 * Re-derive a decision from the document alone: no network, no other file. Each
 * check is reported; the whole reconstruction is `ok` only when every check holds and
 * the re-derived outcome equals the stated one.
 */
export function reconstructDecision(document) {
  const checks = [];
  const add = (id, ok, detail) => { checks.push({ id, ok: !!ok, detail }); return !!ok; };
  const done = (rederived = null) => ({ ok: checks.every((check) => check.ok), checks, rederived, stated: document?.outcome ? { available: document.outcome.available, status: document.outcome.status, reasons: document.outcome.reasons } : null });
  if (!add('schema', document?.schema === DECISION_EVIDENCE_SCHEMA, document?.schema ?? 'missing')) return done();
  const { evidenceHash, ...payload } = document;
  if (!add('document.hash', HASH64.test(evidenceHash || '') && fingerprint(payload) === evidenceHash, 'SHA-256 of the document recomputed')) return done();
  let policy;
  try { policy = normalizePolicy(document.policy); } catch (error) { add('policy.valid', false, error.message); return done(); }
  add('policy.hash', fingerprint(policy) === document.identity?.policyHash && document.evaluation?.policyHash === document.identity?.policyHash, document.identity?.policyHash);
  const report = document.report;
  let reportOk = verifyRun(report);
  try { validateImportedRun(report); } catch (error) { reportOk = false; add('report.semantics', false, error.message); }
  add('report.verifies', reportOk && report.evidenceHash === document.identity?.reportHash && report.evidenceHash === document.binding?.reportHash, report?.evidenceHash);
  add('binding.verifies', verifyBinding(document.binding, policy) && document.binding.bindingHash === document.identity?.bindingHash, document.binding?.bindingHash);
  if (!checks.every((check) => check.ok)) return done();
  const inputs = document.inputs || {};
  const evidence = inputs.evidence ? (inputs.evidence.runHash ? { ...inputs.evidence, run: report } : inputs.evidence) : null;
  let rederivedEvaluation;
  try {
    rederivedEvaluation = evaluateBinding({ policy, binding: document.binding, report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence, now: document.evaluation.evaluatedAt });
  } catch (error) { add('evaluation.rederived', false, error.message); return done(); }
  add('evaluation.rederived', rederivedEvaluation.evaluationHash === document.evaluation.evaluationHash && rederivedEvaluation.evaluationHash === document.identity.evaluationHash, `${rederivedEvaluation.status}: ${rederivedEvaluation.evaluationHash}`);
  const entry = entryDecision(document.entry?.configured, report);
  add('entry.rederived', entry.match === document.entry?.match && JSON.stringify(entry.mismatches) === JSON.stringify(document.entry?.mismatches) && JSON.stringify(entry.approved) === JSON.stringify(document.entry?.approved), entry.match ? 'the configured entry equals the approved report' : entry.reason);
  const available = rederivedEvaluation.enable === true && entry.match === true;
  const reasons = [...new Set([...rederivedEvaluation.reasons.map((reason) => reason.code), ...entry.reasons])];
  add('outcome.rederived', available === document.outcome?.available && rederivedEvaluation.status === document.outcome?.status && JSON.stringify(reasons) === JSON.stringify(document.outcome?.reasons), `${available ? 'available' : 'withheld'} (${rederivedEvaluation.status}${reasons.length ? `: ${reasons.join(', ')}` : ''})`);
  add('reviewer.basis', typeof document.reviewerTrust?.basis === 'string' && document.reviewerTrust.basis.length > 0 && JSON.stringify(document.reviewerTrust.trusted) === JSON.stringify(policy.reviewers.trusted), policy.reviewers.trusted.join(', '));
  add('links.report', typeof document.links?.report === 'string' && document.links.report.includes(report.evidenceHash), document.links?.report ?? 'missing');
  return done({ available, status: rederivedEvaluation.status, reasons, evaluationHash: rederivedEvaluation.evaluationHash, entryMatch: entry.match });
}

/** One line per check, for a terminal or a log. */
export function formatReconstruction(result, source = '') {
  const lines = [`Reconstruction from the document alone${source ? `: ${source}` : ''}`];
  for (const check of result.checks) lines.push(`${check.ok ? 'ok     ' : 'FAILED '} ${check.id.padEnd(22)} ${check.detail ?? ''}`);
  if (result.rederived) lines.push(`re-derived: ${result.rederived.available ? 'available' : 'withheld'} (${result.rederived.status}${result.rederived.reasons.length ? `: ${result.rederived.reasons.join(', ')}` : ''}); stated: ${result.stated.available ? 'available' : 'withheld'} (${result.stated.status})`);
  lines.push(result.ok ? 'consistent: the stated decision follows from the embedded artifacts' : 'NOT consistent');
  return lines.join('\n');
}

/** A compact, human-readable HTML sheet of the decision, self-contained (inline styles, the QR images passed in as SVG strings). */
export function decisionSheetHtml(document, { qrSvgs = {} } = {}) {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const row = (label, value) => `<tr><th>${escape(label)}</th><td>${value}</td></tr>`;
  const mono = (value) => `<code>${escape(value)}</code>`;
  const link = (url, text = url) => url ? `<a href="${escape(url)}">${escape(text)}</a>` : '—';
  const { outcome, identity, entry, evidenceAge, checkpoints, reviewerTrust, storage, release } = document;
  const entryRows = ['chainId', 'address', 'symbol', 'name', 'decimals', 'assetId'].map((field) => { const mismatch = entry.mismatches.some((item) => item.field === field); return `<tr${mismatch ? ' class="mismatch"' : ''}><th>${field}</th><td>${mono(entry.configured?.[field])}</td><td>${entry.approved ? mono(entry.approved[field]) : '—'}</td><td>${entry.approved ? (mismatch ? 'differs' : 'equal') : '—'}</td></tr>`; }).join('');
  const explanations = outcome.explanations.length ? `<ol>${outcome.explanations.map((item) => `<li><code>${escape(item.code)}</code> · ${escape(item.text)}${item.observed ? ` <em>Observed: ${escape(item.observed)}</em>` : ''}<br><strong>Who acts:</strong> ${escape(item.who)}. <strong>Then:</strong> ${escape(item.then)}</li>`).join('')}</ol>` : '<p>Every policy condition held and the published entry equals the approved report.</p>';
  const qr = document.qr.map((item) => `<figure><div class="qr">${qrSvgs[item.url] || ''}</div><figcaption>${escape(item.label)}<br>${link(item.url)}</figcaption></figure>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Decision evidence · ${escape(identity.policyName)}</title>
<style>body{font:15px/1.5 -apple-system,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;color:#0b0c0f;background:#fff;margin:0;padding:32px;max-width:960px}h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}p{margin:6px 0}code{font:13px/1.4 "SF Mono",Menlo,Consolas,monospace;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{text-align:left;vertical-align:top;padding:6px 10px;border-top:1px solid #e6e8ec}th{width:200px;color:#3b3f48;font-weight:600}tr.mismatch td{background:#fff1f0}.verdict{display:inline-block;padding:6px 12px;border-radius:999px;font-weight:600;background:${outcome.available ? '#e6f6ec;color:#116a36' : '#fff1f0;color:#a8071a'}}figure{display:inline-block;margin:0 24px 16px 0;text-align:center;max-width:260px;vertical-align:top}.qr svg{width:180px;height:180px}figcaption{font-size:12px;color:#3b3f48;overflow-wrap:anywhere}em{color:#3b3f48}.caveat{font-size:13px;color:#3b3f48;border-top:1px solid #e6e8ec;padding-top:12px;margin-top:28px}@media print{body{padding:0}}</style></head><body>
<h1>Decision evidence</h1><p>${escape(document.producer.name)} · generated ${escape(document.generatedAt)} · document SHA-256 ${mono(document.evidenceHash)}</p>
<p><span class="verdict">${outcome.available ? 'Available' : 'Withheld'}</span> · policy status ${escape(outcome.status)} · evaluated at ${escape(document.evaluatedAt)}</p>
<h2>Why, who acts, what next</h2>${explanations}<p><strong>Next action:</strong> ${escape(outcome.nextAction)}</p>
<h2>Identity</h2><table>${row('Exact report', mono(identity.reportHash))}${row('Policy', `${mono(identity.policyHash)}<br>${escape(identity.policyName)}`)}${row('Binding', `${mono(identity.bindingHash)}<br>${escape(identity.bindingId)}`)}${row('Release', `${escape(release.label || 'by ID')} · revision ${escape(release.revision)}<br>${mono(release.releaseId)}`)}${row('Evaluation', mono(identity.evaluationHash))}${row('Entry identity', identity.entryIdentity ? mono(identity.entryIdentity) : '— (no approved entry)')}</table>
<h2>Entry: configured against the approved report</h2><table><tr><th>Field</th><th>Configured</th><th>Approved report</th><th></th></tr>${entryRows}</table>
<h2>Trust, storage, time</h2><table>${row('Trusted reviewers', `${reviewerTrust.trusted.map(mono).join('<br>')} (threshold ${reviewerTrust.threshold})<br><em>${escape(reviewerTrust.basis)}</em>`)}${row('Stored report', storage ? `${link(document.links.storage, storage.extrinsicHash)}<br>block ${escape(storage.blockNumber ?? '?')} · publisher ${escape(storage.publisher ?? 'unknown')}` : 'not required by the policy')}${row('Evidence age', `report sealed ${escape(evidenceAge.completedAt)} · acceptable until ${escape(evidenceAge.expiresAt)} (${escape(evidenceAge.maxAgeSeconds)} s)`)}${row('Observation', `observed ${escape(document.observation.observedAt ?? 'not read')} · runtime ${escape(document.observation.runtime ?? 'not read')} · limit ${escape(document.observation.maxObservationAgeSeconds)} s`)}${row('Checkpoints', ['registry', 'listing', 'observation', 'report'].map((key) => `${key} #${escape(checkpoints[key]?.number ?? '—')} ${checkpoints[key]?.nativeHash ? mono(checkpoints[key].nativeHash) : ''}`).join('<br>'))}</table>
<h2>Verified links</h2>${qr}
<p class="caveat">${escape(document.caveat)} Reconstruct this decision offline with <code>revivecheck/decision</code>: <code>reconstructDecision(document)</code> re-derives the evaluation, the entry comparison and the outcome from the embedded artifacts and compares every hash.</p>
</body></html>`;
}
