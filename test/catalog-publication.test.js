import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCatalogRelease, publicationOutcome, EXIT } from '../lib/catalog-release.js';

// Repair handoff 2026-10-26, R-04: a catalog release file is immutable. Repeating a
// preparation never changes an earlier release's bytes; the next version names its
// verified predecessor; a duplicate use of a predecessor either reuses an identical
// artifact explicitly or refuses the conflicting version; two concurrent preparations
// cannot replace each other or leave a partial document, and each run's outcome and
// evidence stay attributable to it; a publication failure after evaluation yields no
// successful outcome; a refusal writes its evidence without touching an older release.
// Every case runs in a disposable directory; retained historical artifacts are untouched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const starter = path.join(root, 'examples/release-gate-starter');
const bin = path.join(root, 'scripts/catalog-release.js');
const CONFIG = path.join(starter, 'project.json');
const PERMITTED = path.join(starter, 'fixtures/reapprove-r2.inputs.json');
const REFUSED = path.join(starter, 'fixtures/revoke-r2.inputs.json');
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const fresh = (name) => mkdtempSync(path.join(tmpdir(), `catalog-publication-${name}-`));
const runRecords = (out) => readdirSync(path.join(out, 'runs')).map((id) => ({ id, outcome: readJson(path.join(out, 'runs', id, 'outcome.json')) }));
const T1 = '2026-10-25T09:44:00.000Z', T2 = '2026-10-25T09:45:00.000Z', T3 = '2026-10-25T09:46:00.000Z';

test('R04-A, R04-C: a repeated preparation never changes an earlier release; identical bytes are reused explicitly, different bytes at an occupied version conflict', () => {
  const out = fresh('repeat');
  const first = run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--now', T1);
  assert.equal(first.status, EXIT.permitted, first.stdout + first.stderr);
  const file = path.join(out, 'catalog-release-1.json');
  const bytes = sha256(file);
  const release = readJson(file);
  const firstOutcome = readJson(path.join(out, 'outcome.json'));
  assert.deepEqual([firstOutcome.status, firstOutcome.publication.status, firstOutcome.publication.releaseHash], ['permitted', 'published', release.releaseHash]);
  assert.match(firstOutcome.runId, /^\d{8}T\d{6}Z-[a-f0-9]{8}$/);
  assert.ok(existsSync(path.join(out, 'runs', firstOutcome.runId, 'outcome.json')) && existsSync(path.join(out, 'runs', firstOutcome.runId, 'decision-evidence.json')), 'per-run records are kept');
  // A minute later, the same command without a predecessor: a conflict, exit 4, the first file untouched.
  const second = run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--now', T2);
  assert.equal(second.status, EXIT['publication-conflict'], second.stdout + second.stderr);
  assert.equal(sha256(file), bytes, 'release 1 keeps its bytes');
  const conflict = readJson(path.join(out, 'outcome.json'));
  assert.deepEqual([conflict.status, conflict.permitted, conflict.release, conflict.publication.status, conflict.publication.existingReleaseHash], ['publication-conflict', false, null, 'conflict', release.releaseHash]);
  assert.match(conflict.nextAction, /Pass --previous/);
  assert.notEqual(conflict.builtRelease.releaseHash, release.releaseHash, 'the run built a different release and did not publish it');
  assert.match(second.stdout, /^PUBLICATION-CONFLICT/m);
  // The first run's record still says what it did.
  const records = runRecords(out);
  assert.equal(records.length, 2);
  assert.equal(records.find((item) => item.id === firstOutcome.runId).outcome.status, 'permitted');
  assert.equal(records.find((item) => item.id === conflict.runId).outcome.status, 'publication-conflict');
  // The same inputs and clock again: identical bytes, reused explicitly, exit 0, nothing written.
  const same = run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--now', T1);
  assert.equal(same.status, EXIT.permitted, same.stdout + same.stderr);
  assert.equal(sha256(file), bytes);
  const reused = readJson(path.join(out, 'outcome.json'));
  assert.deepEqual([reused.status, reused.publication.status, reused.publication.releaseHash], ['permitted', 'reused', release.releaseHash]);
  assert.match(reused.nextAction, /already held this exact release/);
  assert.match(same.stdout, /identical to the existing/);
  // No temporary file is left behind.
  assert.deepEqual(readdirSync(out).filter((name) => name.includes('.tmp')), []);
});

