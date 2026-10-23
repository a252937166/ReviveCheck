import { readFile } from 'node:fs/promises';
import { verifyRun } from '../lib/report.js';
const file = process.argv[2];
if (!file) { process.stderr.write('Usage: node scripts/verify-report.js <exported-report.json>\n'); process.exit(2); }
try {
  const run = JSON.parse(await readFile(file, 'utf8'));
  const valid = verifyRun(run);
  process.stdout.write(JSON.stringify({ valid, id: run.id, scope: run.scope, status: run.status, caveat: 'Integrity only; this does not authenticate RPC responses or establish security.' }, null, 2) + '\n');
  if (!valid) process.exitCode = 1;
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
