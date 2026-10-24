import { Interface } from 'ethers';
import { decodeAddress } from '@polkadot/util-crypto';

const H160 = /^0x[0-9a-fA-F]{40}$/;
const TYPES = new Set(['uint256', 'address', 'bool', 'string', 'bytes32']);
const SIGNATURE = /^([A-Za-z_][A-Za-z0-9_]*)\(((?:(?:uint256|address|bool|string|bytes32)(?:,(?:uint256|address|bool|string|bytes32))*)?)\)$/;

export function normalizeScalar(type, value) {
  if (type === 'uint256') {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error('uint256 numbers must be safe nonnegative integers; use decimal strings');
    if (!['string', 'number', 'bigint'].includes(typeof value) || !/^\d+$/.test(String(value)) || BigInt(value) >= 2n ** 256n) throw new Error('uint256 requires a decimal value within 256 bits');
    return BigInt(value).toString();
  }
  if (type === 'address') {
    if (typeof value !== 'string' || !H160.test(value)) throw new Error('address requires a complete H160 hex address');
    return value.toLowerCase();
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new Error('bool requires true or false');
    return value;
  }
  if (type === 'bytes32') {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('bytes32 requires exactly 32 hex bytes');
    return value.toLowerCase();
  }
  if (type === 'string') {
    if (typeof value !== 'string' || value.length > 1024) throw new Error('string values must contain at most 1024 characters');
    return value;
  }
  throw new Error('Unsupported ABI scalar type');
}

export function assertionInterface(assertion) {
  return new Interface([`function ${assertion.signature} view returns (${assertion.returns})`]);
}

export function decodeAssertion(assertion, data) {
  if (typeof data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(data) || data.length > 32770) throw new Error('View response is empty, malformed, or exceeds 16 KiB');
  const iface = assertionInterface(assertion);
  const decoded = iface.decodeFunctionResult(assertion.signature, data);
  // Reject truncated/noncanonical bool/address words and unused trailing data.
  if (iface.encodeFunctionResult(assertion.signature, decoded).toLowerCase() !== data.toLowerCase()) throw new Error('View response is not canonical ABI data');
  return normalizeScalar(assertion.returns, decoded[0]);
}

export function normalizeAssertions(assertions = []) {
  if (!Array.isArray(assertions) || assertions.length > 8) throw new Error('assertions must be an array with at most eight entries');
  const ids = new Set();
  return assertions.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each assertion must be an object');
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(item.id) || ids.has(item.id)) throw new Error('Assertion IDs must be unique stable identifiers');
    ids.add(item.id);
    if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 120) throw new Error('Assertion labels must contain 1–120 characters');
    const match = typeof item.signature === 'string' && item.signature.length <= 160 && item.signature.match(SIGNATURE);
    if (!match || !TYPES.has(item.returns)) throw new Error('Views accept scalar uint256/address/bool/string/bytes32 ABI signatures and one supported return value');
    const inputs = match[2] ? match[2].split(',') : [];
    if (inputs.length > 4 || !Array.isArray(item.args) || item.args.length !== inputs.length) throw new Error('View arguments must match the signature, with at most four scalar arguments');
    const normalized = { id: item.id, label: item.label.trim(), signature: item.signature, returns: item.returns, args: inputs.map((type, i) => normalizeScalar(type, item.args[i])), expected: normalizeScalar(item.returns, item.expected) };
    assertionInterface(normalized).encodeFunctionData(normalized.signature, normalized.args);
    return normalized;
  });
}

export function normalizePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Plan must be an object');
  const profile = input.profile ?? 'contract';
  if (!['contract', 'native-asset'].includes(profile)) throw new Error('profile must be contract or native-asset');
  for (const key of ['logicalContractId', 'sourceRevision']) if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 200)) throw new Error(`${key} must be a string with at most 200 characters`);
  const plan = { ...input, profile, logicalContractId: input.logicalContractId ?? '', sourceRevision: input.sourceRevision ?? '', assertions: normalizeAssertions(input.assertions) };
  if (input.nativeAsset !== undefined && input.nativeAsset !== null) {
    const asset = input.nativeAsset;
    if (typeof asset !== 'object' || Array.isArray(asset) || typeof asset.assetId !== 'string' || !/^\d+$/.test(asset.assetId) || BigInt(asset.assetId) > 0xffffffffn) throw new Error('nativeAsset.assetId must be a u32 decimal string');
    const holder = asset.holder ?? '';
    if (typeof holder !== 'string') throw new Error('nativeAsset.holder must be a native SS58 or H160 address');
    if (holder && !H160.test(holder) && decodeAddress(holder).length !== 32) throw new Error('nativeAsset.holder must identify AccountId32');
    plan.nativeAsset = { assetId: BigInt(asset.assetId).toString(), holder };
  } else delete plan.nativeAsset;
  if (profile === 'native-asset' && !plan.nativeAsset) throw new Error('native-asset profile requires nativeAsset');
  if (profile === 'native-asset' && plan.assertions.length) throw new Error('Contract assertions require the contract profile; native-asset runs the dedicated parity checks');
  if (input.listing !== undefined && input.listing !== null) plan.listing = normalizeListing(input.listing, profile);
  else delete plan.listing;
  return plan;
}

// A released token-list entry is checked against the chain; its claims are release content, not expectations.
export function normalizeListing(listing, profile = 'native-asset') {
  if (profile !== 'native-asset') throw new Error('A token-list entry requires the native-asset profile');
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) throw new Error('listing must be a token-list entry object');
  const chainId = Number(listing.chainId), decimals = Number(listing.decimals);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('listing.chainId must be a positive integer');
  if (typeof listing.address !== 'string' || !H160.test(listing.address)) throw new Error('listing.address must be a complete H160 address');
  for (const key of ['symbol', 'name']) if (typeof listing[key] !== 'string' || !listing[key].trim() || listing[key].length > 64) throw new Error(`listing.${key} must contain 1–64 characters`);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('listing.decimals must be an integer from 0 to 255');
  return { chainId, address: listing.address.toLowerCase(), symbol: listing.symbol, name: listing.name, decimals };
}

export const validatePlan = normalizePlan;
