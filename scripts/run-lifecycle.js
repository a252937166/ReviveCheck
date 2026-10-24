import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inspectChain } from '../lib/chain.js';
import { inspectPromotion } from '../lib/promotion.js';
import { replayReport } from '../lib/replay.js';
import { sealRun, overall, compareRuns, reportHtml, validateImportedRun } from '../lib/report.js';
import { attestationRemark } from '../lib/attestation.js';
import { demoPlan, DEMO_PROJECT } from '../lib/demo.js';
import { NETWORKS, RUNTIME_HISTORY } from '../lib/networks.js';

// Reference run of the walkthrough: real read-only observations, no signing.
// Without --publish everything stays under artifacts/local/lifecycle/.
const publish = process.argv.includes('--publish');
const projectId = 'demo-pusd-token-list';
const outDir = publish ? 'public/reports' : 'artifacts/local/lifecycle';

async function observe(version, previous) {
  const input = demoPlan(version);
  const startedAt = new Date().toISOString();
  const result = await inspectChain(input);
  return sealRun({ id: randomUUID(), projectId, projectName: DEMO_PROJECT.name, release: input.release, input, mode: 'live', scope: 'portaldot-testnet-readonly', scenario: null, trigger: previous ? 'recheck' : 'manual', startedAt, completedAt: new Date().toISOString(), previousRunId: previous?.id ?? null, status: overall(result.checks), checks: result.checks, network: result.network, limitations: result.limitations });
}

const first = await observe('v1.0.0');
const second = await observe('v1.0.1', first);
const comparison = compareRuns(first, second);
const replay = await replayReport(second);
const promotionInput = { ...demoPlan('v1.0.1'), promotionOf: { reportHash: second.evidenceHash, release: second.release, network: 'testnet', specVersion: second.network.specVersion, finalizedBlockNumber: second.network.finalizedBlockNumber } };
const startedAt = new Date().toISOString();
const promoted = await inspectPromotion(promotionInput, second);
const promotion = sealRun({ id: randomUUID(), projectId, projectName: DEMO_PROJECT.name, release: second.release, input: promotionInput, mode: 'live', scope: NETWORKS.live.scope, scenario: null, trigger: 'promotion', startedAt, completedAt: new Date().toISOString(), previousRunId: second.id, status: overall(promoted.checks), checks: promoted.checks, network: promoted.network, limitations: promoted.limitations });
for (const run of [first, second, promotion]) validateImportedRun(run);

const step = (run) => ({ reportHash: run.evidenceHash, release: run.release, status: run.status, network: run.scope === NETWORKS.live.scope ? 'live' : 'testnet', block: { number: run.network.finalizedBlockNumber, nativeHash: run.network.finalizedNativeBlockHash, evmHash: run.network.finalizedEvmBlockHash ?? null }, runtime: `${run.network.specName}/${run.network.specVersion}`, completedAt: run.completedAt });
const ledger = {
  schema: 'revivecheck.lifecycle.v1',
  subject: DEMO_PROJECT.name,
  scope: 'Reference run by the ReviveCheck author: real read-only observations of a token-list release written for this walkthrough. No signing.',
  observedAt: promotion.completedAt,
  check: step(first),
  recheck: { ...step(second), comparison: { kind: comparison.comparisonKind ?? null, summary: comparison.summary, caveat: comparison.caveat ?? comparison.reason ?? null } },
  replay: { reportHash: replay.reportHash, status: replay.status, reproduced: replay.items.filter((item) => item.match).length, total: replay.items.length, checkedAt: replay.checkedAt, error: replay.error ?? null },
  // A new passing report starts unreviewed: record it with scripts/gate-revision.js, which updates release-gate.json.
  attestation: { status: 'pending', mechanism: 'release-gate', reportHash: second.evidenceHash, visitorRemark: attestationRemark({ reportHash: second.evidenceHash, decision: 'accepted' }) },
  promotion: step(promotion),
  runtimes: RUNTIME_HISTORY,
};

await mkdir(outDir, { recursive: true });
for (const run of [first, second, promotion]) {
  await writeFile(`${outDir}/${run.evidenceHash}.json`, `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(`${outDir}/${run.evidenceHash}.html`, reportHtml(run));
}
if (publish) {
  const index = JSON.parse(await readFile('public/reports/index.json', 'utf8'));
  index.reports = index.reports.filter((entry) => entry.lifecycle === undefined);
  for (const [role, run] of [['lifecycle-check', first], ['lifecycle-recheck', second], ['lifecycle-promotion', promotion]]) index.reports.push({ evidenceHash: run.evidenceHash, projectName: run.projectName, release: run.release, profile: run.input.profile, completedAt: run.completedAt, role, lifecycle: true, network: run.scope === NETWORKS.live.scope ? 'live' : 'testnet' });
  await writeFile('public/reports/index.json', `${JSON.stringify(index, null, 2)}\n`);
  await mkdir('public/lifecycle', { recursive: true });
  await writeFile('public/lifecycle/reference.json', `${JSON.stringify(ledger, null, 2)}\n`);
} else await writeFile(`${outDir}/reference.json`, `${JSON.stringify(ledger, null, 2)}\n`);

const brief = (run) => ({ release: run.release, status: run.status, hash: run.evidenceHash, block: run.network.finalizedBlockNumber, runtime: `${run.network.specName}/${run.network.specVersion}`, checks: run.checks.map((check) => `${check.id}=${check.status}: ${check.observed}`) });
console.log(JSON.stringify({ published: publish, outDir, check: brief(first), recheck: brief(second), comparison: { kind: comparison.comparisonKind, summary: comparison.summary }, replay: { status: replay.status, items: replay.items.map((item) => `${item.id}:${item.match ? 'match' : 'DIFF'} ${item.recorded} → ${item.replayed}`), error: replay.error }, promotion: brief(promotion) }, null, 2));
