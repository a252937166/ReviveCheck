#!/usr/bin/env node
// The MCP tools from a terminal: `npm run rc -- <tool> --key value`. Same handlers
// and input schemas as the MCP server and POST /api/tools/<name>; read-only.
import { z } from 'zod';
import { TOOLS } from '../mcp/tools.js';
import { closeConnections } from '../lib/service.js';

const [name, ...rest] = process.argv.slice(2);
const tool = TOOLS.find((item) => item.name === name);
if (!tool) {
  console.log(`Usage: npm run rc -- <tool> [--key value ...]\n\n${TOOLS.map((item) => `  ${item.name.padEnd(20)} ${item.title}`).join('\n')}\n\nValues are parsed as JSON when they can be: --approved false, --plan '{"name":"…"}'.`);
  process.exit(name && name !== '--help' ? 1 : 0);
}
const args = {};
for (let index = 0; index < rest.length; index += 1) {
  const key = rest[index].replace(/^--/, '');
  const value = rest[index + 1] === undefined || rest[index + 1].startsWith('--') ? 'true' : rest[++index];
  try { args[key] = JSON.parse(value); } catch { args[key] = value; }
  if (typeof args[key] === 'number' && !Number.isSafeInteger(args[key])) args[key] = value;
}
const parsed = z.object(tool.inputSchema).strict().safeParse(args);
try {
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '));
  console.log(JSON.stringify(await tool.run(parsed.data), null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: String(error?.message || error) }));
  process.exitCode = 1;
} finally { await closeConnections(); }
