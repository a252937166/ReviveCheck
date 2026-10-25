// Receipts the studio keeps in this browser. A finalized transaction is bound to the
// exact operation it performed: the network and genesis, the consumer contract and
// version, the token, the release, the exact report hash and revision, and the
// reviewer. A receipt that does not match the operation the visitor is looking at
// now is history: it stays in the ledger, linked to its block, and never marks the
// current operation complete. Transaction completion (finalized, read back) and
// current eligibility (a policy evaluation at a checkpoint) are different facts; a
// receipt records the first and says nothing about the second.
//
// The readback attached to a receipt counts only when it is provenance-matched to the
// same operation: the same consumer contract and version, the same token, and an entry
// naming the same release, exact report and reviewer, read at a finalized checkpoint at
// or after the transaction's block. A readback of another operation, an unidentified
// readback, or a readback attached to a failed transaction never shows Listed.
export const RECEIPT_SCHEMA = 'revivecheck.studio-receipt.v2';
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/;
const lower = (value) => String(value ?? '').toLowerCase();
const hash = (value) => { const text = lower(value); return text ? (text.startsWith('0x') ? text : `0x${text}`) : ''; };
const integer = (value) => { try { return value === null || value === undefined || value === '' ? null : BigInt(value); } catch { return null; } };
const shown = (value) => value === undefined ? 'missing' : typeof value === 'string' ? JSON.stringify(value) : String(value);

/**
 * The ways a readback can establish a consumer version, each kept separate: the
 * `version()` getter read through both interfaces, or the one legacy deployment whose
 * runtime code was verified, which identifies v1 and nothing later.
 */
export const VERSION_SOURCES = Object.freeze({ 'on-chain-version-getter': 'the version() getter read through both interfaces', 'known-deployment-runtime-code': 'the code-verified legacy deployment' });

/**
 * A known consumer version: a positive safe integer, given as a number or as its
 * canonical decimal string (`2` or `"2"`). Anything else (missing, null, empty,
 * boolean, non-numeric, fractional, zero, negative, padded or unsafe) is unknown and
 * never equals any expected version.
 */
export function knownVersion(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) { const number = Number(value); return Number.isSafeInteger(number) ? number : null; }
  return null;
}

/** A listing receipt, written once the `list` call is finalized. `readback` is attached after the dual-interface read. */
export function listReceipt({ network, consumer, token, decimals, releaseId, reportHash, revision, reviewer, from, sender, tx }) {
  if (!network?.genesisHash || !Number.isSafeInteger(Number(network.chainId))) throw new Error('A receipt names the network it was signed on.');
  if (!H160.test(consumer?.address || '') || knownVersion(consumer.version) === null) throw new Error('A receipt names the consumer contract and its version.');
  if (!H160.test(token || '') || !HASH.test(releaseId || '') || !HASH.test(hash(reportHash)) || !H160.test(reviewer || '')) throw new Error('A receipt names the token, release, report and reviewer.');
  if (!/^[1-9]\d*$/.test(String(revision ?? ''))) throw new Error('A receipt names the registry revision it listed on.');
  return {
    schema: RECEIPT_SCHEMA, kind: 'list', signedAt: new Date().toISOString(),
    network: { key: network.key, chainId: Number(network.chainId), genesisHash: lower(network.genesisHash) },
    consumer: { address: lower(consumer.address), version: knownVersion(consumer.version) },
    token: lower(token), decimals: Number(decimals), releaseId: lower(releaseId), reportHash: hash(reportHash), revision: String(revision), reviewer: lower(reviewer),
    from, sender: lower(sender), tx, readback: null,
  };
}

/**
 * Does the attached readback describe this receipt's operation? Missing provenance is
 * a mismatch: a readback that does not say which contract, token and entry it read
 * cannot vouch for anything. The result lists every reason it does not match.
 */
