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
  assert.equal(describeListReceipt({ ...saved, readback: { ...matchingReadback(), interfacesAgree: false } }, context).listed, false);
  assert.equal(describeListReceipt({ ...saved, readback: { ...matchingReadback(), listed: false, entry: null } }, context).listed, false);
  assert.equal(describeListReceipt({ ...saved, readback: { listed: true, interfacesAgree: true } }, context).listed, false, 'a readback that does not say what it read vouches for nothing');
  assert.equal(describeListReceipt({ ...saved, readback: matchingReadback() }, context).listed, true);
  assert.equal(describeListReceipt({ ...saved, tx: { ...tx, success: false } }, context).completion, 'failed');
});

test('a saved session keeps the distinctions after a reload, and a later revision changes eligibility without rewriting the receipt', () => {
  const saved = JSON.parse(JSON.stringify({ ...receipt(), readback: matchingReadback() }));
  const described = describeListReceipt(saved, context);
  assert.deepEqual({ kind: described.kind, completion: described.completion, listed: described.listed, reasons: described.reasons }, { kind: 'current', completion: 'finalized', listed: true, reasons: [] });
  const later = describeListReceipt(saved, { ...context, release: { reportHash: `0x${REPORT2}`, revision: '2' } });
  assert.equal(later.kind, 'historical');
  assert.equal(saved.readback.listed, true, 'the receipt itself is unchanged; only its relation to the current revision changed');
  assert.equal(describeReviewReceipt({ releaseId: RELEASE, reportHash: `0x${REPORT}`, revision: '1', tx }, { releaseId: RELEASE, release: { reportHash: `0x${REPORT2}`, revision: '2' } }).kind, 'historical');
  assert.equal(describeReviewReceipt({ releaseId: RELEASE, reportHash: `0x${REPORT}`, revision: '1', tx }, { releaseId: RELEASE, release: { reportHash: `0x${REPORT}`, revision: '1' } }).kind, 'current');
});

// Assessment 2026-10-25, O-01: the attached readback must describe this exact operation.
// A readback of another consumer, token, release, report or reviewer, an unidentified
// readback, one taken before the transaction's block, or one attached to a failed
// transaction never completes the selected operation as Listed.
import { matchReadback } from '../src/receipts.js';
const V2_IDENTITY = { address: V2.address, interfacesAgree: true, version: 2, versionSource: 'on-chain-version-getter', evm: { version: '2' }, native: { version: '2' } };
const matchingReadback = () => ({ token: TOKEN, list: V2.address, listed: true, interfacesAgree: true, block: { number: '190003', nativeHash: `0x${'33'.repeat(32)}`, evmHash: `0x${'44'.repeat(32)}` }, entry: { releaseId: RELEASE, reportHash: `0x${REPORT}`, reviewer: OWNER }, identity: V2_IDENTITY, observedAt: '2026-10-25T12:00:00.000Z' });

test('a fully matching successful readback completes the operation as Listed', () => {
  const described = describeListReceipt({ ...receipt(), readback: matchingReadback() }, context);
  assert.deepEqual({ kind: described.kind, completion: described.completion, listed: described.listed }, { kind: 'current', completion: 'finalized', listed: true });
  assert.equal(described.readback.matched, true);
  assert.deepEqual(described.readback.reasons, []);
});

