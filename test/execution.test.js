import test from 'node:test';
import assert from 'node:assert/strict';
import { TypeRegistry } from '@polkadot/types';
import { assertDryRun, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';

test('a reverted simulation never becomes an executable result', () => {
  assert.throws(() => assertDryRun({}, { result: { isOk: true, asOk: { flags: { toJSON: () => ({ bits: 1 }) } } } }), /reverted/);
  assert.throws(() => assertDryRun({}, { result: { isOk: false, asErr: 'insufficient funding' } }), /insufficient funding/);
});

test('transaction hash is durably handed to the journal before broadcast', async () => {
  const order = [];
  const tx = {
    hash: { toHex: () => '0x1234' },
    signAsync: async () => { order.push('signed'); },
    send: async callback => {
      order.push('sent');
      callback({ status: { isFinalized: true, asFinalized: { toHex: () => '0xabcd' } }, events: [{ event: { section: 'system', method: 'ExtrinsicSuccess', data: { toJSON: () => [] } } }] });
      return () => order.push('unsubscribed');
    },
  };
  const receipt = await sendFinalized({}, tx, {}, async hash => { assert.equal(hash, '0x1234'); order.push('journaled'); });
  assert.deepEqual(order, ['signed', 'journaled', 'sent', 'unsubscribed']);
  assert.equal(receipt.transactionBlockHash, '0xabcd');
});

test('journal failure prevents submission', async () => {
  let sent = false;
  const tx = { hash: { toHex: () => '0x1234' }, signAsync: async () => {}, send: async () => { sent = true; } };
  await assert.rejects(sendFinalized({}, tx, {}, async () => { throw new Error('disk full'); }), /disk full/);
  assert.equal(sent, false);
});

test('a finalized transaction without dispatch success is not accepted', async () => {
  const tx = { hash: { toHex: () => '0x1234' }, signAsync: async () => {}, send: async callback => { callback({ status: { isFinalized: true, asFinalized: { toHex: () => '0xabcd' } }, events: [] }); return () => {}; } };
  await assert.rejects(sendFinalized({}, tx, {}, async () => {}), /no explicit successful dispatch/);
});

test('finalization timeout reports an unknown outcome and does not resubmit', async () => {
  let submissions = 0;
  let unsubscribed = 0;
  const tx = { hash: { toHex: () => '0x1234' }, signAsync: async () => {}, send: async () => { submissions++; return () => unsubscribed++; } };
  await assert.rejects(sendFinalized({}, tx, {}, async () => {}, 10), /outcome unknown.*0x1234/);
  assert.equal(submissions, 1);
  assert.equal(unsubscribed, 1);
});

async function finalizedFeeReceipt(codec, { missing = false, duplicate = false } = {}) {
  const success = { event: { section: 'system', method: 'ExtrinsicSuccess', data: { toJSON: () => [] } } };
  const fee = { event: { section: 'transactionPayment', method: 'TransactionFeePaid', data: Object.assign([null, codec], { toJSON: () => [null, codec?.toJSON?.() ?? codec] }) } };
  let submissions = 0;
  const tx = { hash: { toHex: () => '0x1234' }, signAsync: async () => {}, send: async callback => {
    submissions++;
    callback({ status: { isFinalized: true, asFinalized: { toHex: () => '0xabcd' } }, events: [success, ...(missing ? [] : duplicate ? [fee, fee] : [fee])] });
    return () => {};
  } };
  const receipt = await sendFinalized({}, tx, {}, async () => {});
  assert.equal(submissions, 1);
  return receipt;
}

test('actual Balance JSON numbers retain canonical fee evidence from the original codec', async () => {
  const codec = new TypeRegistry().createType('Balance', '12341073032937');
  assert.equal(typeof codec.toJSON(), 'number');
  const receipt = await finalizedFeeReceipt(codec);
  assert.equal(typeof receipt.events[1].data[1], 'number');
  assert.equal(receipt.actualNativeFeeRaw, '12341073032937');
  const journal = { stages: [{}], actualNativeFeesRaw: '7' };
  assert.equal(recordFinalizedNativeFee(journal, receipt, 24682146065874n), null);
  assert.equal(journal.actualNativeFeesRaw, '12341073032944');
  assert.equal(journal.stages[0].actualNativeFeeRaw, '12341073032937');
  assert.equal(journal.actualFeeNeedsReconciliation, undefined);
});

test('large Balance JSON hex preserves every fee digit and cumulative accounting uses bigint', async () => {
  const raw = '340282366920938463463374607431768211455';
  const codec = new TypeRegistry().createType('Balance', raw);
  assert.match(codec.toJSON(), /^0x/);
  const receipt = await finalizedFeeReceipt(codec);
  assert.equal(receipt.actualNativeFeeRaw, raw);
  const journal = { stages: [{}], actualNativeFeesRaw: '9007199254740993' };
  assert.equal(recordFinalizedNativeFee(journal, receipt, BigInt(raw)), null);
  assert.equal(journal.actualNativeFeesRaw, (BigInt(raw) + 9007199254740993n).toString());
});

test('missing, ambiguous, primitive or invalid fee evidence requests reconciliation before another write', async () => {
  const valid = new TypeRegistry().createType('Balance', 1);
  const cases = [
    [valid, { missing: true }], [valid, { duplicate: true }],
    [12341073032937], ['0x1234'],
    [{ toString: () => '-1' }], [{ toString: () => { throw new Error('bad codec'); } }],
  ];
  for (const [codec, options] of cases) {
    const receipt = await finalizedFeeReceipt(codec, options);
    assert.equal(receipt.actualNativeFeeRaw, null);
    const journal = { stages: [{}], actualNativeFeesRaw: '7' };
    const stopReason = recordFinalizedNativeFee(journal, receipt, 100n);
    assert.match(stopReason, /Reconcile.*before sending another transaction/);
    assert.equal(journal.actualFeeNeedsReconciliation, true);
    assert.equal(journal.actualNativeFeesRaw, '7');
    assert.equal(journal.stages[0].actualNativeFeeRaw, undefined);
  }
  for (const invalid of [123, '0x123', '01', '-1', null]) {
    const journal = { stages: [{}], actualNativeFeesRaw: '0' };
    assert.match(recordFinalizedNativeFee(journal, { actualNativeFeeRaw: invalid }, 100n), /missing or invalid/);
    assert.equal(journal.actualFeeNeedsReconciliation, true);
  }
});

test('an exact zero fee is valid; a fee exceeding reserve is recorded and stops subsequent execution', async () => {
  const zero = await finalizedFeeReceipt(new TypeRegistry().createType('Balance', 0));
  const zeroJournal = { stages: [{}], actualNativeFeesRaw: '0' };
  assert.equal(recordFinalizedNativeFee(zeroJournal, zero, 0n), null);
  assert.equal(zeroJournal.actualNativeFeesRaw, '0');
  const journal = { stages: [{}], actualNativeFeesRaw: '7' };
  const stopReason = recordFinalizedNativeFee(journal, { actualNativeFeeRaw: '101' }, 100n);
  assert.match(stopReason, /exceeded.*Reconcile/);
  assert.equal(journal.budgetNeedsReconciliation, true);
  assert.equal(journal.actualNativeFeesRaw, '108');
  assert.equal(journal.stages[0].actualNativeFeeRaw, '101');
});
