// A versioned token-catalog release: the business output of a maintainer's decision. The
// release carries only the entries that were eligible when it was generated, each derived
// from the approved report and backed by its own decision-evidence document (policy,
// binding, exact report, reads, evaluation, entry comparison, validity deadline), plus the
// entries that were withheld with field-level diagnostics. The document is immutable: it
// names its predecessor's hash and its own recomputable hash, so two releases can be
// compared and every entry's decision reconstructed offline.
//
// A reader applies the declared policy before use: the release hash shows that the
// decision followed from these artifacts at generation; whether an entry may be used NOW
// is decided again, at least against the permission deadline each entry carries and, when
// fresh reads are supplied, by re-evaluating the binding. An expired release is history.
// Point-in-time decisions, never a guarantee against later chain-state changes.
import { buildDecisionEvidence, reconstructDecision, RECOVERY } from './decision.js';
import { evaluateBinding, normalizePolicy, policyHash as hashPolicy, REASONS } from './policy.js';
import { canonicalEntry, entryDecision, entryIdentity, ENTRY_FIELDS } from './entry.js';
import { fingerprint } from './report.js';
import { decisionValidity } from './current.js';
import { NETWORKS } from './networks.js';

export const CATALOG_RELEASE_SCHEMA = 'revivecheck.catalog-release.v1';
export const CATALOG_READ_SCHEMA = 'revivecheck.catalog-release-read.v1';
export const OUTCOME_SCHEMA = 'revivecheck.release-gate-outcome.v1';
export const CONSUMER_CONFIG_SCHEMA = 'revivecheck-consumer.config.v1';
/** Exit codes of the release gate. A refusal and an unavailable verification both block publication, and stay distinguishable. */
export const EXIT = Object.freeze({ permitted: 0, refused: 1, unknown: 2, 'configuration-error': 3 });
const HASH64 = /^[a-f0-9]{64}$/;
const lower = (value) => String(value ?? '').toLowerCase();
const clock = (value) => { const at = value instanceof Date ? value.getTime() : Date.parse(value); if (!Number.isFinite(at)) throw new Error('now is a valid date.'); return at; };
const CHECKPOINT_OF = [[/^(registry)\./, 'registry'], [/^consumer\./, 'listing'], [/^subject\./, 'subject'], [/^(observation|runtime\.current)/, 'observation'], [/^(evidence|report|target|plan|runtime\.report|storage)/, 'report']];

/** Validate the consumer configuration (`revivecheck-consumer.config.v1`) the gate reads. Throws naming the field. */
export function loadConsumerConfig(config, name = 'config') {
  if (config?.schema !== CONSUMER_CONFIG_SCHEMA) throw new Error(`${name} declares schema ${CONSUMER_CONFIG_SCHEMA}.`);
  const policy = normalizePolicy(config.policy);
  for (const key of ['label', 'owner', 'releaseId', 'revision', 'reportHash', 'storage']) if (config.release?.[key] === undefined) throw new Error(`${name}: release.${key} is required.`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.release.releaseId)) throw new Error(`${name}: release.releaseId is a 0x-prefixed 32-byte hash.`);
  if (!/^[1-9]\d*$/.test(String(config.release.revision))) throw new Error(`${name}: release.revision is a positive integer.`);
  if (!HASH64.test(lower(config.release.reportHash).replace(/^0x/, ''))) throw new Error(`${name}: release.reportHash is a 64-hex report fingerprint.`);
  if (policy.evidence.requireStoredOnChain && !/^0x[0-9a-fA-F]{64}$/.test(config.release.storage?.extrinsicHash || '')) throw new Error(`${name}: the policy requires stored evidence, so release.storage.extrinsicHash names the remark.store extrinsic.`);
  if (!config.entry || typeof config.entry !== 'object') throw new Error(`${name}: entry is the token entry this configuration intends to publish.`);
  if (!String(config.boundBy ?? '').trim()) throw new Error(`${name}: boundBy says who makes the binding.`);
  if (lower(config.entry.address) !== policy.subject.address) throw new Error(`${name}: entry.address ${config.entry.address} is not the policy subject ${policy.subject.address}.`);
  return { ...config, policy, policyHash: hashPolicy(policy), name: config.name || `${policy.name} release gate` };
}

