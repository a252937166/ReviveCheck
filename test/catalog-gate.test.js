import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconstructDecision } from '../lib/decision.js';
import { verifyCatalogRelease } from '../lib/catalog-release.js';

// Product plan 2026-10-25, D-03 and D-05: the release gate command writes a release only when
// the entry is permitted, keeps a refusal and an unavailable node distinguishable in its
// machine-readable outcome and exit code, and the reader uses the release in another process.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const starter = path.join(root, 'examples/release-gate-starter');
const bin = path.join(root, 'scripts/catalog-release.js');
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const CAPTURE_NOW = '2026-10-25T09:43:18.329Z';

test('the permitted case writes release 1, its evidence and a permitted outcome; the reader uses it at its clock and refuses it later', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'release-gate-'));
  const result = run('prepare', '--config', path.join(starter, 'project.json'), '--fixture', path.join(starter, 'fixtures/reapprove-r2.inputs.json'), '--out', out);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PERMITTED 0x00001e61/m);
  const release = readJson(path.join(out, 'catalog-release-1.json'));
  assert.equal(release.version, 1);
  assert.equal(release.entries[0].decimals, 6);
  assert.equal(verifyCatalogRelease(release).ok, true);
  const outcome = readJson(path.join(out, 'outcome.json'));
  assert.deepEqual([outcome.status, outcome.exitCode, outcome.permitted, outcome.release.version], ['permitted', 0, true, 1]);
  assert.equal(reconstructDecision(readJson(path.join(out, 'decision-evidence.json'))).ok, true);
  const read = run('read', path.join(out, 'catalog-release-1.json'), '--now', release.generatedAt);
  assert.equal(read.status, 0, read.stdout + read.stderr);
  assert.match(read.stdout, /USABLE   pUSD · Portaldot USD \(test\) · 6 decimals/);
  const late = run('read', path.join(out, 'catalog-release-1.json'), '--now', '2026-10-26T00:00:00.000Z', '--json');
  assert.equal(late.status, 1);
  assert.deepEqual(JSON.parse(late.stdout).withheld[0].reasons, ['lapsed']);
  // A second release after the first, then the comparison.
  const second = run('prepare', '--config', path.join(starter, 'project.json'), '--fixture', path.join(starter, 'fixtures/reapprove-r2.inputs.json'), '--out', out, '--previous', path.join(out, 'catalog-release-1.json'), '--now', '2026-10-25T09:44:00.000Z');
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const releaseTwo = readJson(path.join(out, 'catalog-release-2.json'));
  assert.equal(releaseTwo.previousReleaseHash, release.releaseHash);
  const compare = run('compare', path.join(out, 'catalog-release-1.json'), path.join(out, 'catalog-release-2.json'), '--json');
  assert.equal(compare.status, 0);
  const diff = JSON.parse(compare.stdout);
  assert.equal(diff.chained, true);
  assert.equal(diff.summary.changed + diff.summary.unchanged, 1);
});

test('the refused case writes no release and names the field, the role and the next action; an unavailable node is unknown, never a pass', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'release-gate-refused-'));
  const revoked = run('prepare', '--config', path.join(starter, 'project.json'), '--fixture', path.join(starter, 'fixtures/revoke-r2.inputs.json'), '--out', out);
  assert.equal(revoked.status, 1, revoked.stdout + revoked.stderr);
  assert.equal(existsSync(path.join(out, 'catalog-release-1.json')), false, 'no release file on a refusal');
  const outcome = readJson(path.join(out, 'outcome.json'));
  assert.equal(outcome.status, 'refused');
  assert.ok(outcome.reasons.includes('approval-revoked'));
  const diagnostic = outcome.diagnostics.find((item) => item.code === 'approval-revoked');
  assert.equal(diagnostic.pointer, '/evaluation/checks/registry.approvals');
  assert.equal(diagnostic.role, 'reviewer');
  assert.match(diagnostic.nextAction, /approve the exact hash again/);
  assert.ok(diagnostic.checkpoint?.number, 'the registry checkpoint is named');
  assert.match(revoked.stdout, /\/evaluation\/checks\/registry\.approvals: approval-revoked/);
  // Wrong decimals in the configuration: a valid policy, the entry withheld, the field named.
  const wrongConfig = path.join(out, 'wrong.json');
  const config = readJson(path.join(starter, 'project.json'));
  writeFileSync(wrongConfig, JSON.stringify({ ...config, entry: { ...config.entry, decimals: 18 } }));
  const wrong = run('prepare', '--config', wrongConfig, '--fixture', path.join(starter, 'fixtures/reapprove-r2.inputs.json'), '--out', path.join(out, 'wrong'));
  assert.equal(wrong.status, 1);
  const wrongOutcome = readJson(path.join(out, 'wrong/outcome.json'));
  assert.deepEqual(wrongOutcome.reasons, ['entry-mismatch:decimals']);
  assert.deepEqual([wrongOutcome.diagnostics[0].pointer, wrongOutcome.diagnostics[0].configured, wrongOutcome.diagnostics[0].approved], ['/entry/configured/decimals', 18, 6]);
  // Every read unavailable: unknown, exit 2.
  const capture = readJson(path.join(starter, 'fixtures/reapprove-r2.inputs.json'));
  const token = capture.tokens['0x00001e6100000000000000000000000000010000'];
  const error = 'fixture: the public node did not answer';
  const unavailable = { ...capture, tokens: { '0x00001e6100000000000000000000000000010000': { ...token, observation: { error }, registry: { error }, listing: { error }, evidence: { error, run: token.evidence.run } } } };
  const unavailableFile = path.join(out, 'unavailable.json');
  writeFileSync(unavailableFile, JSON.stringify(unavailable));
  const unknown = run('prepare', '--config', path.join(starter, 'project.json'), '--fixture', unavailableFile, '--out', path.join(out, 'unavailable'));
  assert.equal(unknown.status, 2, unknown.stdout + unknown.stderr);
  const unknownOutcome = readJson(path.join(out, 'unavailable/outcome.json'));
  assert.equal(unknownOutcome.status, 'unknown');
  assert.equal(existsSync(path.join(out, 'unavailable/catalog-release-1.json')), false);
  // A configuration that does not validate: exit 3 with the field named.
  const bad = path.join(out, 'bad.json');
  writeFileSync(bad, JSON.stringify({ ...config, release: { ...config.release, revision: '0' } }));
  const badRun = run('prepare', '--config', bad, '--fixture', path.join(starter, 'fixtures/reapprove-r2.inputs.json'), '--out', path.join(out, 'bad'));
  assert.equal(badRun.status, 3);
  assert.match(badRun.stderr, /release\.revision/);
  assert.equal(readJson(path.join(out, 'bad/outcome.json')).status, 'configuration-error');
});
