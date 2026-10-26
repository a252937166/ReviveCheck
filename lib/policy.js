// A policy envelope decides whether a consumer may act on a release right now.
// The contracts answer one question: does an approval of this exact report hash
// stand on the current revision? A business action needs more: the right network,
// the right subject, the plan the policy expects, a runtime the policy supports,
// evidence that is not too old, reviewers the policy trusts, and fresh finalized
// observations to compare against. Everything here is pure: callers supply the
// report, a registry read, an observation and a clock, so the same evaluation runs
// against the testnet, a local in-memory chain, or a recorded fixture.
//
// Statuses: `valid` enables the action. `recheck-required`, `expired` and
// `unknown` all block it. Nothing in a Solidity contract detects a runtime change
// or an aging report; the evaluator does, from the observation it is handed.
import { fingerprint, validateImportedRun } from './report.js';
import { releaseIdOf } from './registry.js';
import { resolveTokenListVersion } from './tokenlist.js';
import { approvedEntry } from './entry.js';
import { SUBJECT_FIELDS } from './subject.js';

export const POLICY_SCHEMA = 'revivecheck.policy.v1';
export const BINDING_SCHEMA = 'revivecheck.binding.v1';
export const EVALUATION_SCHEMA = 'revivecheck.policy-evaluation.v1';
export const POLICY_STATUSES = Object.freeze(['valid', 'recheck-required', 'expired', 'unknown']);
const SEVERITY = { valid: 0, unknown: 1, expired: 2, 'recheck-required': 3 };
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/, BARE = /^[a-f0-9]{64}$/;
const SCOPES = Object.freeze({ 'portaldot-testnet-readonly': 'live', 'portaldot-live-readonly': 'live', 'local-rehearsal': 'rehearsal' });
const lower = (value) => String(value ?? '').toLowerCase();
const freeze = (value) => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const consistentReport = (report) => { try { validateImportedRun(report); return true; } catch { return false; } };

/** Every reason an evaluation can give, with the status it forces. The text is written for a maintainer. */
export const REASONS = Object.freeze({
  'evidence-unverifiable': { status: 'unknown', text: 'The report or the binding fails its integrity check, so the evidence cannot be evaluated. Fetch the original artifacts.' },
  'wrong-scope': { status: 'recheck-required', text: 'The report comes from a different evidence scope than the policy accepts.' },
  'wrong-target': { status: 'recheck-required', text: 'The report is about another network, asset, contract or token than the policy subject. A report for the right target is needed.' },
  'plan-changed': { status: 'recheck-required', text: 'The report was produced under a different acceptance plan than the policy expects. Check the subject with the policy plan.' },
  'report-not-passed': { status: 'recheck-required', text: 'The bound report did not pass. Fix the release and check it again.' },
  'runtime-unsupported': { status: 'recheck-required', text: 'The report was taken on a runtime the policy does not support.' },
  'observation-missing': { status: 'unknown', text: 'No fresh finalized observation of the network was available, so runtime drift cannot be ruled out.' },
  'observation-stale': { status: 'unknown', text: 'The network observation is older than the policy allows. Observe the network again.' },
  'observation-mismatch': { status: 'unknown', text: 'The observation comes from another network than the policy names, so it says nothing about this one.' },
  'runtime-changed': { status: 'recheck-required', text: 'The network runs a different runtime than the report pinned. Recheck on the current runtime; approvals do not carry over.' },
  'evidence-expired': { status: 'expired', text: 'The report is older than the policy allows. Recheck at the current head; an approval does not extend evidence age.' },
  'registry-unavailable': { status: 'unknown', text: 'The ReleaseRegistry could not be read for every trusted reviewer, so the approval state is unknown.' },
  'registry-domain-unverifiable': { status: 'unknown', text: 'The registry read does not identify its contract, release and observation time. Read the expected registry again.' },
  'registry-domain-mismatch': { status: 'recheck-required', text: 'The registry read names another contract or release than this policy and binding.' },
  'interfaces-disagree': { status: 'unknown', text: 'The EVM RPC and ReviveApi returned different values for the same read. Do not act on either.' },
  'release-missing': { status: 'recheck-required', text: 'The release is not in the registry. Submit the report first.' },
  'owner-mismatch': { status: 'recheck-required', text: 'The release is owned by another account than the policy names.' },
  'revision-superseded': { status: 'recheck-required', text: 'The registry holds a different revision or report than the binding names. Approve the new report, then bind it explicitly; the old binding stays as history.' },
  'approval-missing': { status: 'recheck-required', text: 'Not enough trusted reviewers have approved the current revision.' },
  'approval-revoked': { status: 'recheck-required', text: 'A trusted reviewer requested changes on the current revision.' },
  'consumer-unavailable': { status: 'unknown', text: 'The consumer contract could not be read through both interfaces.' },
  'consumer-domain-unverifiable': { status: 'unknown', text: 'The consumer read does not identify its contract, token and observation time. Read the expected consumer again.' },
  'consumer-domain-mismatch': { status: 'recheck-required', text: 'The consumer read names another contract or token than this policy subject.' },
  'consumer-identity-unavailable': { status: 'unknown', text: 'The consumer version and registry identity could not be verified through both interfaces at the listing checkpoint.' },
  'consumer-identity-mismatch': { status: 'recheck-required', text: 'The consumer version or registry does not match this policy.' },
  'consumer-not-listed': { status: 'recheck-required', text: 'The consumer contract does not list the subject right now.' },
  'consumer-entry-mismatch': { status: 'recheck-required', text: 'The consumer lists the subject on another release, report or reviewer than the binding names.' },
  'storage-unverified': { status: 'unknown', text: 'The stored report could not be retrieved and verified from chain data.' },
  'storage-mismatch': { status: 'recheck-required', text: 'The report stored on-chain is not the bound report.' },
  'subject-unavailable': { status: 'unknown', text: 'The subject metadata could not be read through both interfaces at a finalized checkpoint, so its current values are unknown.' },
  'subject-domain-unverifiable': { status: 'unknown', text: 'The subject read does not identify its asset, address and observation time. Read the policy subject again.' },
  'subject-domain-mismatch': { status: 'recheck-required', text: 'The subject read names another asset or address than the policy subject.' },
  'subject-unsupported': { status: 'unknown', text: 'The subject read runs on a runtime whose precompile adapter is not verified; the current metadata cannot be established there.' },
  'subject-missing': { status: 'recheck-required', text: 'The native asset no longer exists at the checkpoint read.' },
  'subject-changed': { status: 'recheck-required', text: 'The subject now reports other metadata than the approved report verified. A standing approval of the old report does not cover the new values: check again, obtain a new approval and bind the new report.' },
});

