// The app: a registry dashboard over the public records, with live lookups
// through the same service the MCP server uses, the lifecycle run, the report
// reviewer and (on loopback) the local workbench. Reads need no wallet.
import React, { useEffect, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, CircleAlert, Database, ExternalLink, FileCheck2, LayoutDashboard, ListChecks, LoaderCircle, Play, ScanSearch, Search, Wrench } from 'lucide-react';
import Lifecycle from './Lifecycle.jsx';
import Try from './Try.jsx';
import Workspace, { isLoopback } from './Workspace.jsx';
import { Mark, short } from './components.jsx';
import { Badge, ChainLink, CopyButton, NetworkPill, WalletButton, useNetworkHead, useSubRoute, useTestnetHead } from './site.jsx';
import { Odometer } from './motion.jsx';
import { useRecords, recordedState, evidenceRows, counts, activity, listingFor, reviewerLink, fmt, when, useTask, TESTNET, LIVE, PUSD } from './records.js';
import { NETWORKS } from '../lib/networks.js';

const engine = () => import('./engine.js');
const strip = (hash) => String(hash || '').replace(/^0x/, '');
const addressUrl = (network, address) => `${network.explorer}/#/accounts/${address}`;
const KIND = { submitted: 'submitted', approved: 'approved', changes: 'changes requested', listed: 'listed', stored: 'stored' };
const PAGES = [['', 'Overview', LayoutDashboard], ['releases', 'Releases', Database], ['tokens', 'Token list', ListChecks], ['evidence', 'Evidence', FileCheck2], ['activity', 'Activity', Activity], ['run', 'Run the lifecycle', Play]];
const isHash = (value) => /^0x[0-9a-fA-F]{64}$/.test(value.trim());
const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim());

function ContractChip({ label, record }) {
  if (!record) return <span className="contract-chip skeleton" aria-hidden="true"/>;
  return <span className="contract-chip"><span className="contract-dot" aria-hidden="true"/><span>{label}</span><span className="mono">{short(record.contract, 10)}</span><CopyButton value={record.contract} label="Copy"/><ChainLink hash={record.deploy.extrinsicHash} kind="extrinsic"><ExternalLink size={13} aria-label="Deployment on the explorer"/></ChainLink></span>;
}

/** The app frame: a top bar, a section rail, and the page. `bare` pages bring their own main element. */
export function AppShell({ page, bare = false, wide = false, children }) {
  const head = useTestnetHead();
  const data = useRecords();
  const strip = React.useRef(null);
  // On a phone the section rail is a horizontal strip: keep the current section in view and drop the edge fade once scrolled to the end.
  useEffect(() => {
    const nav = strip.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return undefined;
    nav.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    const update = () => { nav.classList.toggle('at-start', nav.scrollLeft <= 4); nav.classList.toggle('at-end', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 4); };
    update();
    nav.addEventListener('scroll', update, { passive: true });
    return () => nav.removeEventListener('scroll', update);
  }, [page]);
  const c = counts(data);
  const countFor = { releases: c.releases, tokens: c.listings, evidence: c.stored, activity: activity(data).length };
  const Main = bare ? 'div' : 'main';
  return <div className="app">
    <header className="app-top">
      <a className="wordmark" href="#/" aria-label="ReviveCheck home"><Mark size={24}/><span>ReviveCheck</span></a>
      <span className="app-tag">App</span>
      <div className="app-top-end"><NetworkPill head={head}/><WalletButton/><a className="btn btn-ghost btn-sm" href="#/docs">Docs</a><a className="btn btn-ghost btn-sm" href="#/">Site</a></div>
    </header>
    <div className={`app-frame ${wide ? 'wide' : ''}`}>
      {!wide && <aside className="app-side" aria-label="App sections">
        <nav className="side-nav" ref={strip}>
          {PAGES.map(([id, label, Icon]) => <a key={id} className="side-link" href={`#/app${id ? `/${id}` : ''}`} aria-current={page === id ? 'page' : undefined}><Icon size={17} aria-hidden="true"/><span>{label}</span>{countFor[id] ? <span className="count">{countFor[id]}</span> : null}</a>)}
          <a className="side-link" href="#/review" aria-current={page === 'review' ? 'page' : undefined}><ScanSearch size={17} aria-hidden="true"/><span>Report reviewer</span></a>
          {isLoopback() && <a className="side-link" href="#/app/workbench" aria-current={page === 'workbench' ? 'page' : undefined}><Wrench size={17} aria-hidden="true"/><span>Local workbench</span></a>}
        </nav>
        <div className="side-group"><span className="side-label">Contracts on the V3 testnet</span><ContractChip label="Registry" record={data.registry}/><ContractChip label="Token list" record={data.tokenList}/></div>
      </aside>}
      <Main className="app-main" id={bare ? undefined : 'main'}>{children}</Main>
    </div>
  </div>;
}

