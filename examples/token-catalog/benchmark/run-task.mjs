#!/usr/bin/env node
// The complete maintainer task, measured (product plan 2026-10-25, D-08): from a cold
// start on the installed artifact alone, configure a project, detect incorrect metadata,
// inspect the exact evidence, correct and review the release, generate a catalog release,
// consume it in another process, invalidate it, and recover explicitly. Every step is
// timed, every refusal and recovery recorded, every retained artifact hashed. Offline
// steps replay the reads captured live on 2026-10-25; `--live` adds the live gate and a
// live read of the release on the public testnet, with the network time stated apart.
// Author-operated: this measures the task, not adoption.
//
//   node examples/token-catalog/benchmark/run-task.mjs [--out <results.json>] [--live] [--keep]
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { values } = parseArgs({ options: { out: { type: 'string', default: 'examples/token-catalog/benchmark/results-task-2026-10-25.json' }, live: { type: 'boolean', default: false }, keep: { type: 'boolean', default: false } } });
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const steps = [];
const retained = [];
async function step(id, role, what, work) {
  const started = Date.now();
  try { const result = await work(); steps.push({ id, role, what, ms: Date.now() - started, ...result }); return result; }
  catch (error) { steps.push({ id, role, what, ms: Date.now() - started, failed: true, error: error.message }); throw error; }
}
async function retain(file, label) { const buffer = await readFile(file); retained.push({ label, file: path.basename(file), bytes: buffer.length, sha256: sha256(buffer) }); return JSON.parse(buffer.toString('utf8')); }
/** Run the gate and parse its outcome; an expected nonzero exit is a result, not a failure. */
async function gate(cwd, args) {
  const bin = path.join(cwd, 'node_modules', '.bin', 'revivecheck-catalog');
  const result = await exec(bin, args, { cwd, maxBuffer: 16 * 1024 * 1024 }).then((out) => ({ status: 0, ...out }), (error) => ({ status: error.code, stdout: error.stdout, stderr: error.stderr }));
  return result;
}

