// Publish a studio session (the browser's revivecheck.studio.v1 entry, saved as
// JSON) as evidence. Every report is validated, and every on-chain claim is
// re-read from the chain here before anything is written.
import { readFile, writeFile } from 'node:fs/promises';
import { reportHtml, validateImportedRun } from '../lib/report.js';
import { readRegistry, verifyAttestation, closeConnections, REGISTRY } from '../lib/service.js';

const [file, ...rest] = process.argv.slice(2);
if (!file) throw new Error('Usage: node scripts/record-studio-run.js <session.json> [--scope "…"]');
const scopeIndex = rest.indexOf('--scope');
const session = JSON.parse(await readFile(file, 'utf8'));
const roles = { check: 'studio-check', recheck: 'studio-recheck', promote: 'studio-promotion', watch: 'studio-watch' };
try {
  const reports = Object.fromEntries(Object.keys(roles).filter((key) => session[key]?.report).map((key) => [key, session[key].report]));
  for (const report of Object.values(reports)) validateImportedRun(report);
  const { submit, approve, remark } = session;
  if (!submit?.tx?.success || !approve?.tx?.success) throw new Error('The session has no successful submit and approve.');
  const registry = await readRegistry({ releaseId: submit.releaseId, reviewer: approve.reviewer });
  if (!registry.interfacesAgree || registry.release.reportHash !== `0x${reports.recheck.evidenceHash}` || registry.decision?.approved !== approve.approved) throw new Error('The chain does not show the session’s submission and decision.');
  const attestation = remark?.tx ? await verifyAttestation({ extrinsicHash: remark.tx.extrinsicHash, blockHash: remark.tx.blockHash }) : null;
  if (attestation && !attestation.verified) throw new Error(`The remark did not verify: ${attestation.reasons.join(' ')}`);
  const index = JSON.parse(await readFile('public/reports/index.json', 'utf8'));
  for (const [key, report] of Object.entries(reports)) {
    await writeFile(`public/reports/${report.evidenceHash}.json`, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(`public/reports/${report.evidenceHash}.html`, reportHtml(report));
    index.reports = index.reports.filter((item) => item.evidenceHash !== report.evidenceHash);
    index.reports.push({ evidenceHash: report.evidenceHash, projectName: report.projectName, release: report.release, profile: report.input.profile, completedAt: report.completedAt, role: roles[key], studio: true, network: report.scope === 'portaldot-live-readonly' ? 'live' : 'testnet' });
  }
  await writeFile('public/reports/index.json', `${JSON.stringify(index, null, 2)}\n`);
  const tx = (value) => ({ extrinsicHash: value.extrinsicHash, blockHash: value.blockHash, blockNumber: value.blockNumber, finalizedAt: value.finalizedAt });
  const summary = (report) => ({ reportHash: report.evidenceHash, release: report.release, status: report.status, network: report.scope === 'portaldot-live-readonly' ? 'live' : 'testnet', block: { number: report.network.finalizedBlockNumber, nativeHash: report.network.finalizedNativeBlockHash, evmHash: report.network.finalizedEvmBlockHash ?? null }, runtime: `${report.network.specName}/${report.network.specVersion}` });
  const record = {
    schema: 'revivecheck.studio-run.v1', network: 'testnet', registry: REGISTRY.address,
    scope: scopeIndex >= 0 ? rest[scopeIndex + 1] : 'Driven through the public studio (#/try) in headless Chromium. A test-only injected Polkadot extension forwarded each signing payload to a local signer holding the isolated project test wallet, so owner and reviewer are the same test account.',
    release: { label: submit.label, releaseId: submit.releaseId, owner: registry.release.owner, revision: registry.release.revision },
    reports: Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, summary(report)])),
    comparison: session.recheck?.comparison ? { kind: session.recheck.comparison.comparisonKind, summary: session.recheck.comparison.summary } : null,
    replay: session.replay ? { reportHash: session.replay.reportHash, status: session.replay.status, reproduced: session.replay.items.filter((item) => item.match).length, total: session.replay.items.length } : null,
    submit: tx(submit.tx),
    approve: { ...tx(approve.tx), approved: approve.approved, reviewer: approve.reviewer },
    remark: attestation ? { ...tx(remark.tx), remark: attestation.remark, verified: true } : null,
    readback: { checkedAt: new Date().toISOString(), block: registry.block, revision: registry.release.revision, reportHash: registry.release.reportHash, approved: registry.decision.approved, interfacesAgree: registry.interfacesAgree },
  };
  await writeFile('public/lifecycle/studio-run.json', `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'recorded', reports: Object.keys(reports).length, readback: record.readback }, null, 2));
} finally { await closeConnections(); }