test('a readback of another operation never completes this one, and says why', () => {
  const cases = {
    'another consumer': (readback) => ({ ...readback, list: V1.address, identity: { ...V2_IDENTITY, address: V1.address } }),
    'another consumer version': (readback) => ({ ...readback, identity: { ...V2_IDENTITY, version: 1 } }),
    'another token': (readback) => ({ ...readback, token: `0x${'ee'.repeat(20)}` }),
    'another release': (readback) => ({ ...readback, entry: { ...readback.entry, releaseId: `0x${'ff'.repeat(32)}` } }),
    'another report': (readback) => ({ ...readback, entry: { ...readback.entry, reportHash: `0x${REPORT2}` } }),
    'another reviewer': (readback) => ({ ...readback, entry: { ...readback.entry, reviewer: `0x${'ab'.repeat(20)}` } }),
    'an older checkpoint': (readback) => ({ ...readback, block: { ...readback.block, number: '189999' } }),
    'no identity': (readback) => ({ ...readback, identity: { error: 'not read' } }),
    'no entry': (readback) => ({ ...readback, entry: null }),
    'no block': (readback) => ({ ...readback, block: null }),
    'absent provenance': () => ({ listed: true, interfacesAgree: true }),
    'disagreeing interfaces': (readback) => ({ ...readback, interfacesAgree: false }),
  };
  for (const [what, mutate] of Object.entries(cases)) {
    const described = describeListReceipt({ ...receipt(), readback: mutate(matchingReadback()) }, context);
    assert.equal(described.listed, false, what);
    assert.equal(described.readback.matched, false, what);
    assert.ok(described.readback.reasons.length > 0, what);
    assert.equal(described.completion, 'finalized', `${what}: the transaction itself stays a finalized fact`);
  }
  const elsewhere = describeListReceipt({ ...receipt(), readback: matchingReadback() }, { ...context, network: NETWORKS.live });
  assert.equal(elsewhere.kind, 'historical', 'a receipt signed on another network is history even with a matching readback');
});

test('a failed transaction is never Listed, whatever readback is attached', () => {
  const described = describeListReceipt({ ...receipt(), tx: { ...tx, success: false }, readback: matchingReadback() }, context);
  assert.equal(described.completion, 'failed');
  assert.equal(described.listed, false);
  assert.equal(describeReviewReceipt({ releaseId: RELEASE, reportHash: `0x${REPORT}`, revision: '1', tx: { ...tx, success: false } }, { releaseId: RELEASE }).completion, 'failed');
});

test('the assessment reproduction (a readback naming another operation and an older block, then a failed transaction) no longer reads as listed', () => {
  const address = (value) => `0x${value.repeat(40)}`, hash = (value) => `0x${value.repeat(64)}`;
  const network = { key: 'testnet', chainId: 420420777, genesisHash: hash('a') };
  const consumer = { address: address('b'), version: 2 };
  const synthetic = listReceipt({ network, consumer, token: address('c'), decimals: 6, releaseId: hash('d'), reportHash: hash('e'), revision: 2, reviewer: address('f'), from: 'synthetic', sender: address('1'), tx: { success: true, blockNumber: 100 } });
  synthetic.readback = { listed: true, interfacesAgree: true, address: address('2'), version: '1', token: address('3'), entry: { releaseId: hash('4'), reportHash: hash('5'), reviewer: address('6'), decimals: 18 }, block: { number: 99 } };
  const synthContext = { network, consumer, token: address('c'), releaseId: hash('d'), reviewer: address('f'), release: { reportHash: hash('e'), revision: 2 } };
  const mismatched = describeListReceipt(synthetic, synthContext);
  assert.equal(mismatched.kind, 'current');
  assert.equal(mismatched.listed, false);
  assert.ok(mismatched.readback.reasons.some((reason) => /another token/.test(reason)));
  assert.ok(mismatched.readback.reasons.some((reason) => /before the transaction/.test(reason)));
  synthetic.tx.success = false;
  const failed = describeListReceipt(synthetic, synthContext);
  assert.equal(failed.completion, 'failed');
  assert.equal(failed.listed, false);
  assert.equal(matchReadback(synthetic).matched, false);
});

// Remaining fixes 2026-10-25, item 2: the consumer version in the readback identity is
// a separate required fact. Only a known version established by a named source and
// equal to the receipt's version matches; absence, null or a malformed value is never
// agreement, and the code-verified legacy deployment identifies v1 only.
import { knownVersion, VERSION_SOURCES } from '../src/receipts.js';

test('a known version equal to the receipt matches in both supported representations', () => {
  for (const version of [2, '2']) {
    const described = describeListReceipt({ ...receipt(), readback: { ...matchingReadback(), identity: { ...V2_IDENTITY, version } } }, context);
    assert.equal(described.listed, true, String(version));
    assert.deepEqual(described.readback.reasons, []);
  }
  assert.equal(knownVersion(2), 2);
  assert.equal(knownVersion('2'), 2);
  assert.deepEqual(Object.keys(VERSION_SOURCES), ['on-chain-version-getter', 'known-deployment-runtime-code']);
});

