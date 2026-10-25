// The catalog model: a configuration, an append-only binding history and the
// catalog document wallets would read. An entry is available only when its latest
// binding evaluates to `valid` AND the entry the catalog publishes is exactly the
// entry the approved report verified; every other state keeps the entry in the
// document with its reasons, so a maintainer sees why it dropped out.
//
// The published fields (chainId, address, symbol, name, decimals, assetId) are
// derived from the approved report, never copied from the configuration alone. The
// configuration states what the maintainer intends to publish; if it differs from
// what was verified and approved, the entry is withheld and the differing field is
// named. Display-only data (`display`) is passed through and labelled unverified.
import { normalizePolicy, policyHash, verifyBinding } from '../../../lib/policy.js';
import { fingerprint, verifyRun } from '../../../lib/report.js';
import { ENTRY_FIELDS, canonicalEntry, entryIdentity, approvedEntry, compareEntry } from '../../../lib/entry.js';

export const CONFIG_SCHEMA = 'revivecheck.token-catalog-config.v1';
export const CATALOG_SCHEMA = 'revivecheck.token-catalog.v2';
export const INPUTS_SCHEMA = 'revivecheck.token-catalog-inputs.v1';
export const BINDINGS_SCHEMA = 'revivecheck.token-catalog-bindings.v1';
/** The fields acceptance covers. A catalog entry is published only when every one of them equals the approved report. */
// The published-entry invariant lives in the library (lib/entry.js) so that every
// consumer shares one implementation; the catalog re-exports it for its own callers.
export { ENTRY_FIELDS, canonicalEntry, entryIdentity, approvedEntry, compareEntry } from '../../../lib/entry.js';
const H160 = /^0x[0-9a-fA-F]{40}$/;
const lower = (value) => String(value ?? '').toLowerCase();

export function assertEntryApproved(token, report) {
  const approved = approvedEntry(report);
  if (!approved.entry) throw new Error(`Report ${report?.evidenceHash ?? '?'} approves no catalog entry: ${approved.reason}.`);
  const check = compareEntry(token, approved.entry);
  if (!check.match) throw new Error(`The configured entry for ${lower(token.address)} is not the approved entry: ${check.mismatches.map((item) => `${item.field} (configured ${JSON.stringify(item.configured)}, approved ${JSON.stringify(item.approved)})`).join('; ')}. Correct the catalog entry, or check and approve a release that carries the configured values.`);
  return approved.entry;
}

export function normalizeConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('A catalog configuration is an object.');
  if (input.schema !== CONFIG_SCHEMA) throw new Error(`A catalog configuration declares schema ${CONFIG_SCHEMA}.`);
  if (!['local', 'testnet'].includes(input.mode)) throw new Error('mode is local (simulated, in-memory) or testnet (live reads).');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('The catalog has a name.');
  const policy = normalizePolicy(input.policy);
  if ((input.mode === 'local') !== policy.simulation) throw new Error('A local catalog uses a local-rehearsal policy; a testnet catalog uses a live policy.');
  if (!Array.isArray(input.tokens) || !input.tokens.length) throw new Error('tokens lists at least one token.');
  const tokens = input.tokens.map((token) => {
    if (!H160.test(token.address || '')) throw new Error('Each token has an H160 address.');
    if (!token.symbol || !token.name || !Number.isInteger(Number(token.decimals))) throw new Error(`Token ${token.address} needs symbol, name and decimals.`);
    if (token.chainId !== undefined && Number(token.chainId) !== policy.network.chainId) throw new Error(`Token ${token.address} names chain ${token.chainId}; the policy network is ${policy.network.chainId}.`);
    const assetId = token.assetId !== undefined ? String(token.assetId) : policy.subject.kind === 'native-asset' ? policy.subject.assetId : null;
    if (policy.subject.kind === 'native-asset' && assetId !== policy.subject.assetId) throw new Error(`Token ${token.address} names asset ${assetId}; the policy subject is asset ${policy.subject.assetId}.`);
    const display = token.display && typeof token.display === 'object' && !Array.isArray(token.display) ? Object.freeze({ ...token.display }) : null;
    return { chainId: policy.network.chainId, address: lower(token.address), symbol: String(token.symbol), name: String(token.name), decimals: Number(token.decimals), ...(assetId !== null ? { assetId } : {}), ...(display ? { display } : {}) };
  });
  if (tokens.some((token) => token.address !== policy.subject.address)) throw new Error('Every token in this catalog is the policy subject; one policy per subject.');
  const roles = input.roles || {};
  for (const role of ['owner', 'reviewer', 'operator']) if (!roles[role]?.control) throw new Error(`roles.${role}.control states who controls that role (for example "project-controlled test account").`);
  if (typeof input.data !== 'string' || !input.data) throw new Error('data names the directory for bindings and catalog output.');
  const superseded = Array.isArray(input.supersededPolicies) ? input.supersededPolicies.map((item) => { if (!/^[a-f0-9]{64}$/.test(item?.policyHash || '')) throw new Error('supersededPolicies entries name a 64-hex policyHash.'); return Object.freeze({ policyHash: item.policyHash, note: String(item.note || '') }); }) : [];
  return Object.freeze({ schema: CONFIG_SCHEMA, name, mode: input.mode, roles, policy, policyHash: policyHash(input.policy), tokens, data: input.data, supersededPolicies: Object.freeze(superseded), ...(input.reports ? { reports: String(input.reports) } : {}) });
}

