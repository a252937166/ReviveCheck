#!/usr/bin/env node
// ReviveCheck as an MCP server over stdio. Read-only tools for Portaldot V3 release
// checks, replay, promotion, the shared ReleaseRegistry and review attestations.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.js';
import { closeConnections } from '../lib/service.js';
import pkg from '../package.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Both files are shipped in the package (`files` in package.json), so the resources resolve from an installed copy as well as from the checkout.
const RESOURCES = [
  { name: 'lifecycle-reference', uri: 'revivecheck://lifecycle/reference', file: 'public/lifecycle/reference.json', title: 'Recorded lifecycle', description: 'The reference pUSD token-list run: check, recheck, replay, ReleaseGate approval and the V3 Live promotion, with block hashes.' },
  { name: 'release-registry', uri: 'revivecheck://registry', file: 'public/lifecycle/registry.json', title: 'ReleaseRegistry', description: 'Address, deployment transaction, compiler, source hash and ABI of the shared ReleaseRegistry on the V3 testnet.' },
];

export function createServer() {
  const server = new McpServer({ name: 'revivecheck', version: pkg.version }, { instructions: 'ReviveCheck checks Portaldot V3 releases against the chain. Typical flow: check_release → replay_report → prepare_transaction (submit, then review) signed in the user\'s wallet → read_registry → assess_promotion. All tools are read-only; signing happens in the user\'s wallet.' });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }, async (args, extra) => {
      // The public nodes can take tens of seconds; a progress heartbeat keeps clients that reset their timeout on progress waiting.
      const token = extra?._meta?.progressToken;
      let beat = 0;
      const heartbeat = token === undefined ? null : setInterval(() => { extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++beat, message: 'Reading Portaldot V3…' } }).catch(() => {}); }, 8_000);
      try {
        const result = await tool.run(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: String(error?.message || error) }] };
      } finally { clearInterval(heartbeat); }
    });
  }
  for (const resource of RESOURCES) {
    server.registerResource(resource.name, resource.uri, { title: resource.title, description: resource.description, mimeType: 'application/json' }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: await readFile(path.join(root, resource.file), 'utf8') }],
    }));
  }
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  // stdout carries the protocol; route library logging (polkadot.js among others) to stderr.
  console.log = console.info = console.debug = (...args) => console.error(...args);
  const server = createServer();
  const transport = new StdioServerTransport();
  transport.onclose = () => { void closeConnections().finally(() => process.exit(0)); };
  await server.connect(transport);
  process.stdin.on('end', () => { void closeConnections().finally(() => process.exit(0)); });
}
