import { stringToU8a, u8aToHex, u8aToString } from '@polkadot/util';
import { blake2AsHex, decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { abortable, connectNative, safeError, str } from './chain.js';
import { verifyRun } from './report.js';
import { locateExtrinsic } from './attestation.js';
import { NETWORKS } from './networks.js';

// Sealed reports stored on Portaldot itself through the native Remark module
// (remark.store). The chain keeps the bytes in the block and emits
// Remark.Stored { sender, content_hash: blake2_256(bytes) }. Anyone can retrieve a
// report from a block, recompute both hashes, and replay it.
const HASH = /^0x[0-9a-fA-F]{64}$/;
const lower = (value) => String(value ?? '').toLowerCase();

/** The bytes a wallet stores: the sealed report as compact JSON. */
export function evidenceBytes(run) {
  if (!verifyRun(run)) throw new Error('Only a sealed report whose SHA-256 verifies can be stored.');
  const bytes = stringToU8a(JSON.stringify(run));
  return { bytes, hex: u8aToHex(bytes), length: bytes.length, sha256: run.evidenceHash, contentHash: blake2AsHex(bytes, 256) };
}

/** Retrieve and verify a stored report from chain data alone. Every failed condition is reported. */
export async function retrieveEvidenceWithApi(api, { extrinsicHash, blockHash, expectedHash }, { signal } = {}) {
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
  if (!extrinsic.isSigned) return fail('The extrinsic is unsigned, so no publisher account is authenticated.');
  result.publisher = encodeAddress(decodeAddress(extrinsic.signer.toString()), 42);
  if (extrinsic.method.section !== 'remark' || extrinsic.method.method !== 'store') return fail(`The extrinsic is ${extrinsic.method.section}.${extrinsic.method.method}, not remark.store.`);
  const bytes = extrinsic.method.args[0].toU8a(true);
  result.length = bytes.length;
  result.contentHash = blake2AsHex(bytes, 256);
  const records = await abortable((await abortable(api.at(blockHash), signal)).query.system.events(), signal);
  const events = records.filter((record) => record.phase.isApplyExtrinsic && Number(record.phase.asApplyExtrinsic.toString()) === index).map((record) => record.event);
  const success = events.some((event) => event.section === 'system' && event.method === 'ExtrinsicSuccess') && !events.some((event) => event.section === 'system' && event.method === 'ExtrinsicFailed');
  if (!success) return fail('The extrinsic did not dispatch successfully.');
  const stored = events.find((event) => event.section === 'remark' && event.method === 'Stored');
  if (!stored || lower(str(stored.data[1])) !== result.contentHash || encodeAddress(decodeAddress(stored.data[0].toString()), 42) !== result.publisher) return fail('The Remark.Stored event does not match the publisher and the content hash.');
  let run;
  try { run = JSON.parse(u8aToString(bytes)); } catch { return fail('The stored bytes are not a JSON report.'); }
  if (!verifyRun(run)) return fail('The stored report fails its SHA-256 integrity check.');
  result.reportHash = run.evidenceHash;
  if (expectedHash && lower(expectedHash).replace(/^0x/, '') !== run.evidenceHash) return fail(`The stored report is ${run.evidenceHash.slice(0, 12)}…, not the expected one.`);
  result.run = run;
  if (!result.finalized) result.reasons.push('The block is not finalized yet; retrieve again shortly.');
  result.verified = result.finalized;
  return result;
}

export async function retrieveEvidence({ extrinsicHash, blockHash, expectedHash }, { network = NETWORKS.testnet, signal } = {}) {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
  let api;
  try {
    const located = blockHash ? { blockHash } : await locateExtrinsic(network, extrinsicHash, { signal: bounded });
    if (!located) return { verified: false, extrinsicHash: lower(extrinsicHash), reasons: ['The official explorer has not indexed this extrinsic yet. Supply its block hash, or try again shortly.'] };
    api = await connectNative({ signal: bounded, url: network.substrateRpcUrl });
    return await retrieveEvidenceWithApi(api, { extrinsicHash, blockHash: located.blockHash, expectedHash }, { signal: bounded });
  } catch (error) {
    return { verified: false, extrinsicHash: lower(extrinsicHash), reasons: [safeError(error)] };
  } finally { if (api) await api.disconnect().catch(() => {}); }
}
