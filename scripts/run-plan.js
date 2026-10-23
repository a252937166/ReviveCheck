import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateProject, projectDefaults } from '../server/store.js';
import { inspectChain } from '../lib/chain.js';
import { sealRun, overall, fingerprint } from '../lib/report.js';

const [file, ...args] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/run-plan.js <plan.json> [--out report.json]'); process.exit(2); }
try {
  const plan = { ...projectDefaults, ...validateProject(JSON.parse(await readFile(file, 'utf8'))) };
  const projectId = `cli-${fingerprint({ name: plan.name, account: plan.account, contractAddress: plan.contractAddress }).slice(0, 20)}`;
  const startedAt = new Date().toISOString();
  const result = await inspectChain(plan);
  const run = sealRun({ id: randomUUID(), projectId, projectName: plan.name, release: plan.release, input: plan, mode: 'live', scope: 'portaldot-testnet-readonly', scenario: null, startedAt, completedAt: new Date().toISOString(), previousRunId: null, status: overall(result.checks), ...result });
  const index = args.indexOf('--out');
  if (index >= 0) {
    const out = args[index + 1];
    if (!out) throw new Error('--out requires a file path');
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(run, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify(run, null, 2));
  if (run.status !== 'passed') process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
