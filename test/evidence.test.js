import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stringToU8a } from '@polkadot/util';
import { blake2AsHex } from '@polkadot/util-crypto';
import { evidenceBytes } from '../lib/evidence.js';
import { listCall, tokenListInterface, decodeTokenListError, TOKEN_LIST } from '../lib/tokenlist.js';

const published = '9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661';

test('evidence bytes are the sealed report, addressed by its SHA-256 and the bytes’ blake2-256', async () => {
  const run = JSON.parse(await readFile(new URL(`../public/reports/${published}.json`, import.meta.url), 'utf8'));
  const evidence = evidenceBytes(run);
  assert.equal(evidence.sha256, published);
  assert.equal(evidence.length, stringToU8a(JSON.stringify(run)).length);
  assert.equal(evidence.contentHash, blake2AsHex(evidence.bytes, 256));
  assert.match(evidence.hex, /^0x[0-9a-f]+$/);
  assert.throws(() => evidenceBytes({ ...run, status: 'passed', checks: [] }), /SHA-256 verifies/);
});

test('the token-list client encodes list calls the contract decodes, and names its errors', () => {
  assert.match(TOKEN_LIST.address, /^0x[0-9a-f]{40}$/);
  const call = listCall({ token: '0x00001E6100000000000000000000000000010000', releaseId: `0x${'ab'.repeat(32)}`, reportHash: `0x${'cd'.repeat(32)}`, reviewer: `0x${'01'.repeat(20)}`, decimals: 6 });
  const decoded = tokenListInterface.decodeFunctionData('list', call.data);
  assert.equal(decoded[0].toLowerCase(), '0x00001e6100000000000000000000000000010000');
  assert.equal(decoded[4], 6n);
  assert.throws(() => listCall({ token: 'nope', releaseId: `0x${'ab'.repeat(32)}`, reportHash: `0x${'cd'.repeat(32)}`, reviewer: `0x${'01'.repeat(20)}`, decimals: 6 }), /H160/);
  assert.equal(decodeTokenListError(tokenListInterface.encodeErrorResult('DecimalsMismatch', [18])), 'DecimalsMismatch');
  assert.equal(decodeTokenListError(tokenListInterface.encodeErrorResult('ReleaseNotApproved', [`0x${'ab'.repeat(32)}`])), 'ReleaseNotApproved');
});