/**
 * Field-level diagnostics of one decision-evidence document: for every failed check and
 * every entry mismatch, the JSON pointer, the configured/approved/observed values, the
 * checkpoint the observation was made at, the responsible role and the next action.
 */
export function releaseDiagnostics(evidence) {
  const out = [];
  const evaluation = evidence.evaluation || {};
  const failing = (evaluation.checks || []).filter((check) => check.status !== 'passed');
  const reasons = evaluation.reasons || [];
  failing.forEach((check, index) => {
    const code = reasons[index]?.code ?? null;
    const key = (CHECKPOINT_OF.find(([pattern]) => pattern.test(check.id)) || [null, 'observation'])[1];
    out.push({ pointer: `/evaluation/checks/${check.id}`, code, status: check.status, observed: check.observed, expected: check.expected, checkpoint: evidence.checkpoints?.[key] ?? null, checkpointKind: key, role: RECOVERY[code]?.who ?? 'operator', nextAction: RECOVERY[code]?.then ?? evaluation.nextAction ?? null, text: REASONS[code]?.text ?? null });
  });
  for (const mismatch of evidence.entry?.mismatches || []) {
    out.push({ pointer: `/entry/configured/${mismatch.field}`, code: `entry-mismatch:${mismatch.field}`, status: 'failed', configured: mismatch.configured, approved: mismatch.approved, observed: mismatch.configured, expected: mismatch.approved, checkpoint: evidence.checkpoints?.report ?? null, checkpointKind: 'report', role: 'operator', nextAction: 'Correct the configured field to the approved value, or check and approve a release that carries the configured value and bind that report explicitly.', text: `The configured ${mismatch.field} differs from the value the approved report verified.` });
  }
  if (evidence.entry && !evidence.entry.approved && evidence.entry.reason) out.push({ pointer: '/entry/approved', code: 'entry-unverified', status: 'failed', observed: evidence.entry.reason, expected: 'a passed native-asset report whose token.listing check confirmed every published field', checkpoint: evidence.checkpoints?.report ?? null, checkpointKind: 'report', role: 'operator', nextAction: RECOVERY['entry-unverified'].then, text: 'The bound report approves no complete entry.' });
  return out;
}

const entryFrom = (evidence) => ({
  ...evidence.entry.approved, source: 'approved-report', identity: evidence.identity.entryIdentity,
  reportHash: evidence.identity.reportHash, reportCheckpoint: evidence.checkpoints?.report ?? null, releaseId: evidence.release.releaseId, revision: evidence.release.revision, releaseLabel: evidence.release.label ?? null,
  policyHash: evidence.identity.policyHash, policyName: evidence.identity.policyName, bindingHash: evidence.identity.bindingHash, evaluationHash: evidence.identity.evaluationHash, evidenceHash: evidence.evidenceHash,
  trustedReviewers: evidence.reviewerTrust.trusted, evaluatedAt: evidence.evaluatedAt, checkpoints: evidence.checkpoints, validUntil: evidence.validity?.validUntil ?? null, limitedBy: evidence.validity?.limitedBy ?? null,
});
const withheldFrom = (evidence) => ({ address: evidence.entry?.configured?.address ?? evidence.policy?.subject?.address ?? null, assetId: evidence.entry?.configured?.assetId ?? null, symbol: evidence.entry?.configured?.symbol ?? null, status: evidence.outcome.status, reasons: evidence.outcome.reasons, nextAction: evidence.outcome.nextAction, evidenceHash: evidence.evidenceHash, reportHash: evidence.identity.reportHash, revision: evidence.release.revision, evaluatedAt: evidence.evaluatedAt, validUntil: evidence.validity?.validUntil ?? null, diagnostics: releaseDiagnostics(evidence) });
/** Eligible at `at`: the decision was available and its permission deadline had not passed. */
const eligibleAt = (evidence, at) => evidence.outcome.available === true && Number.isFinite(Date.parse(evidence.validity?.validUntil)) && clock(at) <= Date.parse(evidence.validity.validUntil);