test('R04-B, R04-C: version 2 names version 1\'s exact hash and both stay readable; a second use of the same predecessor reuses or conflicts; a corrupt predecessor is refused', () => {
  const out = fresh('chain');
  assert.equal(run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--now', T1).status, 0);
  const one = path.join(out, 'catalog-release-1.json');
  const two = path.join(out, 'catalog-release-2.json');
  const second = run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--previous', one, '--now', T2);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const releaseOne = readJson(one), releaseTwo = readJson(two);
  assert.equal(releaseTwo.version, 2);
  assert.equal(releaseTwo.previousReleaseHash, releaseOne.releaseHash);
  assert.equal(verifyCatalogRelease(releaseOne).ok && verifyCatalogRelease(releaseTwo).ok, true);
  const compare = run('compare', one, two, '--json');
  assert.equal(JSON.parse(compare.stdout).chained, true);
  const bytesTwo = sha256(two);
  // The same predecessor again with another clock: version 2 is occupied by another release.
  const again = run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--previous', one, '--now', T3);
  assert.equal(again.status, EXIT['publication-conflict'], again.stdout + again.stderr);
  assert.equal(sha256(two), bytesTwo);
  assert.equal(readJson(path.join(out, 'outcome.json')).publication.existingReleaseHash, releaseTwo.releaseHash);
  // The same predecessor with the same clock: identical, reused.
  const identical = run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--previous', one, '--now', T2);
  assert.equal(identical.status, 0, identical.stdout + identical.stderr);
  assert.equal(readJson(path.join(out, 'outcome.json')).publication.status, 'reused');
  // A predecessor edited after generation does not verify and cannot be extended.
  const corrupt = path.join(out, 'corrupt-previous.json');
  writeFileSync(corrupt, JSON.stringify({ ...releaseOne, name: 'edited' }));
  const refused = run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', path.join(out, 'from-corrupt'), '--previous', corrupt, '--now', T2);
  assert.equal(refused.status, EXIT['configuration-error']);
  assert.match(refused.stderr, /does not verify as an intact catalog release/);
  assert.equal(existsSync(path.join(out, 'from-corrupt', 'catalog-release-2.json')), false);
});

test('R04-D: two concurrent preparations of one version cannot replace each other or publish a partial document; each outcome is attributable to its run', async () => {
  const out = fresh('concurrent');
  const start = (now) => new Promise((resolve) => { const child = spawn(process.execPath, [bin, 'prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--now', now], { cwd: root }); let stdout = '', stderr = ''; child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; }); child.on('close', (status) => resolve({ status, stdout, stderr })); });
  const results = await Promise.all([start(T1), start(T2)]);
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, [EXIT.permitted, EXIT['publication-conflict']], JSON.stringify(results.map((result) => result.stdout.split('\n')[0])));
  const file = path.join(out, 'catalog-release-1.json');
  const release = readJson(file);
  assert.equal(verifyCatalogRelease(release).ok, true, 'the retained file is a complete, intact release');
  const records = runRecords(out);
  assert.equal(records.length, 2);
  const winner = records.find((item) => item.outcome.status === 'permitted');
  const loser = records.find((item) => item.outcome.status === 'publication-conflict');
  assert.ok(winner && loser, JSON.stringify(records.map((item) => item.outcome.status)));
  assert.equal(winner.outcome.publication.releaseHash, release.releaseHash, 'the winner\'s outcome names the retained release');
  assert.equal(loser.outcome.publication.existingReleaseHash, release.releaseHash, 'the loser names the release that occupies the version, not its own');
  assert.notEqual(loser.outcome.builtRelease.releaseHash, release.releaseHash);
  assert.equal(readJson(path.join(out, 'runs', winner.id, 'decision-evidence.json')).evidenceHash, winner.outcome.evidenceHash, 'the per-run evidence record is the one the outcome names');
  assert.equal(readJson(path.join(out, 'runs', loser.id, 'decision-evidence.json')).evidenceHash, loser.outcome.evidenceHash);
  assert.deepEqual(readdirSync(out).filter((name) => name.includes('.tmp')), []);
});

test('R04-E, R04-F: a publication failure after evaluation yields no successful outcome; a refusal writes its evidence without producing a release or touching an older one', () => {
  const out = fresh('failure');
  // The version path is occupied by something that is not a release file: the exclusive link fails and the path cannot be read as a release.
  mkdirSync(path.join(out, 'catalog-release-1.json'), { recursive: true });
  const failed = run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', out, '--now', T1);
  assert.equal(failed.status, EXIT['publication-failed'], failed.stdout + failed.stderr);
  const outcome = readJson(path.join(out, 'outcome.json'));
  assert.deepEqual([outcome.status, outcome.permitted, outcome.release, outcome.publication.status], ['publication-failed', false, null, 'failed']);
  assert.match(outcome.publication.error, /occupied/);
  assert.ok(outcome.builtRelease?.releaseHash, 'the built release is named for traceability, never claimed published');
  assert.equal(runRecords(out)[0].outcome.status, 'publication-failed');
  // A refusal into a directory that holds release 1: exit 1, evidence written, release 1 untouched, no release of this run.
  const line = fresh('refusal');
  assert.equal(run('prepare', '--config', CONFIG, '--fixture', PERMITTED, '--out', line, '--now', T1).status, 0);
  const one = path.join(line, 'catalog-release-1.json');
  const bytes = sha256(one);
  const refused = run('prepare', '--config', CONFIG, '--fixture', REFUSED, '--out', line);
  assert.equal(refused.status, EXIT.refused, refused.stdout + refused.stderr);
  assert.equal(sha256(one), bytes);
  const refusal = readJson(path.join(line, 'outcome.json'));
  assert.deepEqual([refusal.status, refusal.release, refusal.publication.status, refusal.records.release], ['refused', null, 'not-attempted', null]);
  assert.ok(refusal.reasons.includes('approval-revoked'));
  assert.equal(readJson(path.join(line, 'decision-evidence.json')).outcome.available, false);
  assert.equal(readdirSync(line).filter((name) => /^catalog-release-\d+\.json$/.test(name)).length, 1, 'no new release file');
  // The outcome shape itself: a permitted outcome turned into a conflict names no release and exits 4.
  const permitted = { status: 'permitted', exitCode: 0, permitted: true, release: { version: 1, releaseHash: 'ab'.repeat(32) }, nextAction: 'publish' };
  const turned = publicationOutcome(permitted, { status: 'conflict', existingReleaseHash: 'cd'.repeat(32), runId: 'r' });
  assert.deepEqual([turned.status, turned.exitCode, turned.permitted, turned.release, turned.builtRelease.releaseHash], ['publication-conflict', 4, false, null, 'ab'.repeat(32)]);
  assert.equal(publicationOutcome({ status: 'refused', permitted: false, exitCode: 1 }, { status: 'not-attempted' }).status, 'refused');
});
