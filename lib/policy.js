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
import { fingerprint, verifyRun } from './report.js';

export const POLICY_SCHEMA = 'revivecheck.policy.v1';
export const BINDING_SCHEMA = 'revivecheck.binding.v1';
export const EVALUATION_SCHEMA = 'revivecheck.policy-evaluation.v1';
export const POLICY_STATUSES = Object.freeze(['valid', 'recheck-required', 'expired', 'unknown']);
const SEVERITY = { valid: 0, unknown: 1, expired: 2, 'recheck-required': 3 };
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/, BARE = /^[a-f0-9]{64}$/;
const SCOPES = Object.freeze({ 'portaldot-testnet-readonly': 'live', 'portaldot-live-readonly': 'live', 'local-rehearsal': 'rehearsal' });
const lower = (value) => String(value ?? '').toLowerCase();
const freeze = (value) => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };

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
  'interfaces-disagree': { status: 'unknown', text: 'The EVM RPC and ReviveApi returned different values for the same read. Do not act on either.' },
  'release-missing': { status: 'recheck-required', text: 'The release is not in the registry. Submit the report first.' },
  'owner-mismatch': { status: 'recheck-required', text: 'The release is owned by another account than the policy names.' },
  'revision-superseded': { status: 'recheck-required', text: 'The registry holds a different revision or report than the binding names. Approve the new report, then bind it explicitly; the old binding stays as history.' },
  'approval-missing': { status: 'recheck-required', text: 'Not enough trusted reviewers have approved the current revision.' },
  'approval-revoked': { status: 'recheck-required', text: 'A trusted reviewer requested changes on the current revision.' },
  'consumer-unavailable': { status: 'unknown', text: 'The consumer contract could not be read through both interfaces.' },
  'consumer-not-listed': { status: 'recheck-required', text: 'The consumer contract does not list the subject right now.' },
  'consumer-entry-mismatch': { status: 'recheck-required', text: 'The consumer lists the subject on another release, report or reviewer than the binding names.' },
  'storage-unverified': { status: 'unknown', text: 'The stored report could not be retrieved and verified from chain data.' },
  'storage-mismatch': { status: 'recheck-required', text: 'The report stored on-chain is not the bound report.' },
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
  const normalizedEvidence = {
    scope: evidence.scope,
    maxAgeSeconds: requireInteger(evidence.maxAgeSeconds, 'policy.evidence.maxAgeSeconds'),
    maxObservationAgeSeconds: requireInteger(evidence.maxObservationAgeSeconds, 'policy.evidence.maxObservationAgeSeconds', { fallback: 900 }),
    requireInterfacesAgree: evidence.requireInterfacesAgree !== false,
    requireStoredOnChain: evidence.requireStoredOnChain === true,
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
 * Bind one exact report to the policy subject, naming the registry release and
 * revision it was approved on. A new report, or a new revision, needs a new
 * binding: nothing here follows a release forward on its own.
 */
export function createBinding({ policy, report, releaseId, revision, boundBy, boundAt = new Date().toISOString(), note = '', storage = null, id = globalThis.crypto.randomUUID() }) {
  const normalized = normalizePolicy(policy);
  if (!verifyRun(report)) throw new Error('A binding needs an intact sealed report.');
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
export function evaluateBinding({ policy, binding, report, registry = null, observation = null, listing = null, evidence = null, now = new Date() }) {
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
      checkpoint: { registry: registry?.block ?? null, observation: observation?.finalized ?? null, listing: listing?.block ?? null },
      reviewerTrust: reviewers.basis, simulation: normalized.simulation, evaluatedAt: at.toISOString(), nextAction: NEXT_ACTION[status],
      caveat: `${normalized.simulation ? 'SIMULATED EVIDENCE: local rehearsal fixtures and an in-memory EVM; no Portaldot network was read. ' : ''}A valid result means every policy condition held at the recorded checkpoints and time. It is not a guarantee of future state, a security audit or independent review; the trusted reviewer set is the policy author's choice.`,
    };
    return freeze({ ...result, evaluationHash: fingerprint(result) });
  };
  const bindingOk = verifyBinding(binding, normalized);
  const reportOk = verifyRun(report) && report.evidenceHash === binding?.reportHash;
  if (!add('evidence.integrity', bindingOk && reportOk, bindingOk ? (reportOk ? 'binding and report verify' : 'the report is not the bound report, or fails its SHA-256') : 'the binding fails its hash or was made under another policy', 'an intact binding under this policy and its exact report', 'evidence-unverifiable')) return finish();
  add('evidence.scope', report.mode === SCOPES[normalized.evidence.scope] && report.scope === normalized.evidence.scope, `${report.mode}/${report.scope}`, normalized.evidence.scope, 'wrong-scope');
  const reportNetwork = report.network || {};
  add('target.network', Number(reportNetwork.observedChainId ?? reportNetwork.chainId) === network.chainId && lower(reportNetwork.nativeGenesisHash ?? reportNetwork.genesisHash) === network.genesisHash, `chain ${reportNetwork.observedChainId ?? reportNetwork.chainId}, genesis ${lower(reportNetwork.nativeGenesisHash ?? reportNetwork.genesisHash).slice(0, 12)}…`, `chain ${network.chainId}, genesis ${network.genesisHash.slice(0, 12)}…`, 'wrong-target');
  const input = report.input || {};
  const subjectOk = binding.subject === subject.address && (subject.kind === 'native-asset'
    ? String(input.nativeAsset?.assetId) === subject.assetId && lower(input.listing?.address) === subject.address
    : lower(input.contractAddress) === subject.address && (!subject.codeHash || lower(report.binding?.codeHash) === subject.codeHash));
  add('target.subject', subjectOk, subject.kind === 'native-asset' ? `asset ${input.nativeAsset?.assetId ?? '?'} at ${lower(input.listing?.address) || '?'}` : `contract ${lower(input.contractAddress) || '?'}${report.binding?.codeHash ? ` code ${lower(report.binding.codeHash).slice(0, 12)}…` : ''}`, subject.kind === 'native-asset' ? `asset ${subject.assetId} at ${subject.address}` : `contract ${subject.address}${subject.codeHash ? ` code ${subject.codeHash.slice(0, 12)}…` : ''}`, 'wrong-target');
  add('plan.fingerprint', report.binding?.planHash === normalized.planHash, report.binding?.planHash ?? 'none', normalized.planHash, 'plan-changed');
  add('report.status', report.status === 'passed', report.status, 'passed', 'report-not-passed');
  const reportRuntime = runtimeOf(reportNetwork);
  add('runtime.report', supported.includes(reportRuntime), reportRuntime, supported.join(' or '), 'runtime-unsupported');
  const observed = observation && !observation.error && Number.isFinite(Date.parse(observation.observedAt));
  if (add('observation.present', !!observed, observation?.error ? `error: ${observation.error}` : observation ? 'observation without a time' : 'no observation', 'a dated finalized observation of the network', 'observation-missing')) {
    const age = (at.getTime() - Date.parse(observation.observedAt)) / 1000;
    add('observation.fresh', age >= -60 && age <= normalized.evidence.maxObservationAgeSeconds, `${Math.round(age)} s old`, `at most ${normalized.evidence.maxObservationAgeSeconds} s old`, 'observation-stale');
    add('observation.network', Number(observation.chainId) === network.chainId && lower(observation.genesisHash) === network.genesisHash, `chain ${observation.chainId}, genesis ${lower(observation.genesisHash).slice(0, 12)}…`, `chain ${network.chainId}, genesis ${network.genesisHash.slice(0, 12)}…`, 'observation-mismatch');
    const current = runtimeOf(observation);
    add('runtime.current', current === reportRuntime && supported.includes(current), current, reportRuntime, 'runtime-changed');
  }
  const reportAge = (at.getTime() - Date.parse(report.completedAt)) / 1000;
  add('evidence.age', Number.isFinite(reportAge) && reportAge <= normalized.evidence.maxAgeSeconds, Number.isFinite(reportAge) ? `${Math.round(reportAge)} s since the report` : 'undated report', `at most ${normalized.evidence.maxAgeSeconds} s`, 'evidence-expired');
  const registryRead = registry && !registry.error && registry.release && typeof registry.release.exists === 'boolean';
  if (add('registry.read', !!registryRead, registry?.error ? `error: ${registry.error}` : registry ? 'read' : 'no registry read', 'releaseOf and every trusted decision through both interfaces', 'registry-unavailable')) {
    if (normalized.evidence.requireInterfacesAgree) add('registry.interfaces', registry.interfacesAgree === true, registry.interfacesAgree === true ? 'EVM RPC and ReviveApi agree' : 'the interfaces disagree', 'agreement at one finalized block', 'interfaces-disagree');
    if (add('registry.release', registry.release.exists === true, registry.release.exists ? `revision ${registry.release.revision}` : 'no release with this ID', 'the release exists', 'release-missing')) {
      if (normalized.registry.owner) add('registry.owner', lower(registry.release.owner) === normalized.registry.owner, lower(registry.release.owner), normalized.registry.owner, 'owner-mismatch');
      add('registry.revision', lower(registry.release.reportHash) === `0x${binding.reportHash}` && String(registry.release.revision) === binding.revision, `revision ${registry.release.revision}, report ${lower(registry.release.reportHash).slice(0, 14)}…`, `revision ${binding.revision}, report 0x${binding.reportHash.slice(0, 12)}…`, 'revision-superseded');
      const decisions = registry.decisions || (registry.decision ? { [lower(registry.decision.reviewer)]: registry.decision } : {});
      const unread = reviewers.trusted.filter((reviewer) => !(reviewer in decisions));
      const approved = reviewers.trusted.filter((reviewer) => decisions[reviewer]?.reviewed === true && decisions[reviewer]?.approved === true);
      const changes = reviewers.trusted.filter((reviewer) => decisions[reviewer]?.reviewed === true && decisions[reviewer]?.approved === false);
      const enough = approved.length >= reviewers.threshold;
      add('registry.approvals', enough, `${approved.length} of ${reviewers.trusted.length} trusted reviewer${reviewers.trusted.length === 1 ? '' : 's'} approved revision ${registry.release.revision}${changes.length ? `; ${changes.length} requested changes` : ''}${unread.length ? `; ${unread.length} not read` : ''}`, `at least ${reviewers.threshold}`, unread.length && !enough ? 'registry-unavailable' : changes.length ? 'approval-revoked' : 'approval-missing');
    }
  }
  if (normalized.consumer?.requireListed) {
    const listingRead = listing && !listing.error && typeof listing.listed === 'boolean';
    if (add('consumer.read', !!listingRead, listing?.error ? `error: ${listing.error}` : listing ? 'read' : 'no consumer read', 'isListed and entryOf through both interfaces', 'consumer-unavailable')) {
      if (normalized.evidence.requireInterfacesAgree) add('consumer.interfaces', listing.interfacesAgree === true, listing.interfacesAgree === true ? 'EVM RPC and ReviveApi agree' : 'the interfaces disagree', 'agreement at one finalized block', 'interfaces-disagree');
      if (add('consumer.listed', listing.listed === true, listing.listed ? 'listed' : 'not listed', 'listed', 'consumer-not-listed')) {
        const entry = listing.entry || {};
        add('consumer.entry', lower(entry.releaseId) === binding.releaseId && lower(entry.reportHash) === `0x${binding.reportHash}` && reviewers.trusted.includes(lower(entry.reviewer)), `release ${lower(entry.releaseId).slice(0, 12)}…, report ${lower(entry.reportHash).slice(0, 12)}…, reviewer ${lower(entry.reviewer)}`, `release ${binding.releaseId.slice(0, 12)}…, report 0x${binding.reportHash.slice(0, 10)}…, a trusted reviewer`, 'consumer-entry-mismatch');
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