export function matchReadback(receipt, readback = receipt?.readback) {
  const reasons = [];
  if (!readback || typeof readback !== 'object') return { matched: false, present: false, reasons: ['no readback was attached'] };
  if (typeof readback.listed !== 'boolean') reasons.push('the readback carries no isListed result');
  if (!H160.test(readback.list || '')) reasons.push('the readback does not identify the consumer contract it read');
  else if (lower(readback.list) !== lower(receipt.consumer?.address)) reasons.push(`the readback is of another consumer contract (${lower(readback.list)})`);
  if (!H160.test(readback.token || '')) reasons.push('the readback does not identify the token it read');
  else if (lower(readback.token) !== lower(receipt.token)) reasons.push(`the readback is of another token (${lower(readback.token)})`);
  const identity = readback.identity;
  if (!identity || identity.error || identity.interfacesAgree !== true || !H160.test(identity.address || '')) reasons.push('the readback carries no agreeing consumer identity');
  else {
    if (lower(identity.address) !== lower(receipt.consumer?.address)) reasons.push('the readback identity names another consumer contract');
    // The version is a separate required fact: it must be known, established by a named source, and equal. Absence is never agreement.
    const expected = knownVersion(receipt.consumer?.version), observed = knownVersion(identity.version);
    if (expected === null) reasons.push(`the receipt names no known consumer version (${shown(receipt.consumer?.version)})`);
    else if (observed === null) reasons.push(`the readback identity carries no known consumer version (${shown(identity.version)}); missing version evidence does not pass as v${expected}`);
    else if (!VERSION_SOURCES[identity.versionSource]) reasons.push(`the readback identity does not say how its version was established (${shown(identity.versionSource)})`);
    else if (identity.versionSource === 'known-deployment-runtime-code' && observed !== 1) reasons.push(`the code-verified legacy deployment identifies v1 only; it cannot establish v${observed}`);
    else if (observed !== expected) reasons.push(`the readback identity is consumer version ${observed} (${VERSION_SOURCES[identity.versionSource]}), the receipt is v${expected}`);
  }
  if (readback.listed === true) {
    const entry = readback.entry;
    if (!entry || typeof entry !== 'object') reasons.push('the readback lists the token but carries no entry to match');
    else {
      if (hash(entry.releaseId) !== hash(receipt.releaseId)) reasons.push('the readback entry names another release');
      if (hash(entry.reportHash) !== hash(receipt.reportHash)) reasons.push('the readback entry names another report');
      if (lower(entry.reviewer) !== lower(receipt.reviewer)) reasons.push('the readback entry relies on another reviewer');
    }
  }
  const txBlock = integer(receipt.tx?.blockNumber), readBlock = integer(readback.block?.number);
  if (txBlock === null || readBlock === null) reasons.push('the readback or the transaction carries no block number, so the readback cannot be placed after the transaction');
  else if (readBlock < txBlock) reasons.push(`the readback was taken at #${readBlock}, before the transaction's block #${txBlock}`);
  if (readback.interfacesAgree !== true) reasons.push('the two interfaces did not agree at the readback checkpoint');
  return { matched: reasons.length === 0, present: true, reasons, block: readback.block ?? null, listed: typeof readback.listed === 'boolean' ? readback.listed : null };
}

/**
 * How a saved listing receipt relates to the operation in front of the visitor.
 * `release` is the registry's current revision when it is known; a receipt on a
 * superseded revision or report is history even when everything else matches.
 * `listed` is true only for a successful transaction with a matching readback that
 * read the token as listed through both agreeing interfaces; a failed transaction, an
 * unmatched readback or no readback leaves it false or null.
 */
export function describeListReceipt(receipt, { network, consumer, token, releaseId, reviewer, release = null } = {}) {
  if (!receipt?.tx) return { kind: 'none', completion: 'none', listed: null, reasons: [], readback: null };
  const reasons = [];
  if (receipt.schema !== RECEIPT_SCHEMA || !receipt.network?.genesisHash || !receipt.consumer?.address) reasons.push('recorded before receipts named their network and consumer; kept as history, not as a completion of the current operation');
  else {
    if (Number(receipt.network.chainId) !== Number(network?.chainId) || lower(receipt.network.genesisHash) !== lower(network?.genesisHash)) reasons.push(`signed on another network (chain ${receipt.network.chainId})`);
    const recorded = knownVersion(receipt.consumer.version), expected = knownVersion(consumer?.version);
    if (recorded === null) reasons.push(`recorded without a known consumer version (${shown(receipt.consumer.version)}); kept as history`);
    else if (lower(receipt.consumer.address) !== lower(consumer?.address) || recorded !== expected) reasons.push(`listed in another consumer: v${recorded} at ${receipt.consumer.address}`);
  }
  if (token && lower(receipt.token) !== lower(token)) reasons.push('listed another token');
  if (releaseId && lower(receipt.releaseId) !== lower(releaseId)) reasons.push('listed another release');
  if (reviewer && lower(receipt.reviewer) !== lower(reviewer)) reasons.push('relied on another reviewer');
  if (release && (hash(receipt.reportHash) !== hash(release.reportHash) || String(receipt.revision) !== String(release.revision))) reasons.push(`the registry now holds revision ${release.revision}, report ${hash(release.reportHash).slice(0, 14)}…; this receipt listed revision ${receipt.revision}`);
  const failed = receipt.tx.success === false;
  const readback = receipt.readback ? matchReadback(receipt) : null;
  return {
    kind: reasons.length ? 'historical' : 'current',
    completion: failed ? 'failed' : 'finalized',
    // Listed means a successful transaction and a matching readback through both agreeing interfaces, never inclusion alone.
    listed: failed ? false : readback ? (readback.matched ? readback.listed === true : false) : null,
    reasons,
    readback,
  };
}

/** How a saved review receipt relates to the release's current revision. */
export function describeReviewReceipt(receipt, { releaseId, release = null } = {}) {
  if (!receipt?.tx) return { kind: 'none', reasons: [] };
  const reasons = [];
  if (releaseId && lower(receipt.releaseId) !== lower(releaseId)) reasons.push('decided on another release');
  if (release && (hash(receipt.reportHash) !== hash(release.reportHash) || String(receipt.revision) !== String(release.revision))) reasons.push(`the registry now holds revision ${release.revision}; this decision was on revision ${receipt.revision}`);
  return { kind: reasons.length ? 'historical' : 'current', completion: receipt.tx.success === false ? 'failed' : 'finalized', reasons };
}
