// Offline diagnostic evidence. Uses synthetic identities; never invokes chain tools.
// Run from the ReviveCheck repository root with dependencies already installed:
// node artifacts/assessment-2026-10-25-readiness/offline-reproduction.mjs
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listReceipt, describeListReceipt } from '../../src/receipts.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const address = (value) => `0x${value.repeat(40)}`;
const hash = (value) => `0x${value.repeat(64)}`;
const network = { key: 'testnet', chainId: 420420777, genesisHash: hash('a') };
const consumer = { address: address('b'), version: 2 };
const token = address('c'), releaseId = hash('d'), reportHash = hash('e'), reviewer = address('f');
const receipt = listReceipt({
  network, consumer, token, decimals: 6, releaseId, reportHash, revision: 2,
  reviewer, from: 'synthetic-public-demo', sender: address('1'),
  tx: { success: true, blockNumber: 100 },
});
receipt.readback = {
  listed: true, interfacesAgree: true,
  address: address('2'), version: '1', token: address('3'),
  entry: { releaseId: hash('4'), reportHash: hash('5'), reviewer: address('6'), decimals: 18 },
  block: { number: 99 },
};
const context = { network, consumer, token, releaseId, reviewer, release: { reportHash, revision: 2 } };
const mismatchedReadback = describeListReceipt(receipt, context);
receipt.tx.success = false;
const failedTransaction = describeListReceipt(receipt, context);

const editorSource = await readFile(path.join(root, 'src/PlanEditor.jsx'), 'utf8');
// Extract only the existing non-JSX form functions, without importing the React UI.
const formFunctions = editorSource.slice(editorSource.indexOf('const firstAssertion='), editorSource.indexOf('export default function PlanEditor')).replaceAll('export ', '');
const { makeForm, serializePlan } = new Function(`${formFunctions}\nreturn {makeForm, serializePlan};`)();
const input = {
  name: 'Synthetic example', release: 'v1', profile: 'native-asset',
  listing: { chainId: 420420777, address: '0x00001e6100000000000000000000000000010000', symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 18 },
};
const form = makeForm(input), serialized = serializePlan(form);
const installedServer = path.resolve(root, '../revivecheck-consumer-example/node_modules/revivecheck/mcp/server.js');
const transport = new StdioClientTransport({ command: process.execPath, args: [installedServer], stderr: 'pipe' });
const client = new Client({ name: 'offline-packaged-resource-audit', version: '1.0.0' });
const resources = [];
try {
  await client.connect(transport);
  for (const resource of (await client.listResources()).resources) {
    try {
      const response = await client.readResource({ uri: resource.uri });
      resources.push({ uri: resource.uri, readable: true, contents: response.contents.length });
    } catch (error) {
      resources.push({ uri: resource.uri, readable: false, code: error.code ?? null, missingFile: /ENOENT/.test(error.message) });
    }
  }
} finally {
  await client.close();
  await transport.close();
}
const sourceHashes = {};
for (const relative of ['src/receipts.js', 'src/PlanEditor.jsx', 'src/Catalog.jsx', 'mcp/server.js', 'package.json']) {
  sourceHashes[relative] = createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex');
}
process.stdout.write(`${JSON.stringify({
  observedAt: new Date().toISOString(),
  scope: 'Offline synthetic helper inputs, extracted form functions and installed MCP resources; no chain tools or transactions.',
  sourceHashes,
  receipt: { mismatchedReadback, failedTransaction },
  plan: { formHasListing: Object.hasOwn(form, 'listing'), serializedHasListing: Object.hasOwn(serialized, 'listing') },
  installedMcpResources: resources,
}, null, 2)}\n`);
