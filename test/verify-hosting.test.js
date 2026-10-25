import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyHosting, formatHosting, HOSTING_SCHEMAS } from '../scripts/verify-hosting.mjs';

// Remaining fixes 2026-10-25, item 3: `/hosting.json` is verified by parsing it and
// comparing its commit and the served index with it; an SPA fallback answering 200 with
// HTML is a failure, not a pass.
const sha = (text) => createHash('sha256').update(text).digest('hex');
const COMMIT = 'c'.repeat(40);
const INDEX = '<!doctype html><title>ReviveCheck</title>';
const manifest = (overrides = {}) => ({ schema: 'revivecheck.hosting-manifest.v1', site: 'https://example.test/', release: '20261025-ccccccc-public-r3', sourceCommit: COMMIT, builtAt: '2026-10-25T12:00:00.000Z', files: { count: 2, indexSha256: sha(INDEX) }, ...overrides });
const server = (routes) => async (url) => {
  const name = new URL(url).pathname.slice(1);
  const route = routes[name] ?? routes['*'];
  return { status: route.status ?? 200, headers: { get: () => route.type }, arrayBuffer: async () => new TextEncoder().encode(route.body).buffer };
};

test('a served manifest that names the built commit and the served index verifies', async () => {
  const fetchImpl = server({ 'hosting.json': { type: 'application/json', body: JSON.stringify(manifest()) }, 'index.html': { type: 'text/html; charset=utf-8', body: INDEX } });
  const result = await verifyHosting({ site: 'https://example.test', commit: COMMIT, release: '20261025-ccccccc-public-r3', fetchImpl });
  assert.equal(result.ok, true, formatHosting(result, 'x'));
  assert.match(formatHosting(result, 'https://example.test/'), /verified: the site serves commit c{40} \(release 20261025-ccccccc-public-r3\)/);
  assert.deepEqual(HOSTING_SCHEMAS, ['revivecheck.hosting-manifest.v1', 'revivecheck-consumer.hosting-manifest.v1']);
});

test('the single-page fallback answering hosting.json with HTML and 200 fails', async () => {
  const fetchImpl = server({ '*': { type: 'text/html; charset=utf-8', body: INDEX } });
  const result = await verifyHosting({ site: 'https://example.test/', commit: COMMIT, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.id === 'manifest.fetch').ok, true, 'HTTP 200 alone');
  assert.equal(result.checks.find((check) => check.id === 'manifest.content-type').ok, false);
  assert.match(formatHosting(result, 'x'), /NOT verified/);
});

test('another commit, another release, a changed index or a wrong schema fails, and the consumer schema is accepted', async () => {
  const cases = {
    'another commit': { manifest: manifest({ sourceCommit: 'd'.repeat(40) }), index: INDEX, failing: 'manifest.commit' },
    'another release': { manifest: manifest({ release: '20261025-ccccccc-public-r2' }), index: INDEX, failing: 'manifest.release' },
    'a changed index': { manifest: manifest(), index: `${INDEX}<!-- edited -->`, failing: 'index.sha256' },
    'a wrong schema': { manifest: manifest({ schema: 'something.else' }), index: INDEX, failing: 'manifest.schema' },
    'an undated build': { manifest: manifest({ builtAt: 'yesterday' }), index: INDEX, failing: 'manifest.builtAt' },
  };
  for (const [what, { manifest: served, index, failing }] of Object.entries(cases)) {
    const fetchImpl = server({ 'hosting.json': { type: 'application/json', body: JSON.stringify(served) }, 'index.html': { type: 'text/html', body: index } });
    const result = await verifyHosting({ site: 'https://example.test/', commit: COMMIT, release: '20261025-ccccccc-public-r3', fetchImpl });
    assert.equal(result.ok, false, what);
    assert.equal(result.checks.find((check) => check.id === failing)?.ok, false, `${what}: ${failing}`);
  }
  const consumer = { schema: 'revivecheck-consumer.hosting-manifest.v1', sourceCommit: COMMIT, repository: 'a/b', builtAt: '2026-10-25T12:00:00.000Z', files: [{ path: 'index.html', bytes: INDEX.length, sha256: sha(INDEX) }] };
  const fetchImpl = server({ 'hosting.json': { type: 'application/json; charset=utf-8', body: JSON.stringify(consumer) }, 'index.html': { type: 'text/html', body: INDEX } });
  const result = await verifyHosting({ site: 'https://demo.example.test/', commit: COMMIT, fetchImpl });
  assert.equal(result.ok, true, formatHosting(result, 'consumer'));
});