/**
 * Build one immutable release. `decisions` are the pieces of each entry's decision (the
 * same a decision-evidence document needs): `{ policy, binding, report, evaluation,
 * inputs, configuredEntry }`, or ready-made `{ evidence }` documents. Every network in the
 * release is the same; `previous` chains the version and the hash. The entries included
 * are exactly the eligible ones at `generatedAt`; the rest are listed as withheld.
 */
export function buildCatalogRelease({ name, producer, decisions, previous = null, generatedAt = new Date().toISOString(), note = '' }) {
  if (!String(name ?? '').trim()) throw new Error('A catalog release has a name.');
  if (!producer?.name) throw new Error('producer.name says which application generated the release.');
  if (!Array.isArray(decisions) || !decisions.length) throw new Error('A release is built from at least one decision.');
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('generatedAt is an ISO-8601 time.');
  if (previous && (previous.schema !== CATALOG_RELEASE_SCHEMA || !HASH64.test(previous.releaseHash || '') || !Number.isSafeInteger(previous.version))) throw new Error('previous is an earlier catalog release with its hash and version.');
  const evidence = decisions.map((decision) => decision.evidence ?? buildDecisionEvidence({ producer: { ...producer, kind: producer.kind ?? 'catalog' }, policy: decision.policy, binding: decision.binding, report: decision.report, evaluation: decision.evaluation, inputs: decision.inputs, configuredEntry: decision.configuredEntry, extra: decision.extra ?? {}, generatedAt }));
  for (const document of evidence) { const reconstruction = reconstructDecision(document); if (!reconstruction.ok) throw new Error(`The decision evidence ${document.evidenceHash?.slice(0, 12) ?? '?'} does not reconstruct: ${reconstruction.checks.filter((check) => !check.ok).map((check) => check.id).join(', ')}.`); }
  const networks = [...new Set(evidence.map((document) => `${document.policy.network.key}:${document.policy.network.chainId}:${document.policy.network.genesisHash}`))];
  if (networks.length !== 1) throw new Error('Every entry of a release is on one network.');
  const [key, chainId, genesisHash] = networks[0].split(':');
  const addresses = new Set();
  for (const document of evidence) { const address = lower(document.policy.subject.address); if (addresses.has(address)) throw new Error(`Two decisions for ${address}; one entry per subject.`); addresses.add(address); }
  const eligible = evidence.filter((document) => eligibleAt(document, generatedAt));
  const entries = eligible.map(entryFrom).sort((a, b) => a.address.localeCompare(b.address));
  const withheld = evidence.filter((document) => !eligibleAt(document, generatedAt)).map(withheldFrom).sort((a, b) => String(a.address).localeCompare(String(b.address)));
  const deadlines = entries.map((entry) => Date.parse(entry.validUntil)).filter(Number.isFinite);
  const earliest = deadlines.length ? entries.find((entry) => Date.parse(entry.validUntil) === Math.min(...deadlines)) : null;
  const document = {
    schema: CATALOG_RELEASE_SCHEMA, name: String(name).trim(), version: previous ? previous.version + 1 : 1, generatedAt, producer: { ...producer, kind: producer.kind ?? 'catalog' },
    network: { key, chainId: Number(chainId), genesisHash, name: NETWORKS[key]?.name ?? key },
    summary: { entries: entries.length, withheld: withheld.length, decisions: evidence.length },
    entries, withheld,
    validity: { validUntil: earliest?.validUntil ?? null, limitedBy: earliest?.limitedBy ?? null, note: entries.length ? 'The earliest permission deadline among the included entries. A reader applies each entry\'s own deadline, and re-evaluates on fresh reads before use.' : 'No entry is included; nothing in this release permits anything.' },
    previousReleaseHash: previous?.releaseHash ?? null, previousVersion: previous?.version ?? null,
    evidence,
    rule: 'An entry is included only when its binding evaluated to valid under the declared policy, the published fields equal the approved report field by field, and the permission deadline derived from its evidence had not passed at generation. Every included field comes from the approved report, never from a configuration alone.',
    caveat: 'This release records decisions made at the recorded checkpoints and time. Its hash shows that the decisions follow from the embedded artifacts; it is not proof of current eligibility, of the reviewers\' identity beyond each policy\'s trust basis, of an independent audit, or of hosting or delivery. A reader evaluates again before use.',
    note: String(note ?? '').slice(0, 400),
  };
  return Object.freeze({ ...document, releaseHash: fingerprint(document) });
}

