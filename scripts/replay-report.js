import { readFile, writeFile } from 'node:fs/promises';
import { replayReport } from '../lib/replay.js';
import { validateImportedRun } from '../lib/report.js';

// Re-read a published report's observations at its pinned finalized block.
// --update-ledger records the result in public/lifecycle/reference.json.
const [hash] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Pass a 64-character published report hash.');
const run = validateImportedRun(JSON.parse(await readFile(`public/reports/${hash}.json`, 'utf8')));
let replay;
for (let attempt = 1; attempt <= 3; attempt++) {
  replay = await replayReport(run);
  if (replay.status !== 'unavailable') break;
}
if (process.argv.includes('--update-ledger')) {
  const ledger = JSON.parse(await readFile('public/lifecycle/reference.json', 'utf8'));
  if (ledger.recheck?.reportHash !== hash) throw new Error('The ledger replays its passing recheck report only.');
  ledger.replay = { reportHash: hash, status: replay.status, reproduced: replay.items.filter((item) => item.match).length, total: replay.items.length, checkedAt: replay.checkedAt, error: replay.error ?? null };
  await writeFile('public/lifecycle/reference.json', `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ status: replay.status, block: replay.blockNumber, items: replay.items.map((item) => `${item.match ? 'match' : 'DIFF '} ${item.id}: ${item.recorded} → ${item.replayed}`), error: replay.error ?? null }, null, 2));
if (replay.status !== 'reproduced') process.exitCode = 2;
