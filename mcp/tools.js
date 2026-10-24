// One definition per capability: the MCP server registers these tools, and the
// local workbench serves the same handlers at POST /api/tools/<name>. Every tool
// is read-only. Transactions are prepared and dry-run here, then signed by the
// user's own wallet; no tool ever holds a key.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as service from '../lib/service.js';
import { verifyRun } from '../lib/report.js';
import { NETWORKS, blockUrl, networkForScope } from '../lib/networks.js';
import { PUBLIC_REVIEW_URL } from '../lib/share.js';

// Looking a missing report or feed up on the public site is opt-in, so tests and CI stay offline.
const PUBLIC_FALLBACK = process.env.REVIVECHECK_PUBLIC_FALLBACK === '1';

/** The public data feed built by scripts/index-registry.js: this checkout's copy, then the public site's. */
export async function loadFeed() {
  try { return JSON.parse(await readFile(path.join(root, 'public', 'api', 'registry.json'), 'utf8')); }
  catch {
    const response = PUBLIC_FALLBACK ? await fetch(new URL('api/registry.json', PUBLIC_REVIEW_URL), { signal: AbortSignal.timeout(10_000), redirect: 'error' }).catch(() => null) : null;
    if (!response?.ok) throw new Error('No feed is available. Run `node scripts/index-registry.js` to build one.');
    return response.json();
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH64 = /^(0x)?[a-fA-F0-9]{64}$/;
const sessionReports = new Map();
const bare = (hash) => String(hash).replace(/^0x/, '').toLowerCase();

/** A report by fingerprint: this session, then this checkout's published reports, then (with REVIVECHECK_PUBLIC_FALLBACK=1) the public site. */
export async function loadReport({ reportHash, report } = {}) {
  if (report) {
    if (!verifyRun(report)) throw new Error('The supplied report failed its SHA-256 integrity check. Pass the original JSON.');
    return report;
  }
  if (!HASH64.test(reportHash || '')) throw new Error('Pass a 64-hex report fingerprint or the original report JSON.');
  const hash = bare(reportHash);
  if (sessionReports.has(hash)) return sessionReports.get(hash);
  let found;
  try { found = JSON.parse(await readFile(path.join(root, 'public', 'reports', `${hash}.json`), 'utf8')); }
  catch {
    const response = PUBLIC_FALLBACK ? await fetch(new URL(`reports/${hash}.json`, PUBLIC_REVIEW_URL), { signal: AbortSignal.timeout(10_000), redirect: 'error' }).catch(() => null) : null;
    if (!response?.ok) throw new Error(`No report ${hash.slice(0, 12)}… in this session or this checkout. Pass the report JSON instead${PUBLIC_FALLBACK ? '' : ', or set REVIVECHECK_PUBLIC_FALLBACK=1 to look it up on the public site'}.`);
    found = await response.json();
  }
  if (!verifyRun(found) || found.evidenceHash !== hash) throw new Error('The stored report failed its SHA-256 integrity check.');
  return found;
}

function summarize(run) {
  const network = networkForScope(run.scope) || NETWORKS.testnet;
  const nativeHash = run.network?.finalizedNativeBlockHash;
  return {
    reportHash: run.evidenceHash, status: run.status, release: run.release, project: run.projectName, network: network.key,
    runtime: run.network?.specName ? `${run.network.specName}/${run.network.specVersion}` : null,
    checkpoint: { number: run.network?.finalizedBlockNumber ?? null, nativeHash: nativeHash ?? null, evmHash: run.network?.finalizedEvmBlockHash ?? null, explorerUrl: blockUrl(network, nativeHash) },
    checks: run.checks.map(({ id, title, status, observed, remediation }) => ({ id, title, status, observed, ...(remediation ? { remediation } : {}) })),
    completedAt: run.completedAt,
  };
}
const keep = (run) => { sessionReports.set(run.evidenceHash, run); return run; };
const reportInput = {
  reportHash: z.string().regex(HASH64).optional().describe('64-hex SHA-256 fingerprint of a report from this session, this checkout or the published site'),
  report: z.record(z.any()).optional().describe('The original report JSON, if it is not published'),
};
const read = { readOnlyHint: true, openWorldHint: true };

export const TOOLS = [
  {
    name: 'network_status', title: 'Network status',
    description: 'Finalized head, runtime and identity of Portaldot V3 Testnet or V3 Live, read from the official node. On the testnet it also maps the finalized block to its EVM hash and reads the EVM chain ID.',
    inputSchema: { network: z.enum(['testnet', 'live']).default('testnet') },
    annotations: { ...read, idempotentHint: true },
    run: ({ network }) => service.networkStatus(network),
  },
  {
    name: 'check_release', title: 'Check a release',
    description: 'Run a ReviveCheck acceptance plan against the V3 testnet at one finalized block, through the native and EVM interfaces, and seal a report (SHA-256). Pass `release` for the pUSD token-list demo (v1.0.0 fails on decimals, v1.0.1 passes) or `plan` for your own. A plan is { name, release, profile: "native-asset", logicalContractId, nativeAsset: { assetId }, listing: { chainId, address, symbol, name, decimals } } or a contract profile with { contractAddress, account, assertions }. Pass `previousReportHash` to make it a recheck.',
    inputSchema: {
      release: z.enum(['v1.0.0', 'v1.0.1']).optional().describe('A demo release of the pUSD token list'),
      plan: z.record(z.any()).optional().describe('Your own acceptance plan'),
      previousReportHash: z.string().regex(HASH64).optional(),
      includeReport: z.boolean().default(false).describe('Also return the full sealed report JSON'),
    },
    annotations: read,
    run: async ({ release, plan, previousReportHash, includeReport }) => {
      if (!release === !plan) throw new Error('Pass either a demo `release` or your own `plan`.');
      const previous = previousReportHash ? await loadReport({ reportHash: previousReportHash }) : null;
      const run = keep(release ? await service.checkDemoRelease(release, previous) : await service.checkRelease(plan, { previous }));
      return { ...summarize(run), ...(includeReport ? { report: run } : {}), next: run.status === 'passed' ? 'replay_report, assess_promotion, or prepare_transaction to submit it to the ReleaseRegistry' : 'Fix the release and check again with previousReportHash' };
    },
  },
  {
    name: 'get_report', title: 'Get a report',
    description: 'Load a sealed report by fingerprint, recompute its SHA-256, and summarize its checks and checkpoint with explorer links.',
    inputSchema: { ...reportInput, includeReport: z.boolean().default(false) },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async ({ includeReport, ...args }) => { const run = await loadReport(args); return { ...summarize(run), integrity: 'sha-256 verified', viewerUrl: `${PUBLIC_REVIEW_URL}?report=${run.evidenceHash}#/review`, ...(includeReport ? { report: run } : {}) }; },
  },
  {
    name: 'replay_report', title: 'Replay a report',
    description: 'Re-read every observation of a testnet report at its own pinned finalized block, through both interfaces, and compare value by value. Observations this replay cannot re-read yet (contract code, ABI assertions, account mapping, transaction evidence) make the status "partial" and are listed under coverage.unsupported; only full coverage with every value matching is "reproduced". Shows the chain still returns what the report recorded.',
    inputSchema: reportInput,
    annotations: { ...read, idempotentHint: true },
    run: async (args) => service.replay(await loadReport(args)),
  },
  {
    name: 'compare_reports', title: 'Compare two reports',
    description: 'Compare a baseline and a candidate report of the same release target: which checks changed, and whether the plan, environment or checkpoint differ.',
    inputSchema: { baselineHash: z.string().regex(HASH64), candidateHash: z.string().regex(HASH64) },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async ({ baselineHash, candidateHash }) => service.compare(await loadReport({ reportHash: baselineHash }), await loadReport({ reportHash: candidateHash })),
  },
  {
    name: 'assess_promotion', title: 'Assess promotion to V3 Live',
    description: 'Ask V3 Live whether a passed testnet report can stand for it: network identity, the chain the release names, runtime, asset existence and the EVM interface. Seals a promotion report. Nothing is deployed or listed.',
    inputSchema: reportInput,
    annotations: read,
    run: async (args) => { const run = keep(await service.assessPromotion(await loadReport(args))); return summarize(run); },
  },
  {
    name: 'read_registry', title: 'Read the ReleaseRegistry',
    description: `Read a release from the shared ReleaseRegistry (${service.REGISTRY.address}) through the EVM RPC and ReviveApi at one finalized block: owner, revision, report hash, and optionally one reviewer's decision on the current revision. Identify it by releaseId, or by owner (H160) and label.`,
    inputSchema: {
      releaseId: z.string().regex(HASH64).optional(),
      owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      label: z.string().min(1).max(31).optional(),
      reviewer: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    },
    annotations: { ...read, idempotentHint: true },
    run: (args) => service.readRegistry(args),
  },
  {
    name: 'prepare_transaction', title: 'Prepare a transaction',
    description: 'Build an unsigned transaction for the user to sign in their own wallet: a ReleaseRegistry submit or review, a VerifiedTokenList list, a remark.store that puts a sealed report on-chain, or a System.remark_with_event review attestation. With `from` (SS58 or H160) a contract call is dry-run: weight, storage deposit, and the revert reason if it would fail (EmptyName, EmptyReport, UnknownRelease, StaleReport, ReleaseNotApproved, ReportMismatch, NotReleaseOwner, DecimalsMismatch). This tool never signs.',
    inputSchema: {
      action: z.enum(['submit', 'review', 'list', 'store', 'remark']),
      reportHash: z.string().regex(HASH64),
      label: z.string().min(1).max(31).optional().describe('submit: the release label, at most 31 bytes'),
      releaseId: z.string().regex(HASH64).optional().describe('review, list: the release'),
      approved: z.boolean().default(true).describe('review: approve or request changes'),
      decision: z.enum(['accepted', 'changes-requested']).default('accepted').describe('remark: the decision to record'),
      token: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().describe('list: the ERC-20 token or precompile'),
      reviewer: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().describe('list: the reviewer whose approval the listing relies on'),
      decimals: z.number().int().min(0).max(255).optional().describe('list: the decimals the release claims'),
      from: z.string().min(3).max(64).optional().describe('The signer, to dry-run the call'),
    },
    annotations: { ...read, idempotentHint: true },
    run: async (args) => service.prepareTransaction({ ...args, reportHash: bare(args.reportHash), releaseId: args.releaseId && `0x${bare(args.releaseId)}`, report: args.action === 'store' ? await loadReport({ reportHash: args.reportHash }) : undefined }),
  },
  {
    name: 'retrieve_evidence', title: 'Retrieve stored evidence',
    description: 'Retrieve a sealed report that was stored on Portaldot through remark.store, from chain data alone: the extrinsic in a canonical finalized block, its Remark.Stored event (publisher and blake2-256 content hash), and the report’s own SHA-256. Returns the report.',
    inputSchema: { extrinsicHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/), blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(), expectedHash: z.string().regex(HASH64).optional().describe('Fail unless the stored report has this SHA-256') },
    annotations: { ...read, idempotentHint: true },
    run: async (args) => { const result = await service.retrieveEvidence(args); if (result.run) keep(result.run); return result; },
  },
  {
    name: 'token_list_status', title: 'Token list status',
    description: `Read a token's entry in the VerifiedTokenList, the registry's reference consumer, through the EVM RPC and ReviveApi at one finalized block: whether it is listed right now, and which release, report hash and reviewer the listing relies on.`,
    inputSchema: { token: z.string().regex(/^0x[a-fA-F0-9]{40}$/) },
    annotations: { ...read, idempotentHint: true },
    run: (args) => service.readTokenList(args),
  },
  {
    name: 'list_releases', title: 'List releases',
    description: 'The public data feed: every release in the ReleaseRegistry with its revisions and decisions, every VerifiedTokenList listing, and every report stored on-chain, each row with its block and extrinsic. Built from the official explorer index; re-read the chain to verify any row.',
    inputSchema: { owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().describe('Only this owner’s releases'), label: z.string().optional() },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async ({ owner, label }) => { const feed = await loadFeed(); const releases = feed.releases.filter((item) => (!owner || item.owner === owner.toLowerCase()) && (!label || item.label === label)); return { ...feed, releases }; },
  },
  {
    name: 'verify_attestation', title: 'Verify an attestation',
    description: 'Verify an on-chain review attestation from chain data alone: a signed, successful System.remark_with_event in a canonical finalized block, whose Remarked event matches the signer and the remark digest of "revivecheck:1:review:<decision>:<report hash>".',
    inputSchema: { extrinsicHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/), blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional() },
    annotations: { ...read, idempotentHint: true },
    run: (args) => service.verifyAttestation(args),
  },
];