/** Verify a release from the document alone: its hash, every embedded decision, and that the entries are exactly the eligible decisions at generation. */
export function verifyCatalogRelease(document) {
  const checks = [];
  const add = (id, ok, detail) => { checks.push({ id, ok: !!ok, detail }); return !!ok; };
  const done = () => ({ ok: checks.every((check) => check.ok), checks });
  if (!add('schema', document?.schema === CATALOG_RELEASE_SCHEMA, document?.schema ?? 'missing')) return done();
  const { releaseHash, ...payload } = document;
  if (!add('release.hash', HASH64.test(releaseHash || '') && fingerprint(payload) === releaseHash, 'SHA-256 of the release recomputed')) return done();
  add('release.version', Number.isSafeInteger(document.version) && document.version >= 1 && (document.previousReleaseHash === null ? document.version === 1 && document.previousVersion === null : HASH64.test(document.previousReleaseHash) && document.previousVersion === document.version - 1), `version ${document.version}${document.previousReleaseHash ? `, after ${document.previousReleaseHash.slice(0, 12)}…` : ', first'}`);
  add('release.generatedAt', Number.isFinite(Date.parse(document.generatedAt)), document.generatedAt);
  const evidence = Array.isArray(document.evidence) ? document.evidence : [];
  if (!add('evidence.present', evidence.length > 0 && evidence.length === document.summary?.decisions, `${evidence.length} decision(s)`)) return done();
  for (const item of evidence) {
    const reconstruction = reconstructDecision(item);
    add(`evidence.${String(item?.evidenceHash ?? '?').slice(0, 12)}`, reconstruction.ok, reconstruction.ok ? `${reconstruction.rederived.available ? 'available' : 'withheld'} (${reconstruction.rederived.status})` : reconstruction.checks.filter((check) => !check.ok).map((check) => check.id).join(', '));
  }
  if (!checks.every((check) => check.ok)) return done();
  const eligible = evidence.filter((item) => eligibleAt(item, document.generatedAt));
  const expectedEntries = eligible.map(entryFrom).sort((a, b) => a.address.localeCompare(b.address));
  add('entries.eligible', JSON.stringify(expectedEntries) === JSON.stringify(document.entries), `${expectedEntries.length} eligible at generation, ${document.entries?.length ?? 0} included`);
  const expectedWithheld = evidence.filter((item) => !eligibleAt(item, document.generatedAt)).map(withheldFrom).sort((a, b) => String(a.address).localeCompare(String(b.address)));
  add('entries.withheld', JSON.stringify(expectedWithheld) === JSON.stringify(document.withheld), `${expectedWithheld.length} withheld`);
  const deadlines = (document.entries || []).map((entry) => Date.parse(entry.validUntil)).filter(Number.isFinite);
  add('validity', (deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null) === (document.validity?.validUntil ?? null), document.validity?.validUntil ?? 'no entry');
  add('network', evidence.every((item) => item.policy.network.chainId === document.network.chainId && item.policy.network.genesisHash === document.network.genesisHash), `${document.network.key} ${document.network.chainId}`);
  return done();
}

/**
 * Read a release for use: verify it, then decide for each included entry whether it may
 * be used at `now`. Without fresh reads only the permission deadline is applied, and the
 * result says so; with `reads` (per subject address: `{ observation, registry, listing,
 * evidence }` from `collectPolicyInputs`) the binding is evaluated again under the
 * release's own policy and the entry compared again. A release that does not verify
 * permits nothing.
 */