const NEXT_ACTION = Object.freeze({
  valid: 'Enable the subject under this policy. Validity is a point-in-time result: evaluate again before each use.',
  'recheck-required': 'Do not enable. Produce a new report for the current release, obtain approval of its exact hash from a trusted reviewer, and bind the new report explicitly. Earlier evidence stays as history.',
  expired: 'Do not enable. Recheck at the current head and bind the new report; an approval does not extend evidence age.',
  unknown: 'Do not enable. The verification could not complete; retry the reads. Unavailable verification never counts as valid.',
});

const requireHash = (value, what) => { if (!HASH.test(value || '')) throw new Error(`${what} is a 0x-prefixed 32-byte hash.`); return lower(value); };
const requireAddress = (value, what) => { if (!H160.test(value || '')) throw new Error(`${what} is an H160 address.`); return lower(value); };
const requireInteger = (value, what, { min = 1, fallback } = {}) => {
  if (value === undefined && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) throw new Error(`${what} is an integer of at least ${min}.`);
  return number;
};
const requireText = (value, what, max) => { const text = String(value ?? '').trim(); if (!text || text.length > max) throw new Error(`${what} is 1 to ${max} characters.`); return text; };

/** Validate a policy and return a frozen, canonical copy. Every field a later check relies on is required here. */
export function normalizePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A policy is an object.');
  if (input.schema !== POLICY_SCHEMA) throw new Error(`A policy declares schema ${POLICY_SCHEMA}.`);
  const name = requireText(input.name, 'The policy name', 120);
  const network = input.network || {};
  if (!['testnet', 'live', 'local'].includes(network.key)) throw new Error('policy.network.key is testnet, live or local.');
  const chainId = requireInteger(network.chainId, 'policy.network.chainId');
  const genesisHash = requireHash(network.genesisHash, 'policy.network.genesisHash');
  const runtime = input.runtime || {};
  const specName = requireText(runtime.specName, 'policy.runtime.specName', 64);
  if (!Array.isArray(runtime.specVersions) || !runtime.specVersions.length || runtime.specVersions.some((version) => !/^\d+$/.test(String(version)))) throw new Error('policy.runtime.specVersions lists at least one supported spec version.');
  const specVersions = [...new Set(runtime.specVersions.map(String))];
  const subject = input.subject || {};
  let normalizedSubject;
  if (subject.kind === 'native-asset') {
    if (!/^\d+$/.test(String(subject.assetId ?? '')) || BigInt(subject.assetId) > 0xffffffffn) throw new Error('policy.subject.assetId is a u32 decimal string.');
    normalizedSubject = { kind: 'native-asset', assetId: BigInt(subject.assetId).toString(), address: requireAddress(subject.address, 'policy.subject.address') };
  } else if (subject.kind === 'contract') {
    normalizedSubject = { kind: 'contract', address: requireAddress(subject.address, 'policy.subject.address'), ...(subject.codeHash ? { codeHash: requireHash(subject.codeHash, 'policy.subject.codeHash') } : {}) };
  } else throw new Error('policy.subject.kind is native-asset or contract.');
  if (!BARE.test(input.planHash || '')) throw new Error('policy.planHash is the 64-hex acceptance plan fingerprint the evidence must carry.');
  const evidence = input.evidence || {};
  if (!SCOPES[evidence.scope]) throw new Error(`policy.evidence.scope is one of ${Object.keys(SCOPES).join(', ')}.`);
  if (evidence.requireFreshSubject !== undefined && typeof evidence.requireFreshSubject !== 'boolean') throw new Error('policy.evidence.requireFreshSubject is true or false.');
  if (evidence.requireFreshSubject === true && subject.kind !== 'native-asset') throw new Error('policy.evidence.requireFreshSubject is supported for the native-asset subject profile only.');
  const normalizedEvidence = {
    scope: evidence.scope,
    maxAgeSeconds: requireInteger(evidence.maxAgeSeconds, 'policy.evidence.maxAgeSeconds'),
    maxObservationAgeSeconds: requireInteger(evidence.maxObservationAgeSeconds, 'policy.evidence.maxObservationAgeSeconds', { fallback: 900 }),
    requireInterfacesAgree: evidence.requireInterfacesAgree !== false,
    requireStoredOnChain: evidence.requireStoredOnChain === true,
    // Schema compatibility: the key is present only when set, so the fingerprint of every earlier policy is unchanged.
    ...(evidence.requireFreshSubject === true ? { requireFreshSubject: true } : {}),
  };
  const reviewers = input.reviewers || {};
  if (!Array.isArray(reviewers.trusted) || !reviewers.trusted.length) throw new Error('policy.reviewers.trusted names at least one reviewer address. The policy author decides who counts.');
  const trusted = [...new Set(reviewers.trusted.map((address) => requireAddress(address, 'A trusted reviewer')))];
  const threshold = requireInteger(reviewers.threshold, 'policy.reviewers.threshold', { fallback: 1 });
  if (threshold > trusted.length) throw new Error('policy.reviewers.threshold cannot exceed the number of trusted reviewers.');
  const basis = requireText(reviewers.basis, 'policy.reviewers.basis (why these reviewers are trusted, and what that does not establish)', 400);
  const registry = input.registry || {};
  const normalizedRegistry = { address: requireAddress(registry.address, 'policy.registry.address'), ...(registry.owner ? { owner: requireAddress(registry.owner, 'policy.registry.owner') } : {}), ...(registry.label ? { label: requireText(registry.label, 'policy.registry.label', 31) } : {}) };
  let consumer = null;
  if (input.consumer) {
    consumer = { address: requireAddress(input.consumer.address, 'policy.consumer.address'), requireListed: input.consumer.requireListed !== false, ...(input.consumer.version !== undefined ? { version: requireInteger(input.consumer.version, 'policy.consumer.version') } : {}) };
  }
  const simulation = evidence.scope === 'local-rehearsal';
  if (simulation !== (network.key === 'local')) throw new Error('Local-rehearsal evidence belongs to the local network key, and only there.');
  return freeze({ schema: POLICY_SCHEMA, name, network: { key: network.key, chainId, genesisHash }, runtime: { specName, specVersions }, subject: normalizedSubject, planHash: input.planHash, evidence: normalizedEvidence, reviewers: { trusted, threshold, basis }, registry: normalizedRegistry, consumer, simulation });
}