const work = await mkdtemp(path.join(os.tmpdir(), 'revivecheck-task-'));
const record = { schema: 'revivecheck.task-measurement.v1', measuredAt: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, operator: 'the ReviveCheck project (an AI agent on the author\'s machine); not an outside maintainer', mode: values.live ? 'offline captures plus live' : 'offline captures', assistance: [], steps, retained };
try {
  // 1. Cold start: pack the artifact, install it into the shipped starter copied to an empty directory.
  const packed = await step('cold-start', 'maintainer', 'pack the artifact, copy the shipped starter to an empty directory, npm install', async () => {
    const pack = JSON.parse((await exec('npm', ['pack', '--json', '--pack-destination', work], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout)[0];
    const starter = path.join(work, 'starter');
    await cp(path.join(root, 'examples/release-gate-starter'), starter, { recursive: true });
    await cp(path.join(work, pack.filename), path.join(starter, 'revivecheck.tgz'));
    const installed = Date.now();
    await exec('npm', ['install', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: starter, maxBuffer: 16 * 1024 * 1024 });
    const lock = await readJson(path.join(starter, 'package-lock.json'));
    return { starter, artifact: { filename: pack.filename, bytes: pack.size, files: pack.entryCount, sha256: sha256(await readFile(path.join(work, pack.filename))) }, installMs: Date.now() - installed, packages: Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/')).length, assistance: 'none: the starter README and the package docs only' };
  });
  const starter = packed.starter;
  record.assistance.push('Cold start used the starter README shipped in the package and nothing else.');
  // 2. Configure: the project configuration is the shipped one; its fields are counted as the maintainer's input.
  const config = await readJson(path.join(starter, 'project.json'));
  await step('configure', 'maintainer', 'adopt the consumer configuration (the App exports it; the starter ships the pUSD example)', async () => {
    const count = (value) => typeof value === 'object' && value !== null ? Object.values(value).reduce((sum, child) => sum + count(child), 0) : 1;
    return { fields: count(config), policyFields: count(config.policy), source: 'examples/release-gate-starter/project.json (identical to the consumer example\'s config/allowlist.json apart from its name and role text)' };
  });
  // 3. Detect incorrect metadata: the configuration claims 18 decimals.
  const wrongFile = path.join(starter, 'project-wrong.json');
  await writeFile(wrongFile, JSON.stringify({ ...config, entry: { ...config.entry, decimals: 18 } }, null, 2));
  await step('detect', 'release gate', 'gate the wrong configuration on the captured approved reads', async () => {
    const result = await gate(starter, ['prepare', '--config', 'project-wrong.json', '--out', 'out/wrong', '--fixture', 'fixtures/reapprove-r2.inputs.json']);
    const outcome = await retain(path.join(starter, 'out/wrong/outcome.json'), 'outcome of the wrong configuration');
    if (result.status !== 1 || outcome.status !== 'refused') throw new Error(`expected a refusal, got exit ${result.status} ${outcome.status}`);
    return { exit: result.status, outcome: outcome.status, reasons: outcome.reasons, diagnostic: outcome.diagnostics[0] && { pointer: outcome.diagnostics[0].pointer, configured: outcome.diagnostics[0].configured, approved: outcome.diagnostics[0].approved, role: outcome.diagnostics[0].role, checkpoint: outcome.diagnostics[0].checkpoint?.number }, releaseWritten: false };
  });
  // 4. Inspect the exact evidence: reconstruct the decision from its document alone.
  await step('inspect', 'maintainer', 'reconstruct the refusal from decision-evidence.json alone', async () => {
    const { reconstructDecision } = await import(path.join(starter, 'node_modules/revivecheck/lib/decision.js'));
    const document = await retain(path.join(starter, 'out/wrong/decision-evidence.json'), 'decision evidence of the refusal');
    const reconstruction = reconstructDecision(document);
    if (!reconstruction.ok) throw new Error('the refusal does not reconstruct');
    return { checks: reconstruction.checks.length, consistent: true, reportHash: document.identity.reportHash, reportCheckpoint: document.checkpoints.report?.number, explanation: document.outcome.explanations[0] && { code: document.outcome.explanations[0].code, who: document.outcome.explanations[0].who } };
  });
  // 5. Correct and review: the corrected configuration is permitted; release 1 is written.
  const releaseOne = await step('correct-and-gate', 'maintainer, then release gate', 'correct decimals to the approved value and gate again', async () => {
    const result = await gate(starter, ['prepare', '--config', 'project.json', '--out', 'out/releases', '--fixture', 'fixtures/reapprove-r2.inputs.json']);
    const outcome = await retain(path.join(starter, 'out/releases/outcome.json'), 'outcome of the corrected configuration');
    if (result.status !== 0) throw new Error(`expected permitted, got exit ${result.status}`);
    const release = await retain(path.join(starter, 'out/releases/catalog-release-1.json'), 'catalog release 1');
    return { exit: 0, outcome: outcome.status, release: { version: release.version, releaseHash: release.releaseHash, entries: release.entries.length, validUntil: release.validity.validUntil, generatedAt: release.generatedAt }, file: path.join(starter, 'out/releases/catalog-release-1.json') };
  });
  // 6. Consume: the example reader in another process, at the generation clock.
  await step('consume', 'reader (separate process)', 'read release 1 with read-example.mjs at its generation clock', async () => {
    const result = await exec(process.execPath, ['read-example.mjs', 'out/releases/catalog-release-1.json', '--now', releaseOne.release.generatedAt], { cwd: starter });
    if (!/At least one entry may be used now/.test(result.stdout)) throw new Error('the reader did not use the release');
    const lapsed = await exec(process.execPath, ['read-example.mjs', 'out/releases/catalog-release-1.json', '--now', '2026-10-26T00:00:00.000Z'], { cwd: starter }).then(() => ({ status: 0 }), (error) => ({ status: error.code, stdout: error.stdout }));
    return { usableAtGeneration: true, usableNextDay: lapsed.status === 0, lapsedReason: /lapsed/.test(lapsed.stdout || '') ? 'lapsed' : null };
  });
  // 7. Invalidate: the reviewer requested changes (captured step 11); no release 2 is written.
  await step('invalidate', 'trusted reviewer (recorded), then release gate', 'gate on the revoked reads with release 1 as the predecessor', async () => {
    const result = await gate(starter, ['prepare', '--config', 'project.json', '--out', 'out/revoked', '--fixture', 'fixtures/revoke-r2.inputs.json', '--previous', 'out/releases/catalog-release-1.json']);
    const outcome = await retain(path.join(starter, 'out/revoked/outcome.json'), 'outcome after the revocation');
    const written = await readFile(path.join(starter, 'out/revoked/catalog-release-2.json')).then(() => true, () => false);
    if (result.status !== 1 || written) throw new Error(`expected a refusal without a release, got exit ${result.status}, written ${written}`);
    return { exit: 1, outcome: outcome.status, reasons: outcome.reasons, nextAction: outcome.diagnostics.find((item) => item.code === 'approval-revoked')?.nextAction ?? null, releaseWritten: false };
  });
  // 8. Recover: the reviewer approved again (captured step 12); release 2 chains to release 1 and the diff shows no change.
  await step('recover', 'trusted reviewer (recorded), then release gate', 'gate on the re-approved reads with release 1 as the predecessor, then compare', async () => {
    const result = await gate(starter, ['prepare', '--config', 'project.json', '--out', 'out/releases', '--fixture', 'fixtures/reapprove-r2.inputs.json', '--previous', 'out/releases/catalog-release-1.json', '--now', '2026-10-25T09:44:00.000Z']);
    if (result.status !== 0) throw new Error(`expected permitted, got exit ${result.status}`);
    const release = await retain(path.join(starter, 'out/releases/catalog-release-2.json'), 'catalog release 2');
    const compare = await gate(starter, ['compare', 'out/releases/catalog-release-1.json', 'out/releases/catalog-release-2.json', '--json']);
    const diff = JSON.parse(compare.stdout);
    return { exit: 0, release: { version: release.version, releaseHash: release.releaseHash, previousReleaseHash: release.previousReleaseHash }, chained: diff.chained, summary: diff.summary };
  });
  // 9. Live, optionally: the same gate on fresh reads, then a live read of the release.
  if (values.live) {
    await step('live-gate', 'release gate', 'gate on fresh reads of the public testnet (report retrieved from chain data)', async () => {
      const started = Date.now();
      const result = await gate(starter, ['prepare', '--config', 'project.json', '--out', 'out/live', '--previous', 'out/releases/catalog-release-2.json']);
      const networkMs = Date.now() - started;
      const outcome = await retain(path.join(starter, 'out/live/outcome.json'), 'outcome of the live gate');
      const release = outcome.permitted ? await retain(path.join(starter, 'out/live/catalog-release-3.json'), 'catalog release 3 (live)') : null;
      return { exit: result.status, outcome: outcome.status, networkMs, release: release && { version: release.version, releaseHash: release.releaseHash, validUntil: release.validity.validUntil, checkpoint: release.entries[0]?.checkpoints?.registry?.number ?? null }, note: 'the elapsed time is almost entirely the public nodes answering; computation is milliseconds' };
    });
    await step('live-read', 'reader (separate process)', 'read release 3 with fresh reads (re-evaluation under the release\'s own policy)', async () => {
      const started = Date.now();
      const result = await gate(starter, ['read', 'out/live/catalog-release-3.json', '--live', '--json']);
      const read = JSON.parse(result.stdout);
      return { exit: result.status, networkMs: Date.now() - started, freshness: read.freshness, usable: read.usable.length, status: read.usable[0]?.fresh?.status ?? read.withheld[0]?.reasons ?? null };
    });
  }
  record.summary = { stepsCompleted: steps.filter((item) => !item.failed).length, stepsFailed: steps.filter((item) => item.failed).length, totalMs: steps.reduce((sum, item) => sum + item.ms, 0), networkMs: steps.filter((item) => item.networkMs).reduce((sum, item) => sum + item.networkMs, 0), refusals: steps.filter((item) => item.outcome === 'refused').map((item) => item.id), releases: steps.filter((item) => item.release).map((item) => `${item.release.version}:${item.release.releaseHash.slice(0, 12)}`) };
  record.limits = ['Author-operated; it measures the task on the shipped starter, not adoption or willingness to pay.', 'The signed steps (revocation, re-approval) are the recorded 2026-10-25 transactions replayed from captured reads; no transaction was sent by this run.', 'Offline steps are computation only; the live steps include the public nodes\' response time, which dominates.'];
} catch (error) {
  record.failure = error.message;
} finally {
  if (!values.keep) await rm(work, { recursive: true, force: true });
}
await writeFile(path.resolve(root, values.out), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ ok: !record.failure, failure: record.failure ?? null, summary: record.summary, steps: steps.map((item) => ({ id: item.id, ms: item.ms, outcome: item.outcome ?? (item.failed ? 'failed' : 'ok'), ...(item.release ? { release: item.release.version } : {}) })) }, null, 2));
process.exitCode = record.failure ? 1 : 0;
