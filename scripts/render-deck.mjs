#!/usr/bin/env node
// Render docs/deck/final-deck.html to a 12-page PDF (1920 x 1080 px pages) with the
// `playwright-cli` browser used for the site checks. The source commit replaces the
// {{SOURCE_COMMIT}} token on slide 12; render only after `node scripts/release-status.js`
// reports ok on that commit. The filled page is served over a loopback HTTP server for
// the duration of the render, because the browser session does not open file:// URLs.
//
//   node scripts/render-deck.mjs [--commit <sha>] [--out artifacts/ReviveCheck-Final-Deck.pdf]
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = '') => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const commit = option('--commit') || (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('--commit is the full 40-hex source commit.');
const out = path.resolve(root, option('--out', 'artifacts/ReviveCheck-Final-Deck.pdf'));
const source = await readFile(path.join(root, 'docs/deck/final-deck.html'), 'utf8');
if (!source.includes('{{SOURCE_COMMIT}}')) throw new Error('docs/deck/final-deck.html has no {{SOURCE_COMMIT}} token to fill.');
const html = source.replaceAll('{{SOURCE_COMMIT}}', commit);
const slides = (html.match(/<section class="slide[" ]/g) || []).length;

const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(html); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/deck.html`;
const session = `deck-render-${process.pid}`;
try {
  await mkdir(path.dirname(out), { recursive: true });
  await exec('playwright-cli', ['-s', session, 'open', url]);
  const script = `async page => { await page.waitForLoadState('load'); const n = await page.evaluate(() => document.querySelectorAll('section.slide').length); await page.pdf({ path: ${JSON.stringify(out)}, preferCSSPageSize: true, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }); return n; }`;
  const { stdout } = await exec('playwright-cli', ['-s', session, 'run-code', script], { maxBuffer: 4 * 1024 * 1024 });
  const rendered = Number((stdout.match(/### Result\s+(\d+)/) || [])[1]);
  if (rendered !== slides) throw new Error(`The page rendered ${rendered} slides; the source has ${slides}.`);
  const bytes = await readFile(out);
  const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const boxes = [...new Set(bytes.toString('latin1').match(/\/MediaBox\s*\[[^\]]+\]/g) || [])];
  if (pages !== slides || boxes.length !== 1 || !/1440 810/.test(boxes[0])) throw new Error(`Unexpected PDF: ${pages} pages, media boxes ${boxes.join(' ')}.`);
  console.log(`rendered ${path.relative(root, out)}: ${pages} pages at 1920x1080 px (${bytes.length} bytes) for commit ${commit}`);
} finally {
  await exec('playwright-cli', ['-s', session, 'close']).catch(() => {});
  server.close();
}
