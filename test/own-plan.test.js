import test from 'node:test';
import assert from 'node:assert/strict';
import { ownPlanDefaults, ownPlanFromForm, formFromOwnPlan, describeOwnPlan, exportOwnPlan, importOwnPlan, derivedAddress, OWN_PLAN_LIMITS, OWN_PLAN_SCHEMA } from '../src/own-plan.js';
import { demoPlan } from '../lib/demo.js';
import { buildRunBinding } from '../lib/report.js';

// Remaining fixes 2026-10-25, item 5: a public form for a visitor's own supported input.
// The effective plan is the checker's own normalized plan; its fingerprints survive export
// and import unchanged; unsupported input is refused with its field named.
const pusd = { projectName: 'pUSD token list', logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' };

test('the form builds the same effective plan and fingerprints as the demonstration release', () => {
  const plan = ownPlanFromForm(pusd);
  const demo = demoPlan('v1.0.1');
  assert.equal(plan.listing.address, demo.listing.address.toLowerCase());
  assert.equal(derivedAddress('7777'), '0x00001e6100000000000000000000000000010000');
  assert.equal(derivedAddress('4294967296'), '', 'not a u32');
  const described = describeOwnPlan(plan);
  const demoBinding = buildRunBinding({ input: demo });
  assert.equal(described.planHash, demoBinding.planHash, 'the acceptance-plan fingerprint a policy pins');
  assert.equal(described.planHash, 'ce76c98f90e2851aff534febe6c39a4802fbef32e478a665d3e4109352222191', 'the plan hash of the bound v2 report');
  assert.deepEqual(described.checks, ['network.chain-id', 'network.finalized', 'asset.native-erc20', 'token.listing']);
  assert.equal(OWN_PLAN_LIMITS.profile.supported, 'native-asset');
  assert.equal(OWN_PLAN_LIMITS.runtime.specVersion, '3002');
  assert.deepEqual(formFromOwnPlan(plan), pusd);
});

test('export then import preserves the plan and both fingerprints; an altered export is refused', () => {
  const plan = ownPlanFromForm({ ...pusd, projectName: 'My token list', release: 'v2.0.0', decimals: '18' });
  const exported = exportOwnPlan(plan);
  assert.equal(exported.schema, OWN_PLAN_SCHEMA);
  const imported = importOwnPlan(JSON.stringify(exported));
  assert.deepEqual(imported.plan, plan);
  assert.equal(imported.planHash, exported.planHash);
  assert.equal(imported.releaseArtifactHash, exported.releaseArtifactHash);
  assert.equal(imported.form.decimals, '18');
  const bare = importOwnPlan(JSON.stringify(plan));
  assert.equal(bare.planHash, exported.planHash, 'a bare plan imports too');
  const altered = { ...exported, plan: { ...exported.plan, listing: { ...exported.plan.listing, decimals: 6 } } };
  assert.throws(() => importOwnPlan(JSON.stringify(altered)), /releaseArtifactHash does not match/);
  const renamed = { ...exported, plan: { ...exported.plan, name: 'Other', logicalContractId: 'token-list:portaldot-v3:other' } };
  assert.throws(() => importOwnPlan(JSON.stringify(renamed)), /planHash .* does not match/);
  const changed = ownPlanFromForm({ ...pusd, decimals: '18' });
  assert.notEqual(describeOwnPlan(changed).releaseArtifactHash, describeOwnPlan(ownPlanFromForm(pusd)).releaseArtifactHash, 'a changed input is a different release artifact');
  assert.equal(describeOwnPlan(changed).planHash, describeOwnPlan(ownPlanFromForm(pusd)).planHash, 'the acceptance plan itself is unchanged by a listing edit');
});

test('unsupported or invalid input is refused with the field named', () => {
  assert.throws(() => ownPlanFromForm({ ...pusd, projectName: '' }), /project name/);
  assert.throws(() => ownPlanFromForm({ ...pusd, release: 'v 1' }), /release label/);
  assert.throws(() => ownPlanFromForm({ ...pusd, assetId: '0x1e61' }), /asset ID/);
  assert.throws(() => ownPlanFromForm({ ...pusd, assetId: '4294967296' }), /asset ID/);
  assert.throws(() => ownPlanFromForm({ ...pusd, decimals: '256' }), /Decimals/);
  assert.throws(() => ownPlanFromForm({ ...pusd, decimals: '' }), /Decimals/);
  assert.throws(() => ownPlanFromForm({ ...pusd, symbol: '' }), /listing\.symbol/);
  assert.throws(() => ownPlanFromForm({ ...pusd, tokenName: 'x'.repeat(65) }), /listing\.name/);
  assert.throws(() => ownPlanFromForm({ ...pusd, holder: 'not-an-address' }), /holder/);
  assert.throws(() => importOwnPlan('{'), /not valid JSON/);
  assert.throws(() => importOwnPlan('[]'), /plan object/);
  assert.throws(() => importOwnPlan(JSON.stringify({ profile: 'contract', contractAddress: `0x${'ab'.repeat(20)}`, release: 'v1', name: 'x' })), /native-asset releases only/);
  assert.throws(() => importOwnPlan(JSON.stringify({ ...ownPlanFromForm(pusd), expectedChainId: 1 })), /not the V3 testnet/);
  const plan = ownPlanFromForm(pusd);
  assert.throws(() => importOwnPlan(JSON.stringify({ ...plan, listing: { ...plan.listing, address: `0x${'ab'.repeat(20)}` } })), /not the precompile address of native asset 7777/);
  assert.throws(() => importOwnPlan(JSON.stringify({ ...plan, listing: undefined })), /listing\) is required/);
  assert.throws(() => importOwnPlan(JSON.stringify({ ...plan, nativeAsset: { assetId: 'abc' } })), /assetId/);
  assert.deepEqual(Object.keys(ownPlanDefaults), ['projectName', 'logicalContractId', 'release', 'sourceRevision', 'assetId', 'holder', 'symbol', 'tokenName', 'decimals']);
  assert.equal(ownPlanFromForm({ ...pusd, logicalContractId: '' }).logicalContractId, 'token-list:portaldot-v3:pusd-token-list', 'derived from the project name when not given');
  assert.notEqual(describeOwnPlan(ownPlanFromForm({ ...pusd, logicalContractId: '' })).planHash, describeOwnPlan(ownPlanFromForm(pusd)).planHash, 'another release line is another acceptance plan');
});