export const policyHash = (policy) => fingerprint(normalizePolicy(policy));

/**
 * The guard at an integration boundary: a policy document may request a requirement that
 * an older or foreign implementation does not know and silently drops when it normalizes
 * (`evidence.requireFreshSubject` is the first such option). Compare the requested
 * document with the normalized result handed back by the implementation in use; a
 * requirement set to `true` in the request that is not `true` in the result makes the
 * configuration unusable here, and the error names it. A legacy document without the
 * option passes unchanged. Returns the normalized policy.
 */
export function assertRequirementsRetained(requested, normalized) {
  const dropped = Object.entries(requested?.evidence ?? {}).filter(([, value]) => value === true).map(([key]) => key).filter((key) => normalized?.evidence?.[key] !== true);
  if (dropped.length) throw new Error(`This implementation does not retain the requested policy requirement${dropped.length === 1 ? '' : 's'} ${dropped.map((key) => `evidence.${key}`).join(', ')}; it cannot evaluate this policy and refuses the configuration instead of applying a weaker one.`);
  return normalized;
}

/**
 * The evidence predicates the evaluator decides with, exported so that other views
 * (evidence health, the renewal plan) claim a fact only when the same predicate holds.
 * Each takes the normalized policy; none throws on a malformed read, it answers false.
 */
