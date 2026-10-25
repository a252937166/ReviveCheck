import test from 'node:test';
import assert from 'node:assert/strict';
import { listReceipt, describeListReceipt, describeReviewReceipt, RECEIPT_SCHEMA } from '../src/receipts.js';
import { NETWORKS } from '../lib/networks.js';

// Assessment 2026-10-25, A-02: a persisted Consume receipt is bound to the exact
// operation; an old receipt never marks a different consumer, network, token,
// release, revision or reviewer complete, and inclusion alone never shows Listed.
const TESTNET = NETWORKS.testnet;
const V1 = { address: '0xd0bd833b4b8658b1230a0e9a99640935b3c65819', version: 1 };
const V2 = { address: '0xedaf8a25bb583ad164a94191b762414277198df9', version: 2 };
const TOKEN = '0x00001e6100000000000000000000000000010000', OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const RELEASE = `0x${'e3'.repeat(32)}`, REPORT = 'cb'.repeat(32), REPORT2 = 'dd'.repeat(32);
const tx = { route: 'native', extrinsicHash: `0x${'11'.repeat(32)}`, blockHash: `0x${'22'.repeat(32)}`, blockNumber: '190000', success: true };
const receipt = () => listReceipt({ network: TESTNET, consumer: V2, token: TOKEN, decimals: 6, releaseId: RELEASE, reportHash: REPORT, revision: '1', reviewer: OWNER, from: '5GH8…', sender: OWNER, tx });
const context = { network: TESTNET, consumer: V2, token: TOKEN, releaseId: RELEASE, reviewer: OWNER, release: { reportHash: `0x${REPORT}`, revision: '1' } };

test('a receipt names its network, consumer, token, release, report, revision and reviewer, and refuses to be written without them', () => {
  const saved = receipt();
  assert.equal(saved.schema, RECEIPT_SCHEMA);
  assert.deepEqual(saved.network, { key: 'testnet', chainId: 420420777, genesisHash: TESTNET.genesisHash });
  assert.deepEqual(saved.consumer, V2);
  assert.equal(saved.reportHash, `0x${REPORT}`);
  assert.equal(saved.readback, null);
  assert.throws(() => listReceipt({ network: TESTNET, consumer: { address: V2.address }, token: TOKEN, releaseId: RELEASE, reportHash: REPORT, revision: '1', reviewer: OWNER, tx }), /consumer contract and its version/);
  assert.throws(() => listReceipt({ network: TESTNET, consumer: V2, token: TOKEN, releaseId: RELEASE, reportHash: REPORT, revision: '0', reviewer: OWNER, tx }), /registry revision/);
});

test('switching from v1 to v2 preserves the old receipt as history without marking v2 complete', () => {
  const onV1 = { ...receipt(), consumer: V1 };
  const described = describeListReceipt(onV1, context);
  assert.equal(described.kind, 'historical');
  assert.match(described.reasons[0], /another consumer: v1/);
  assert.equal(described.completion, 'finalized', 'the historical transaction stays finalized and linked');
  const legacy = { token: TOKEN, releaseId: RELEASE, reportHash: `0x${REPORT}`, reviewer: OWNER, tx, readback: { listed: true, interfacesAgree: true } };
  const old = describeListReceipt(legacy, context);
  assert.equal(old.kind, 'historical', 'a receipt from before receipts carried identity never completes the current operation');
  assert.match(old.reasons[0], /recorded before receipts named their network and consumer/);
});

test('changing the token, network, reviewer, report or revision invalidates current completion', () => {
  const saved = receipt();
  assert.equal(describeListReceipt(saved, context).kind, 'current');
  assert.equal(describeListReceipt(saved, { ...context, token: `0x${'ee'.repeat(20)}` }).kind, 'historical');
  assert.equal(describeListReceipt(saved, { ...context, network: NETWORKS.live }).kind, 'historical');
  assert.equal(describeListReceipt(saved, { ...context, reviewer: `0x${'ab'.repeat(20)}` }).kind, 'historical');
  assert.equal(describeListReceipt(saved, { ...context, releaseId: `0x${'ff'.repeat(32)}` }).kind, 'historical');
  const superseded = describeListReceipt(saved, { ...context, release: { reportHash: `0x${REPORT2}`, revision: '2' } });
  assert.equal(superseded.kind, 'historical');
  assert.match(superseded.reasons[0], /registry now holds revision 2/);
  assert.equal(describeListReceipt(saved, { ...context, release: null }).kind, 'current', 'without a fresh registry read the receipt is current on its own identity');
});

test('finalized inclusion without a successful matching readback never shows Listed', () => {
  const saved = receipt();
  assert.equal(describeListReceipt(saved, context).listed, null);
  assert.equal(describeListReceipt({ ...saved, readback: { listed: true, interfacesAgree: false } }, context).listed, false);
  assert.equal(describeListReceipt({ ...saved, readback: { listed: false, interfacesAgree: true } }, context).listed, false);
  assert.equal(describeListReceipt({ ...saved, readback: { listed: true, interfacesAgree: true } }, context).listed, true);
  assert.equal(describeListReceipt({ ...saved, tx: { ...tx, success: false } }, context).completion, 'failed');
});

test('a saved session keeps the distinctions after a reload, and a later revision changes eligibility without rewriting the receipt', () => {
  const saved = JSON.parse(JSON.stringify({ ...receipt(), readback: { listed: true, interfacesAgree: true, block: { number: '190001' } } }));
  assert.deepEqual(describeListReceipt(saved, context), { kind: 'current', completion: 'finalized', listed: true, reasons: [] });
  const later = describeListReceipt(saved, { ...context, release: { reportHash: `0x${REPORT2}`, revision: '2' } });
  assert.equal(later.kind, 'historical');
  assert.equal(saved.readback.listed, true, 'the receipt itself is unchanged; only its relation to the current revision changed');
  assert.equal(describeReviewReceipt({ releaseId: RELEASE, reportHash: `0x${REPORT}`, revision: '1', tx }, { releaseId: RELEASE, release: { reportHash: `0x${REPORT2}`, revision: '2' } }).kind, 'historical');
  assert.equal(describeReviewReceipt({ releaseId: RELEASE, reportHash: `0x${REPORT}`, revision: '1', tx }, { releaseId: RELEASE, release: { reportHash: `0x${REPORT}`, revision: '1' } }).kind, 'current');
});
