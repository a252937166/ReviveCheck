#!/usr/bin/env node
// The hosting manifest: one small public file, generated AFTER the build and placed
// beside the built files on the server, that identifies the build actually served:
// the source commit, the release ID, the build time, the per-file manifest hash and
// the payload hash. It is not part of the repository and never part of the evidence
// status (`public/release-status.json`), which describes the published records, so
// the two cannot contradict each other about "the current release".
//
//   node scripts/hosting-manifest.mjs --dist dist --release <id> --commit <sha> [--payload <tar.gz>] [--site https://…] --out <hosting.json>
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const HOSTING_SCHEMA = 'revivecheck.hosting-manifest.v1';
const exec = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback = '') => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full, base));
    else if (!entry.name.startsWith('._') && entry.name !== '.DS_Store') out.push(path.relative(base, full));
  }
  return out.sort();
}

export async function buildHostingManifest({ dist, release, commit, payload = null, site = 'https://revivecheck.axiqo.xyz/', builtAt = null }) {
  if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('--commit is the full 40-hex source commit.');
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(release || '')) throw new Error('--release is the release identifier (letters, digits, dots, dashes).');
  const files = [];
  for (const relative of await listFiles(dist)) {
    const buffer = await readFile(path.join(dist, relative));
    files.push({ path: relative, bytes: buffer.length, sha256: sha256(buffer) });
  }
  if (!files.some((file) => file.path === 'index.html')) throw new Error(`${dist} has no index.html.`);
  const manifestText = files.map((file) => `${file.sha256}  ${file.path}`).join('\n');
  let payloadRecord = null;
  if (payload) { const buffer = await readFile(payload); payloadRecord = { filename: path.basename(payload), bytes: buffer.length, sha256: sha256(buffer) }; }
  const indexStat = await stat(path.join(dist, 'index.html'));
  return {
    schema: HOSTING_SCHEMA, site, release, sourceCommit: commit,
    sourceUrl: `https://github.com/a252937166/ReviveCheck/commit/${commit}`,
    builtAt: builtAt || indexStat.mtime.toISOString(), generatedAt: new Date().toISOString(),
    files: { count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), manifestSha256: sha256(manifestText), indexSha256: files.find((file) => file.path === 'index.html').sha256 },
    payload: payloadRecord,
    evidenceStatus: 'release-status.json describes the published evidence records at its own commit; this manifest describes the hosted build. They are separate facts.',
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  const dist = option('--dist', 'dist'), out = option('--out');
  let commit = option('--commit');
  if (!commit) commit = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const manifest = await buildHostingManifest({ dist, release: option('--release'), commit, payload: option('--payload') || null, site: option('--site', 'https://revivecheck.axiqo.xyz/'), builtAt: option('--built-at') || null });
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (out) await writeFile(out, text);
  process.stdout.write(text);
}
