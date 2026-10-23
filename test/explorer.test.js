import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jsQR from 'jsqr';
import { EXPLORER_NETWORK, OFFICIAL_EXPLORER_ORIGIN, EXPLORER_ROUTE_VERIFICATION, reportExplorerEvidence, isApprovedExplorerUrl, explorerQrSvgDataUrl } from '../lib/explorer.js';
import { reportHtml, verifyRun, sealRun } from '../lib/report.js';

const retained = JSON.parse(readFileSync(new URL('../public/reports/15baa9e1d2e8746bdc94b873e314a3fd839fbd52ecc13dd99470bec8444ba544.json', import.meta.url)));
const contract = `0x${'12'.repeat(20)}`, codeHash = `0x${'ab'.repeat(32)}`;
const hash = `0x${'34'.repeat(32)}`, blockHash = `0x${'56'.repeat(32)}`;
const clone = () => structuredClone(retained);
const find = (run, id) => run.checks.find((check) => check.id === id);
const item = (result, kind) => result.items.find((entry) => entry.kind === kind);
function contractRun(kind = 'native-extrinsic') {
  const run = clone();
  run.input = { profile: 'contract', account: 'observed-signer', contractAddress: contract, transactionHash: hash, transactionBlockHash: kind === 'native-extrinsic' ? blockHash : '', expectedChainId: EXPLORER_NETWORK.chainId };
  run.checks = run.checks.filter((check) => check.id !== 'asset.native-erc20');
  run.checks.push({ id: 'contract.code', status: 'passed', evidence: { address: contract, codeHash, blockTag: `0x${BigInt(run.network.finalizedBlockNumber).toString(16)}` } });
  run.checks.push({ id: 'transaction.finality', status: 'passed', evidence: { kind, hash, blockHash, blockNumber: '157425', sender: 'observed-signer', senderMatches: true, extrinsicIndex: 1, events: ['system.ExtrinsicSuccess', 'revive.Instantiated'], status: '0x1' } });
  delete run.binding;
  return run;
}

// Rasterize the actual SVG returned/exported (not a separately generated QR).
function decodeSvg(dataUrl) {
  assert.ok(dataUrl.startsWith('data:image/svg+xml;charset=utf-8,'));
  const svg = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const dimension = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)[1]);
  const scale = 8, width = dimension * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const match of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x = Number(match[1]) * scale, y = Number(match[2]) * scale;
    for (let row = y; row < y + scale; row++) for (let column = x; column < x + scale; column++) {
      const offset = (row * width + column) * 4;
      pixels[offset] = 0x18; pixels[offset + 1] = 0x35; pixels[offset + 2] = 0x7f;
    }
  }
  return jsQR(pixels, width, width)?.data;
}

test('official route evidence documents actual deployed hash router and disabled EVM routes', () => {
  assert.equal(EXPLORER_ROUTE_VERIFICATION.router, 'hash');
  assert.equal(EXPLORER_ROUTE_VERIFICATION.evmTransaction, false);
  assert.equal(EXPLORER_ROUTE_VERIFICATION.h160Contract, false);
  assert.match(EXPLORER_ROUTE_VERIFICATION.bundleSha256, /^[a-f0-9]{64}$/);
});

test('retained real public asset gets native checkpoint link and an explicitly external plain address QR', () => {
  const evidence = reportExplorerEvidence(retained);
  assert.equal(evidence.eligible, true);
  assert.equal(item(evidence, 'finalized-block').url, `${OFFICIAL_EXPLORER_ORIGIN}/#/blocks/${retained.network.finalizedNativeBlockHash}`);
  assert.ok(!item(evidence, 'finalized-block').url.includes(retained.network.finalizedEvmBlockHash));
  const precompile = item(evidence, 'native-asset-precompile');
  assert.equal(precompile.identifier, '0x00001e6100000000000000000000000000010000');
  assert.equal(precompile.url, null);
  assert.equal(precompile.qrValue, precompile.identifier);
  assert.equal(precompile.qrKind, 'identifier');
  assert.match(precompile.label, /external public precompile/);
  assert.equal(item(evidence, 'contract'), undefined);
  assert.ok(evidence.pending.some((entry) => /read-only/.test(entry.reason)));
});

