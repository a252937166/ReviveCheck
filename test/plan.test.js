import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, normalizeAssertions, assertionInterface, decodeAssertion } from '../lib/plan.js';
import { compileReleaseGate } from '../scripts/compile-release-gate.js';

const address = `0x${'ab'.repeat(20)}`;
const view = { id: 'balance', label: 'Holder balance', signature: 'balanceOf(address)', returns: 'uint256', args: [address], expected: '42' };

test('legacy plans retain the contract profile and value fallback', () => {
  const plan = normalizePlan({ name: 'Legacy probe', expectedValue: '42' });
  assert.equal(plan.profile, 'contract');
  assert.equal(plan.expectedValue, '42');
  assert.deepEqual(plan.assertions, []);
});

test('scalar view plans encode calldata, normalize precise values, and decode canonical results', () => {
  const [normalized] = normalizeAssertions([{ ...view, expected: '00042' }]);
  assert.equal(normalized.expected, '42');
  const iface = assertionInterface(normalized);
  assert.equal(iface.encodeFunctionData(normalized.signature, normalized.args), `0x70a08231${address.slice(2).padStart(64, '0')}`);
  assert.equal(decodeAssertion(normalized, iface.encodeFunctionResult(normalized.signature, [42n])), '42');
  for (const [returns, expected] of [['bool', true], ['address', address], ['string', 'release verified'], ['bytes32', `0x${'12'.repeat(32)}`]]) {
    const assertion = normalizeAssertions([{ ...view, signature: 'read()', args: [], returns, expected }])[0];
    assert.equal(decodeAssertion(assertion, assertionInterface(assertion).encodeFunctionResult(assertion.signature, [expected])), expected);
  }
});

test('plans reject duplicate IDs, unsupported ABI shapes, oversized sets, and unsafe integers', () => {
  assert.throws(() => normalizeAssertions([view, view]), /unique/);
  assert.throws(() => normalizeAssertions(Array.from({ length: 9 }, (_, i) => ({ ...view, id: String(i) }))), /eight/);
  assert.throws(() => normalizeAssertions([{ ...view, signature: 'run(bytes)' }]), /scalar/);
  assert.throws(() => normalizeAssertions([{ ...view, args: [] }]), /arguments/);
  assert.throws(() => normalizeAssertions([{ ...view, expected: Number.MAX_SAFE_INTEGER + 1 }]), /safe/);
  assert.throws(() => normalizeAssertions([{ ...view, expected: String(2n ** 256n) }]), /256/);
  assert.throws(() => normalizeAssertions([{ ...view, returns: 'bool', expected: 'true' }]), /bool/);
  assert.throws(() => normalizeAssertions([{ ...view, returns: 'bytes32', expected: '0x12' }]), /32/);
  assert.throws(() => normalizeAssertions([{ ...view, args: ['https://example.com'] }]), /H160/);
});

test('malformed, noncanonical, and excessive ABI results cannot pass', () => {
  assert.throws(() => decodeAssertion(view, '0x'), /empty/);
  assert.throws(() => decodeAssertion(view, '0x2a'));
  assert.throws(() => decodeAssertion(view, `0x${'00'.repeat(64)}`), /canonical/);
  assert.throws(() => decodeAssertion({ ...view, returns: 'bool' }, `0x${'0'.repeat(63)}2`), /canonical/);
  assert.throws(() => decodeAssertion(view, `0x${'00'.repeat(16385)}`), /16 KiB/);
});

test('native-asset profile requires a valid u32 asset and accepts an empty holder for owner selection', () => {
  assert.deepEqual(normalizePlan({ profile: 'native-asset', nativeAsset: { assetId: '0007777' } }).nativeAsset, { assetId: '7777', holder: '' });
  assert.throws(() => normalizePlan({ profile: 'native-asset' }), /requires nativeAsset/);
  assert.throws(() => normalizePlan({ profile: 'native-asset', nativeAsset: { assetId: '7777' }, assertions: [view] }), /Contract assertions/);
  assert.throws(() => normalizePlan({ nativeAsset: { assetId: '4294967296' } }), /u32/);
  assert.throws(() => normalizePlan({ profile: 'custom-rpc' }), /profile/);
});

test('ReleaseGate compiles the artifact consumed by deployment and exposes review lifecycle views', async () => {
  const artifact = await compileReleaseGate();
  assert.equal(artifact.contractName, 'ReleaseGate');
  assert.equal(artifact.target, 'evm-paris');
  assert.match(artifact.sourceSha256, /^[0-9a-f]{64}$/);
  const functions = artifact.abi.filter((entry) => entry.type === 'function');
  assert.deepEqual(functions.filter((entry) => entry.stateMutability === 'view').map((entry) => entry.name).sort(), ['approved', 'owner', 'reportHash', 'reviewer', 'revision']);
  assert.deepEqual(functions.filter((entry) => entry.stateMutability === 'nonpayable').map((entry) => entry.name).sort(), ['review', 'submit']);
  assert.equal(artifact.abi.find((entry) => entry.type === 'constructor').inputs[0].type, 'address');
});