export function readCatalogRelease(document, { now = new Date(), reads = null } = {}) {
  const at = clock(now);
  const verification = verifyCatalogRelease(document);
  const base = { schema: CATALOG_READ_SCHEMA, readAt: new Date(at).toISOString(), releaseHash: document?.releaseHash ?? null, version: document?.version ?? null, name: document?.name ?? null, verification, freshness: reads ? 'fresh-reads' : 'deadline-only' };
  if (!verification.ok) return Object.freeze({ ...base, ok: false, usable: [], withheld: (document?.entries || []).map((entry) => ({ address: entry.address, reasons: ['release-unverified'], detail: 'the release does not verify; nothing in it is used' })), note: 'The release failed verification; nothing in it permits anything.' });
  const usable = [], withheld = [];
  for (const entry of document.entries) {
    const evidence = document.evidence.find((item) => item.evidenceHash === entry.evidenceHash);
    const until = Date.parse(entry.validUntil);
    if (!Number.isFinite(until) || at > until) { withheld.push({ ...entry, reasons: ['lapsed'], detail: `the permission of this entry ended at ${entry.validUntil} (${entry.limitedBy}); a new evaluation is needed` }); continue; }
    if (reads) {
      const fresh = reads[lower(entry.address)];
      if (!fresh) { withheld.push({ ...entry, reasons: ['reads-missing'], detail: 'no fresh reads were supplied for this entry; unavailable verification never counts as valid' }); continue; }
      const policy = normalizePolicy(evidence.policy);
      const inputs = fresh.evidence?.runHash ? { ...fresh, evidence: { ...fresh.evidence, run: evidence.report } } : fresh;
      const evaluation = evaluateBinding({ policy, binding: evidence.binding, report: evidence.report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence: inputs.evidence, subject: inputs.subject ?? null, now: new Date(at) });
      const comparison = entryDecision(entry, evidence.report);
      const validity = decisionValidity({ policy, report: evidence.report, inputs, evaluatedAt: evaluation.evaluatedAt });
      const ok = evaluation.enable === true && comparison.match && validity.validUntil !== null && at <= Date.parse(validity.validUntil);
      const target = ok ? usable : withheld;
      target.push({ ...entry, fresh: { evaluationHash: evaluation.evaluationHash, status: evaluation.status, evaluatedAt: evaluation.evaluatedAt, checkpoint: evaluation.checkpoint, validUntil: validity.validUntil, limitedBy: validity.limitedBy }, reasons: ok ? [] : [...evaluation.reasons.map((reason) => reason.code), ...comparison.reasons, ...(validity.validUntil === null ? ['validity-unknown'] : [])], detail: ok ? `re-evaluated ${evaluation.status} at ${evaluation.evaluatedAt}; permission until ${validity.validUntil}` : evaluation.nextAction });
      continue;
    }
    usable.push({ ...entry, reasons: [], detail: `within the permission deadline ${entry.validUntil} (${entry.limitedBy}); chain state after the recorded reads is not checked without fresh reads` });
  }
  return Object.freeze({ ...base, ok: usable.length > 0, usable, withheld: [...withheld, ...document.withheld.map((item) => ({ ...item, reasons: [...item.reasons], detail: 'withheld at generation' }))], note: reads ? 'Each entry was evaluated again on the supplied reads under the release\'s own policy.' : 'Only each entry\'s permission deadline was applied. Supply fresh reads to detect a revocation, a new revision or a delisting since the recorded reads.' });
}

