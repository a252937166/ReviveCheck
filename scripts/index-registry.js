import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stringToU8a, u8aToString, hexToU8a } from '@polkadot/util';
import { blake2AsHex } from '@polkadot/util-crypto';
import { REGISTRY, registryInterface, labelText } from '../lib/registry.js';
import { TOKEN_LIST, TOKEN_LIST_VERSIONS, tokenListInterface } from '../lib/tokenlist.js';
import { verifyRun } from '../lib/report.js';
import { NETWORKS } from '../lib/networks.js';

// Build the public data feed from the official explorer's event index: every
// ReleaseRegistry and VerifiedTokenList event, and every report stored through
// remark.store, each with its block and extrinsic. Writes public/api/registry.json.
// The feed is a convenience: every row names the block and extrinsic it came from.
const network = NETWORKS.testnet;
const FROM = Number(REGISTRY.deploy.blockNumber);
const out = 'public/api/registry.json';
const get = async (path) => { const response = await fetch(`${network.explorerApi}${path}`, { signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response.json(); };
const blocks = new Map();
async function extrinsicAt(height, index) {
  if (!blocks.has(height)) blocks.set(height, get(`/blocks/${height}/extrinsics`).then((data) => data.items || []));
  const item = (await blocks.get(height)).find((entry) => entry.indexer?.extrinsicIndex === index);
  return item ? { hash: item.hash, signer: item.signer, call: item.call, time: new Date(item.indexer.blockTime).toISOString() } : null;
}
// The explorer lists events newest first; stop once we are older than the registry.
async function* events(section, method) {
  for (let page = 0; page < 500; page += 1) {
    const items = (await get(`/events?section=${section}&method=${method}&page=${page}&pageSize=100`)).items || [];
    if (!items.length) return;
    for (const item of items) { if (item.indexer.blockHeight < FROM) return; yield item; }
    if (items.length < 100) return;
  }
}
const arg = (item, name) => item.args?.find((entry) => entry.name === name)?.value;
const lower = (value) => String(value ?? '').toLowerCase();

// Every verified token-list deployment is indexed, not only the active one, so v1 listings stay in the feed after v2 activates.
const LISTS = new Map(Object.entries(TOKEN_LIST_VERSIONS).filter(([key, value]) => key !== 'active' && value?.address).map(([, value]) => [value.address, value.version]));
const releases = new Map(), listings = [], delistings = [], evidence = [], history = [];
for await (const item of events('revive', 'ContractEmitted')) {
  const contract = lower(arg(item, 'contract'));
  const isRegistry = contract === REGISTRY.address, isList = LISTS.has(contract);
  if (!isRegistry && !isList) continue;
  let log;
  try { log = (isRegistry ? registryInterface : tokenListInterface).parseLog({ topics: arg(item, 'topics'), data: arg(item, 'data') }); } catch { continue; }
  if (!log) continue;
  const where = await extrinsicAt(item.indexer.blockHeight, item.indexer.extrinsicIndex);
  const at = { blockNumber: String(item.indexer.blockHeight), blockHash: item.indexer.blockHash, extrinsicHash: where?.hash ?? null, signer: where?.signer ?? null, time: where?.time ?? new Date(item.indexer.blockTime).toISOString() };
  const a = log.args;
  if (log.name === 'ReportSubmitted') history.push({ type: 'submitted', releaseId: lower(a.releaseId), owner: lower(a.owner), label: labelText(a.name), revision: a.revision.toString(), reportHash: lower(a.reportHash), ...at });
  else if (log.name === 'ReportReviewed') history.push({ type: 'reviewed', releaseId: lower(a.releaseId), reviewer: lower(a.reviewer), revision: a.revision.toString(), reportHash: lower(a.reportHash), approved: a.approved, ...at });
  else if (log.name === 'Listed') listings.push({ token: lower(a.token), releaseId: lower(a.releaseId), reviewer: lower(a.reviewer), reportHash: lower(a.reportHash), decimals: Number(a.decimals), list: contract, version: LISTS.get(contract), ...at });
  else if (log.name === 'Delisted') delistings.push({ token: lower(a.token), releaseId: lower(a.releaseId), by: lower(a.by), list: contract, version: LISTS.get(contract), ...at });
}
// Oldest first, so revisions and decisions fold in order.
history.sort((x, y) => Number(x.blockNumber) - Number(y.blockNumber) || 0);
for (const event of history) {
  const release = releases.get(event.releaseId) || { releaseId: event.releaseId, owner: null, label: null, revision: '0', reportHash: null, decisions: {}, history: [] };
  if (event.type === 'submitted') Object.assign(release, { owner: event.owner, label: event.label, revision: event.revision, reportHash: event.reportHash, decisions: {} });
  else release.decisions[event.reviewer] = { revision: event.revision, approved: event.approved, blockNumber: event.blockNumber, extrinsicHash: event.extrinsicHash };
  release.history.push(event);
  releases.set(event.releaseId, release);
}
for await (const item of events('remark', 'Stored')) {
  const where = await extrinsicAt(item.indexer.blockHeight, item.indexer.extrinsicIndex);
  const entry = { publisher: where?.signer ?? arg(item, 'sender') ?? null, contentHash: lower(arg(item, 'contentHash') ?? arg(item, 'content_hash')), reportHash: null, release: null, bytes: null, blockNumber: String(item.indexer.blockHeight), blockHash: item.indexer.blockHash, extrinsicHash: where?.hash ?? null, time: where?.time ?? null };
  const stored = where?.call?.section === 'remark' && where.call.method === 'store' ? where.call.args?.[0]?.value : null;
  if (typeof stored === 'string' && stored.startsWith('0x')) {
    try {
      const bytes = hexToU8a(stored);
      const run = JSON.parse(u8aToString(bytes));
      if (verifyRun(run) && blake2AsHex(bytes, 256) === entry.contentHash) Object.assign(entry, { reportHash: run.evidenceHash, release: run.release ?? null, project: run.projectName ?? null, bytes: bytes.length });
    } catch { /* not a ReviveCheck report; listed by content hash only */ }
  }
  evidence.push(entry);
}
const overview = await get('/overview');
const feed = {
  schema: 'revivecheck.feed.v1', network: network.key, chainId: network.chainId, generatedAt: new Date().toISOString(), indexedTo: overview.finalizedHeight,
  source: { explorerApi: network.explorerApi, from: FROM, note: 'Every row names its block and extrinsic. Re-read the chain to verify; the feed is a convenience.' },
  registry: { address: REGISTRY.address, deploy: REGISTRY.deploy },
  tokenList: TOKEN_LIST.address ? { address: TOKEN_LIST.address, version: TOKEN_LIST.version, curator: TOKEN_LIST.curator ?? null, deploy: TOKEN_LIST.deploy } : null,
  tokenLists: Object.entries(TOKEN_LIST_VERSIONS).filter(([key, value]) => key !== 'active' && value?.address).map(([key, value]) => ({ key, version: value.version, address: value.address, curator: value.curator, deploy: value.deploy, active: key === TOKEN_LIST_VERSIONS.active, knownIssue: value.knownIssue ?? null })),
  releases: [...releases.values()].sort((x, y) => Number(y.history.at(-1).blockNumber) - Number(x.history.at(-1).blockNumber)),
  listings: listings.sort((x, y) => Number(y.blockNumber) - Number(x.blockNumber)),
  delistings: delistings.sort((x, y) => Number(y.blockNumber) - Number(x.blockNumber)),
  evidence: evidence.sort((x, y) => Number(y.blockNumber) - Number(x.blockNumber)),
};
await mkdir('public/api', { recursive: true });
await writeFile(out, `${JSON.stringify(feed, null, 2)}\n`);
console.log(JSON.stringify({ status: 'indexed', releases: feed.releases.length, decisions: history.filter((event) => event.type === 'reviewed').length, listings: listings.length, delistings: delistings.length, tokenLists: feed.tokenLists.map((list) => `v${list.version}@${list.address}`), evidence: evidence.length, indexedTo: feed.indexedTo, out }, null, 2));
