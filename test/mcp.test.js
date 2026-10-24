import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../mcp/server.js';
import { registryInterface, REGISTRY, releaseLabel } from '../lib/registry.js';

// Offline: tool listing, schemas and the tools that need no network.
const failed = '49ea0e93c6163cb37ed5e4a1dc1f2119c8fb4ec8cb5afc3a174df3a3098de71f';
const passed = '9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661';
async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}
const json = (result) => JSON.parse(result.content[0].text);

test('the MCP server lists read-only tools with object input schemas', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['assess_promotion', 'check_release', 'compare_reports', 'evaluate_policy', 'get_report', 'list_releases', 'network_status', 'prepare_transaction', 'read_registry', 'replay_report', 'retrieve_evidence', 'token_list_status', 'verify_attestation']);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
  }
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((resource) => resource.uri).sort(), ['revivecheck://lifecycle/reference', 'revivecheck://registry']);
  const registry = JSON.parse((await client.readResource({ uri: 'revivecheck://registry' })).contents[0].text);
  assert.equal(registry.contract, REGISTRY.address);
  await client.close();
});

test('get_report and compare_reports verify published reports by fingerprint', async () => {
  const client = await connect();
  const report = json(await client.callTool({ name: 'get_report', arguments: { reportHash: passed } }));
  assert.equal(report.status, 'passed');
  assert.equal(report.integrity, 'sha-256 verified');
  assert.match(report.checkpoint.explorerUrl, /^https:\/\/scanner-testnet-v3\.portaldot\.dev\/#\/blocks\/0x/);
  const comparison = json(await client.callTool({ name: 'compare_reports', arguments: { baselineHash: failed, candidateHash: passed } }));
  assert.equal(comparison.comparisonKind, 'same-target');
  assert.equal(comparison.summary.improved, 1);
  assert.equal(comparison.baseline, undefined, 'the full reports are not echoed back');
  const missing = await client.callTool({ name: 'get_report', arguments: { reportHash: '00'.repeat(32) } });
  assert.equal(missing.isError, true);
  await client.close();
});

test('prepare_transaction builds unsigned registry calls and remarks without signing', async () => {
  const client = await connect();
  const submit = json(await client.callTool({ name: 'prepare_transaction', arguments: { action: 'submit', label: 'pusd-token-list', reportHash: passed } }));
  assert.equal(submit.to, REGISTRY.address);
  assert.deepEqual([...registryInterface.decodeFunctionData('submit', submit.data)], [releaseLabel('pusd-token-list'), `0x${passed}`]);
  assert.equal(submit.evm.method, 'eth_sendTransaction');
  assert.equal(submit.dryRun, undefined);
  const remark = json(await client.callTool({ name: 'prepare_transaction', arguments: { action: 'remark', reportHash: passed, decision: 'accepted' } }));
  assert.equal(remark.remark, `revivecheck:1:review:accepted:${passed}`);
  const invalid = await client.callTool({ name: 'prepare_transaction', arguments: { action: 'submit', label: 'x'.repeat(31) + 'yy', reportHash: passed } });
  assert.equal(invalid.isError, true);
  const store = json(await client.callTool({ name: 'prepare_transaction', arguments: { action: 'store', reportHash: passed } }));
  assert.equal(store.native.pallet, 'remark');
  assert.equal(store.sha256, passed);
  assert.match(store.contentHash, /^0x[a-f0-9]{64}$/);
  assert.ok(store.bytes > 1000);
  await client.close();
});
