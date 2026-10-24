// The catalog model: a configuration, an append-only binding history and the
// catalog document wallets would read. An entry is available only when its latest
// binding evaluates to `valid`; every other status keeps the entry in the document
// with its reasons, so a maintainer sees why it dropped out.
import { normalizePolicy, policyHash, verifyBinding } from '../../../lib/policy.js';

export const CONFIG_SCHEMA = 'revivecheck.token-catalog-config.v1';
export const CATALOG_SCHEMA = 'revivecheck.token-catalog.v1';
export const INPUTS_SCHEMA = 'revivecheck.token-catalog-inputs.v1';
const H160 = /^0x[0-9a-fA-F]{40}$/;
const lower = (value) => String(value ?? '').toLowerCase();

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
    return { address: lower(token.address), symbol: String(token.symbol), name: String(token.name), decimals: Number(token.decimals), ...(token.assetId !== undefined ? { assetId: String(token.assetId) } : {}) };
  });
  if (tokens.some((token) => token.address !== policy.subject.address)) throw new Error('Every token in this catalog is the policy subject; one policy per subject.');
  const roles = input.roles || {};
  for (const role of ['owner', 'reviewer', 'operator']) if (!roles[role]?.control) throw new Error(`roles.${role}.control states who controls that role (for example "project-controlled test account").`);
  if (typeof input.data !== 'string' || !input.data) throw new Error('data names the directory for bindings and catalog output.');
  return Object.freeze({ schema: CONFIG_SCHEMA, name, mode: input.mode, roles, policy, policyHash: policyHash(input.policy), tokens, data: input.data, ...(input.reports ? { reports: String(input.reports) } : {}) });
}

/** Bindings are history: appending never changes an earlier entry, and an id is used once. */
export function appendBinding(history, binding, policy) {
  if (!verifyBinding(binding, policy)) throw new Error('Only an intact binding made under this catalog policy can be appended.');
  if (history.some((entry) => entry.id === binding.id)) throw new Error(`Binding ${binding.id} already exists; a rebinding is a new entry.`);
  return Object.freeze([...history, binding]);
}

/** The binding that currently speaks for a token: the last one appended for it. */
export const latestBinding = (history, token) => [...history].reverse().find((binding) => binding.subject === lower(token)) || null;

/** The document a wallet or a DEX allow-list reads. `available` is the business action; it follows the policy evaluation and nothing else. */
export function buildCatalog({ config, entries, generatedAt = new Date().toISOString() }) {
  const tokens = config.tokens.map((token) => {
    const entry = entries.find((item) => lower(item.token) === token.address) || {};
    const evaluation = entry.evaluation || null;
    const status = evaluation ? evaluation.status : 'unbound';
    return {
      ...token, available: evaluation?.enable === true, status,
      reasons: evaluation ? evaluation.reasons.map((reason) => reason.code) : ['no-binding'],
      binding: entry.binding ? { id: entry.binding.id, reportHash: entry.binding.reportHash, release: entry.binding.release, releaseId: entry.binding.releaseId, revision: entry.binding.revision, boundBy: entry.binding.boundBy, boundAt: entry.binding.boundAt, storage: entry.binding.storage } : null,
      evaluation: evaluation ? { evaluatedAt: evaluation.evaluatedAt, checkpoint: evaluation.checkpoint, evaluationHash: evaluation.evaluationHash, nextAction: evaluation.nextAction, checks: evaluation.checks.length, failed: evaluation.checks.filter((check) => check.status !== 'passed').map((check) => check.id) } : null,
    };
  });
  return {
    schema: CATALOG_SCHEMA, name: config.name, mode: config.mode, simulation: config.policy.simulation, generatedAt,
    policy: { name: config.policy.name, hash: config.policyHash, network: config.policy.network, runtime: config.policy.runtime, evidence: config.policy.evidence, reviewers: config.policy.reviewers, registry: config.policy.registry, consumer: config.policy.consumer },
    roles: config.roles,
    tokens, summary: { available: tokens.filter((token) => token.available).length, total: tokens.length },
    caveat: `${config.policy.simulation ? 'SIMULATED EVIDENCE: fixture reads and an in-memory EVM; no Portaldot network was read. ' : ''}An available entry means the policy held at the recorded checkpoints and time. The roles above say who controls each account; this catalog does not establish independent review or adoption.`,
  };
}
