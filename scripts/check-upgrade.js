import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUpgrade } from '../lib/baseline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const usage = 'Usage: node scripts/check-upgrade.js [--baseline public/baselines/current-2026-10-23.json] [--report report.json] [--out-dir artifacts/local/upgrade-checks] [--timeout-ms 45000] [--previous-result saved.result.json] [--force]';
try {
  if (args.includes('--help')) { console.log(usage); process.exit(0); }
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (flags.has(key)) throw new Error(usage);
    if (key === '--force') { flags.set(key, true); continue; }
    if (!['--baseline', '--report', '--out-dir', '--timeout-ms', '--previous-result'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(usage);
    flags.set(key, args[++i]);
  }
  const timeout = Number(flags.get('--timeout-ms') || 45000);
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 60000) throw new Error('--timeout-ms must be 1000–60000.');
  const baselineFile = path.resolve(flags.get('--baseline') || path.join(root, 'public/baselines/current-2026-10-23.json'));
  const manifest = JSON.parse(await readFile(baselineFile, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(manifest.reportHash)) throw new Error('Baseline report hash is invalid.');
  const reportFile = flags.has('--report') ? path.resolve(flags.get('--report')) : path.resolve(path.dirname(baselineFile), '../reports', `${manifest.reportHash}.json`);
  const baseline = JSON.parse(await readFile(reportFile, 'utf8'));
  const previousFile = flags.has('--previous-result') ? path.resolve(flags.get('--previous-result')) : null;
  const previousResult = previousFile && !flags.has('--force') ? JSON.parse(await readFile(previousFile, 'utf8')) : undefined;
  const result = await checkUpgrade(manifest, baseline, { signal: AbortSignal.timeout(timeout), previousResult, force: flags.has('--force') });
  let artifacts;
  if (result.changes?.length && !result.previousResultUsed) {
    const outDir = path.resolve(flags.get('--out-dir') || path.join(root, 'artifacts/local/upgrade-checks'));
    await mkdir(outDir, { recursive: true });
    const stem = `${result.checkedAt.replace(/[:.]/g, '-')}-${result.run?.id || randomUUID()}`;
    artifacts = {};
    if (result.run) {
      artifacts.report = path.join(outDir, `${stem}.report.json`);
      await writeFile(artifacts.report, `${JSON.stringify(result.run, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    if (result.comparison) {
      artifacts.comparison = path.join(outDir, `${stem}.comparison.json`);
      await writeFile(artifacts.comparison, `${JSON.stringify(result.comparison, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    artifacts.result = path.join(outDir, `${stem}.result.json`);
    await writeFile(artifacts.result, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const { run, comparison, observation, ...summary } = result;
  console.log(JSON.stringify({ ...summary, ...(previousFile ? { previousResultFile: previousFile } : {}), ...(artifacts ? { artifacts } : {}), ...(observation ? { observedAt: observation.observedAt, checkpoint: observation.checkpoint } : {}), ...(run ? { newReportHash: run.evidenceHash, runStatus: run.status, reviewStatus: result.lifecycle.review.status } : {}), ...(comparison ? { comparisonKind: comparison.comparisonKind, comparisonCompatible: comparison.compatible, comparisonSummary: comparison.summary, comparisonCaveat: comparison.caveat } : {}) }));
  process.exitCode = result.status === 'identity-mismatch' ? 3 : result.status === 'unavailable' ? 1 : result.status === 'recheck-incomplete' || result.run && result.run.status !== 'passed' ? 2 : 0;
} catch (error) {
  console.error(JSON.stringify({ status: 'error', signing: false, publishing: false, reason: String(error.message).slice(0, 350) }));
  process.exitCode = 1;
}