/** The differences between two releases: entries added, removed, changed (fields or evidence) and unchanged. */
export function compareCatalogReleases(before, after) {
  const index = (document) => Object.fromEntries((document?.entries || []).map((entry) => [lower(entry.address), entry]));
  const a = index(before), b = index(after);
  const added = Object.keys(b).filter((address) => !a[address]).map((address) => b[address]);
  const removed = Object.keys(a).filter((address) => !b[address]).map((address) => ({ ...a[address], withheldAfter: (after?.withheld || []).find((item) => lower(item.address) === address) ?? null }));
  const changed = [], unchanged = [];
  for (const address of Object.keys(a).filter((key) => b[key])) {
    const fields = ENTRY_FIELDS.filter((field) => a[address][field] !== b[address][field]).map((field) => ({ field, before: a[address][field], after: b[address][field] }));
    const evidence = ['reportHash', 'revision', 'policyHash', 'bindingHash', 'evaluationHash', 'validUntil'].filter((key) => a[address][key] !== b[address][key]).map((key) => ({ key, before: a[address][key], after: b[address][key] }));
    (fields.length || evidence.length ? changed : unchanged).push({ address, fields, evidence });
  }
  return { before: { version: before?.version ?? null, releaseHash: before?.releaseHash ?? null, generatedAt: before?.generatedAt ?? null }, after: { version: after?.version ?? null, releaseHash: after?.releaseHash ?? null, generatedAt: after?.generatedAt ?? null }, chained: after?.previousReleaseHash === before?.releaseHash, added, removed, changed, unchanged, summary: { added: added.length, removed: removed.length, changed: changed.length, unchanged: unchanged.length } };
}

/**
 * The machine-readable outcome of one release-gate run (`revivecheck.release-gate-outcome.v1`):
 * permitted when the release includes the configured entry, refused for a known policy or
 * entry refusal, unknown when a read was unavailable, configuration-error when the
 * configuration or an artifact could not be used. The exit code follows `EXIT`.
 */
export function gateOutcome({ evidence = null, release = null, error = null, subject = null, generatedAt = new Date().toISOString() }) {
  if (error) return { schema: OUTCOME_SCHEMA, status: 'configuration-error', exitCode: EXIT['configuration-error'], permitted: false, generatedAt, subject, reasons: ['configuration-error'], error: String(error.message || error), diagnostics: [], release: null };
  const permitted = !!release && release.entries.some((entry) => lower(entry.address) === lower(subject ?? entry.address));
  const status = permitted ? 'permitted' : evidence?.outcome?.status === 'unknown' || (evidence?.outcome?.reasons || []).some((code) => REASONS[code]?.status === 'unknown') && !(evidence?.outcome?.reasons || []).some((code) => code.startsWith('entry-') || REASONS[code]?.status === 'recheck-required' || REASONS[code]?.status === 'expired') ? 'unknown' : 'refused';
  return { schema: OUTCOME_SCHEMA, status, exitCode: EXIT[status], permitted, generatedAt, subject, reasons: permitted ? [] : evidence?.outcome?.reasons ?? ['no-evaluation'], nextAction: permitted ? release.entries[0]?.validUntil ? `Publish release ${release.version} (${release.releaseHash.slice(0, 12)}…); readers apply the deadline ${release.validity.validUntil} and evaluate again before use.` : null : evidence?.outcome?.nextAction ?? 'Do not publish. The bound report could not be retrieved; retry the retrieval.', diagnostics: evidence ? releaseDiagnostics(evidence) : [], evidenceHash: evidence?.evidenceHash ?? null, release: release ? { version: release.version, releaseHash: release.releaseHash, validUntil: release.validity.validUntil, entries: release.entries.length } : null };
}

/** The entries a token selector shows from a read release: label, selectable flag and reason, in the shape the consumer example's selector uses. */
export function selectorFrom(read) {
  const rows = [];
  for (const entry of read.usable) rows.push({ id: entry.address, label: `${entry.symbol} · ${entry.name} · ${entry.decimals} decimals`, selectable: true, reason: `From release ${read.version} (${String(read.releaseHash).slice(0, 12)}…), approved report ${entry.reportHash.slice(0, 12)}…, revision ${entry.revision}; ${entry.detail}.`, entry });
  for (const entry of read.withheld) rows.push({ id: entry.address ?? 'unknown', label: `${entry.symbol ?? entry.address ?? 'entry'} (withheld)`, selectable: false, reason: `Withheld: ${(entry.reasons || []).join(', ') || 'no reason recorded'}. ${entry.detail ?? ''}`.trim(), entry });
  return rows;
}

export { canonicalEntry, entryIdentity };
