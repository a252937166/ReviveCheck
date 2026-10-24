import { stringToU8a, u8aToString } from '@polkadot/util';
import { blake2AsHex, decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { abortable, connectNative, safeError, str } from './chain.js';
import { NETWORKS } from './networks.js';

// A review decision recorded on-chain as System.remark_with_event. The signer is
// authenticated by the chain; the remark binds one exact report fingerprint.
export const ATTESTATION_PATTERN = /^revivecheck:1:review:(accepted|changes-requested):([a-f0-9]{64})$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const lower = (value) => String(value ?? '').toLowerCase();

export function attestationRemark({ reportHash, decision }) {
  if (!/^[a-f0-9]{64}$/.test(reportHash || '')) throw new Error('An attestation needs the exact 64-character report fingerprint.');
  if (!['accepted', 'changes-requested'].includes(decision)) throw new Error('Choose accepted or changes-requested.');
  return `revivecheck:1:review:${decision}:${reportHash}`;
}

export function parseAttestationRemark(text) {
  const match = ATTESTATION_PATTERN.exec(String(text ?? ''));
  return match ? { version: 1, decision: match[1], reportHash: match[2] } : null;
}

export const remarkDigest = (text) => blake2AsHex(stringToU8a(text), 256);

/** Find an extrinsic's block through the official explorer index. Null when it is not indexed yet. */
export async function locateExtrinsic(network, hash, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (!HASH.test(hash || '')) throw new Error('Enter a complete 0x-prefixed 32-byte extrinsic hash.');
  const response = await fetchImpl(`${network.explorerApi}/extrinsics/${lower(hash)}`, { signal, credentials: 'omit' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The explorer index returned HTTP ${response.status}.`);
  const indexer = (await response.json())?.indexer || {};
  if (!HASH.test(indexer.blockHash || '') || !Number.isSafeInteger(indexer.extrinsicIndex)) throw new Error('The explorer index did not return a block for this extrinsic.');
  return { blockHash: lower(indexer.blockHash), blockNumber: indexer.blockHeight, extrinsicIndex: indexer.extrinsicIndex };
}

function identityDisplay(value) {
  try {
    // Newer pallet-identity stores (Registration, Option<Username>); older stores Registration.
    const unwrapped = value?.isSome ? value.unwrap() : null;
    const registration = Array.isArray(unwrapped) ? unwrapped[0] : unwrapped;
    const display = registration?.info?.display;
    return display?.isRaw ? u8aToString(display.asRaw.toU8a(true)) : null;
  } catch { return null; }
}

/** Verify a remark attestation from chain data alone. Every failed condition is reported. */
export async function verifyAttestationWithApi(api, { extrinsicHash, blockHash }, { signal } = {}) {
  const result = { verified: false, extrinsicHash: lower(extrinsicHash), blockHash: lower(blockHash), reasons: [] };
  const fail = (reason) => { result.reasons.push(reason); return result; };
  if (!HASH.test(extrinsicHash || '') || !HASH.test(blockHash || '')) return fail('A complete extrinsic hash and block hash are required.');
  const header = await abortable(api.rpc.chain.getHeader(blockHash), signal);
  const number = BigInt(header.number.toString());
  result.blockNumber = number.toString();
  const canonical = lower(str(await abortable(api.rpc.chain.getBlockHash(number.toString()), signal)));
  const finalized = BigInt((await abortable(api.rpc.chain.getHeader(await abortable(api.rpc.chain.getFinalizedHead(), signal)), signal)).number.toString());
  result.finalized = canonical === lower(blockHash) && number <= finalized;
  if (canonical !== lower(blockHash)) return fail('The block is not on the canonical chain.');
  const block = await abortable(api.rpc.chain.getBlock(blockHash), signal);
  const extrinsics = block.block.extrinsics;
  const index = extrinsics.findIndex((item) => lower(str(item.hash)) === lower(extrinsicHash));
  if (index < 0) return fail('The extrinsic is not in this block.');
  result.extrinsicIndex = index;
  const extrinsic = extrinsics[index];
  const stamp = extrinsics.find((item) => item.method.section === 'timestamp' && item.method.method === 'set');
  if (stamp) result.time = new Date(Number(stamp.method.args[0].toString())).toISOString();
  if (!extrinsic.isSigned) return fail('The extrinsic is unsigned, so no reviewer account is authenticated.');
  result.reviewer = encodeAddress(decodeAddress(extrinsic.signer.toString()), 42);
  if (extrinsic.method.section !== 'system' || extrinsic.method.method !== 'remarkWithEvent') return fail(`The extrinsic is ${extrinsic.method.section}.${extrinsic.method.method}, not system.remarkWithEvent.`);
  const bytes = extrinsic.method.args[0].toU8a(true);
  result.remark = u8aToString(bytes);
  const parsed = parseAttestationRemark(result.remark);
  if (!parsed) return fail('The remark is not a ReviveCheck review attestation.');
  Object.assign(result, parsed);
  const records = await abortable((await abortable(api.at(blockHash), signal)).query.system.events(), signal);
  const events = records.filter((record) => record.phase.isApplyExtrinsic && Number(record.phase.asApplyExtrinsic.toString()) === index).map((record) => record.event);
  const success = events.some((event) => event.section === 'system' && event.method === 'ExtrinsicSuccess') && !events.some((event) => event.section === 'system' && event.method === 'ExtrinsicFailed');
  const remarked = events.find((event) => event.section === 'system' && event.method === 'Remarked');
  const digest = blake2AsHex(bytes, 256);
  result.remarkDigest = digest;
  if (!success) return fail('The extrinsic did not dispatch successfully.');
  if (!remarked || lower(str(remarked.data[1])) !== digest || encodeAddress(decodeAddress(remarked.data[0].toString()), 42) !== result.reviewer) return fail('The System.Remarked event does not match the signer and remark digest.');
  try { result.reviewerEvm = str(await abortable(api.call.reviveApi.address(result.reviewer), signal)); } catch { /* mapping is informative only */ }
  try { result.identity = api.query.identity?.identityOf ? identityDisplay(await abortable(api.query.identity.identityOf(result.reviewer), signal)) : null; } catch { result.identity = null; }
  if (!result.finalized) result.reasons.push('The block is not finalized yet; verify again shortly.');
  result.verified = result.finalized;
  return result;
}

export async function verifyAttestation({ extrinsicHash, blockHash }, { network = NETWORKS.testnet, signal } = {}) {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(26_000)]) : AbortSignal.timeout(26_000);
  let api;
  try {
    const located = blockHash ? { blockHash } : await locateExtrinsic(network, extrinsicHash, { signal: bounded });
    if (!located) return { verified: false, extrinsicHash: lower(extrinsicHash), reasons: ['The official explorer has not indexed this extrinsic yet. Supply its block hash, or try again shortly.'] };
    api = await connectNative({ signal: bounded, url: network.substrateRpcUrl });
    return await verifyAttestationWithApi(api, { extrinsicHash, blockHash: located.blockHash }, { signal: bounded });
  } catch (error) {
    return { verified: false, extrinsicHash: lower(extrinsicHash), reasons: [safeError(error)] };
  } finally { if (api) await api.disconnect().catch(() => {}); }
}