test('a missing, null, empty, boolean, malformed, fractional, nonpositive, padded or unsafe version never matches, and says so', () => {
  const values = { missing: undefined, null: null, empty: '', boolean: true, malformed: 'two', hex: '0x2', fractional: 2.5, 'fractional string': '2.0', zero: 0, negative: -2, padded: '02', 'with spaces': ' 2', unsafe: 2 ** 53, 'unsafe string': '9007199254740993', NaN: NaN, object: { version: 2 } };
  for (const [what, version] of Object.entries(values)) {
    assert.equal(knownVersion(version), null, what);
    const identity = { ...V2_IDENTITY };
    if (version === undefined) delete identity.version; else identity.version = version;
    const described = describeListReceipt({ ...receipt(), readback: { ...matchingReadback(), identity } }, context);
    assert.equal(described.listed, false, what);
    assert.equal(described.readback.matched, false, what);
    assert.ok(described.readback.reasons.some((reason) => /no known consumer version/.test(reason)), `${what}: ${described.readback.reasons.join('; ')}`);
    assert.equal(described.completion, 'finalized', `${what}: the transaction stays a finalized fact`);
  }
});

test('a known different version, an unnamed source, or the legacy path claiming a later version fails', () => {
  const different = describeListReceipt({ ...receipt(), readback: { ...matchingReadback(), identity: { ...V2_IDENTITY, version: 1 } } }, context);
  assert.equal(different.listed, false);
  assert.match(different.readback.reasons[0], /consumer version 1 \(the version\(\) getter read through both interfaces\), the receipt is v2/);
  const unsourced = describeListReceipt({ ...receipt(), readback: { ...matchingReadback(), identity: { ...V2_IDENTITY, versionSource: undefined } } }, context);
  assert.equal(unsourced.listed, false);
  assert.match(unsourced.readback.reasons[0], /does not say how its version was established/);
  const legacyClaimsV2 = describeListReceipt({ ...receipt(), readback: { ...matchingReadback(), identity: { ...V2_IDENTITY, versionSource: 'known-deployment-runtime-code' } } }, context);
  assert.equal(legacyClaimsV2.listed, false);
  assert.match(legacyClaimsV2.readback.reasons[0], /identifies v1 only/);
  // The code-verified legacy path still identifies the one v1 deployment, separately.
  const onV1 = { ...receipt(), consumer: V1 };
  const legacyReadback = { ...matchingReadback(), list: V1.address, identity: { ...V2_IDENTITY, address: V1.address, version: 1, versionSource: 'known-deployment-runtime-code', evm: { version: null }, native: { version: null } } };
  assert.equal(matchReadback(onV1, legacyReadback).matched, true);
  assert.equal(describeListReceipt({ ...onV1, readback: legacyReadback }, { ...context, consumer: V1 }).listed, true);
  assert.equal(describeListReceipt({ ...onV1, readback: legacyReadback }, context).kind, 'historical', 'against the v2 operation the v1 receipt is history');
});

test('a receipt without a known consumer version is refused when written and kept as history when read', () => {
  for (const version of [undefined, null, '', 0, 'two', 2.5]) assert.throws(() => listReceipt({ network: TESTNET, consumer: { address: V2.address, version }, token: TOKEN, decimals: 6, releaseId: RELEASE, reportHash: REPORT, revision: '1', reviewer: OWNER, tx }), /consumer contract and its version/, String(version));
  const stored = { ...receipt(), consumer: { address: V2.address, version: null }, readback: matchingReadback() };
  const described = describeListReceipt(stored, context);
  assert.equal(described.kind, 'historical');
  assert.match(described.reasons[0], /recorded without a known consumer version/);
  assert.equal(described.listed, false);
  assert.ok(described.readback.reasons.some((reason) => /receipt names no known consumer version/.test(reason)));
  const nullContext = describeListReceipt(receipt(), { ...context, consumer: { address: V2.address, version: null } });
  assert.equal(nullContext.kind, 'historical', 'an unknown expected version never equals the receipt');
});
