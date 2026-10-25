// Receipts the studio keeps in this browser. A finalized transaction is bound to the
// exact operation it performed: the network and genesis, the consumer contract and
// version, the token, the release, the exact report hash and revision, and the
// reviewer. A receipt that does not match the operation the visitor is looking at
// now is history: it stays in the ledger, linked to its block, and never marks the
// current operation complete. Transaction completion (finalized, read back) and
// current eligibility (a policy evaluation at a checkpoint) are different facts; a
// receipt records the first and says nothing about the second.
export const RECEIPT_SCHEMA = 'revivecheck.studio-receipt.v2';
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/;
const lower = (value) => String(value ?? '').toLowerCase();
const hash = (value) => { const text = lower(value); return text ? (text.startsWith('0x') ? text : `0x${text}`) : ''; };

/** A listing receipt, written once the `list` call is finalized. `readback` is attached after the dual-interface read. */
export function listReceipt({ network, consumer, token, decimals, releaseId, reportHash, revision, reviewer, from, sender, tx }) {
  if (!network?.genesisHash || !Number.isSafeInteger(Number(network.chainId))) throw new Error('A receipt names the network it was signed on.');
  if (!H160.test(consumer?.address || '') || !Number.isSafeInteger(Number(consumer.version))) throw new Error('A receipt names the consumer contract and its version.');
  if (!H160.test(token || '') || !HASH.test(releaseId || '') || !HASH.test(hash(reportHash)) || !H160.test(reviewer || '')) throw new Error('A receipt names the token, release, report and reviewer.');
  if (!/^[1-9]\d*$/.test(String(revision ?? ''))) throw new Error('A receipt names the registry revision it listed on.');
  return {
    schema: RECEIPT_SCHEMA, kind: 'list', signedAt: new Date().toISOString(),
    network: { key: network.key, chainId: Number(network.chainId), genesisHash: lower(network.genesisHash) },
    consumer: { address: lower(consumer.address), version: Number(consumer.version) },
    token: lower(token), decimals: Number(decimals), releaseId: lower(releaseId), reportHash: hash(reportHash), revision: String(revision), reviewer: lower(reviewer),
    from, sender: lower(sender), tx, readback: null,
  };
}

/**
 * How a saved listing receipt relates to the operation in front of the visitor.
 * `release` is the registry's current revision when it is known; a receipt on a
 * superseded revision or report is history even when everything else matches.
 */
export function describeListReceipt(receipt, { network, consumer, token, releaseId, reviewer, release = null } = {}) {
  if (!receipt?.tx) return { kind: 'none', completion: 'none', listed: null, reasons: [] };
  const reasons = [];
  if (receipt.schema !== RECEIPT_SCHEMA || !receipt.network?.genesisHash || !receipt.consumer?.address) reasons.push('recorded before receipts named their network and consumer; kept as history, not as a completion of the current operation');
  else {
    if (Number(receipt.network.chainId) !== Number(network?.chainId) || lower(receipt.network.genesisHash) !== lower(network?.genesisHash)) reasons.push(`signed on another network (chain ${receipt.network.chainId})`);
    if (lower(receipt.consumer.address) !== lower(consumer?.address) || Number(receipt.consumer.version) !== Number(consumer?.version)) reasons.push(`listed in another consumer: v${receipt.consumer.version} at ${receipt.consumer.address}`);
  }
  if (token && lower(receipt.token) !== lower(token)) reasons.push('listed another token');
  if (releaseId && lower(receipt.releaseId) !== lower(releaseId)) reasons.push('listed another release');
  if (reviewer && lower(receipt.reviewer) !== lower(reviewer)) reasons.push('relied on another reviewer');
  if (release && (hash(receipt.reportHash) !== hash(release.reportHash) || String(receipt.revision) !== String(release.revision))) reasons.push(`the registry now holds revision ${release.revision}, report ${hash(release.reportHash).slice(0, 14)}…; this receipt listed revision ${receipt.revision}`);
  const readback = receipt.readback && typeof receipt.readback.listed === 'boolean' ? receipt.readback : null;
  return {
    kind: reasons.length ? 'historical' : 'current',
    completion: receipt.tx.success === false ? 'failed' : 'finalized',
    // Listed means a successful matching readback through both interfaces, never inclusion alone.
    listed: readback ? readback.listed === true && readback.interfacesAgree === true : null,
    reasons,
  };
}

/** How a saved review receipt relates to the release's current revision. */
export function describeReviewReceipt(receipt, { releaseId, release = null } = {}) {
  if (!receipt?.tx) return { kind: 'none', reasons: [] };
  const reasons = [];
  if (releaseId && lower(receipt.releaseId) !== lower(releaseId)) reasons.push('decided on another release');
  if (release && (hash(receipt.reportHash) !== hash(release.reportHash) || String(receipt.revision) !== String(release.revision))) reasons.push(`the registry now holds revision ${release.revision}; this decision was on revision ${receipt.revision}`);
  return { kind: reasons.length ? 'historical' : 'current', reasons };
}