test('rehearsal, unknown scope, failed identity, spoofed or inconsistent identity cannot produce any targets', () => {
  const mutations = [
    (run) => { run.mode = 'rehearsal'; },
    (run) => { run.scope = 'other'; },
    (run) => { find(run, 'network.chain-id').status = 'failed'; },
    (run) => { run.network.observedChainId = 1; },
    (run) => { run.network.nativeGenesisHash = blockHash; },
    (run) => { find(run, 'network.chain-id').evidence.nativeRuntimeChainId = '1'; },
    (run) => { find(run, 'network.chain-id').evidence.evmChainIdHex = '0x1'; },
    (run) => { delete find(run, 'network.chain-id').evidence; },
    (run) => { run.input.expectedChainId = '1'; },
    (run) => { run.binding.environment.genesisHash = blockHash; },
    (run) => { run.checks.push(structuredClone(find(run, 'network.chain-id'))); },
  ];
  for (const mutate of mutations) {
    const run = clone(); mutate(run); const evidence = reportExplorerEvidence(run);
    assert.equal(evidence.eligible, false); assert.deepEqual(evidence.items, []);
  }
  assert.equal(reportExplorerEvidence(null).eligible, false);
});

test('supplied network URLs are never trusted and a conflicting finalized checkpoint emits no target QR', () => {
  const run = clone();
  run.network.explorerUrl = 'https://evil.example'; run.network.evmRpcUrl = 'http://127.0.0.1:9999';
  assert.ok(reportExplorerEvidence(run).items.filter((entry) => entry.url).every((entry) => entry.url.startsWith(OFFICIAL_EXPLORER_ORIGIN)));
  run.network.finalizedNativeBlockHash = blockHash;
  const result = reportExplorerEvidence(run);
  assert.deepEqual(result.items.map((entry) => entry.kind), ['home']);
  assert.ok(result.pending.some((entry) => entry.kind === 'finalized-block'));
});

test('native asset QR requires an existing matching asset, exact parity and the observed adapter address', () => {
  for (const mutate of [
    (run) => { find(run, 'asset.native-erc20').evidence.nativeExists = false; },
    (run) => { find(run, 'asset.native-erc20').evidence.erc20Balance = '0'; },
    (run) => { delete find(run, 'asset.native-erc20').evidence.nativeSupply; delete find(run, 'asset.native-erc20').evidence.erc20Supply; },
    (run) => { find(run, 'asset.native-erc20').evidence.precompileAddress = contract; },
    (run) => { run.input.nativeAsset.assetId = '999'; },
    (run) => { find(run, 'asset.native-erc20').evidence.nativeBlockHash = blockHash; },
  ]) {
    const run = clone(); mutate(run);
    assert.equal(item(reportExplorerEvidence(run), 'native-asset-precompile'), undefined);
  }
});

test('contract QR encodes only the H160 backed by matching code evidence at the checkpoint', () => {
  const run = contractRun();
  const target = item(reportExplorerEvidence(run), 'contract');
  assert.equal(target.qrValue, contract); assert.equal(target.url, null); assert.equal(target.routeStatus, 'unsupported');
  for (const mutate of [
    (value) => { find(value, 'contract.code').status = 'blocked'; },
    (value) => { find(value, 'contract.code').evidence.address = retained.checks[2].evidence.precompileAddress; },
    (value) => { find(value, 'contract.code').evidence.codeHash = null; },
    (value) => { find(value, 'contract.code').evidence.blockTag = '0x1'; },
    (value) => { value.input.contractAddress = ''; },
  ]) { const changed = contractRun(); mutate(changed); assert.equal(item(reportExplorerEvidence(changed), 'contract'), undefined); }
});

test('native transaction route requires its matching successful finalized native extrinsic evidence', () => {
  const run = contractRun();
  assert.equal(item(reportExplorerEvidence(run), 'native-extrinsic').url, `${OFFICIAL_EXPLORER_ORIGIN}/#/extrinsics/${hash}`);
  for (const mutate of [
    (value) => { value.input.transactionHash = codeHash; },
    (value) => { value.input.transactionBlockHash = codeHash; },
    (value) => { find(value, 'transaction.finality').evidence.senderMatches = false; },
    (value) => { find(value, 'transaction.finality').evidence.blockNumber = '999999'; },
    (value) => { find(value, 'transaction.finality').evidence.events.push('system.ExtrinsicFailed'); },
    (value) => { find(value, 'transaction.finality').status = 'unknown'; },
  ]) { const changed = contractRun(); mutate(changed); assert.equal(item(reportExplorerEvidence(changed), 'native-extrinsic'), undefined); }
});

