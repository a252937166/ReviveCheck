#!/usr/bin/env node
// The example reader: a separate process that imports a catalog release, verifies it from
// the document alone, decides which entries may be used at the clock it is given, and
// fills a token selector from them. It needs the installed `revivecheck` package and the
// release file; nothing else (no network, unless --live asks for fresh reads).
//
//   node read-example.mjs <catalog-release.json> [--now <ISO>] [--live]
import { readFile } from 'node:fs/promises';
import { readCatalogRelease, selectorFrom } from 'revivecheck/catalog-release';

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
if (!file) { console.error('Usage: node read-example.mjs <catalog-release.json> [--now <ISO>] [--live]'); process.exit(3); }
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const release = JSON.parse(await readFile(file, 'utf8'));
let reads = null;
if (args.includes('--live')) {
  const service = await import('revivecheck/service');
  try { reads = {}; for (const entry of release.entries) { const evidence = release.evidence.find((item) => item.evidenceHash === entry.evidenceHash); reads[entry.address] = await service.collectPolicyInputs({ policy: evidence.policy, binding: evidence.binding }); } }
  finally { await service.closeConnections(); }
}
const result = readCatalogRelease(release, { now: option('--now') ?? new Date(), reads });
console.log(`Token selector from release ${result.version} (${String(result.releaseHash).slice(0, 12)}…), read ${result.readAt}, ${result.freshness}:`);
for (const row of selectorFrom(result)) console.log(`  [${row.selectable ? 'x' : ' '}] ${row.label}\n      ${row.reason}`);
console.log(result.ok ? 'At least one entry may be used now.' : 'Nothing in this release may be used now.');
process.exitCode = result.ok ? 0 : 1;
