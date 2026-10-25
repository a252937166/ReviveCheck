import test from 'node:test';
import assert from 'node:assert/strict';
import { makeForm, serializePlan, PLAN_FIELDS } from '../src/plan-form.js';
import { normalizePlan } from '../lib/plan.js';
import { acceptancePlan, fingerprint } from '../lib/report.js';
import { demoPlan } from '../lib/demo.js';

// Assessment 2026-10-25, O-04: plan serialization preserved only the editor's default
// keys and dropped a native-asset token-list entry (`listing`). Import → save → export →
// reload must keep every supported claim and the normalized plan identity.
const listing = { chainId: 420420777, address: '0x00001e6100000000000000000000000000010000', symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 18 };
const imported = { name: 'Synthetic example', release: 'v1', profile: 'native-asset', logicalContractId: 'token-list:example', nativeAsset: { assetId: '7777', holder: '' }, listing };

test('a native-asset plan keeps its listing claim through the form round trip, and the plan identity is unchanged', () => {
  const first = serializePlan(makeForm(imported));
  assert.deepEqual(first.listing, { ...listing, address: listing.address.toLowerCase() });
  const reloaded = serializePlan(makeForm(JSON.parse(JSON.stringify(first))));
  assert.deepEqual(reloaded, first);
  assert.equal(fingerprint(acceptancePlan(reloaded)), fingerprint(acceptancePlan(normalizePlan(imported))));
  assert.ok(PLAN_FIELDS.includes('listing'));
  assert.equal(first.listing.decimals, 18, 'the claim reaches the checker as written; the checker, not the editor, decides whether it holds');
});

test('the demo plans round-trip unchanged, and a contract plan carries no listing', () => {
  for (const version of ['v1.0.0', 'v1.0.1']) {
    const plan = demoPlan(version);
    const serialized = serializePlan(makeForm(plan));
    assert.deepEqual(serialized.listing, { ...plan.listing, address: plan.listing.address.toLowerCase() });
    assert.equal(serialized.profile, 'native-asset');
    assert.equal(fingerprint(acceptancePlan(serialized)), fingerprint(acceptancePlan(normalizePlan(plan))));
  }
  const contract = serializePlan(makeForm({ name: 'Contract', release: 'v0.1.0', profile: 'contract', contractAddress: `0x${'ab'.repeat(20)}` }));
  assert.equal('listing' in contract, false);
  assert.equal(contract.assertions.length, 1);
});

test('unsupported input fails with its field named instead of disappearing', () => {
  assert.throws(() => serializePlan(makeForm({ ...imported, listing: { ...listing, decimals: 300 } })), /listing\.decimals/);
  assert.throws(() => serializePlan(makeForm({ ...imported, listing: { ...listing, address: 'not-an-address' } })), /listing\.address/);
  assert.throws(() => serializePlan(makeForm({ ...imported, profile: 'contract', listing })), /native-asset profile/);
  assert.throws(() => serializePlan(makeForm({ ...imported, expectedChainId: 'abc' })), /chain ID/);
  assert.throws(() => serializePlan(makeForm({ ...imported, nativeAsset: { assetId: 'x', holder: '' } })), /assetId/);
});