export const evidencePredicates = Object.freeze({
  /** The report's evidence mode and scope are the policy's. */
  scope: (report, policy) => report?.mode === SCOPES[policy.evidence.scope] && report?.scope === policy.evidence.scope,
  /** The report observed the policy's network: chain ID and genesis hash. */
  reportNetwork: (report, policy) => { const network = report?.network || {}; return Number(network.observedChainId ?? network.chainId) === policy.network.chainId && lower(network.nativeGenesisHash ?? network.genesisHash) === policy.network.genesisHash; },
  /** The report is about the policy subject (and, when given, the binding names it too). */
  reportSubject: (report, policy, binding = null) => {
    const subject = policy.subject, input = report?.input || {};
    if (binding && binding.subject !== subject.address) return false;
    return subject.kind === 'native-asset'
      ? String(input.nativeAsset?.assetId) === subject.assetId && lower(input.listing?.address) === subject.address
      : lower(input.contractAddress) === subject.address && (!subject.codeHash || lower(report?.binding?.codeHash) === subject.codeHash);
  },
  /** The report was produced under the acceptance plan the policy pins. */
  plan: (report, policy) => report?.binding?.planHash === policy.planHash,
  /** The report passed. */
  passed: (report) => report?.status === 'passed',
  /** The report's runtime is one the policy supports. */
  reportRuntime: (report, policy) => policy.runtime.specVersions.map((version) => `${policy.runtime.specName}/${version}`).includes(runtimeOf(report?.network || {})),
  /** A dated read within the policy's freshness window at `at` (60 s of clock skew allowed in the future). */
  fresh: (observedAt, at, policy) => { const observed = Date.parse(observedAt); if (!Number.isFinite(observed)) return false; const age = (new Date(at).getTime() - observed) / 1000; return age >= -60 && age <= policy.evidence.maxObservationAgeSeconds; },
  /** The report is within the policy's age limit at `at`. */
  reportAge: (report, at, policy) => { const age = (new Date(at).getTime() - Date.parse(report?.completedAt)) / 1000; return Number.isFinite(age) && age >= -60 && age <= policy.evidence.maxAgeSeconds; },
  /** The observation comes from the policy's network. */
  observationNetwork: (observation, policy) => Number(observation?.chainId) === policy.network.chainId && lower(observation?.genesisHash) === policy.network.genesisHash,
  /** The registry read identifies a dated contract and release. */
  registryDated: (registry) => H160.test(registry?.address || '') && HASH.test(registry?.releaseId || '') && Number.isFinite(Date.parse(registry?.observedAt)),
  /** The registry read names the policy's registry and the binding's release. */
  registryDomain: (registry, policy, binding) => lower(registry?.address) === policy.registry.address && lower(registry?.releaseId) === lower(binding?.releaseId),
  /** The consumer read identifies a dated contract and token. */
  listingDated: (listing) => H160.test(listing?.list || '') && H160.test(listing?.token || '') && Number.isFinite(Date.parse(listing?.observedAt)),
  /** The consumer read names the policy's consumer and subject. */
  listingDomain: (listing, policy) => lower(listing?.list) === policy.consumer?.address && lower(listing?.token) === policy.subject.address,
  /** The subject read identifies a dated asset and address. */
  subjectDated: (read) => /^\d+$/.test(String(read?.assetId ?? '')) && H160.test(read?.subject || '') && Number.isFinite(Date.parse(read?.observedAt)),
  /** The subject read names the policy subject. */
  subjectDomain: (read, policy) => lower(read?.subject) === policy.subject.address && String(read?.assetId) === policy.subject.assetId,
  /** The two interfaces agreed, when the policy requires it (true when it does not). */
  interfacesAgree: (read, policy) => !policy.evidence.requireInterfacesAgree || read?.interfacesAgree === true,
  /** The registry read's current revision and report are the binding's. */
  registryRevision: (registry, binding) => lower(registry?.release?.reportHash) === `0x${binding?.reportHash}` && String(registry?.release?.revision) === String(binding?.revision),
  /** Enough trusted reviewers approved, every trusted decision was read, none requested changes. */
  approvals: (registry, policy) => {
    const decisions = registry?.decisions || (registry?.decision ? { [lower(registry.decision.reviewer)]: registry.decision } : {});
    const trusted = policy.reviewers.trusted;
    const unread = trusted.filter((reviewer) => !decisions[reviewer] || lower(decisions[reviewer].reviewer) !== reviewer || typeof decisions[reviewer].reviewed !== 'boolean' || typeof decisions[reviewer].approved !== 'boolean');
    const approved = trusted.filter((reviewer) => decisions[reviewer]?.reviewed === true && decisions[reviewer]?.approved === true);
    const changes = trusted.filter((reviewer) => decisions[reviewer]?.reviewed === true && decisions[reviewer]?.approved === false);
    return { ok: approved.length >= policy.reviewers.threshold && unread.length === 0 && changes.length === 0, approved, changes, unread };
  },
  /** The consumer lists the subject on the binding's release and report, relying on a trusted reviewer. */
  listingEntry: (listing, policy, binding) => { const entry = listing?.entry || {}; return listing?.listed === true && lower(entry.releaseId) === lower(binding?.releaseId) && lower(entry.reportHash) === `0x${binding?.reportHash}` && policy.reviewers.trusted.includes(lower(entry.reviewer)); },
  /**
   * The consumer's identity at the listing checkpoint: `read` when it was read through both
   * interfaces, agreeing, at the listing's own block; `matches` when it names this policy's
   * consumer and registry; `versionKnown` when its version comes from an observed getter or the
   * explicitly selected, code-verified legacy deployment; `versionMatches` against the policy's
   * version (null when the policy pins none). `ok` is all of them. A listing without a verified
   * identity proves nothing about which registry its entry trusts.
   */
  consumerIdentity: (listing, policy) => {
    const identity = listing?.identity;
    const sameCheckpoint = !!(identity?.block?.nativeHash && identity.block.nativeHash === listing?.block?.nativeHash && identity.block.evmHash === listing?.block?.evmHash);
    const read = !!(identity && !identity.error && identity.interfacesAgree === true && sameCheckpoint && H160.test(identity.address || '') && identity.evm && identity.native);
    if (!read) return { ok: false, read: false, matches: false, versionKnown: false, version: null, versionMatches: null };
    const matches = lower(identity.address) === policy.consumer?.address && lower(identity.evm.registry) === policy.registry.address && lower(identity.native.registry) === policy.registry.address;
    const resolved = resolveTokenListVersion(identity);
    const version = resolved.version;
    const versionKnown = version !== null && identity.version === version && identity.versionSource === resolved.versionSource && (resolved.versionSource === 'on-chain-version-getter' || policy.consumer?.version === 1);
    const versionMatches = policy.consumer?.version === undefined ? null : version === policy.consumer.version;
    return { ok: matches && versionKnown && versionMatches !== false, read, matches, versionKnown, version, versionMatches };
  },
});

