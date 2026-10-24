// The public landing: release approvals as a product, opening into the app.
// Every number on it is a recorded block or a count from the public feed.
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, LayoutDashboard, Play, Workflow } from 'lucide-react';
import { STAGES, LANES } from './stages.js';
import { short } from './components.jsx';
import { Badge, ChainLink, CodeBlock, CopyButton, REPO, useNetworkHead, useTestnetHead } from './site.jsx';
import { Odometer, Reveal, reduceMotion, useAutoAdvance, useInView, useSequence } from './motion.jsx';
import { useRecords, recordedState, counts, activity, evidenceFor, listingFor, reviewerLink, fmt, when, TESTNET, LIVE } from './records.js';

const SECTIONS = ['products', 'product-middleware', 'product-storage', 'product-api', 'rules', 'lifecycle', 'activity', 'audience'];
const MCP_COMMAND = 'claude mcp add revivecheck -- node mcp/server.js';
const strip = (hash) => String(hash || '').replace(/^0x/, '');
const KIND = { submitted: 'submitted', approved: 'approved', changes: 'changes requested', listed: 'listed', stored: 'stored' };

/* The hero: the recorded release in the registry, its on-chain status stepping through on load. */
function Hero({ data, head }) {
  const { studio } = data;
  const listing = listingFor(data);
  const stored = studio ? evidenceFor(data, studio.reports.recheck.reportHash) : null;
  const ready = !!studio;
  const phase = useSequence(4, { start: ready, delay: 700, gap: 650 });
  const live = Number.isSafeInteger(head.number);
  const steps = studio ? [
    ['Submitted to the registry', <>Revision {studio.release.revision} · <ChainLink hash={studio.submit.extrinsicHash} kind="extrinsic">#{fmt(studio.submit.blockNumber)}</ChainLink></>],
    ['Approved by its reviewer', <>Exact report hash · <ChainLink hash={studio.approve.extrinsicHash} kind="extrinsic">#{fmt(studio.approve.blockNumber)}</ChainLink></>],
    ['Listed by a contract', listing ? <>VerifiedTokenList · <ChainLink hash={listing.extrinsicHash} kind="extrinsic">#{fmt(listing.blockNumber)}</ChainLink></> : 'VerifiedTokenList'],
    ['Verified through both interfaces', <>Both interfaces agree at #{fmt(studio.readback.block.number)} · standing</>],
  ] : [['Submitted to the registry', ''], ['Approved by its reviewer', ''], ['Listed by a contract', ''], ['Verified through both interfaces', '']];
  return <section className="hero-wrap" aria-labelledby="hero-title">
    <div className="hero-ground" aria-hidden="true"/>
    <div className="hero">
      <div className="hero-copy">
        <p className="hero-chip"><span className={`dot ${live ? head.status : 'idle'}`} aria-hidden="true"/>Live on the Portaldot V3 testnet{live && <> · <ChainLink hash={head.hash}>#{fmt(head.number)}</ChainLink></>}</p>
        <h1 id="hero-title">Release approvals your contracts enforce.</h1>
        <p className="hero-sub">A registry on Portaldot V3 that records who approved which exact report, contracts that act only while that approval stands, and evidence anyone can read back from the chain.</p>
        <div className="hero-actions"><a className="btn btn-primary btn-lg" href="#/app">Open the app<ArrowRight size={17} aria-hidden="true"/></a><a className="btn btn-secondary btn-lg" href="#/rules">How it is enforced</a></div>
        <p className="hero-source">Open source · <a href={REPO} target="_blank" rel="noreferrer">github.com/a252937166/ReviveCheck</a></p>
      </div>
      <div className="hero-stack">
        <div className={`ac-toast ${phase >= 3 ? 'in' : ''}`} aria-hidden={phase < 3}><span className="toast-icon"><Check size={16} aria-hidden="true"/></span><div><strong>Listing allowed</strong><span>pUSD · VerifiedTokenList{listing && <> · #{fmt(listing.blockNumber)}</>}</span></div></div>
        <article className="approval-card" aria-label="The recorded release in the registry">
          <div className="ac-head"><strong>pusd-token-list<span className="mono">revision {studio?.release.revision ?? '1'}</span></strong><Badge status="approved">Approved</Badge></div>
          <p className="ac-label">Approved at block</p>
          <p className="ac-number"><Odometer value={studio ? `#${fmt(studio.approve.blockNumber)}` : '#000,000'} start={ready}/></p>
          <p className="ac-caption">In the ReleaseRegistry on the V3 testnet, read back through the EVM RPC and ReviveApi</p>
          <div className="ac-meter">
            <div className="ac-meter-head"><span>Replayed at its own block</span><strong>{studio ? `${studio.replay.reproduced} of ${studio.replay.total} observations reproduced` : 'Loading the record'}</strong></div>
            <div className="ac-track"><div className="ac-fill" style={{ width: ready && phase >= 1 ? '100%' : '0%' }}/></div>
          </div>
          <dl className="ac-facts">
            <div><dt>Owner</dt><dd className="mono">{studio ? short(studio.release.owner, 12) : '…'}</dd></div>
            <div><dt>Report</dt><dd>{studio ? <a className="hash-link" href={reviewerLink(studio.reports.recheck.reportHash)}>{short(studio.reports.recheck.reportHash, 12)}</a> : '…'}</dd></div>
            <div><dt>Stored</dt><dd>{stored ? <ChainLink hash={stored.extrinsicHash} kind="extrinsic">#{fmt(stored.blockNumber)}</ChainLink> : '…'}</dd></div>
          </dl>
        </article>
        <aside className="tx-card" aria-label="What happened on-chain, in order">
          <h3>On-chain status</h3>
          <ol className="tx-steps">{steps.map(([title, detail], index) => { const last = index === steps.length - 1; const state = last ? (phase >= index ? 'live' : '') : phase > index ? 'done' : phase === index ? 'current' : ''; return <li key={title} className={state}><span className="step-dot" aria-hidden="true">{state === 'done' ? <Check size={12}/> : index + 1}</span><div><strong>{title}</strong><span>{detail}</span></div></li>; })}</ol>
        </aside>
      </div>
    </div>
    <p className="hero-note">Recorded on the V3 testnet by one isolated test account acting as both owner and reviewer: the mechanism, not independent review. Every block number links to the official explorer.</p>
  </section>;
}

function Stats({ data }) {
  const c = counts(data);
  const [ref, inView] = useInView(0.3);
  const items = [
    ['Records on-chain', c.records, 'Linked from this site, each one an explorer click away'],
    ['Approvals standing', c.approvals, 'Current revisions with a reviewer’s approval in the registry'],
    ['Reports stored', c.stored, 'Sealed reports kept in Portaldot blocks through remark.store'],
    ['Tokens listed', c.listings, 'Unique tokens with a listing event in the feed; validity is read live in the app'],
  ];
  return <section className="stats" ref={ref} aria-label="ReviveCheck in numbers">
    <div className="stats-inner">
      <h2>Real numbers from the published records, every one linked to a block.</h2>
      <dl className="stats-grid">{items.map(([label, value, note]) => <div className="stat" key={label}><dt>{label}</dt><dd><Odometer value={data.loaded ? String(value) : '0'} start={inView && !!data.loaded}/></dd><p>{note}</p></div>)}</dl>
      <p className="stats-note">ReviveCheck holds no key. Every write is dry-run in the browser and signed in the visitor’s own wallet; reads need no wallet at all.</p>
    </div>
  </section>;
}

/* The permissions the registry enforces, each with its live value from the record. */
function Rules({ data }) {
  const { studio } = data;
  const listing = listingFor(data);
  const rules = [
    { title: 'An approval names one exact report hash', text: 'A reviewer approves the hash they read, nothing broader. A decision on a superseded report reverts with StaleReport.', chips: [['ok', studio ? `Revision ${studio.release.revision} · approved` : 'Approved'], ['', studio ? `report ${short(studio.reports.recheck.reportHash, 12)}` : 'report hash']] },
    { title: 'A new revision clears every approval', text: 'Each submission opens a new revision with no decision on it, so an approval never silently carries over to a newer report.', chips: [['ok', 'Cleared on submit, by the contract'], ['', 'ReportSubmitted → revision + 1']] },
    { title: 'Only the release owner lists, and only while approved', text: 'The VerifiedTokenList accepts a listing from the owner of the release it names, for the named reviewer’s current approval, and un-lists it the moment that approval lapses.', chips: [['ok', listing ? `pUSD listed · #${fmt(listing.blockNumber)}` : 'pUSD listed'], ['', 'ReviveCheckGuard.requireApproved']] },
    { title: 'Both interfaces must agree before a value is reported', text: 'Every readback ReviveCheck makes runs through the EVM RPC and ReviveApi at the same finalized block, and a disagreement is reported, never averaged away. This one is the verification service’s rule, not a contract’s.', chips: [['ok', studio ? `Agree at #${fmt(studio.readback.block.number)}` : 'Interfaces agree'], ['', 'read_registry · token_list_status']] },
  ];
  return <section className="rules" id="rules" aria-labelledby="rules-title">
    <Reveal className="rules-band on-band">
      <h2 id="rules-title">Permissions the registry enforces, not a policy someone remembers.</h2>
      <p className="lede">An approval in ReviveCheck is a permission a contract checks on-chain. Three of these rules are written into the ReleaseRegistry and the ReviveCheckGuard library, where nothing off-chain can loosen them; the fourth is how ReviveCheck reads them.</p>
      <div className="rules-grid">{rules.map((rule) => <article className="rule" key={rule.title}><h3>{rule.title}</h3><p>{rule.text}</p><div className="rule-chips">{rule.chips.map(([tone, text]) => <span className={`chip-dark ${tone}`} key={text}>{text}</span>)}</div></article>)}</div>
      <p className="rules-note">The token list on the testnet is v1: any release owner can replace a token’s entry with their own approved release. The v2 source in the repository adds entry ownership, a delist call and a curator override, with regression tests; it awaits its own deployment.</p>
      <div className="rules-actions"><a className="btn btn-primary btn-lg" href="#/app">See the registry live<ArrowRight size={16} aria-hidden="true"/></a><a className="btn btn-ghost btn-lg" href="#/docs/middleware">Integrate the guard<ArrowRight size={16} aria-hidden="true"/></a></div>
    </Reveal>
  </section>;
}

const DEV = {
  mcp: { label: 'MCP', title: 'Claude Code', code: `claude mcp add revivecheck -- node "$PWD/mcp/server.js"

# then ask: "Check the pUSD token list v1.0.1 on Portaldot V3,
#            store the report on-chain and list it."`, response: `check_release { "release": "v1.0.1" }
→ { "status": "passed", "reportHash": "cbd78faa…18ed427",
    "checkpoint": { "number": "163480" } }
prepare_transaction { "action": "store", "reportHash": "cbd78faa…" }
→ { "bytes": 7404, "contentHash": "0x99c9307f…",
    "native": { "pallet": "remark", "call": "store" } }` },
  rest: { label: 'REST', title: 'Local workbench API', code: `curl -s http://127.0.0.1:4173/api/tools/token_list_status \\
  -H 'Content-Type: application/json' \\
  -d '{"token":"0x00001E6100000000000000000000000000010000"}'`, response: `{
  "listed": true,
  "entry": { "releaseId": "0xe3f6ab77…f808",
             "reportHash": "0xcbd78faa…18ed427",
             "reviewer": "0x48b9e37a…a71b" },
  "interfacesAgree": true
}` },
  js: { label: 'JavaScript', title: 'lib/service.js', code: `import { checkDemoRelease, readRegistry, readTokenList } from './lib/service.js';

const report = await checkDemoRelease('v1.0.1');
const release = await readRegistry({ releaseId, reviewer });
const listing = await readTokenList({ token: pUSD });`, response: `report.status             // 'passed'
release.decision.approved // true, through EVM RPC and ReviveApi
listing.listed            // true while that approval stands` },
  cli: { label: 'CLI', title: 'Terminal', code: `npm run rc -- retrieve_evidence \\
  --extrinsicHash 0x14b66988c9b160c1442485eae729ec92731fedd45820f8b63718f2c6405520ac`, response: `{
  "verified": true,
  "blockNumber": "164266",
  "length": 7404,
  "contentHash": "0x99c9307f…9e5a4e3e",
  "reportHash": "cbd78faa…18ed427"
}` },
};

function ApiVisual() {
  const [tab, setTab] = useState('mcp');
  return <div className="visual-card api-visual">
    <div className="visual-head"><div className="tabs" role="tablist" aria-label="Integration">{Object.entries(DEV).map(([id, item]) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={`dev-${id}`} id={`dev-tab-${id}`} onClick={() => setTab(id)}>{item.label}</button>)}</div></div>
    <div role="tabpanel" id={`dev-${tab}`} aria-labelledby={`dev-tab-${tab}`} className="dev-pair"><CodeBlock code={DEV[tab].code} title={DEV[tab].title}/><CodeBlock code={DEV[tab].response} title="Response, from a real run"/></div>
  </div>;
}

function RegistryVisual({ data }) {
  const { registry, tokenList } = data;
  const listing = listingFor(data);
  if (!registry) return <div className="visual-card loading" aria-hidden="true"/>;
  return <div className="visual-card">
    <div className="visual-head"><Badge status="finalized">Deployed</Badge><strong>ReleaseRegistry · VerifiedTokenList</strong><span className="mono">V3 Testnet</span></div>
    <pre className="app-code" aria-label="Guard integration"><code><span className="note">// any contract, three lines</span><span><i>using</i> ReviveCheckGuard <i>for</i> IReleaseRegistry;</span><span>registry.<i>requireApproved</i>(id, reviewer, reportHash);</span><span className="note">// reverts ReleaseNotApproved or ReportMismatch</span></code></pre>
    <dl className="kv-list compact in-card">
      <div className="kv"><dt>Registry</dt><dd><ChainLink hash={registry.deploy.extrinsicHash} kind="extrinsic">{short(registry.contract, 14)}</ChainLink> · #{fmt(registry.deploy.blockNumber)}</dd></div>
      {tokenList?.deploy && <div className="kv"><dt>Token list</dt><dd><ChainLink hash={tokenList.deploy.extrinsicHash} kind="extrinsic">{short(tokenList.contract, 14)}</ChainLink> · #{fmt(tokenList.deploy.blockNumber)}</dd></div>}
      {listing && <div className="kv"><dt>isListed(pUSD)</dt><dd><Badge status="approved">true</Badge> at #{fmt(listing.readback.block.number)}, both interfaces agree</dd></div>}
    </dl>
  </div>;
}

function StorageVisual({ data }) {
  const stored = data.evidence?.items?.[0];
  const feed = data.feed;
  if (!stored) return <div className="visual-card loading" aria-hidden="true"/>;
  return <div className="visual-card">
    <div className="visual-head"><Badge status="passed">Retrieved and verified</Badge><strong>Report {short(stored.reportHash, 12)}</strong><ChainLink hash={stored.extrinsicHash} kind="extrinsic">#{fmt(stored.blockNumber)}</ChainLink></div>
    <dl className="kv-list compact in-card">
      <div className="kv"><dt>Stored</dt><dd>{fmt(stored.bytes)} bytes through <span className="mono">remark.store</span>, fee {Number(stored.feeTpot).toFixed(2)} tPOT</dd></div>
      <div className="kv"><dt>SHA-256</dt><dd className="mono">{short(stored.reportHash, 22)}</dd></div>
      <div className="kv"><dt>blake2-256</dt><dd className="mono">{short(stored.contentHash, 22)} <span className="muted">from Remark.Stored</span></dd></div>
      <div className="kv"><dt>Publisher</dt><dd className="mono">{short(stored.publisher, 16)}</dd></div>
    </dl>
    <div className="visual-foot"><span>{feed ? `Feed: ${feed.releases.length} release${feed.releases.length === 1 ? '' : 's'}, ${feed.listings.length} listing${feed.listings.length === 1 ? '' : 's'}, ${feed.evidence.length} stored report${feed.evidence.length === 1 ? '' : 's'}, indexed to #${fmt(feed.indexedTo)}` : 'Feed: api/registry.json'}</span><a className="text-link" href="./api/registry.json" target="_blank" rel="noreferrer">api/registry.json<ArrowUpRight size={13} aria-hidden="true"/></a></div>
  </div>;
}

const MODULES = [
  ['Revive', 'Runs the registry and the token list; reachable as EVM transactions or native Revive.call'],
  ['ReviveApi', 'Maps accounts and blocks between the interfaces, so each read is one finalized height through both'],
  ['Assets + precompiles', 'Native Assets storage and its ERC-20 precompile, compared for the demo release'],
  ['Remark', 'Keeps the sealed report bytes in the block and emits their content hash: the evidence store'],
];

function Products({ data }) {
  const rows = [
    { id: 'middleware', title: 'Middleware: a release registry other contracts can trust', body: 'ReleaseRegistry records which report hash a release owner committed and which reviewers approved it. Each new submission opens a revision with no approval, and a decision names the exact hash it covers. The ReviveCheckGuard library lets any Solidity contract on V3 act on that state; the VerifiedTokenList is the reference consumer, live on the testnet.', points: ['Approvals bound to one exact report hash and revision', 'Three lines of Solidity to gate your own contract', 'Readable through the EVM RPC and ReviveApi alike'], action: ['Integrate the guard', '#/docs/middleware'], visual: <RegistryVisual data={data}/> },
    { id: 'storage', title: 'Storage: evidence on Portaldot, not on a website', body: 'A sealed report is written to the chain through Portaldot’s native Remark module. The block keeps the bytes; Remark.Stored carries the publisher and a content hash. Anyone retrieves the report from any node, checks both hashes, and replays its observations at the pinned block. A public feed, built from chain events, lists every release, decision, listing and stored report.', points: ['Content-addressed: SHA-256 of the report, blake2-256 of the bytes', 'Replayable at its own finalized block, through both interfaces', 'api/registry.json, with a block and extrinsic on every row'], action: ['Retrieve a stored report', '#/app/evidence'], visual: <StorageVisual data={data}/> },
    { id: 'api', title: 'API: one verification layer for agents, apps and CI', body: 'Twelve read-only tools cover checking, storing, registering, consuming and promoting a release. They are served over MCP for agents, REST on the local workbench, as a JavaScript module and as a CLI, from one implementation. Writes are prepared and dry-run, then signed in the user’s own wallet.', points: ['Checks read both V3 interfaces at one finalized block', 'Promotion assessed against V3 Live itself', 'Add it to Claude Code with one command'], action: ['Read the API docs', '#/docs/api'], visual: <ApiVisual/>, command: true },
  ];
  return <section className="section products" id="products" aria-labelledby="products-title">
    <Reveal className="section-head"><h2 id="products-title">Three components, built on Portaldot’s modules</h2><p>Middleware your contracts call, storage that keeps the evidence on-chain, and an API that reaches both. Everything below is deployed and recorded on the V3 testnet.</p></Reveal>
    {rows.map((row, index) => <Reveal as="article" key={row.id} id={`product-${row.id}`} className={`feature-row ${index % 2 ? 'reverse' : ''}`}>
      <div className="feature-copy">
        <h3>{row.title}</h3>
        <p>{row.body}</p>
        <ul>{row.points.map((point) => <li key={point}><Check size={15} aria-hidden="true"/>{point}</li>)}</ul>
        {row.command && <div className="hero-command"><span className="mono"><span aria-hidden="true">$ </span>{MCP_COMMAND}</span><CopyButton value={MCP_COMMAND} label="Copy"/></div>}
        <a className="link-arrow" href={row.action[1]}>{row.action[0]}<ArrowRight size={15} aria-hidden="true"/></a>
      </div>
      <div className="feature-visual">{row.visual}</div>
    </Reveal>)}
    <Reveal className="module-strip">
      <a className="module-brand" href="https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail" target="_blank" rel="noreferrer" aria-label="Built on Portaldot V3 for Portaldot Hacker House 2026"><img src="./brand/portaldot-mark-128.png" width="36" height="36" alt=""/><span><small>Built on</small><strong>Portaldot V3</strong></span></a>
      <dl className="module-list">{MODULES.map(([name, use]) => <div key={name}><dt>{name}</dt><dd>{use}</dd></div>)}</dl>
    </Reveal>
  </section>;
}

/* Where each stage landed in the recorded run: the block to roll in the panel, and its explorer link. */
function recordedRef(data, head, id) {
  const { rec, studio } = data;
  if (!rec) return null;
  const stored = evidenceFor(data, rec.recheck.reportHash) || data.evidence?.items?.[0];
  const listing = listingFor(data);
  switch (id) {
    case 'check': return { label: `#${fmt(rec.check.block.number)}`, hash: rec.check.block.nativeHash, kind: 'block', network: TESTNET, note: `${rec.check.release} failed: decimals listed 18, chain 6` };
    case 'recheck': return { label: `#${fmt(rec.recheck.block.number)}`, hash: rec.recheck.block.nativeHash, kind: 'block', network: TESTNET, note: `${rec.recheck.release} passed, 1 check improved` };
    case 'store': return stored ? { label: `#${fmt(stored.blockNumber)}`, hash: stored.extrinsicHash, kind: 'extrinsic', network: TESTNET, note: `${fmt(stored.bytes)} bytes, fee ${Number(stored.feeTpot).toFixed(2)} tPOT` } : null;
    case 'submit': return studio ? { label: `#${fmt(studio.submit.blockNumber)}`, hash: studio.submit.extrinsicHash, kind: 'extrinsic', network: TESTNET, note: `Revision ${studio.release.revision} of ${studio.release.label}` } : null;
    case 'approve': return studio ? { label: `#${fmt(studio.approve.blockNumber)}`, hash: studio.approve.extrinsicHash, kind: 'extrinsic', network: TESTNET, note: 'Approved; remark attested two blocks later' } : null;
    case 'consume': return listing ? { label: `#${fmt(listing.blockNumber)}`, hash: listing.extrinsicHash, kind: 'extrinsic', network: TESTNET, note: 'pUSD listed on that approval' } : null;
    case 'promote': return { label: `#${fmt(rec.promotion.block.number)}`, hash: rec.promotion.block.nativeHash, kind: 'block', network: LIVE, note: 'V3 Live refused: chain 780780777, runtime 3001, no asset 7777' };
    case 'watch': return Number.isSafeInteger(head.number) ? { label: `#${fmt(head.number)}`, hash: head.hash, kind: 'block', network: TESTNET, note: `${head.specName || 'portaldot-v3'}/${head.specVersion || '…'} now, live` } : { label: 'syncing', note: 'Following both networks' };
    default: return null;
  }
}

function LifecycleTabs({ data, head }) {
  const [ref, inView] = useInView(0.2);
  const { index, select, auto, cycle } = useAutoAdvance(STAGES.length, 6500, inView);
  const stage = STAGES[index];
  const record = recordedRef(data, head, stage.id);
  return <section className="section" id="lifecycle" ref={ref} aria-labelledby="lifecycle-title">
    <Reveal className="section-head"><h2 id="lifecycle-title">Protection at every stage, not one moment.</h2><p>Eight stages across two networks, shown on the recorded run of the pUSD token list. Four stages only read; four write to the chain and need a wallet.</p></Reveal>
    <div className="tabber">
      <div className="tab-list" role="tablist" aria-label="Lifecycle stages">
        {STAGES.map((item, position) => <button key={item.id} type="button" role="tab" className="tab-item" id={`lifecycle-tab-${item.id}`} aria-selected={index === position} aria-controls="lifecycle-panel" onClick={() => select(position)}>
          <span className="tab-num" aria-hidden="true">{String(position + 1).padStart(2, '0')}</span>
          <strong>{item.name}{item.kind === 'write' && <span className="lane-tag write">wallet</span>}{item.lane !== 'testnet' && <span className={`lane-tag ${item.lane}`}>{LANES[item.lane]}</span>}</strong>
          <span className="tab-text">{item.why}</span>
          {index === position && <span className={`tab-progress ${auto ? 'running' : ''}`} key={cycle} style={{ '--interval': '6.5s' }} aria-hidden="true"><i/></span>}
        </button>)}
      </div>
      <div className="tab-panel on-band" role="tabpanel" id="lifecycle-panel" aria-labelledby={`lifecycle-tab-${stage.id}`}>
        <div className="tp-head"><h3>{stage.title}</h3>{stage.kind === 'write' ? <span className="lane-tag write">Your wallet signs</span> : <span className="lane-tag">Read-only · no wallet</span>}</div>
        <ul className="tp-list">{stage.proves.map((item) => <li key={item}>{item}</li>)}<li>{stage.description}</li></ul>
        <p className="tp-limits">Does not show: {stage.limits}</p>
        <div className="tp-foot">
          <dl><div><dt>In the recorded run</dt><dd>{record?.hash ? <ChainLink hash={record.hash} kind={record.kind} network={record.network}><Odometer value={record.label} key={stage.id}/></ChainLink> : <span>{record?.label || '…'}</span>}</dd>{record?.note && <dd className="tp-limits" style={{ fontSize: '.8125rem', marginTop: '.35rem', letterSpacing: 0, fontWeight: 400 }}>{record.note}</dd>}</div></dl>
          <code className="tp-api">{stage.chain ? `${stage.chain} → ${stage.readback}` : stage.tool}</code>
        </div>
        <div className="tp-actions"><a className="btn btn-primary" href={`#/app/run/${stage.id}`}>Try this stage<ArrowRight size={15} aria-hidden="true"/></a><a className="btn btn-ghost" href={`#/docs/${stage.id}`}>Docs</a></div>
      </div>
    </div>
  </section>;
}

function Activity({ data, head }) {
  const items = activity(data).slice(0, 4);
  const stored = data.feed?.evidence || [];
  const items2 = data.evidence?.items || [];
  const totals = items2.length ? { count: items2.length, bytes: items2.reduce((sum, item) => sum + Number(item.bytes || 0), 0), fees: items2.reduce((sum, item) => sum + Number(item.feeTpot || 0), 0) } : null;
  const live = Number.isSafeInteger(head.number);
  return <section className="section" id="activity" aria-labelledby="activity-title">
    <Reveal className="section-head row"><div><h2 id="activity-title">What happened on-chain.</h2><p>No mock-ups. On the left, the registry’s own events from the public feed; on the right, the reports stored in Portaldot blocks. Every row links to the official explorer.</p></div><a className="link-arrow" href="#/app/activity">Open the full activity log<ArrowRight size={15} aria-hidden="true"/></a></Reveal>
    <Reveal className="activity-card" delay={80}>
      <div className="activity-head"><h3>Activity</h3><span className={`live-tag ${live ? '' : 'quiet'}`}><span className={`dot ${live ? head.status : 'idle'}`} aria-hidden="true"/>{live ? <>V3 testnet head <ChainLink hash={head.hash}>#{fmt(head.number)}</ChainLink></> : 'Connecting to the V3 testnet'}</span></div>
      <div className="activity-cols">
        <div className="activity-col">
          <h4>Registry events</h4>
          {items.length ? items.map((item) => <div className="event" key={item.hash}>
            <div className="event-head"><span className={`kind-chip ${item.kind}`}>{KIND[item.kind]}</span><span>{when(item.time)}</span><ChainLink hash={item.hash} kind="extrinsic">#{fmt(item.block)}</ChainLink></div>
            <p>{item.title} by <span className="mono">{short(item.who, 12)}</span>{item.report && <> · report <a className="hash-link" href={reviewerLink(strip(item.report))}>{short(strip(item.report), 10)}</a></>}</p>
          </div>) : <p className="muted">Loading the feed…</p>}
        </div>
        <div className="activity-col">
          <h4>Stored reports</h4>
          {stored.map((item) => <div className="stored-row" key={item.extrinsicHash}><div><a className="hash-link" href={reviewerLink(item.reportHash)}>{short(item.reportHash, 14)}</a><small>{item.project} · {item.release} · {fmt(item.bytes)} bytes</small></div><ChainLink hash={item.extrinsicHash} kind="extrinsic">#{fmt(item.blockNumber)}</ChainLink><Badge status="finalized">Stored</Badge></div>)}
          {totals && <dl className="kv-list compact activity-totals">
            <div className="kv"><dt>Bytes on-chain</dt><dd>{fmt(totals.bytes)} across {totals.count} report{totals.count === 1 ? '' : 's'}</dd></div>
            <div className="kv"><dt>Storage fees</dt><dd>{totals.fees.toFixed(2)} tPOT, paid by the publisher</dd></div>
            {data.studio?.replay && <div className="kv"><dt>Replay</dt><dd>{data.studio.replay.reproduced} of {data.studio.replay.total} observations reproduced at its block</dd></div>}
          </dl>}
          <a className="link-arrow" href="#/app/evidence">Retrieve and verify one from the chain<ArrowRight size={14} aria-hidden="true"/></a>
        </div>
      </div>
      <div className="activity-foot"><span>Feed built from chain events, indexed to #{fmt(data.feed?.indexedTo)} · <a className="text-link" href="./api/registry.json" target="_blank" rel="noreferrer">api/registry.json</a></span><a className="link-arrow" href="#/app">Open the full dashboard<ArrowRight size={15} aria-hidden="true"/></a></div>
    </Reveal>
  </section>;
}

function Audience() {
  const cards = [
    ['Token issuers and listing teams', 'Publish a release with proof that the chain agrees.', 'Check the list against the chain, store the report, submit its hash, and let wallets and DEX allow-lists read the approval on-chain instead of trusting a file.', ['Run the pUSD release', '#/app/run']],
    ['Protocol teams gating launches', 'Put a launch behind an approval a contract checks.', 'Gate a launchpad, a router allow-list or an upgrade with three lines of Solidity. The gate lapses the moment a new revision is submitted.', ['Integrate the guard', '#/docs/middleware']],
    ['Reviewers, auditors, agents and CI', 'Verify from anywhere, sign from your own wallet.', 'Check a release through both V3 interfaces, replay it at its block, and sign a decision from a wallet or a pipeline. Twelve tools, one implementation.', ['Read the API docs', '#/docs/api']],
  ];
  return <section className="section" id="audience" aria-labelledby="audience-title">
    <Reveal className="section-head"><h2 id="audience-title">One registry, three ways in.</h2></Reveal>
    <div className="audience">{cards.map(([who, lead, text, action], index) => <Reveal as="article" className="aud-card" key={who} delay={index * 70}><h3>{who}</h3><p><strong>{lead}</strong> {text}</p><a className="link-arrow" href={action[1]}>{action[0]}<ArrowRight size={15} aria-hidden="true"/></a></Reveal>)}</div>
  </section>;
}

function Deeper() {
  const doors = [
    [Workflow, 'How it works', 'Eight stages, two networks, on the recorded run.', '#/lifecycle', 'See the lifecycle'],
    [BookOpen, 'Docs', 'MCP, REST, JavaScript and CLI, with every tool’s needs and limits.', '#/docs', 'Read the docs'],
    [LayoutDashboard, 'Dashboard', 'Releases, approvals, listings and stored reports, with live lookups.', '#/app', 'Open the app'],
    [Play, 'Run it yourself', 'Eight steps on the real testnet, signed in your own wallet.', '#/app/run', 'Start with Check'],
  ];
  return <section className="section" aria-labelledby="deeper-title">
    <Reveal className="section-head"><h2 id="deeper-title">Go deeper.</h2></Reveal>
    <Reveal className="deeper">{doors.map(([Icon, title, text, href, action]) => <a className="door" key={title} href={href}><span className="door-icon"><Icon size={18} aria-hidden="true"/></span><h3>{title}</h3><p>{text}</p><span className="link-arrow">{action}<ArrowRight size={14} aria-hidden="true"/></span></a>)}</Reveal>
  </section>;
}

export default function Landing() {
  const head = useTestnetHead();
  const data = useRecords();
  useEffect(() => {
    const go = () => {
      const id = location.hash.replace(/^#\/?/, '').split(/[?#/]/)[0];
      if (SECTIONS.includes(id)) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? 'instant' : 'smooth', block: 'start' }), 60);
    };
    go();
    addEventListener('hashchange', go);
    return () => removeEventListener('hashchange', go);
  }, []);
  return <main className="landing" id="main">
    <Hero data={data} head={head}/>
    <Stats data={data}/>
    <Rules data={data}/>
    <Products data={data}/>
    <LifecycleTabs data={data} head={head}/>
    <Activity data={data} head={head}/>
    <Audience/>
    <Deeper/>
    <section className="cta-band" aria-labelledby="closing-title">
      <div className="cta-inner">
        <div><h2 id="closing-title">Put your next release behind an on-chain approval.</h2><p>Check it through both V3 interfaces, store the evidence on Portaldot, and let your contracts act on the decision. Reads need no wallet; writes sign in yours.</p></div>
        <div className="hero-actions"><a className="btn btn-primary btn-lg" href="#/app">Open the app<ArrowRight size={16} aria-hidden="true"/></a><a className="btn btn-secondary btn-lg" href="#/docs/middleware">Integrate the guard<ArrowRight size={16} aria-hidden="true"/></a></div>
      </div>
    </section>
  </main>;
}
