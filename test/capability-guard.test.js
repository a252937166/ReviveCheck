import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizePolicy, policyHash, assertRequirementsRetained } from '../lib/policy.js';
import { loadConsumerConfig } from '../lib/catalog-release.js';

// Repair handoff 2026-10-26, R-01: a configuration that requests a policy requirement an
// implementation does not retain when it normalizes is refused at the boundary, before
// any binding or evaluation, with the requirement named. A legacy configuration without
// the option passes unchanged and keeps its fingerprint. The guard is tested against an
// adapter that behaves like the older normalizer (drops the option, keeps the old hash).
const config = JSON.parse(await readFile(new URL('../examples/release-gate-starter/project.json', import.meta.url), 'utf8'));
const LEGACY_HASH = '795942d67b86c2c9b35c07fe3e24f2d8796dbd01ea79806b35cf125aaf44f8c3'; // the starter's and the consumer's legacy policy, recorded 2026-10-25
const fresh = { ...config.policy, evidence: { ...config.policy.evidence, requireFreshSubject: true } };
/** The 0.5.0 behavior, simulated: normalize, then drop the option the older code never knew. */
const olderNormalizer = (policy) => { const normalized = normalizePolicy(policy); const { requireFreshSubject, ...evidence } = normalized.evidence; return { ...normalized, evidence }; };

test('the guard passes a legacy policy and a retained requirement, and refuses an implementation that drops a requested one', () => {
  assert.equal(policyHash(config.policy), LEGACY_HASH);
  assert.equal(assertRequirementsRetained(config.policy, normalizePolicy(config.policy)).evidence.requireFreshSubject, undefined);
  assert.equal(assertRequirementsRetained(config.policy, olderNormalizer(config.policy)).evidence.requireStoredOnChain, true, 'without the option the older normalizer is as good');
  assert.equal(assertRequirementsRetained(fresh, normalizePolicy(fresh)).evidence.requireFreshSubject, true);
  assert.throws(() => assertRequirementsRetained(fresh, olderNormalizer(fresh)), /does not retain the requested policy requirement evidence\.requireFreshSubject/);
  assert.equal(policyHash(olderNormalizer(fresh)), LEGACY_HASH, 'the older normalizer would have computed the legacy fingerprint for the stronger policy: exactly the silent weakening the guard refuses');
  assert.notEqual(policyHash(fresh), LEGACY_HASH);
  assert.equal(policyHash({ ...config.policy, evidence: { ...config.policy.evidence, requireFreshSubject: false } }), LEGACY_HASH, 'explicit false is the legacy policy');
});

test('the gate boundary accepts the fresh-subject configuration and refuses a requirement this implementation cannot support', () => {
  const loaded = loadConsumerConfig({ ...config, policy: fresh }, 'fresh');
  assert.equal(loaded.policy.evidence.requireFreshSubject, true);
  assert.notEqual(loaded.policyHash, LEGACY_HASH);
  assert.equal(loadConsumerConfig(config, 'legacy').policyHash, LEGACY_HASH);
  // A requirement no implementation knows yet: the normalizer drops it, so the boundary refuses the configuration and names the field.
  assert.throws(() => loadConsumerConfig({ ...config, policy: { ...config.policy, evidence: { ...config.policy.evidence, requireFutureCapability: true } } }, 'future'), /evidence\.requireFutureCapability/);
});
