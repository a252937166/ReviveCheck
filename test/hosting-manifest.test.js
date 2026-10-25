import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildHostingManifest, HOSTING_SCHEMA } from '../scripts/hosting-manifest.mjs';

// Assessment 2026-10-25, O-11: the hosted build is identified by a manifest written after
// the build, beside the served files; the evidence status record never names it.
test('the hosting manifest names the commit, release, every served file and the payload, and refuses an incomplete build', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'revivecheck-hosting-'));
  try {
    await mkdir(path.join(dir, 'dist/assets'), { recursive: true });
    await writeFile(path.join(dir, 'dist/index.html'), '<!doctype html><title>x</title>');
    await writeFile(path.join(dir, 'dist/assets/app.js'), 'console.log(1)');
    await writeFile(path.join(dir, 'dist/._index.html'), 'apple double metadata');
    await writeFile(path.join(dir, 'payload.tar.gz'), 'not really a tarball');
    const commit = 'a'.repeat(40);
    const manifest = await buildHostingManifest({ dist: path.join(dir, 'dist'), release: '20261025-aaaaaaa-public-r9', commit, payload: path.join(dir, 'payload.tar.gz'), builtAt: '2026-10-25T12:00:00.000Z' });
    assert.equal(manifest.schema, HOSTING_SCHEMA);
    assert.equal(manifest.sourceCommit, commit);
    assert.equal(manifest.files.count, 2, 'AppleDouble entries are not served files');
    assert.match(manifest.files.indexSha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.files.manifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(manifest.payload.filename, 'payload.tar.gz');
    assert.equal(manifest.builtAt, '2026-10-25T12:00:00.000Z');
    assert.match(manifest.evidenceStatus, /separate facts/);
    await assert.rejects(buildHostingManifest({ dist: path.join(dir, 'dist'), release: 'bad release!', commit }), /release identifier/);
    await assert.rejects(buildHostingManifest({ dist: path.join(dir, 'dist'), release: '20261025-aaaaaaa-public-r1', commit: 'abc' }), /40-hex/);
    await rm(path.join(dir, 'dist/index.html'));
    await assert.rejects(buildHostingManifest({ dist: path.join(dir, 'dist'), release: '20261025-aaaaaaa-public-r1', commit }), /no index\.html/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
