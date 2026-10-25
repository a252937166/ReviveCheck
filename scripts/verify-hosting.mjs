#!/usr/bin/env node
// Verify what a site actually serves: fetch its hosting manifest, parse it as JSON (an
// HTTP 200 is not enough, because a single-page fallback answers every path with the
// HTML shell), validate its schema, compare its source commit and release with what was
// built, and fetch the served index.html to compare its SHA-256 with the manifest. Works
// for the main site (`revivecheck.hosting-manifest.v1`) and the separate consumer
// (`revivecheck-consumer.hosting-manifest.v1`). Exit code 0 only when every check holds.
//
//   node scripts/verify-hosting.mjs --site https://revivecheck.axiqo.xyz/ --commit <sha> [--release <id>] [--index-sha256 <hex>] [--out report.json]
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const HOSTING_SCHEMAS = Object.freeze(['revivecheck.hosting-manifest.v1', 'revivecheck-consumer.hosting-manifest.v1']);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** Fetch and check one site. `fetchImpl` is injectable for tests. Returns { ok, checks[], manifest }. */
export async function verifyHosting({ site, commit, release = null, indexSha256 = null, fetchImpl = fetch, timeoutMs = 20_000 }) {
  const checks = [];
  const add = (id, ok, detail) => { checks.push({ id, ok: !!ok, detail: String(detail) }); return !!ok; };
  const base = site.endsWith('/') ? site : `${site}/`;
  const get = async (name) => { const response = await fetchImpl(new URL(name, base), { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) }); return { status: response.status, type: response.headers.get('content-type') || '', body: Buffer.from(await response.arrayBuffer()) }; };
  let manifestResponse;
  try { manifestResponse = await get('hosting.json'); } catch (error) { add('manifest.fetch', false, error.message); return { ok: false, checks, manifest: null }; }
  if (!add('manifest.fetch', manifestResponse.status === 200, `HTTP ${manifestResponse.status}`)) return { ok: false, checks, manifest: null };
  if (!add('manifest.content-type', /\bapplication\/json\b/.test(manifestResponse.type), manifestResponse.type || 'no content-type')) return { ok: false, checks, manifest: null };
  let manifest;
  try { manifest = JSON.parse(manifestResponse.body.toString('utf8')); add('manifest.json', true, 'parsed'); } catch { add('manifest.json', false, `not JSON: ${manifestResponse.body.toString('utf8').slice(0, 60).replace(/\s+/g, ' ')}…`); return { ok: false, checks, manifest: null }; }
  if (!add('manifest.schema', HOSTING_SCHEMAS.includes(manifest?.schema), manifest?.schema ?? 'missing')) return { ok: false, checks, manifest };
  add('manifest.commit', /^[0-9a-f]{40}$/.test(manifest.sourceCommit || '') && (!commit || manifest.sourceCommit === commit), `served ${manifest.sourceCommit ?? 'none'}${commit ? `, expected ${commit}` : ''}`);
  if (release !== null) add('manifest.release', manifest.release === release, `served ${manifest.release ?? 'none'}, expected ${release}`);
  add('manifest.builtAt', Number.isFinite(Date.parse(manifest.builtAt)), manifest.builtAt ?? 'missing');
  const expectedIndex = manifest.schema === 'revivecheck.hosting-manifest.v1' ? manifest.files?.indexSha256 : (manifest.files || []).find((file) => file.path === 'index.html')?.sha256;
  if (add('manifest.index', /^[a-f0-9]{64}$/.test(expectedIndex || ''), expectedIndex ?? 'the manifest names no index.html hash')) {
    try {
      const index = await get('index.html');
      const served = sha256(index.body);
      add('index.fetch', index.status === 200 && /text\/html/.test(index.type), `HTTP ${index.status}, ${index.type}`);
      add('index.sha256', served === expectedIndex, `served ${served.slice(0, 16)}…, manifest ${expectedIndex.slice(0, 16)}…`);
      if (indexSha256) add('index.expected', served === indexSha256, `served ${served.slice(0, 16)}…, expected ${indexSha256.slice(0, 16)}…`);
    } catch (error) { add('index.fetch', false, error.message); }
  }
  // The manifest is a distinct document, not the SPA shell served under another name.
  add('manifest.distinct', sha256(manifestResponse.body) !== (expectedIndex || ''), 'hosting.json is not index.html');
  return { ok: checks.every((check) => check.ok), checks, manifest };
}

export const formatHosting = (result, site) => [`Hosting verification: ${site}`, ...result.checks.map((check) => `${check.ok ? 'ok     ' : 'FAILED '} ${check.id.padEnd(22)} ${check.detail}`), result.ok ? `verified: the site serves commit ${result.manifest.sourceCommit}${result.manifest.release ? ` (release ${result.manifest.release})` : ''}` : 'NOT verified'].join('\n');

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const option = (name, fallback = null) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const site = option('--site', 'https://revivecheck.axiqo.xyz/');
  const result = await verifyHosting({ site, commit: option('--commit'), release: option('--release'), indexSha256: option('--index-sha256') });
  console.log(formatHosting(result, site));
  const out = option('--out');
  if (out) await writeFile(out, `${JSON.stringify({ site, verifiedAt: new Date().toISOString(), ...result }, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