/**
 * What a valid evaluation under this policy says about the subject's CURRENT metadata.
 * Without `evidence.requireFreshSubject` the metadata correctness comes from the approved
 * report at its checkpoint and the consumer's listing-time decimals check; a standing
 * approval does not re-read symbol, name or decimals. With it, every evaluation reads them
 * again at a finalized checkpoint through both interfaces and compares.
 */
export function policyAssurance(policy) {
  const normalized = normalizePolicy(policy);
  const fresh = normalized.evidence.requireFreshSubject === true;
  return Object.freeze({
    subject: fresh ? 'fresh-read' : 'historical-report',
    text: fresh
      ? `Symbol, name, decimals and the address mapping of the subject are read again at a finalized checkpoint through both interfaces on every evaluation (at most ${normalized.evidence.maxObservationAgeSeconds} s old) and compared with the approved report; a changed value withholds the entry until a new report is approved and bound.`
      : 'Symbol, name and decimals were verified by the approved report at its checkpoint; evaluations re-read the approval, the listing and the network, not the metadata itself. The consumer contract checks decimals at listing time. A metadata change after the report is seen only by a new check, or by a policy that sets evidence.requireFreshSubject.',
  });
}

/**
 * Bind one exact report to the policy subject, naming the registry release and
 * revision it was approved on. A new report, or a new revision, needs a new
 * binding: nothing here follows a release forward on its own.
 */
export function createBinding({ policy, report, releaseId, revision, boundBy, boundAt = new Date().toISOString(), note = '', storage = null, id = globalThis.crypto.randomUUID() }) {
  const normalized = normalizePolicy(policy);
  if (!consistentReport(report)) throw new Error('A binding needs an intact sealed report with consistent plan and observation bindings.');
  if (!/^[1-9]\d*$/.test(String(revision ?? ''))) throw new Error('A binding names the registry revision the report was approved on.');
  if (!Number.isFinite(Date.parse(boundAt))) throw new Error('boundAt is an ISO-8601 time.');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(String(id))) throw new Error('A binding ID is a safe identifier.');
  const payload = {
    schema: BINDING_SCHEMA, id: String(id), policyHash: fingerprint(normalized), policyName: normalized.name,
    subject: normalized.subject.address, subjectKind: normalized.subject.kind,
    reportHash: report.evidenceHash, release: report.release ?? null, releaseId: requireHash(releaseId, 'The release ID'), revision: String(revision),
    boundBy: requireText(boundBy, 'boundBy (who made the binding, and whether that account is project-controlled)', 160), boundAt, note: String(note ?? '').slice(0, 400),
    storage: storage ? { extrinsicHash: requireHash(storage.extrinsicHash, 'storage.extrinsicHash'), blockHash: storage.blockHash ? requireHash(storage.blockHash, 'storage.blockHash') : null } : null,
  };
  return freeze({ ...payload, bindingHash: fingerprint(payload) });
}

/** True when the binding is intact and, if a policy is given, was made under that exact policy. */
export function verifyBinding(binding, policy) {
  try {
    if (!binding || typeof binding !== 'object' || binding.schema !== BINDING_SCHEMA) return false;
    const { bindingHash, ...payload } = binding;
    if (!BARE.test(bindingHash || '') || fingerprint(payload) !== bindingHash) return false;
    return !policy || payload.policyHash === fingerprint(normalizePolicy(policy));
  } catch { return false; }
}

const runtimeOf = (source) => source?.runtime ? String(source.runtime) : `${source?.specName}/${source?.specVersion}`;

/**
 * Evaluate one binding against the policy, the bound report, a fresh registry
 * read (`readRegistryWithClients` with the trusted reviewers), a fresh network
 * observation (`networkStatus`), and optionally the consumer listing and the
 * stored-evidence retrieval. `now` is injectable so fixtures stay deterministic.
 */