function Busy({ task, children }) {
  if (task.busy) return <div className="working" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true"/><div><strong>{task.busy}</strong><span>{task.elapsed ? `${task.elapsed} s` : ''}{task.elapsed > 8 ? ' · the public node can take up to a minute to hand out metadata on first contact' : ''}</span></div></div>;
  if (task.error) return <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Nothing was read.</strong> {task.error}{children}</div></div>;
  return null;
}

function Tile({ label, value, note, loaded }) {
  return <div className="tile"><dt>{label}</dt><dd><Odometer value={loaded ? String(value) : '0'} start={loaded}/></dd><p>{note}</p></div>;
}

function Overview({ data, head, liveHead }) {
  const c = counts(data);
  const { studio, registry } = data;
  const listing = listingFor(data);
  const state = recordedState(data, head.specVersion);
  const recent = activity(data).slice(0, 5);
  const live = Number.isSafeInteger(head.number);
  const liveKnown = Number.isSafeInteger(liveHead.number);
  const rules = [
    ['Approval names one exact hash', studio ? `revision ${studio.release.revision} · ${short(strip(studio.reports.recheck.reportHash), 10)}` : '…'],
    ['New revision clears approvals', 'enforced in submit()'],
    ['Only the owner lists, while approved', listing ? `pUSD listed · #${fmt(listing.blockNumber)}` : 'no listing yet'],
    ['Both interfaces agree', studio ? `at #${fmt(studio.readback.block.number)}` : '…'],
  ];
  return <>
    <div className="page-head">
      <div><h1>ReleaseRegistry</h1><p>The shared registry on the V3 testnet and the contracts that read it. Reads need no wallet; writes sign in yours.</p></div>
      <div className="page-chips">
        <span className="chip"><span className={`dot ${live ? 'live' : 'idle'}`} aria-hidden="true"/>{live ? 'Active' : 'Connecting'}</span>
        {registry && <span className="chip"><span className="mono">{short(registry.contract, 12)}</span><CopyButton value={registry.contract} label="Copy"/><a href={addressUrl(TESTNET, registry.contract)} target="_blank" rel="noreferrer" aria-label="Registry on the explorer"><ExternalLink size={13} aria-hidden="true"/></a></span>}
        {c.indexedTo && <span className="chip">Feed indexed to <span className="mono">#{fmt(c.indexedTo)}</span></span>}
      </div>
    </div>
    <div className="overview">
      <div className="overview-main">
        <section className="card hero-card" aria-label="Live testnet head">
          <div className="card-body">
            <p className="hc-label"><span className={`dot ${live ? head.status : 'idle'}`} aria-hidden="true"/>Finalized head · {live ? (head.status === 'live' ? 'live from the official node' : head.status === 'indexed' ? 'from the official explorer index' : 'last seen by this browser') : 'connecting to the V3 testnet'}</p>
            <p className="big">{live ? <ChainLink hash={head.hash}><Odometer value={`#${fmt(head.number)}`}/></ChainLink> : <span className="big-wait" aria-label="Waiting for the first finalized head">#<span/><span/><span/>,<span/><span/><span/></span>}</p>
            <p className="hc-sub">Runtime {head.specName ? `${head.specName}/${head.specVersion}` : '…'} · chain {TESTNET.chainId}. The registry holds {c.releases} release{c.releases === 1 ? '' : 's'}, {c.approvals} standing approval{c.approvals === 1 ? '' : 's'}, {c.listings} listing{c.listings === 1 ? '' : 's'} and {c.stored} stored report{c.stored === 1 ? '' : 's'}.</p>
            <div className="hc-actions"><a className="btn btn-primary" href="#/app/run">Run the lifecycle<ArrowRight size={15} aria-hidden="true"/></a><a className="btn btn-secondary" href="#/app/releases">Look up a release</a>{registry && <a className="btn btn-secondary" href={addressUrl(TESTNET, registry.contract)} target="_blank" rel="noreferrer">View on explorer<ArrowUpRight size={15} aria-hidden="true"/></a>}</div>
          </div>
        </section>
        <dl className="tiles">
          <Tile label="Releases" value={c.releases} note="In the registry, each with one current revision" loaded={!!data.loaded}/>
          <Tile label="Approvals standing" value={c.approvals} note="Current revisions a reviewer approved" loaded={!!data.loaded}/>
          <Tile label="Tokens listed" value={c.listings} note="On the VerifiedTokenList, on those approvals" loaded={!!data.loaded}/>
        </dl>
        <section className="card" aria-labelledby="recent-title">
          <div className="card-head"><h2 id="recent-title">Latest activity</h2><a className="link-arrow" href="#/app/activity">See all<ArrowRight size={14} aria-hidden="true"/></a></div>
          <ul className="activity-list">{recent.map((item) => <li key={item.hash}><span className={`kind-chip ${item.kind}`}>{KIND[item.kind]}</span><span className="act-title">{item.title}<small>{when(item.time)} · by <span className="mono">{short(item.who, 10)}</span></small></span><ChainLink hash={item.hash} kind="extrinsic">#{fmt(item.block)}</ChainLink></li>)}</ul>
        </section>
      </div>
      <div className="overview-side">
        <section className="card" aria-labelledby="rules-card-title">
          <div className="card-head"><h2 id="rules-card-title">Rules the registry enforces</h2></div>
          <ul className="rule-rows">{rules.map(([label, value]) => <li key={label}><span>{label}</span><span className="rule-value"><span className="dot live" aria-hidden="true"/>{value}</span></li>)}</ul>
          <div className="card-foot"><a className="link-arrow" href="#/rules">How each rule works<ArrowRight size={14} aria-hidden="true"/></a></div>
        </section>
        <section className="card" aria-labelledby="networks-title">
          <div className="card-head"><h2 id="networks-title">Networks</h2></div>
          <ul className="net-rows">
            <li><span><span className={`dot ${live ? head.status : 'idle'}`} aria-hidden="true"/>V3 Testnet</span><span>{live ? <ChainLink hash={head.hash}>#{fmt(head.number)}</ChainLink> : 'syncing'}<small>{head.specName ? `${head.specName}/${head.specVersion}` : 'runtime …'}</small></span></li>
            <li><span><span className={`dot ${liveKnown ? liveHead.status : 'idle'}`} aria-hidden="true"/>V3 Live</span><span>{liveKnown ? <ChainLink hash={liveHead.hash} network={LIVE}>#{fmt(liveHead.number)}</ChainLink> : 'syncing'}<small>{liveHead.specName ? `${liveHead.specName}/${liveHead.specVersion}` : 'runtime …'}</small></span></li>
          </ul>
          <div className="card-foot"><a className="link-arrow" href="#/app/run/watch">Watch for a runtime change<ArrowRight size={14} aria-hidden="true"/></a></div>
        </section>
        <section className="dark-card on-band">
          <h2>Run it with your own wallet</h2>
          <p>Eight steps on the real testnet. Four only read; four write after a dry-run, signed by you and paid with your testnet tPOT. ReviveCheck holds no key.</p>
          <a className="btn btn-primary" href="#/app/run">Start with Check<ArrowRight size={15} aria-hidden="true"/></a>
        </section>
      </div>
    </div>
    <section className="card" aria-labelledby="run-title">
      <div className="card-head"><h2 id="run-title">Recorded run</h2><span className="card-note"><span className="legend-write"><i aria-hidden="true"/>black icon: a wallet signs · select a stage to run it</span></span></div>
      <div className="card-body">{data.rec ? <Lifecycle state={state} selected={null} compact onSelect={(id) => { location.hash = `#/app/run/${id}`; }} label="Recorded run"/> : <div className="skeleton-block"/>}</div>
    </section>
  </>;
}

function ReleaseResult({ result }) {
  const { release, decision } = result;
  return <div className={`result-card ${release.exists ? 'passed' : ''}`}>
    <div className="result-head"><Badge status={release.exists ? (decision?.approved ? 'approved' : decision?.reviewed ? 'changes-requested' : 'pending') : 'unknown'}>{release.exists ? (decision?.approved ? 'Approved' : decision?.reviewed ? 'Changes requested' : 'No decision') : 'Not found'}</Badge><strong>{release.exists ? `Revision ${release.revision}` : 'No release with this ID'}</strong><span className="muted">{result.interfacesAgree ? 'EVM RPC and ReviveApi agree' : 'Interfaces disagree'} at <ChainLink hash={result.block.nativeHash}>#{fmt(result.block.number)}</ChainLink></span></div>
    {release.exists && <dl className="kv-list compact">
      <div className="kv"><dt>Release ID</dt><dd className="mono">{short(result.releaseId, 22)}<CopyButton value={result.releaseId}/></dd></div>
      <div className="kv"><dt>Owner</dt><dd className="mono">{release.owner}</dd></div>
      <div className="kv"><dt>Report hash</dt><dd><a className="hash-link" href={reviewerLink(strip(release.reportHash))}>{short(strip(release.reportHash), 20)}</a></dd></div>
      {decision && <div className="kv"><dt>Reviewer</dt><dd className="mono">{short(decision.reviewer, 16)} · reviewed {String(decision.reviewed)}, approved {String(decision.approved)}</dd></div>}
    </dl>}
  </div>;
}

function Releases({ data }) {
  const releases = data.feed?.releases || [];
  const first = releases[0];
  const [releaseId, setReleaseId] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [result, setResult] = useState(null);
  const [task, run] = useTask();
  useEffect(() => { if (first && !releaseId) { setReleaseId(first.releaseId); setReviewer(Object.keys(first.decisions || {})[0] || ''); } }, [first]);
  async function lookup(event) {
    event.preventDefault();
    const next = await run('Reading the registry through both interfaces…', async () => (await engine()).readRegistry({ releaseId: releaseId.trim(), reviewer: isAddress(reviewer) ? reviewer.trim() : undefined }));
    if (next) setResult(next);
  }
  return <>
    <div className="page-head"><div><h1>Releases</h1><p>Every release in the ReleaseRegistry, from the public feed built from chain events. Look any release up live against the chain below.</p></div></div>
    <section className="card" aria-label="Releases in the registry">
      <div className="table-wrap flat"><table className="data-table">
        <thead><tr><th scope="col">Label</th><th scope="col">Owner</th><th scope="col">Revision</th><th scope="col">Report</th><th scope="col">Decision</th><th scope="col">Submitted</th></tr></thead>
        <tbody>{releases.length ? releases.map((release) => {
          const decision = Object.entries(release.decisions || {}).find(([, item]) => item.revision === release.revision);
          const submitted = [...release.history].reverse().find((item) => item.type === 'submitted');
          return <tr key={release.releaseId}><th scope="row">{release.label}<small className="block mono">{short(release.releaseId, 16)}</small></th><td className="mono">{short(release.owner, 12)}</td><td>{release.revision}</td><td><a className="hash-link" href={reviewerLink(strip(release.reportHash))}>{short(strip(release.reportHash), 12)}</a></td><td>{decision ? <Badge status={decision[1].approved ? 'approved' : 'changes-requested'}>{decision[1].approved ? 'Approved' : 'Changes'} · #{fmt(decision[1].blockNumber)}</Badge> : <Badge status="pending">No decision</Badge>}</td><td>{submitted ? <ChainLink hash={submitted.extrinsicHash} kind="extrinsic">#{fmt(submitted.blockNumber)}</ChainLink> : '—'}</td></tr>;
        }) : <tr><td colSpan={6} className="muted">{data.loaded ? 'No releases in the feed yet.' : 'Loading the feed…'}</td></tr>}</tbody>
      </table></div>
    </section>
    <section className="card" aria-labelledby="lookup-title">
      <div className="card-head"><h2 id="lookup-title">Look up a release</h2><span className="card-note">read_registry · no wallet, no gas</span></div>
      <form className="card-body lookup" onSubmit={lookup}>
        <div className="field-row two"><label className="field">Release ID<input value={releaseId} onChange={(event) => setReleaseId(event.target.value)} placeholder="0x… (32 bytes)" spellCheck="false"/></label><label className="field">Reviewer address <span className="hint">optional, to read its decision</span><input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="0x… (20 bytes)" spellCheck="false"/></label></div>
        <div className="step-actions"><button type="submit" className="btn btn-primary" disabled={!isHash(releaseId) || !!task.busy}>{task.busy ? <LoaderCircle className="spin" size={15} aria-hidden="true"/> : <Search size={15} aria-hidden="true"/>}Read from the chain</button><span className="muted">Runs in this browser against wss://test-node-v3.portaldot.dev and the EVM RPC.</span></div>
        <Busy task={task}/>
        {result && !task.busy && <ReleaseResult result={result}/>}
      </form>
    </section>
  </>;
}

function Tokens({ data }) {
  const listings = data.feed?.listings || [];
  const [token, setToken] = useState(PUSD);
  const [result, setResult] = useState(null);
  const [task, run] = useTask();
  async function lookup(event) {
    event.preventDefault();
    const next = await run('Reading the VerifiedTokenList through both interfaces…', async () => (await engine()).readTokenList({ token: token.trim() }));
    if (next) setResult(next);
  }
  return <>
    <div className="page-head"><div><h1>Token list</h1><p>Tokens the VerifiedTokenList accepted, each on a standing approval in the registry. A new revision un-lists a token until it is approved again.</p></div></div>
    <section className="card" aria-label="Listings">
      <div className="table-wrap flat"><table className="data-table">
        <thead><tr><th scope="col">Token</th><th scope="col">Decimals</th><th scope="col">Release</th><th scope="col">Reviewer</th><th scope="col">Report</th><th scope="col">Listed</th></tr></thead>
        <tbody>{listings.length ? listings.map((item) => <tr key={item.extrinsicHash}><th scope="row">pUSD<small className="block mono">{short(item.token, 16)}</small></th><td>{item.decimals}</td><td className="mono">{short(item.releaseId, 12)}</td><td className="mono">{short(item.reviewer, 12)}</td><td><a className="hash-link" href={reviewerLink(strip(item.reportHash))}>{short(strip(item.reportHash), 12)}</a></td><td><ChainLink hash={item.extrinsicHash} kind="extrinsic">#{fmt(item.blockNumber)}</ChainLink></td></tr>) : <tr><td colSpan={6} className="muted">{data.loaded ? 'No listings in the feed yet.' : 'Loading the feed…'}</td></tr>}</tbody>
      </table></div>
    </section>
    <section className="card" aria-labelledby="token-lookup-title">
      <div className="card-head"><h2 id="token-lookup-title">Check a token</h2><span className="card-note">token_list_status · no wallet, no gas</span></div>
      <form className="card-body lookup" onSubmit={lookup}>
        <label className="field">Token address<input value={token} onChange={(event) => setToken(event.target.value)} placeholder="0x… (20 bytes)" spellCheck="false"/></label>
        <div className="step-actions"><button type="submit" className="btn btn-primary" disabled={!isAddress(token) || !!task.busy}>{task.busy ? <LoaderCircle className="spin" size={15} aria-hidden="true"/> : <Search size={15} aria-hidden="true"/>}Read isListed</button><span className="muted">The default is the pUSD precompile on the V3 testnet.</span></div>
        <Busy task={task}/>
        {result && !task.busy && <div className={`result-card ${result.listed ? 'passed' : ''}`}>
          <div className="result-head"><Badge status={result.listed ? 'approved' : 'pending'}>{result.listed ? 'Listed' : 'Not listed'}</Badge><strong>{short(result.token, 16)}</strong><span className="muted">{result.interfacesAgree ? 'EVM RPC and ReviveApi agree' : 'Interfaces disagree'} at <ChainLink hash={result.block.nativeHash}>#{fmt(result.block.number)}</ChainLink></span></div>
          {result.entry && <dl className="kv-list compact"><div className="kv"><dt>Release</dt><dd className="mono">{short(result.entry.releaseId, 22)}</dd></div><div className="kv"><dt>Report</dt><dd><a className="hash-link" href={reviewerLink(strip(result.entry.reportHash))}>{short(strip(result.entry.reportHash), 20)}</a></dd></div><div className="kv"><dt>Reviewer</dt><dd className="mono">{result.entry.reviewer}</dd></div></dl>}
        </div>}
      </form>
    </section>
  </>;
}

function Evidence({ data }) {
  const stored = data.feed?.evidence || [];
  const reports = data.reports || [];
  const [results, setResults] = useState({});
  const [task, run] = useTask();
  async function retrieve(item) {
    const next = await run(`Retrieving ${short(item.reportHash, 10)} from the chain…`, async () => (await engine()).retrieveEvidence({ extrinsicHash: item.extrinsicHash, blockHash: item.blockHash, expectedHash: item.reportHash }));
    if (next) setResults((current) => ({ ...current, [item.extrinsicHash]: next }));
  }
  return <>
    <div className="page-head"><div><h1>Evidence</h1><p>Sealed reports stored in Portaldot blocks through the native Remark module, and the published reports behind this site. Retrieve any stored report from the chain and verify both hashes here.</p></div></div>
    <section className="card" aria-labelledby="stored-title">
      <div className="card-head"><h2 id="stored-title">Stored on-chain</h2><span className="card-note">retrieve_evidence · no wallet, no gas</span></div>
      <ul className="stored-list">{stored.length ? stored.map((item) => { const result = results[item.extrinsicHash]; return <li key={item.extrinsicHash}>
        <div className="stored-main"><a className="hash-link" href={reviewerLink(item.reportHash)}>{short(item.reportHash, 18)}</a><small>{item.project} · {item.release} · {fmt(item.bytes)} bytes · stored by <span className="mono">{short(item.publisher, 12)}</span> · <ChainLink hash={item.extrinsicHash} kind="extrinsic">#{fmt(item.blockNumber)}</ChainLink></small></div>
        <div className="stored-side">{result ? <Badge status={result.verified ? 'passed' : 'failed'}>{result.verified ? 'Verified' : 'Not verified'}</Badge> : <Badge status="finalized">Stored</Badge>}<button type="button" className="btn btn-secondary btn-sm" disabled={!!task.busy} onClick={() => retrieve(item)}>{result ? 'Retrieve again' : 'Retrieve and verify'}</button></div>
        {result && <dl className="kv-list compact stored-result"><div className="kv"><dt>Result</dt><dd>{result.verified ? `Remark.Stored names the publisher and a content hash of the ${fmt(result.length)} stored bytes; the report's SHA-256 is ${short(result.reportHash, 12)}.` : (result.reasons || []).join(' ')}</dd></div><div className="kv"><dt>Content hash</dt><dd className="mono">{short(result.contentHash, 24)}</dd></div><div className="kv"><dt>Block</dt><dd>#{fmt(result.blockNumber)}{result.finalized ? ' · finalized' : ''}</dd></div></dl>}
      </li>; }) : <li className="muted">{data.loaded ? 'No stored reports in the feed yet.' : 'Loading the feed…'}</li>}</ul>
      <div className="card-body"><Busy task={task}/></div>
    </section>
    <section className="card" aria-labelledby="published-title">
      <div className="card-head"><h2 id="published-title">Published reports</h2><span className="card-note">Each opens in the reviewer, which recomputes its SHA-256 first</span></div>
      <ul className="report-list">{[...reports].reverse().map((item) => <li key={item.evidenceHash}><a href={reviewerLink(item.evidenceHash)}><span><strong>{item.projectName}</strong><small>{item.release || item.profile} · {when(item.completedAt)}</small></span><span className="mono">{short(item.evidenceHash, 16)}</span><ArrowUpRight size={15} aria-hidden="true"/></a></li>)}</ul>
    </section>
  </>;
}

function ActivityPage({ data }) {
  const [kind, setKind] = useState('all');
  const [network, setNetwork] = useState('all');
  const items = activity(data).filter((item) => kind === 'all' || item.kind === kind);
  const rows = evidenceRows(data).filter((row) => network === 'all' || row[2].key === network).slice().reverse();
  const tone = { Failed: 'failed', Passed: 'passed', Finalized: 'finalized', Refused: 'refused' };
  const kinds = [['all', 'All'], ['submitted', 'Submissions'], ['approved', 'Approvals'], ['listed', 'Listings'], ['stored', 'Stored reports']];
  return <>
    <div className="page-head"><div><h1>Activity</h1><p>The registry’s own events from the public feed, then every on-chain record behind this site in block order. Each row links to the official explorer.</p></div></div>
    <section className="card" aria-labelledby="events-title">
      <div className="card-head"><h2 id="events-title">Registry events</h2><div className="filter" role="group" aria-label="Filter events">{kinds.map(([id, label]) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}</div></div>
      <ul className="activity-list">{items.length ? items.map((item) => <li key={item.hash}><span className={`kind-chip ${item.kind}`}>{KIND[item.kind]}</span><span className="act-title">{item.title}<small>{when(item.time)} · by <span className="mono">{short(item.who, 10)}</span>{item.report && <> · report <a className="hash-link" href={reviewerLink(strip(item.report))}>{short(strip(item.report), 10)}</a></>}</small></span><ChainLink hash={item.hash} kind="extrinsic">#{fmt(item.block)}</ChainLink></li>) : <li className="muted">{data.loaded ? 'Nothing matches this filter.' : 'Loading the feed…'}</li>}</ul>
    </section>
    <section className="card" aria-labelledby="records-title">
      <div className="card-head"><h2 id="records-title">Every record behind this site</h2><div className="filter" role="group" aria-label="Filter by network">{[['all', 'Both networks'], ['testnet', 'V3 Testnet'], ['live', 'V3 Live']].map(([id, label]) => <button key={id} type="button" aria-pressed={network === id} onClick={() => setNetwork(id)}>{label}</button>)}</div></div>
      <div className="table-wrap flat"><table className="data-table">
        <thead><tr><th scope="col">Event</th><th scope="col">Result</th><th scope="col">Network</th><th scope="col">Block</th><th scope="col">On-chain</th><th scope="col">Report</th></tr></thead>
        <tbody>{rows.map(([event, result, net, hash, block, hashKind, report]) => <tr key={`${event}-${block}`}><th scope="row">{event}</th><td><Badge status={tone[result]}>{result}</Badge></td><td>{net.shortName}</td><td className="mono">#{fmt(block)}</td><td><ChainLink hash={hash} kind={hashKind} network={net}/></td><td>{report ? <a className="hash-link" href={reviewerLink(report)}>{short(report, 12)}</a> : <span className="muted">—</span>}</td></tr>)}</tbody>
      </table></div>
    </section>
  </>;
}

function NotLocal() {
  return <div className="page-head"><div><h1>Local workbench</h1><p>The workbench runs on your own machine with <code>npm run dev</code>, where its API exists. The public site serves only the static pages.</p></div></div>;
}

export default function Dashboard() {
  const sub = useSubRoute('#/app');
  const page = sub.split('/')[0];
  const data = useRecords();
  const head = useTestnetHead();
  const liveHead = useNetworkHead('live');
  useEffect(() => { if (page !== 'run') window.scrollTo({ top: 0 }); }, [page]);
  if (page === 'run') return <AppShell page="run" bare><Try/></AppShell>;
  if (page === 'workbench') return <AppShell page="workbench" bare wide>{isLoopback() ? <Workspace/> : <main className="app-main" id="main"><NotLocal/></main>}</AppShell>;
  const Page = { '': Overview, releases: Releases, tokens: Tokens, evidence: Evidence, activity: ActivityPage }[page] || Overview;
  return <AppShell page={page in { releases: 1, tokens: 1, evidence: 1, activity: 1 } ? page : ''}><Page data={data} head={head} liveHead={liveHead}/></AppShell>;
}