/** Bindings are history: appending never changes an earlier entry, and an id is used once. */
export function appendBinding(history, binding, policy) {
  if (!verifyBinding(binding, policy)) throw new Error('Only an intact binding made under this catalog policy can be appended.');
  if (history.some((entry) => entry.id === binding.id)) throw new Error(`Binding ${binding.id} already exists; a rebinding is a new entry.`);
  return Object.freeze([...history, binding]);
}

/**
 * Sort a loaded history into the bindings that speak under the current policy and
 * the ones kept from a superseded policy. A binding made under a policy the
 * configuration does not list as superseded is an error, not history.
 */
export function classifyBindings(history, config) {
  const current = [], historical = [];
  for (const binding of history) {
    if (verifyBinding(binding, config.policy)) { current.push(binding); continue; }
    if (!verifyBinding(binding)) throw new Error(`Binding ${binding?.id ?? '?'} is not intact.`);
    const superseded = config.supersededPolicies.find((item) => item.policyHash === binding.policyHash);
    if (!superseded) throw new Error(`Binding ${binding.id} was made under policy ${binding.policyHash.slice(0, 12)}…, which this configuration neither uses nor lists as superseded.`);
    historical.push(Object.freeze({ ...binding, historical: { policyHash: superseded.policyHash, note: superseded.note } }));
  }
  return { current: Object.freeze(current), historical: Object.freeze(historical) };
}

/** The binding that currently speaks for a token: the last one appended for it under the current policy. */
export const latestBinding = (history, token) => [...history].reverse().find((binding) => binding.subject === lower(token)) || null;

const ENTRY_NEXT_ACTION = 'Do not publish this entry. Correct the catalog configuration to the approved values, or check and approve a release that carries the configured values and bind that report explicitly.';
const compactBinding = (binding) => binding ? { id: binding.id, reportHash: binding.reportHash, release: binding.release, releaseId: binding.releaseId, revision: binding.revision, boundBy: binding.boundBy, boundAt: binding.boundAt, note: binding.note, storage: binding.storage, policyHash: binding.policyHash, ...(binding.historical ? { historical: binding.historical } : {}) } : null;

/**
 * The document a wallet or a DEX allow-list reads. `available` is the business
 * action: the policy evaluation is `valid` and the published entry is the approved
 * one. Each entry carries the comparison, so a reader sees which field blocked it.
 */
export function buildCatalog({ config, entries, history = null, generatedAt = new Date().toISOString() }) {
  const tokens = config.tokens.map((token) => {
    const entry = entries.find((item) => lower(item.token) === token.address) || {};
    const evaluation = entry.evaluation || null;
    const status = evaluation ? evaluation.status : 'unbound';
    const approved = entry.report ? approvedEntry(entry.report) : { entry: null, reason: entry.binding ? 'the bound report was not loaded' : 'no binding, so no approved report' };
    const check = compareEntry(token, approved.entry);
    const policyOk = evaluation?.enable === true;
    const available = policyOk && check.match;
    // Without a binding there is nothing to compare; `no-binding` already says so.
    const entryReasons = check.match || !entry.binding ? [] : approved.entry ? check.mismatches.map((item) => `entry-mismatch:${item.field}`) : ['entry-unverified'];
    const published = check.match ? approved.entry : canonicalEntry(token);
    const { display, ...configured } = token;
    return {
      ...published, ...(display ? { display: { ...display, verified: false } } : {}),
      available, status,
      reasons: [...(evaluation ? evaluation.reasons.map((reason) => reason.code) : ['no-binding']), ...entryReasons],
      nextAction: !check.match && (policyOk || !evaluation) ? ENTRY_NEXT_ACTION : evaluation?.nextAction ?? 'Bind an approved report explicitly; nothing is published before that.',
      entry: {
        source: check.match ? 'approved-report' : 'configuration (unverified; withheld)', verified: ENTRY_FIELDS, match: check.match, mismatches: check.mismatches,
        reason: check.match ? null : approved.entry ? check.reason : approved.reason,
        configured: canonicalEntry(configured), approved: approved.entry, identity: approved.entry ? entryIdentity(approved.entry) : null,
        reportHash: approved.reportHash ?? entry.binding?.reportHash ?? null, checkpoint: approved.checkpoint ?? null,
      },
      binding: compactBinding(entry.binding),
      evaluation: evaluation ? { evaluatedAt: evaluation.evaluatedAt, checkpoint: evaluation.checkpoint, evaluationHash: evaluation.evaluationHash, nextAction: evaluation.nextAction, checks: evaluation.checks.length, failed: evaluation.checks.filter((item) => item.status !== 'passed').map((item) => item.id) } : null,
    };
  });
  return {
    schema: CATALOG_SCHEMA, name: config.name, mode: config.mode, simulation: config.policy.simulation, generatedAt,
    policy: { name: config.policy.name, hash: config.policyHash, network: config.policy.network, runtime: config.policy.runtime, subject: config.policy.subject, planHash: config.policy.planHash, evidence: config.policy.evidence, reviewers: config.policy.reviewers, registry: config.policy.registry, consumer: config.policy.consumer },
    roles: config.roles,
    tokens, summary: { available: tokens.filter((token) => token.available).length, total: tokens.length },
    ...(history ? { history: { current: history.current.map(compactBinding), historical: history.historical.map(compactBinding) } } : {}),
    rule: 'An entry is available only when its latest binding evaluates to valid under this policy and the published fields equal the approved report field by field. A valid evaluation with a differing configured entry withholds the entry and names the field.',
    caveat: `${config.policy.simulation ? 'SIMULATED EVIDENCE: fixture reads and an in-memory EVM; no Portaldot network was read. ' : ''}An available entry means the policy held at the recorded checkpoints and time. The roles above say who controls each account; this catalog does not establish independent review or adoption.`,
  };
}