test('successful EVM transaction has a hash-only QR and is never routed as a native extrinsic', () => {
  const run = contractRun('evm-transaction');
  const result = reportExplorerEvidence(run), target = item(result, 'evm-transaction');
  assert.equal(target.url, null); assert.equal(target.qrKind, 'identifier'); assert.equal(target.qrValue, hash);
  assert.equal(item(result, 'native-extrinsic'), undefined);
  find(run, 'transaction.finality').evidence.status = '0x0';
  assert.equal(item(reportExplorerEvidence(run), 'evm-transaction'), undefined);
});

test('missing or partial targets never invent an address, transaction hash or link', () => {
  const run = contractRun(); run.input.contractAddress = ''; run.input.transactionHash = '';
  const result = reportExplorerEvidence(run);
  assert.deepEqual(result.items.map((entry) => entry.kind), ['home', 'finalized-block']);
  assert.ok(result.pending.some((entry) => entry.kind === 'contract'));
  assert.ok(result.pending.some((entry) => entry.kind === 'transaction'));
});

test('QR format guard permits only exact verified routes or plain complete identifiers', () => {
  for (const value of ['https://evil.example/#/blocks/' + hash, `${OFFICIAL_EXPLORER_ORIGIN}/#/tx/${hash}`, `${OFFICIAL_EXPLORER_ORIGIN}/#/accounts/${contract}`, `${OFFICIAL_EXPLORER_ORIGIN}/#/blocks/${hash}?x=1`, `ethereum:${contract}`, '0x1234', '<script>']) {
    assert.equal(isApprovedExplorerUrl(value), false);
    assert.throws(() => explorerQrSvgDataUrl(value), /not an approved/);
  }
});

test('actual generated SVG QR codes decode to the exact official URL or plain address/hash', () => {
  for (const target of [`${OFFICIAL_EXPLORER_ORIGIN}/#/extrinsics/${hash}`, contract, hash]) assert.equal(decodeSvg(explorerQrSvgDataUrl(target)), target);
});

test('HTML embeds scannable target QR codes, safe official links, and preserves sealed historical evidence', () => {
  assert.equal(verifyRun(retained), true);
  const original = JSON.stringify(retained), html = reportHtml(retained);
  assert.match(html, /Official explorer and QR targets/);
  assert.match(html, /external public precompile/);
  assert.match(html, /Explorer has no verified detail route/);
  assert.match(html, /Address only — plain text/);
  const qr = html.match(/<img src="([^"]+)"/)[1];
  assert.equal(decodeSvg(qr), retained.checks[2].evidence.precompileAddress);
  assert.equal(JSON.stringify(retained), original); assert.equal(verifyRun(retained), true);
  for (const kind of ['native-extrinsic', 'evm-transaction']) {
    const sample = contractRun(kind), rendered = reportHtml(sample);
    const decoded = [...rendered.matchAll(/<img src="([^"]+)"/g)].map((match) => decodeSvg(match[1]));
    assert.deepEqual(decoded, [contract, kind === 'native-extrinsic' ? `${OFFICIAL_EXPLORER_ORIGIN}/#/extrinsics/${hash}` : hash]);
  }
  const malicious = sealRun({ ...contractRun(), projectName: '<script>alert(1)</script>', release: '"onload="x', limitations: ['<img src=x onerror=alert(1)>'] });
  const safe = reportHtml(malicious);
  assert.ok(!safe.includes('<script>')); assert.ok(safe.includes('&lt;script&gt;'));
  assert.equal(verifyRun(malicious), true);
});

test('rehearsal HTML with declared fake identifiers contains no QR or explorer target links', () => {
  const run = contractRun(); run.mode = 'rehearsal'; run.scope = 'local-rehearsal';
  const html = reportHtml(run);
  assert.ok(!html.includes('data:image/svg+xml')); assert.ok(!html.includes(`href="${OFFICIAL_EXPLORER_ORIGIN}`));
});