export function evaluateBinding({ policy, binding, report, registry = null, observation = null, listing = null, evidence = null, subject: subjectRead = null, now = new Date() }) {
  const normalized = normalizePolicy(policy);
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) throw new Error('now is a valid date.');
  const { network, runtime, subject, reviewers } = normalized;
  const supported = runtime.specVersions.map((version) => `${runtime.specName}/${version}`);
  const checks = [], reasons = [];
  const add = (id, ok, observed, expected, reason) => {
    checks.push({ id, status: ok ? 'passed' : REASONS[reason].status === 'unknown' ? 'unknown' : 'failed', observed: String(observed), expected: String(expected) });
    if (!ok) reasons.push({ code: reason, status: REASONS[reason].status, text: REASONS[reason].text });
    return ok;
  };
  const finish = () => {
    const status = reasons.reduce((worst, reason) => SEVERITY[reason.status] > SEVERITY[worst] ? reason.status : worst, 'valid');
    const result = {
      schema: EVALUATION_SCHEMA, policyName: normalized.name, policyHash: fingerprint(normalized), subject: subject.address, subjectKind: subject.kind,
      bindingId: binding?.id ?? null, reportHash: binding?.reportHash ?? null, releaseId: binding?.releaseId ?? null, revision: binding?.revision ?? null,
      status, enable: status === 'valid', reasons, checks,
      checkpoint: { registry: registry?.block ?? null, observation: observation?.finalized ?? null, listing: listing?.block ?? null, ...(normalized.evidence.requireFreshSubject ? { subject: subjectRead?.block ?? null } : {}) },
      reviewerTrust: reviewers.basis, simulation: normalized.simulation, evaluatedAt: at.toISOString(), nextAction: NEXT_ACTION[status],
      caveat: `${normalized.simulation ? 'SIMULATED EVIDENCE: local rehearsal fixtures and an in-memory EVM; no Portaldot network was read. ' : ''}A valid result means every policy condition held at the recorded checkpoints and time. It is not a guarantee of future state, a security audit or independent review; the trusted reviewer set is the policy author's choice.`,
    };
    return freeze({ ...result, evaluationHash: fingerprint(result) });
  };
  const bindingOk = verifyBinding(binding, normalized);
  const reportOk = consistentReport(report) && report.evidenceHash === binding?.reportHash;
  if (!add('evidence.integrity', bindingOk && reportOk, bindingOk ? (reportOk ? 'binding and report verify' : 'the report is not the bound report, or fails its integrity or semantic validation') : 'the binding fails its hash or was made under another policy', 'an intact binding under this policy and its exact semantically consistent report', 'evidence-unverifiable')) return finish();
  add('evidence.scope', evidencePredicates.scope(report, normalized), `${report.mode}/${report.scope}`, normalized.evidence.scope, 'wrong-scope');
  const reportNetwork = report.network || {};
  add('target.network', evidencePredicates.reportNetwork(report, normalized), `chain ${reportNetwork.observedChainId ?? reportNetwork.chainId}, genesis ${lower(reportNetwork.nativeGenesisHash ?? reportNetwork.genesisHash).slice(0, 12)}…`, `chain ${network.chainId}, genesis ${network.genesisHash.slice(0, 12)}…`, 'wrong-target');
  const input = report.input || {};
  const subjectOk = evidencePredicates.reportSubject(report, normalized, binding);
  add('target.subject', subjectOk, subject.kind === 'native-asset' ? `asset ${input.nativeAsset?.assetId ?? '?'} at ${lower(input.listing?.address) || '?'}` : `contract ${lower(input.contractAddress) || '?'}${report.binding?.codeHash ? ` code ${lower(report.binding.codeHash).slice(0, 12)}…` : ''}`, subject.kind === 'native-asset' ? `asset ${subject.assetId} at ${subject.address}` : `contract ${subject.address}${subject.codeHash ? ` code ${subject.codeHash.slice(0, 12)}…` : ''}`, 'wrong-target');
  add('plan.fingerprint', evidencePredicates.plan(report, normalized), report.binding?.planHash ?? 'none', normalized.planHash, 'plan-changed');
  add('report.status', evidencePredicates.passed(report), report.status, 'passed', 'report-not-passed');
  const reportRuntime = runtimeOf(reportNetwork);
  add('runtime.report', evidencePredicates.reportRuntime(report, normalized), reportRuntime, supported.join(' or '), 'runtime-unsupported');
  const observed = observation && !observation.error && Number.isFinite(Date.parse(observation.observedAt));
  if (add('observation.present', !!observed, observation?.error ? `error: ${observation.error}` : observation ? 'observation without a time' : 'no observation', 'a dated finalized observation of the network', 'observation-missing')) {
    const age = (at.getTime() - Date.parse(observation.observedAt)) / 1000;
    add('observation.fresh', evidencePredicates.fresh(observation.observedAt, at, normalized), `${Math.round(age)} s old`, `at most ${normalized.evidence.maxObservationAgeSeconds} s old`, 'observation-stale');
    add('observation.network', evidencePredicates.observationNetwork(observation, normalized), `chain ${observation.chainId}, genesis ${lower(observation.genesisHash).slice(0, 12)}…`, `chain ${network.chainId}, genesis ${network.genesisHash.slice(0, 12)}…`, 'observation-mismatch');
    const current = runtimeOf(observation);
    add('runtime.current', current === reportRuntime && supported.includes(current), current, reportRuntime, 'runtime-changed');
  }
  const reportAge = (at.getTime() - Date.parse(report.completedAt)) / 1000;
  add('evidence.age', evidencePredicates.reportAge(report, at, normalized), Number.isFinite(reportAge) ? `${Math.round(reportAge)} s since the report` : 'undated report', `at most ${normalized.evidence.maxAgeSeconds} s old, with at most 60 s clock skew`, 'evidence-expired');
  const registryRead = registry && !registry.error && registry.release && typeof registry.release.exists === 'boolean';
  if (add('registry.read', !!registryRead, registry?.error ? `error: ${registry.error}` : registry ? 'read' : 'no registry read', 'releaseOf and every trusted decision through both interfaces', 'registry-unavailable')) {
    if (add('registry.provenance', evidencePredicates.registryDated(registry), `${registry.address || 'unknown contract'}, ${registry.releaseId || 'unknown release'}, ${registry.observedAt || 'undated'}`, 'the dated registry contract and release', 'registry-domain-unverifiable')) {
      add('registry.domain', evidencePredicates.registryDomain(registry, normalized, binding), `${registry.address}, ${registry.releaseId}`, `${normalized.registry.address}, ${binding.releaseId}`, 'registry-domain-mismatch');
      const age = (at.getTime() - Date.parse(registry.observedAt)) / 1000;
      add('registry.fresh', evidencePredicates.fresh(registry.observedAt, at, normalized), `${Math.round(age)} s old`, `at most ${normalized.evidence.maxObservationAgeSeconds} s old`, 'observation-stale');
    }
    if (normalized.evidence.requireInterfacesAgree) add('registry.interfaces', registry.interfacesAgree === true, registry.interfacesAgree === true ? 'EVM RPC and ReviveApi agree' : 'the interfaces disagree', 'agreement at one finalized block', 'interfaces-disagree');
    if (add('registry.release', registry.release.exists === true, registry.release.exists ? `revision ${registry.release.revision}` : 'no release with this ID', 'the release exists', 'release-missing')) {
      if (normalized.registry.owner) add('registry.owner', lower(registry.release.owner) === normalized.registry.owner, lower(registry.release.owner), normalized.registry.owner, 'owner-mismatch');
      if (normalized.registry.label) {
        let expectedId = null;
        try { expectedId = releaseIdOf(registry.release.owner, normalized.registry.label); } catch { /* Invalid provenance cannot identify the declared release. */ }
        add('registry.label', expectedId === binding.releaseId, binding.releaseId, expectedId || 'a release ID derived from the declared label and read owner', 'registry-domain-mismatch');
      }
      add('registry.revision', evidencePredicates.registryRevision(registry, binding), `revision ${registry.release.revision}, report ${lower(registry.release.reportHash).slice(0, 14)}…`, `revision ${binding.revision}, report 0x${binding.reportHash.slice(0, 12)}…`, 'revision-superseded');
      const { ok: enough, approved, changes, unread } = evidencePredicates.approvals(registry, normalized);
      add('registry.approvals', enough, `${approved.length} of ${reviewers.trusted.length} trusted reviewer${reviewers.trusted.length === 1 ? '' : 's'} approved revision ${registry.release.revision}${changes.length ? `; ${changes.length} requested changes` : ''}${unread.length ? `; ${unread.length} not read` : ''}`, `at least ${reviewers.threshold}, every trusted decision read and no trusted request for changes`, unread.length ? 'registry-unavailable' : changes.length ? 'approval-revoked' : 'approval-missing');
    }
  }
  if (normalized.consumer?.requireListed) {
    const listingRead = listing && !listing.error && typeof listing.listed === 'boolean';
    if (add('consumer.read', !!listingRead, listing?.error ? `error: ${listing.error}` : listing ? 'read' : 'no consumer read', 'isListed and entryOf through both interfaces', 'consumer-unavailable')) {
      if (add('consumer.provenance', evidencePredicates.listingDated(listing), `${listing.list || 'unknown contract'}, ${listing.token || 'unknown token'}, ${listing.observedAt || 'undated'}`, 'the dated consumer contract and token', 'consumer-domain-unverifiable')) {
        add('consumer.domain', evidencePredicates.listingDomain(listing, normalized), `${listing.list}, ${listing.token}`, `${normalized.consumer.address}, ${subject.address}`, 'consumer-domain-mismatch');
        const age = (at.getTime() - Date.parse(listing.observedAt)) / 1000;
        add('consumer.fresh', evidencePredicates.fresh(listing.observedAt, at, normalized), `${Math.round(age)} s old`, `at most ${normalized.evidence.maxObservationAgeSeconds} s old`, 'observation-stale');
      }
      const identity = listing.identity;
      const consumerIdentity = evidencePredicates.consumerIdentity(listing, normalized);
      if (add('consumer.identity', consumerIdentity.read, consumerIdentity.read ? `identity at ${identity.block.nativeHash}` : 'no agreeing identity at the listing checkpoint', 'consumer identity through both interfaces at the listing checkpoint', 'consumer-identity-unavailable')) {
        add('consumer.registry', consumerIdentity.matches, `${identity.address}, registry ${identity.evm.registry}`, `${normalized.consumer.address}, registry ${normalized.registry.address}`, 'consumer-identity-mismatch');
        if (add('consumer.version-known', consumerIdentity.versionKnown, identity.version ?? 'unknown', 'an observed getter or the explicitly selected, code-verified legacy deployment', 'consumer-identity-unavailable') && normalized.consumer.version !== undefined) add('consumer.version', consumerIdentity.versionMatches, consumerIdentity.version, normalized.consumer.version, 'consumer-identity-mismatch');
      }
      if (normalized.evidence.requireInterfacesAgree) add('consumer.interfaces', listing.interfacesAgree === true, listing.interfacesAgree === true ? 'EVM RPC and ReviveApi agree' : 'the interfaces disagree', 'agreement at one finalized block', 'interfaces-disagree');
      if (add('consumer.listed', listing.listed === true, listing.listed ? 'listed' : 'not listed', 'listed', 'consumer-not-listed')) {
        const entry = listing.entry || {};
        add('consumer.entry', evidencePredicates.listingEntry(listing, normalized, binding), `release ${lower(entry.releaseId).slice(0, 12)}…, report ${lower(entry.reportHash).slice(0, 12)}…, reviewer ${lower(entry.reviewer)}`, `release ${binding.releaseId.slice(0, 12)}…, report 0x${binding.reportHash.slice(0, 10)}…, a trusted reviewer`, 'consumer-entry-mismatch');
      }
    }
  }
  if (normalized.evidence.requireFreshSubject) {
    // The subject's current metadata, read again: compared field by field with the entry the approved report verified.
    const subjectRead_ = subjectRead && !subjectRead.error && typeof subjectRead.supported === 'boolean';
    if (add('subject.read', !!subjectRead_, subjectRead?.error ? `error: ${subjectRead.error}` : subjectRead ? 'read' : 'no subject read', 'native Assets metadata and the ERC-20 precompile views at one finalized checkpoint', 'subject-unavailable')) {
      if (add('subject.provenance', evidencePredicates.subjectDated(subjectRead), `${subjectRead.subject || 'unknown address'}, asset ${subjectRead.assetId ?? '?'}, ${subjectRead.observedAt || 'undated'}`, 'the dated subject address and asset', 'subject-domain-unverifiable')) {
        add('subject.domain', evidencePredicates.subjectDomain(subjectRead, normalized), `${lower(subjectRead.subject)}, asset ${subjectRead.assetId}`, `${subject.address}, asset ${subject.assetId}`, 'subject-domain-mismatch');
        const age = (at.getTime() - Date.parse(subjectRead.observedAt)) / 1000;
        add('subject.fresh', evidencePredicates.fresh(subjectRead.observedAt, at, normalized), `${Math.round(age)} s old`, `at most ${normalized.evidence.maxObservationAgeSeconds} s old`, 'observation-stale');
      }
      if (add('subject.supported', subjectRead.supported === true, subjectRead.supported === true ? `adapter verified on ${subjectRead.runtime}` : subjectRead.note || `unsupported on ${subjectRead.runtime || 'an unknown runtime'}`, 'the verified precompile adapter runtime', 'subject-unsupported')) {
        if (add('subject.exists', subjectRead.exists === true, subjectRead.exists === true ? 'the native asset exists at the checkpoint' : 'the native asset does not exist at the checkpoint', 'an existing native asset', 'subject-missing')) {
          // Disagreeing interfaces are unknown, never "changed": the comparison runs only on values both interfaces agree on (or on the native values when the policy does not require agreement).
          const agreeing = !normalized.evidence.requireInterfacesAgree || add('subject.interfaces', subjectRead.interfacesAgree === true, subjectRead.interfacesAgree === true ? 'native Assets metadata and the ERC-20 precompile agree' : 'the interfaces disagree', 'agreement at one finalized checkpoint', 'interfaces-disagree');
          if (agreeing) {
            const approved = approvedEntry(report);
            const current = subjectRead.native ?? null;
            const differing = approved.entry && current ? SUBJECT_FIELDS.filter((field) => (field === 'address' ? lower(current.address) !== approved.entry.address : current[field] !== approved.entry[field])) : SUBJECT_FIELDS;
            add('subject.metadata', approved.entry !== null && current !== null && differing.length === 0, !approved.entry ? `the report approves no entry: ${approved.reason}` : !current ? 'no current values were read' : differing.length ? differing.map((field) => `${field}: now ${JSON.stringify(current[field])}, approved ${JSON.stringify(approved.entry[field])}`).join('; ') : 'symbol, name, decimals and address unchanged', 'the current metadata equal to the approved report, field by field', 'subject-changed');
          }
        }
      }
    }
  }
  if (normalized.evidence.requireStoredOnChain) {
    const stored = evidence && !evidence.error && evidence.verified === true;
    if (add('storage.read', !!stored, evidence?.error ? `error: ${evidence.error}` : evidence ? (evidence.reasons || []).join(' ') || 'not verified' : 'no retrieval', 'the report retrieved and verified from chain data', 'storage-unverified')) {
      add('storage.report', lower(evidence.reportHash).replace(/^0x/, '') === binding.reportHash, lower(evidence.reportHash).replace(/^0x/, ''), binding.reportHash, 'storage-mismatch');
    }
  }
  return finish();
}

/** One line for a log or a table. */
export const summarizeEvaluation = (evaluation) => `${evaluation.status}${evaluation.reasons.length ? `: ${evaluation.reasons.map((reason) => reason.code).join(', ')}` : ': every policy condition holds'}`;
