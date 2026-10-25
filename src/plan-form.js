// The acceptance-plan form of the local workbench, without any React: the shape the
// editor edits, and the serialization that turns it back into a plan. Every supported
// field survives the round trip (import → save → export → reload), including a
// native-asset token-list entry (`listing`); the result is validated by the same
// `normalizePlan` the server and the checker use, so an unsupported input fails with
// its field named instead of a field disappearing silently.
import { normalizePlan, normalizeListing } from '../lib/plan.js';

const firstAssertion = { id: 'value', label: 'Stored value', signature: 'value()', returns: 'uint256', args: [], expected: '42' };
export const defaults = { name: '', release: 'v0.1.0', profile: 'contract', logicalContractId: '', sourceRevision: '', account: '', contractAddress: '', expectedValue: '42', expectedChainId: 420420777, transactionHash: '', transactionBlockHash: '', assertions: [firstAssertion], nativeAsset: { assetId: '7777', holder: '' } };
/** Every plan field the form carries. `listing` is optional and belongs to the native-asset profile. */
export const PLAN_FIELDS = Object.freeze([...Object.keys(defaults), 'listing']);

export function makeForm(project = {}) {
  const plan = { ...defaults, ...project, nativeAsset: { ...defaults.nativeAsset, ...project.nativeAsset } };
  const assertions = Array.isArray(project.assertions) ? project.assertions : plan.profile === 'native-asset' ? [] : [{ ...firstAssertion, expected: project.expectedValue ?? '42' }];
  return { ...plan, listing: project.listing ? { ...project.listing } : null, assertions: assertions.map((item) => ({ ...item, argsText: JSON.stringify(item.args || []), expectedText: String(item.expected ?? '') })) };
}

export function serializePlan(form) {
  const plan = Object.fromEntries(Object.keys(defaults).map((key) => [key, form[key] ?? defaults[key]]));
  plan.expectedChainId = Number(plan.expectedChainId);
  if (!Number.isSafeInteger(plan.expectedChainId) || plan.expectedChainId <= 0) throw new Error('The expected chain ID must be a positive integer.');
  plan.assertions = (form.profile === 'native-asset' ? [] : form.assertions).map((item) => {
    let args; try { args = JSON.parse(item.argsText ?? JSON.stringify(item.args || [])); } catch { throw new Error(`Arguments for “${item.label || item.signature}” must be a JSON array.`); }
    if (!Array.isArray(args) || args.some((arg) => arg !== null && !['string', 'number', 'boolean'].includes(typeof arg))) throw new Error('Function arguments must be a JSON array of primitive values.');
    if (args.some((arg) => typeof arg === 'number' && !Number.isSafeInteger(arg))) throw new Error('Put large integer arguments in quotes to preserve precision.');
    let expected = item.expectedText ?? String(item.expected ?? '');
    if (item.returns === 'bool') { if (!['true', 'false'].includes(expected)) throw new Error('Boolean expectations must be true or false.'); expected = expected === 'true'; }
    return { id: item.id, label: item.label, signature: item.signature, returns: item.returns, args, expected };
  });
  plan.nativeAsset = plan.profile === 'native-asset' ? { assetId: String(form.nativeAsset?.assetId || '').trim(), holder: String(form.nativeAsset?.holder || '').trim() } : null;
  // A token-list entry is release content the checker verifies; it is kept, validated, and never dropped in passing.
  if (form.profile === 'native-asset' && form.listing && typeof form.listing === 'object') plan.listing = normalizeListing({ ...form.listing, chainId: form.listing.chainId ?? plan.expectedChainId }, 'native-asset');
  else if (form.listing && form.profile !== 'native-asset') throw new Error('A token-list entry belongs to the native-asset profile; remove it or switch the acceptance target.');
  // The same validation the server and the checker apply, so nothing unsupported passes silently.
  const normalized = normalizePlan(plan);
  return Object.fromEntries(PLAN_FIELDS.filter((key) => normalized[key] !== undefined).map((key) => [key, normalized[key]]));
}
