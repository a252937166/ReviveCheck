import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { replayWithClients } from '../lib/replay.js';
import { verifyRun } from '../lib/report.js';

// Review F-03 (2026-10-24): a generic contract report used to come back "reproduced" after
// checkpoint-only reads. Replay now says what it did not re-read. Offline: the clients are mocks
// that answer the checkpoint reads from the report itself and refuse every other read.
const path = new URL('../public/reports/9dd04e0685d06a1a9a0525b2b8d6ac4b259d1618184789f345a7be5e55ae0645.json', import.meta.url);

function checkpointOnlyClients(network, calls) {
  const refuse = (name) => () => { calls.refused.push(name); throw new Error(`${name} is not replayed`); };
  const at = { call: { reviveApi: { ethBlockHash: async () => network.finalizedEvmBlockHash, call: refuse('reviveApi.call') } }, query: { assets: { asset: refuse('assets.asset'), metadata: refuse('assets.metadata'), account: refuse('assets.account') } } };
  const api = { genesisHash: network.nativeGenesisHash, rpc: { chain: { getBlockHash: async () => network.finalizedNativeBlockHash, getFinalizedHead: async () => network.finalizedNativeBlockHash, getHeader: async () => ({ number: BigInt(network.finalizedBlockNumber) }) } }, at: async () => at };
  return { api, rpc: refuse('eth_call') };
}

test('a contract report with observations the replay cannot re-read comes back partial, never reproduced', async () => {
  const run = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(verifyRun(run), true, 'the retained report is unchanged');
  const calls = { refused: [] };
  const result = await replayWithClients(run, checkpointOnlyClients(run.network, calls));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.items.map((item) => item.id), ['checkpoint.native', 'checkpoint.finalized', 'checkpoint.evm']);
  assert.ok(result.items.every((item) => item.match), 'the checkpoint itself matches');
  assert.equal(result.coverage.checks, 7);
  assert.deepEqual(result.coverage.unsupported, ['account.mapping', 'account.balance', 'contract.code', 'contract.assertions', 'transaction.finality']);
  assert.deepEqual(calls.refused, [], 'no contract or asset read was attempted');
});

test('a checkpoint that no longer matches is "differs" even when coverage is partial', async () => {
  const run = JSON.parse(await readFile(path, 'utf8'));
  const calls = { refused: [] };
  const clients = checkpointOnlyClients({ ...run.network, finalizedEvmBlockHash: `0x${'ab'.repeat(32)}` }, calls);
  const result = await replayWithClients(run, clients);
  assert.equal(result.status, 'differs');
  assert.equal(result.items.find((item) => item.id === 'checkpoint.evm').match, false);
  assert.equal(result.coverage.unsupported.length, 5);
});
