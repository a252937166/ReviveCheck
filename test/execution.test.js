import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDryRun, sendFinalized } from '../lib/execution.js';

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
