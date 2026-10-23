import { readFile } from 'node:fs/promises';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';

export function dispatchError(api, error) {
  if (error?.isModule) {
    const meta = api.registry.findMetaError(error.asModule);
    return `${meta.section}.${meta.name}: ${meta.docs.join(' ')}`;
  }
  return error?.toString?.() || 'Unknown dispatch error';
}

export async function loadTestnetSigner(file) {
  const wallet = JSON.parse(await readFile(file, 'utf8'));
  if (wallet.network !== 'portaldot-v3-testnet' || !wallet.mnemonic || !wallet.ss58Address) throw new Error('Expected an isolated Portaldot V3 testnet wallet.');
  await cryptoWaitReady();
  let signer;
  try { signer = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromUri(wallet.mnemonic); }
  catch { throw new Error('Cannot load the isolated testnet signer.'); }
  if (!Buffer.from(decodeAddress(signer.address)).equals(Buffer.from(decodeAddress(wallet.ss58Address)))) throw new Error('Wallet public address does not match its signer.');
  return signer;
}

export function assertDryRun(api, simulation, instantiate = false) {
  if (!simulation.result?.isOk) throw new Error(`Dry-run rejected: ${dispatchError(api, simulation.result?.asErr)}`);
  const result = simulation.result.asOk;
  const flags = (instantiate ? result.result.flags : result.flags).toJSON();
  if ((BigInt(flags?.bits ?? flags) & 1n) !== 0n) throw new Error('Dry-run reverted. No transaction was sent.');
  return result;
}

function canonicalNativeFee(records) {
  const paid = records.filter(({ event }) => event.section === 'transactionPayment' && event.method === 'TransactionFeePaid');
  if (paid.length !== 1) return null;
  const codec = paid[0].event.data[1];
  // Balance.toJSON() is a number for small balances and a hex string for large
  // ones. Extract from the original codec before serializing the event payload.
  // A primitive/JSON value is not a substitute for that original evidence.
  if (!codec || typeof codec !== 'object' || typeof codec.toString !== 'function') return null;
  try {
    const raw = codec.toString();
    return typeof raw === 'string' && /^\d+$/.test(raw) ? BigInt(raw).toString() : null;
  } catch { return null; }
}

// Return the stop reason so callers can durably save the finalized receipt and
// reconciliation flag before throwing. An uncertain fee never permits a write.
export function recordFinalizedNativeFee(journal, receipt, feeReserve) {
  const raw = receipt.actualNativeFeeRaw;
  if (typeof raw !== 'string' || !/^(?:0|[1-9]\d*)$/.test(raw)) {
    journal.actualFeeNeedsReconciliation = true;
    return 'Finalized transaction saved, but actual native fee evidence is missing or invalid. Reconcile the receipt before sending another transaction.';
  }
  journal.actualNativeFeesRaw = (BigInt(journal.actualNativeFeesRaw || '0') + BigInt(raw)).toString();
  journal.stages.at(-1).actualNativeFeeRaw = raw;
  if (BigInt(raw) > feeReserve) {
    journal.budgetNeedsReconciliation = true;
    return 'Finalized transaction saved; actual native fee exceeded its conservative reserve. Reconcile the cumulative budget before continuing.';
  }
  return null;
}

// The journal is persisted before submission. An interrupted submission remains
// an unknown outcome and must never be automatically retried.
export async function sendFinalized(api, tx, signer, onSigned, timeoutMs = 120_000) {
  await tx.signAsync(signer);
  const transactionHash = tx.hash.toHex();
  await onSigned(transactionHash);
  return new Promise((resolve, reject) => {
    let unsub;
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub?.();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error(`Finalization timed out; outcome unknown. Inspect ${transactionHash} before retrying.`)), timeoutMs);
    tx.send(result => {
      if (result.dispatchError) return finish(new Error(`Transaction ${transactionHash} failed: ${dispatchError(api, result.dispatchError)}`));
      if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped) return finish(new Error(`Transaction ${transactionHash}: ${result.status.type}. Inspect before retrying.`));
      if (!result.status.isFinalized) return;
      const events = result.events.map(({ event }) => ({ section: event.section, method: event.method, data: event.data.toJSON() }));
      if (!events.some(event => event.section === 'system' && event.method === 'ExtrinsicSuccess') || events.some(event => event.section === 'system' && event.method === 'ExtrinsicFailed')) return finish(new Error(`Finalized transaction ${transactionHash} has no explicit successful dispatch evidence. Inspect before retrying.`));
      finish(null, {
        transactionHash,
        transactionBlockHash: result.status.asFinalized.toHex(),
        events,
        actualNativeFeeRaw: canonicalNativeFee(result.events),
        finalizedAt: new Date().toISOString(),
      });
    }).then(value => { unsub = value; if (done) unsub(); }).catch(error => finish(error));
  });
}
