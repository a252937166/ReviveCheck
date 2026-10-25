#!/usr/bin/env node
// Render docs/deck/final-deck.html to a 12-page PDF with the browser Playwright already
// installed for the site checks. The source commit replaces the {{SOURCE_COMMIT}} token on
// slide 12; render only after `node scripts/release-status.js` reports ok on that commit.
//
//   node scripts/render-deck.mjs [--commit <sha>] [--out artifacts/ReviveCheck-Final-Deck.pdf]
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = '') => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const commit = option('--commit') || (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const out = path.resolve(root, option('--out', 'artifacts/ReviveCheck-Final-Deck.pdf'));
const source = await readFile(path.join(root, 'docs/deck/final-deck.html'), 'utf8');
if (!source.includes('{{SOURCE_COMMIT}}')) throw new Error('docs/deck/final-deck.html has no {{SOURCE_COMMIT}} token to fill.');
const work = await mkdtemp(path.join(tmpdir(), 'revivecheck-deck-'));
try {
  const html = path.join(work, 'deck.html');
  await writeFile(html, source.replaceAll('{{SOURCE_COMMIT}}', commit));
  // Playwright's chromium prints the @page size declared in the document; no margins.
  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto('file://${html}', { waitUntil: 'load' });
      await page.pdf({ path: ${JSON.stringify(out)}, preferCSSPageSize: true, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      await browser.close();
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  await exec(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, NODE_PATH: option('--node-path', process.env.NODE_PATH || '') } });
  console.log(`rendered ${out} for commit ${commit}`);
} finally { await rm(work, { recursive: true, force: true }); }
