import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { sealRun } from '../lib/report.js';
import { makeShareLink, reportFromHash, verifyReport, createReviewReceipt, verifyReviewReceipt, viewerUrl, MAX_QR_LENGTH } from '../lib/share.js';

const makeRun = () => sealRun({ id: 'public-reference', projectId: 'asset-reference', projectName: 'Native asset acceptance', release: 'v0.2.0', status: 'passed', mode: 'live', scope: 'portaldot-testnet-readonly', input: { profile: 'native-asset', nativeAsset: { assetId: '7777', holder: '' } }, checks: [{ id: 'asset.native-erc20', title: 'Native / ERC20 consistency', status: 'passed', observed: '100000000000', expected: 'Native state equals precompile' }], limitations: ['A point-in-time observation; not an audit.'] });

test('browser and server agree on report integrity and compressed link round-trips', async () => {
  const run = makeRun();
  await verifyReport(run);
  const share = await makeShareLink(run);
  const decoded = await reportFromHash(new URL(share.url).hash);
  assert.deepEqual(decoded.run, run);
  assert.equal(new URL(share.url).origin, 'https://revivecheck.axiqo.xyz');
});

test('modified report and modified review receipt cannot pass verification', async () => {
  const run = makeRun();
  await assert.rejects(verifyReport({ ...run, checks: [] }), /Integrity/);
  const review = await createReviewReceipt(run, { reviewer: 'Internal QA test', decision: 'changes-requested', comment: 'Needs another check.' });
  await verifyReviewReceipt(review, run.evidenceHash);
  await assert.rejects(verifyReviewReceipt({ ...review, decision: 'accepted' }), /changed/);
  await assert.rejects(verifyReviewReceipt(review, 'f'.repeat(64)), /different report/);
  assert.equal(review.identity, 'self-declared');
});

test('credential-bearing reports are refused before constructing a share link', async () => {
  const run = sealRun({ ...makeRun(), input: { privateKey: 'sensitive test placeholder' } });
  await assert.rejects(makeShareLink(run), /credential field/);
});

test('report QR is actually decodable and points to the intended report', async () => {
  const run = makeRun();
  const share = await makeShareLink(run);
  assert.ok(share.qrUrl.length <= MAX_QR_LENGTH);
  const png = PNG.sync.read(await QRCode.toBuffer(share.qrUrl, { errorCorrectionLevel: 'M', margin: 4, scale: 7 }));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded?.data, share.qrUrl);
  if (share.qrIncludesReport) assert.deepEqual((await reportFromHash(new URL(decoded.data).hash)).run, run);
});

test('oversized compressed input is rejected; hash-only QR makes no report claim', async () => {
  await assert.rejects(reportFromHash(`#/review?report=rc1j.${'a'.repeat(33000)}`), /too long/);
  assert.match(viewerUrl('a'.repeat(64)), /review\?hash=a{64}$/);
  assert.equal((await reportFromHash(new URL(viewerUrl('a'.repeat(64))).hash)).run, null);
});

test('resealing cannot hide an inconsistent aggregate or evidence scope', async () => {
  await assert.rejects(verifyReport(sealRun({ ...makeRun(), status: 'failed' })), /aggregate result disagrees/);
  await assert.rejects(verifyReport(sealRun({ ...makeRun(), status: { invalid: true } })), /invalid aggregate/);
  await assert.rejects(verifyReport(sealRun({ ...makeRun(), scope: 'local-rehearsal' })), /mode and scope disagree/);
});
