import { readFile, writeFile } from 'node:fs/promises';
import { reportHtml, validateImportedRun } from '../lib/report.js';

// Publish a sealed report under public/reports: the JSON the reviewer verifies, the
// HTML rendering, and an index entry with its role. Either run a demo check live and
// publish its report, or publish a report JSON produced elsewhere. Read-only on the
// chain; nothing is signed.
//
//   node scripts/publish-report.js --release v1.0.1 --role catalog-v2-recheck [--previous <64-hex>]
//   node scripts/publish-report.js --file artifacts/local/my-report.json --role my-role
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const role = option('--role', '');
if (!/^[a-z0-9-]{3,40}$/.test(role)) throw new Error('--role is a short kebab-case label for the index.');
let report, service = null;
try {
  if (option('--file', '')) {
    report = JSON.parse(await readFile(option('--file', ''), 'utf8'));
  } else {
    const release = option('--release', '');
    if (!['v1.0.0', 'v1.0.1'].includes(release)) throw new Error('--release is v1.0.0 or v1.0.1, or pass --file.');
    service = await import('../lib/service.js');
    const previousHash = option('--previous', '').replace(/^0x/, '').toLowerCase();
    const previous = previousHash ? JSON.parse(await readFile(`public/reports/${previousHash}.json`, 'utf8')) : null;
    report = await service.checkDemoRelease(release, previous);
  }
  validateImportedRun(report);
  const index = JSON.parse(await readFile('public/reports/index.json', 'utf8'));
  await writeFile(`public/reports/${report.evidenceHash}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`public/reports/${report.evidenceHash}.html`, reportHtml(report));
  index.reports = index.reports.filter((item) => item.evidenceHash !== report.evidenceHash);
  index.reports.push({ evidenceHash: report.evidenceHash, projectName: report.projectName, release: report.release, profile: report.input.profile, completedAt: report.completedAt, role, network: report.scope === 'portaldot-live-readonly' ? 'live' : 'testnet' });
  await writeFile('public/reports/index.json', `${JSON.stringify(index, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'published', reportHash: report.evidenceHash, reportStatus: report.status, release: report.release, block: report.network?.finalizedBlockNumber ?? null, runtime: `${report.network?.specName}/${report.network?.specVersion}`, files: [`public/reports/${report.evidenceHash}.json`, `public/reports/${report.evidenceHash}.html`], indexed: index.reports.length }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600) }, null, 2));
  process.exitCode = 1;
} finally { if (service) await service.closeConnections(); }
