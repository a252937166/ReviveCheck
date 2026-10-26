// The studio: the whole lifecycle on the real V3 testnet, run by the visitor, for ONE
// active project and ONE active report. Reads need nothing; registry writes and the
// remark are signed in their wallet. Every badge, prepared transaction and completion is
// derived from the receipts that name the active report (src/studio-state.js); a new
// check or recheck replaces the active report whatever its result, and the earlier
// receipts become history. The project (src/projects.js) decides which plan is checked
// and which defaults the write steps start from: the demonstration's pUSD releases, or
// the visitor's own supported release, never one substituted for the other.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, CircleAlert, Download, FolderKanban, History, Lock, LoaderCircle, PenLine, RotateCcw, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { STAGES, stageById, LANES, PRODUCTS } from './stages.js';
import { STAGE_ICONS } from './Lifecycle.jsx';
import { FEATURES } from './docs-content.js';
import { Tabs } from './Docs.jsx';
import { short } from './components.jsx';
import { Badge, ChainLink, CopyButton, fmt, useNetworkHead, useSubRoute, useTestnetHead } from './site.jsx';
import { useWallet } from './WalletContext.jsx';
import { NETWORKS, RUNTIME_HISTORY } from '../lib/networks.js';
import { DEMO_RELEASES } from '../lib/demo.js';
import { downloadJson, makeShareLink } from '../lib/share.js';
import { TOKEN_LIST } from '../lib/tokenlist.js';
import { listReceipt, describeListReceipt, describeReviewReceipt } from './receipts.js';
import { clearSession, activeReport, passedActiveReport, activePlan, stepStatuses, completion, ledgerRows, createRequestFence, beginRequest, requestIsCurrent, supersedeRequests, READ_STAGES, txFailure } from './studio-state.js';
import { listProjects, releaseLabelFor, planForCheck } from './projects.js';
import { readStudio, writeSession, activateProject, applyToProject } from './studio-store.js';

const TESTNET = NETWORKS.testnet, LIVE = NETWORKS.live;
const engine = () => import('./engine.js');
const walletModule = () => import('./wallet.js');
const tpot = (value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
const statusWord = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', unknown: 'Unknown', inconclusive: 'Inconclusive', reproduced: 'Reproduced', differs: 'Differs' };
const DEMO_CUSTOM = { symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6 };
const BUSY_TX = ['signing', 'submitted', 'in-block', 'finalized', 'readback'];

/**
 * The active project, its studio session and the transitions. The session is written to
 * the browser on every change; switching projects switches to that project's own session.
 * Every asynchronous answer is routed to the session of the project it STARTED in, read
 * from the browser store when it arrives: a read answer (check, recheck, replay, promote,
 * watch, verify) applies only when it is still the latest request of that project and
 * stage; a write receipt or a readback always lands under its origin, whatever project is
 * on screen. The screen follows only when the origin is still the active project.
 */
function useStudio() {
  const [state, setState] = useState(() => readStudio());
  const { project, session } = state;
  const fence = useRef(createRequestFence());
  useEffect(() => { writeSession(session); }, [session]);
  const identity = { projectId: project.id, projectName: project.name };
  const route = (projectId, key, value) => {
    const result = applyToProject({ projectId, key, value });
    setState((current) => current.project.id === projectId ? { ...current, project: result.project ?? current.project, session: result.session } : current);
    return result;
  };
  /** Start a read request for the active project; the token names the origin and the generation. */
  const begin = (key) => beginRequest(fence.current, project.id, key);
  /** Settle a read request: discarded when a later request of the same project and stage started, or the project was reset. */
  const settle = (token, value) => (READ_STAGES.includes(token.key) && !requestIsCurrent(fence.current, token)) ? { applied: false, reason: 'superseded' } : { applied: true, ...route(token.projectId, token.key, value) };
  /** A finalized write receipt for the project this handler was created in. Never discarded. */
  const apply = (key, value) => route(project.id, key, value);
  /** A readback for ONE transaction of the project this handler was created in. */
  const readback = (stage, extrinsicHash, patch) => route(project.id, 'readback', { stage, extrinsicHash, patch });
  const reset = () => { supersedeRequests(fence.current, project.id); const cleared = clearSession(session); writeSession(cleared); setState((current) => ({ ...current, session: cleared })); };
  const switchProject = (id) => { activateProject(id); setState(readStudio()); };
  return { project, session, identity, apply, begin, settle, readback, reset, switchProject, projects: listProjects(state.projects) };
}

/** A long-running read with an elapsed counter; a failure is a retry, never a result. */
function useTask() {
  const [state, setState] = useState({});
  const timer = useRef();
  useEffect(() => () => clearInterval(timer.current), []);
  async function run(label, task) {
    const started = Date.now();
    setState({ busy: label, elapsed: 0 });
    clearInterval(timer.current);
    timer.current = setInterval(() => setState((current) => current.busy ? { ...current, elapsed: Math.round((Date.now() - started) / 1000) } : current), 1000);
    try { const result = await task(); setState({}); return result; }
    catch (error) { setState({ error: error?.message || String(error) }); return null; }
    finally { clearInterval(timer.current); }
  }
  return [state, run, () => setState({})];
}

function Working({ task, children }) {
  if (task.busy) return <div className="working" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true"/><div><strong>{task.busy}</strong><span>{task.elapsed ? `${task.elapsed} s` : ''}{task.elapsed > 8 ? ' · the public node can take up to a minute to hand out metadata on first contact' : ''}</span></div></div>;
  if (task.error) return <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Nothing was recorded.</strong> {task.error}{children}</div></div>;
  return null;
}

function ReleaseChooser({ project, choice, setChoice, custom, setCustom, disabled }) {
  const plan = planForCheck(project, choice, custom);
  const listing = plan.listing;
  if (project.kind === 'own') return <div className="release-chooser">
    <figure className="code-block entry">
      <figcaption><span>{plan.logicalContractId} · {plan.release} · tokens[0]</span><a className="text-link" href="#/app/check">Edit on Check my token<ArrowRight size={13} aria-hidden="true"/></a></figcaption>
      <pre><code>{'{\n'}{Object.entries({ chainId: listing.chainId, address: `"${listing.address}"`, symbol: `"${listing.symbol}"`, name: `"${listing.name}"`, decimals: listing.decimals }).map(([key, value]) => <span key={key}>{`  "${key}": ${value},\n`}</span>)}{`  "extensions": { "nativeAssetId": "${plan.nativeAsset.assetId}" }\n}`}</code></pre>
    </figure>
    <p className="muted">Your project's release, exactly as Check my token validated it: a change there is a new plan and gets a report of its own.</p>
  </div>;
  const changed = choice === 'v1.0.0' ? 'decimals' : '';
  const options = [['v1.0.0', 'v1.0.0', 'Lists 18 decimals, the Ethereum default'], ['v1.0.1', 'v1.0.1', 'Lists the 6 decimals the chain reports'], ['custom', 'Your edit', 'Change the listed symbol, name or decimals']];
  return <div className="release-chooser">
    <fieldset className="segmented-cards" disabled={disabled}><legend>Release to check</legend>
      {options.map(([id, title, note]) => <label key={id} className={choice === id ? 'selected' : ''}><input type="radio" name="release" value={id} checked={choice === id} onChange={() => setChoice(id)}/><strong>{title}</strong><span>{note}</span></label>)}
    </fieldset>
    {choice === 'custom' && <div className="field-row">
      <label>Symbol<input value={custom.symbol} maxLength={64} onChange={(event) => setCustom({ ...custom, symbol: event.target.value })} disabled={disabled}/></label>
      <label>Name<input value={custom.name} maxLength={64} onChange={(event) => setCustom({ ...custom, name: event.target.value })} disabled={disabled}/></label>
      <label>Decimals<input type="number" min="0" max="255" value={custom.decimals} onChange={(event) => setCustom({ ...custom, decimals: event.target.value })} disabled={disabled}/></label>
    </div>}
    <figure className="code-block entry">
      <figcaption><span>pusd-token-list · tokens[0]</span></figcaption>
      <pre><code>{'{\n'}{Object.entries({ chainId: listing.chainId, address: `"${listing.address}"`, symbol: `"${listing.symbol}"`, name: `"${listing.name}"`, decimals: listing.decimals }).map(([key, value]) => <span key={key} className={key === changed || (choice === 'custom' && listing[key] !== DEMO_RELEASES['v1.0.1'].listing[key]) ? 'mark' : ''}>{`  "${key}": ${value},\n`}</span>)}{`  "extensions": { "nativeAssetId": "${plan.nativeAsset.assetId}" }\n}`}</code></pre>
    </figure>
  </div>;
}

export function ReportResult({ report, title }) {
  const [link, setLink] = useState('');
  useEffect(() => { let alive = true; setLink(''); makeShareLink(report, { checkPublished: false }).then((share) => alive && setLink(share.url || share.qrUrl)).catch(() => {}); return () => { alive = false; }; }, [report.evidenceHash]);
  const network = report.scope === LIVE.scope ? LIVE : TESTNET;
  return <div className={`result-card ${report.status}`}>
    <div className="result-head">
      <Badge status={report.scope === LIVE.scope && report.status !== 'passed' ? 'refused' : report.status}>{report.scope === LIVE.scope && report.status !== 'passed' ? 'Refused' : statusWord[report.status] || report.status}</Badge>
      <strong>{title}</strong>
      <span className="muted">{report.checks.filter((item) => item.status === 'passed').length}/{report.checks.length} checks · {report.network?.specName}/{report.network?.specVersion}</span>
    </div>
    <ul className="check-list">{report.checks.map((item) => <li key={item.id} className={item.status}><Badge status={item.status}>{statusWord[item.status] || item.status}</Badge><div><strong>{item.title}</strong><span>{item.observed}</span>{item.status !== 'passed' && item.remediation && <em>{item.remediation}</em>}</div></li>)}</ul>
    <div className="result-foot">
      <span>Block <ChainLink hash={report.network?.finalizedNativeBlockHash} network={network}>#{fmt(report.network?.finalizedBlockNumber)}</ChainLink></span>
      <span className="mono" title={report.evidenceHash}>sha-256 {short(report.evidenceHash, 16)}</span>
      {link && <a className="text-link" href={link} target="_blank" rel="noreferrer">Open in reviewer<ArrowUpRight size={13} aria-hidden="true"/></a>}
      <button type="button" className="text-link" onClick={() => downloadJson(report, `revivecheck-${report.release}-${report.evidenceHash.slice(0, 12)}.json`)}><Download size={13} aria-hidden="true"/>JSON</button>
    </div>
  </div>;
}

function Locked({ children, action }) { return <div className="locked"><Lock size={16} aria-hidden="true"/><p>{children}</p>{action}</div>; }

/** The active report in one line: what the write steps act on, and why a step is locked when it is not a pass. */
function ActiveLine({ session }) {
  const report = activeReport(session);
  if (!report) return null;
  return <p className="baseline-line">Active report <span className="mono">{short(report.evidenceHash, 16)}</span> · <Badge status={report.status}>{statusWord[report.status] || report.status}</Badge> · {report.release} · {session.active.source === 'import' ? 'from Check my token' : session.active.source} at {new Date(session.active.at).toISOString().slice(11, 19)} UTC</p>;
}

/**
 * One step of the studio. The header says where the step sits, which product it
 * belongs to, who performs it and what it costs; the body is the step itself; the
 * API block at the end shows the same step as a tool call.
 */
function StepFrame({ id, purpose, cost, children, next }) {
  const stage = stageById[id];
  const index = STAGES.findIndex((item) => item.id === id);
  return <section className="step-panel" aria-labelledby={`step-${id}`}>
    <header className="step-head">
      <h2 id={`step-${id}`} tabIndex={-1}>{stage.title}</h2>
      <div className="step-meta">
        <span className="step-count">Step {index + 1} of {STAGES.length}</span>
        <span className="lane-tag product">{PRODUCTS[stage.product]}</span>
        {stage.kind === 'write'
          ? <><span className="lane-tag write"><PenLine size={11} aria-hidden="true"/>Your wallet signs</span><span className="lane-tag cost">{cost || stage.cost}</span></>
          : <span className="lane-tag read">Read-only · no wallet · no gas</span>}
        <span className={`lane-tag ${stage.lane}`}>{LANES[stage.lane]}</span>
      </div>
      <div className="step-brief">
        <div><h3>What happens</h3><p>{purpose}</p></div>
        <div className="step-why"><h3>Why it matters</h3><p>{stage.why}</p></div>
      </div>
    </header>
    {children}
    <StepApi stage={stage}/>
    {next && <div className="step-next">{next}</div>}
  </section>;
}

/** Who performs the step: this browser for a read, the visitor's own wallet for a write. */
function SignerLine({ id }) {
  const stage = stageById[id];
  const { account } = useWallet();
  if (stage.kind !== 'write') {
    const host = (stage.lane === 'live' ? LIVE : TESTNET).substrateRpcUrl.replace('wss://', '');
    return <span className="signer-line"><span className="signer-dot read" aria-hidden="true"/><span>Runs in this browser · reads {host} · nothing to sign</span></span>;
  }
  if (!account) return <span className="signer-line"><span className="signer-dot" aria-hidden="true"/><span>Signed by <strong>your wallet</strong> · none connected yet</span></span>;
  const route = stage.id === 'store' ? (account.kind === 'polkadot' ? 'a native remark.store' : 'needs a Polkadot wallet') : account.kind === 'evm' ? 'through the official EVM RPC' : 'a native Revive.call';
  return <span className="signer-line"><span className="wallet-kind" aria-hidden="true"/><span>Signed by <strong>{account.name}</strong><span className="mono">{short(account.address, 12)}</span>· {account.kind === 'evm' ? 'EVM' : 'Polkadot'} wallet, {route}</span></span>;
}

/** The same step as an API call: the tool, the on-chain call for a write, and the request in each route. */
function StepApi({ stage }) {
  const feature = FEATURES.find((item) => item.id === stage.id);
  if (!feature) return null;
  const write = stage.kind === 'write';
  const readback = stage.readback || feature.tool;
  return <details className="step-api">
    <summary>
      <span className="step-api-label">Related API</span>
      {write ? <><code>prepare_transaction</code><span className="api-hop"><ArrowRight className="api-arrow" size={13} aria-hidden="true"/><code>{stage.chain}</code></span><span className="api-hop"><ArrowRight className="api-arrow" size={13} aria-hidden="true"/><code>{readback}</code></span></> : <code>{feature.tool}</code>}
    </summary>
    <div className="step-api-body">
      <p>{write ? `Dry-run it with prepare_transaction, sign ${stage.chain} in your wallet, then read it back with ${readback}. ` : ''}{feature.summary}</p>
      <ul className="step-api-needs" aria-label="Needs">{feature.needs.map((need) => <li key={need}>{need}</li>)}</ul>
      <Tabs tabs={feature.tabs} id={`api-${stage.id}`}/>
      <a className="text-link" href={`#/docs/${feature.id}`}>Docs for this step<ArrowRight size={14} aria-hidden="true"/></a>
    </div>
  </details>;
}

function CheckStep({ studio }) {
  const { project, session, identity, begin, settle } = studio;
  const own = project.kind === 'own';
  const [choice, setChoice] = useState(own ? 'own' : session.check?.choice && DEMO_RELEASES[session.check.choice] || session.check?.choice === 'custom' ? session.check.choice : 'v1.0.0');
  const [custom, setCustom] = useState(session.check?.custom && !session.check.custom.plan ? session.check.custom : DEMO_CUSTOM);
  const [task, run] = useTask();
  const report = session.check?.report;
  async function start() {
    // Every plan goes through the general checker with THIS project's identity (its CURRENT plan); a visitor's own plan is never swapped for the demonstration.
    const plan = planForCheck(project, choice, custom);
    const token = begin('check');
    const result = await run('Reading the V3 testnet through both interfaces…', async () => (await engine()).checkRelease(plan, identity));
    if (result) settle(token, { choice: own ? 'own' : choice, custom: own ? { symbol: plan.listing.symbol, name: plan.listing.name, decimals: plan.listing.decimals, plan } : custom, report: result });
  }
  return <StepFrame id="check" purpose={`Compare ${own ? `${project.name}'s release` : 'a token-list release'} with what the chain reports, at one finalized block, through native Assets storage and the ERC-20 precompile. The result is sealed into a SHA-256 report and becomes this project's active report, whatever its result.`}
    next={report && (report.status === 'passed' ? <a className="btn btn-primary" href="#/app/run/replay">Replay it<ArrowRight size={15}/></a> : <a className="btn btn-primary" href="#/app/run/recheck">Fix it and recheck<ArrowRight size={15}/></a>)}>
    <ReleaseChooser project={project} choice={choice} setChoice={setChoice} custom={custom} setCustom={setCustom} disabled={!!task.busy}/>
    <div className="step-actions"><button type="button" className="btn btn-primary" onClick={start} disabled={!!task.busy}>{task.busy ? <LoaderCircle className="spin" size={15}/> : null}{report ? 'Check again' : 'Run the check'}</button><SignerLine id="check"/></div>
    <Working task={task}/>
    {report && !task.busy && <>
      <ReportResult report={report} title={`${report.release} · ${report.status === 'passed' ? 'every check passed' : report.status === 'failed' ? 'a check needs a fix' : 'not established'}`}/>
      {session.active?.reportHash !== report.evidenceHash && <p className="muted">A later recheck is the active report now; this first report stays as the comparison baseline.</p>}
    </>}
  </StepFrame>;
}

function RecheckStep({ studio }) {
  const { project, session, identity, begin, settle } = studio;
  const own = project.kind === 'own';
  const previous = session.check?.report;
  const [choice, setChoice] = useState(own ? 'own' : session.recheck?.choice && (DEMO_RELEASES[session.recheck.choice] || session.recheck.choice === 'custom') ? session.recheck.choice : previous?.release === 'v1.0.1' ? 'custom' : 'v1.0.1');
  const [custom, setCustom] = useState(session.recheck?.custom && !session.recheck.custom.plan ? session.recheck.custom : session.check?.custom && !session.check.custom.plan ? session.check.custom : DEMO_CUSTOM);
  const [task, run] = useTask();
  const { report, comparison } = session.recheck || {};
  async function start() {
    const plan = planForCheck(project, choice, custom);
    const token = begin('recheck');
    const result = await run('Rechecking and comparing…', async () => { const api = await engine(); const next = await api.checkRelease(plan, { ...identity, previous }); return { report: next, comparison: api.compare(previous, next) }; });
    if (result) settle(token, { choice: own ? 'own' : choice, custom: own ? { symbol: plan.listing.symbol, name: plan.listing.name, decimals: plan.listing.decimals, plan } : custom, ...result });
  }
  if (!previous) return <StepFrame id="recheck" purpose="Check a corrected release and compare it with the first report."><Locked action={<a className="btn btn-secondary btn-sm" href="#/app/run/check">Go to Check</a>}>Run a check first; the recheck compares against it.</Locked></StepFrame>;
  return <StepFrame id="recheck" purpose={`Check ${own ? 'the release again (after correcting it on Check my token, or at a later block)' : 'the corrected release'}. It gets a new report of its own, which becomes the active report whatever its result; the comparison shows which checks changed against the first one.`}
    next={report?.status === 'passed' && <a className="btn btn-primary" href="#/app/run/replay">Replay it<ArrowRight size={15}/></a>}>
    <p className="baseline-line">Comparing against <strong>{previous.release}</strong> · <Badge status={previous.status}>{statusWord[previous.status]}</Badge> · <span className="mono">{short(previous.evidenceHash, 14)}</span></p>
    <ReleaseChooser project={project} choice={choice} setChoice={setChoice} custom={custom} setCustom={setCustom} disabled={!!task.busy}/>
    <div className="step-actions"><button type="button" className="btn btn-primary" onClick={start} disabled={!!task.busy}>{task.busy && <LoaderCircle className="spin" size={15}/>}Recheck and compare</button><SignerLine id="recheck"/></div>
    <Working task={task}/>
    {comparison && !task.busy && <div className="comparison-card">
      <div className="comparison-summary"><Badge status="passed">{comparison.summary?.improved || 0} improved</Badge><Badge status="failed">{comparison.summary?.regressed || 0} regressed</Badge><Badge status="idle">{comparison.summary?.unchanged || 0} unchanged</Badge>{comparison.comparisonKind && <span className="muted">{comparison.comparisonKind === 'same-target' ? 'Same target, same plan' : comparison.comparisonKind}</span>}</div>
      {comparison.compatible === false ? <p className="muted">{comparison.reason}</p> : <table className="data-table"><thead><tr><th scope="col">Check</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr></thead><tbody>{comparison.changes.map((change) => <tr key={change.id}><th scope="row">{change.title}</th><td><Badge status={change.before}>{statusWord[change.before] || '—'}</Badge></td><td><Badge status={change.after}>{statusWord[change.after] || '—'}</Badge></td><td className={change.transition}>{change.transition}</td></tr>)}</tbody></table>}
      <p className="caveat">{comparison.caveat}</p>
    </div>}
    {report && !task.busy && <ReportResult report={report} title={`${report.release} · recheck`}/>}
  </StepFrame>;
}

function ReplayCard({ report, studio }) {
  const { session, begin, settle } = studio;
  const [task, run] = useTask();
  const result = report && session.replay?.reportHash === report.evidenceHash ? session.replay : null;
  async function start() { const token = begin('replay'); const replayed = await run('Re-reading the pinned block…', async () => (await engine()).replay(report)); if (replayed) settle(token, replayed); }
  return <div className="sub-card">
    <h3>Replay it at its block</h3>
    <p>Re-read every observation of this report at block #{fmt(report.network.finalizedBlockNumber)} through both interfaces, and compare value by value. Read-only; no wallet needed.</p>
    <div className="step-actions"><button type="button" className="btn btn-secondary" onClick={start} disabled={!!task.busy}>{task.busy && <LoaderCircle className="spin" size={15}/>}{result ? 'Replay again' : 'Replay at its block'}</button></div>
    <Working task={task}/>
    {result && !task.busy && <div className="result-card">
      <div className="result-head"><Badge status={result.status}>{result.items.filter((item) => item.match).length}/{result.items.length} {result.status === 'partial' ? 'checkpoint reads match' : 'reproduced'}</Badge><strong>At block #{fmt(result.blockNumber)}</strong><ChainLink hash={result.nativeHash}/></div>
      {result.status === 'partial' && <p className="muted">Not re-read: {result.coverage.unsupported.join(', ')}. Replay covers the checkpoint, asset-parity and token-listing evidence; other observations stay unverified here.</p>}
      <table className="data-table"><thead><tr><th scope="col">Observation</th><th scope="col">Recorded</th><th scope="col">Replayed</th><th scope="col"><span className="visually-hidden">Result</span></th></tr></thead><tbody>{result.items.map((item) => <tr key={item.id} className={item.match ? '' : 'differs'}><th scope="row">{item.label}</th><td className="mono">{short(String(item.recorded), 20)}</td><td className="mono">{short(String(item.replayed), 20)}</td><td>{item.match ? <Check size={15} aria-label="match"/> : 'differs'}</td></tr>)}</tbody></table>
    </div>}
  </div>;
}

/** The lock every write step shows when the active report is not a pass: what the active report is, and the way to a pass. */
function NeedsPass({ id, purpose, session }) {
  const report = activeReport(session);
  const words = !report ? 'This step starts from a passed report; run the check first.' : `The active report (${report.release}, ${statusWord[report.status]?.toLowerCase() || report.status}, ${short(report.evidenceHash, 12)}) did not pass, and no earlier report is used in its place. Fix the release and recheck.`;
  return <StepFrame id={id} purpose={purpose}><Locked action={<a className="btn btn-secondary btn-sm" href={report ? '#/app/run/recheck' : '#/app/run/check'}>{report ? 'Go to Recheck' : 'Go to Check'}</a>}>{words}</Locked></StepFrame>;
}

function StoreStep({ studio }) {
  const { project, session, apply, readback } = studio;
  const report = passedActiveReport(session);
  const { account, blocker } = useSigner('polkadot');
  const [prepared, setPrepared] = useState(null);
  const [fee, setFee] = useState(null);
  const [tx, setTx] = useState({ stage: 'idle' });
  const stored = report && session.store?.reportHash === report.evidenceHash ? session.store : null;
  useEffect(() => {
    setPrepared(null); setFee(null); setTx({ stage: 'idle' });
    if (!report) return undefined;
    let alive = true;
    engine().then((api) => api.prepareTransaction({ action: 'store', report })).then((next) => {
      if (!alive) return;
      setPrepared({ ...next, forReport: report.evidenceHash, forProject: project.id });
      if (account?.kind === 'polkadot') walletModule().then((module) => module.nativeFee(account, next)).then((value) => alive && setFee(value)).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, [report?.evidenceHash, account?.address]);
  async function sign() {
    if (prepared?.forReport !== report.evidenceHash || prepared.forProject !== project.id) { setTx({ stage: 'error', failedAt: 'signing', error: 'The prepared bytes belong to another report or project; the active report changed. Prepare again.' }); return; }
    setTx({ stage: 'signing' });
    try {
      const result = await (await walletModule()).sendStore(account, prepared.hex, (status) => setTx((value) => ({ ...value, ...status })));
      if (!result.success) throw new Error(`Included in block #${result.blockNumber}, but the store failed.`);
      apply('store', { reportHash: report.evidenceHash, bytes: prepared.bytes, contentHash: prepared.contentHash, tx: result });
      setTx({ stage: 'readback', result });
      const retrieved = await (await engine()).retrieveEvidence({ extrinsicHash: result.extrinsicHash, blockHash: result.blockHash, expectedHash: report.evidenceHash });
      readback('store', result.extrinsicHash, { retrieved: { verified: retrieved.verified, publisher: retrieved.publisher, contentHash: retrieved.contentHash, blockNumber: retrieved.blockNumber, reasons: retrieved.reasons } });
      setTx({ stage: 'done', result });
    } catch (error) { setTx((value) => txFailure(value, error)); }
  }
  if (!report) return <NeedsPass id="store" purpose="Write the sealed report to Portaldot, and replay it at its block." session={session}/>;
  const busyTx = BUSY_TX.includes(tx.stage);
  return <StepFrame id="store" cost={fee ? `fee ≈ ${(Number(fee) / 1e14).toFixed(2)} tPOT` : undefined} purpose={`Write report ${short(report.evidenceHash, 12)} to Portaldot through the native Remark module. The chain keeps the bytes in the block and emits a content hash. Anyone can then retrieve the report from any node and verify both hashes.`}
    next={stored && <a className="btn btn-primary" href="#/app/run/submit">Submit it to the registry<ArrowRight size={15}/></a>}>
    <ActiveLine session={session}/>
    {prepared && <dl className="kv-list compact">
      <div className="kv"><dt>Bytes</dt><dd>{prepared.bytes.toLocaleString('en-US')} <span className="muted">compact JSON of the sealed report</span></dd></div>
      <div className="kv"><dt>SHA-256</dt><dd className="mono">{short(prepared.sha256, 20)}</dd></div>
      <div className="kv"><dt>Content hash</dt><dd className="mono">{short(prepared.contentHash, 20)} <span className="muted">blake2-256, emitted by Remark.Stored</span></dd></div>
      {fee && <div className="kv"><dt>Fee estimate</dt><dd>{(Number(fee) / 1e14).toFixed(4)} tPOT</dd></div>}
    </dl>}
    {blocker || <>
      <div className="step-actions"><button type="button" className="btn btn-primary" disabled={!prepared || busyTx || tx.uncertain} onClick={sign}><PenLine size={15}/>{stored ? 'Store again' : 'Sign and store'}</button><SignerLine id="store"/></div>
      <TxProgress tx={tx}/>
      <TxError tx={tx}/>
    </>}
    {stored && <div className="result-card passed">
      <div className="result-head"><Badge status={stored.retrieved?.verified ? 'passed' : 'pending'}>{stored.retrieved?.verified ? 'Retrieved and verified' : 'Stored'}</Badge><strong>{stored.bytes.toLocaleString('en-US')} bytes on Portaldot</strong></div>
      <TxResult result={stored.tx} title="Extrinsic"/>
      {stored.retrieved && <dl className="kv-list compact"><div className="kv"><dt>Retrieved</dt><dd>{stored.retrieved.verified ? `Remark.Stored names the publisher and content hash; the report's SHA-256 is ${short(report.evidenceHash, 12)}.` : stored.retrieved.reasons?.join(' ')}</dd></div></dl>}
    </div>}
    <ReplayCard report={report} studio={studio}/>
  </StepFrame>;
}

const TX_STAGES = [['signing', 'Sign in your wallet'], ['submitted', 'Submitted'], ['in-block', 'In a block'], ['finalized', 'Finalized'], ['readback', 'Read back']];
function TxProgress({ tx }) {
  if (!tx?.stage || tx.stage === 'idle') return null;
  const order = TX_STAGES.map(([id]) => id);
  const current = tx.stage === 'done' ? order.length : tx.stage === 'error' ? order.indexOf(tx.failedAt || 'signing') : order.indexOf(tx.stage);
  return <ol className="tx-progress" aria-label="Transaction progress">{TX_STAGES.map(([id, label], index) => <li key={id} className={index < current ? 'done' : index === current ? (tx.stage === 'error' ? 'failed' : 'current') : ''}><span className="tx-dot" aria-hidden="true">{index < current ? <Check size={11}/> : index === current && tx.stage !== 'error' ? <LoaderCircle className="spin" size={11}/> : null}</span>{label}</li>)}</ol>;
}

/** A failed transaction: what failed, and, when the send was handed to the network without an established result, a stop that no automatic retry follows. */
function TxError({ tx }) {
  if (tx?.stage !== 'error') return null;
  return <div className={`form-error block${tx.uncertain ? ' uncertain' : ''}`} role="alert"><CircleAlert size={15}/><div><strong>{tx.uncertain ? 'Stop: the result of this transaction is unknown.' : 'Not completed.'}</strong> {tx.error} {tx.note}</div></div>;
}

function TxResult({ result, title }) {
  if (!result) return null;
  return <dl className="kv-list tx-result">
    <div className="kv"><dt>{title}</dt><dd>{result.extrinsicHash ? <ChainLink hash={result.extrinsicHash} kind="extrinsic" length={18}/> : <span className="mono">{short(result.txHash, 18)}</span>}</dd></div>
    <div className="kv"><dt>Block</dt><dd><ChainLink hash={result.blockHash}>#{fmt(result.blockNumber)}</ChainLink> · finalized</dd></div>
    {result.route === 'evm' && <div className="kv"><dt>EVM transaction</dt><dd className="mono">{short(result.txHash, 18)}</dd></div>}
  </dl>;
}

/** The connected wallet, or the reason a write step cannot start yet. */
function useSigner(kind) {
  const { account, info, openDialog, refresh } = useWallet();
  const blocker = !account ? <Locked action={<button type="button" className="btn btn-primary btn-sm" onClick={openDialog}><Wallet size={14}/>Connect wallet</button>}>Connect a wallet to sign this step. Reads stay free.</Locked>
    : kind === 'polkadot' && account.kind !== 'polkadot' ? <Locked action={<button type="button" className="btn btn-secondary btn-sm" onClick={openDialog}>Switch wallet</button>}>A remark is a native extrinsic, so it needs a Polkadot wallet.</Locked> : null;
  return { account, info, refresh, blocker };
}

function DryRun({ prepared, fee, info, account }) {
  if (!prepared?.dryRun) return null;
  const run = prepared.dryRun;
  const need = BigInt(run.maxStorageDepositRaw || '0') + BigInt(fee || '0') * 2n;
  const short1 = info?.availableRaw && BigInt(info.availableRaw) < need;
  return <div className={`dry-run ${run.ok ? 'ok' : 'reverts'}`}>
    <div className="dry-run-head"><Badge status={run.ok ? 'passed' : 'failed'}>{run.ok ? 'Dry-run passes' : `Would revert${run.revertReason ? `: ${run.revertReason}` : ''}`}</Badge><span className="muted">Simulated by ReviveApi.call at the latest block. Nothing is signed.</span></div>
    <dl className="kv-list compact">
      <div className="kv"><dt>Call</dt><dd className="mono">{prepared.action === 'submit' ? 'submit(name, reportHash)' : prepared.action === 'list' ? 'list(token, id, reportHash, reviewer, decimals)' : `review(id, reportHash, ${prepared.approved !== false})`} → {short(prepared.to, 12)}</dd></div>
      <div className="kv"><dt>Storage deposit</dt><dd>up to {run.maxStorageDeposit}</dd></div>
      {account.kind === 'polkadot' && <div className="kv"><dt>Fee estimate</dt><dd>{fee ? `${(Number(fee) / 1e14).toFixed(4)} tPOT` : 'estimating…'}</dd></div>}
      <div className="kv"><dt>Your balance</dt><dd>{info?.available ? `${tpot(info.available)} tPOT spendable` : 'reading…'}</dd></div>
      <div className="kv"><dt>Sender</dt><dd className="mono">{short(run.sender, 16)}</dd></div>
    </dl>
    {short1 && <p className="form-error"><CircleAlert size={14}/>This account cannot cover the deposit and fee. Fund it with tPOT or switch accounts.</p>}
  </div>;
}

function SubmitStep({ studio }) {
  const { project, session, apply, readback } = studio;
  const report = passedActiveReport(session);
  const { account, info, refresh, blocker } = useSigner();
  const defaultLabel = project.kind === 'demo' ? 'pusd-token-list' : releaseLabelFor(project.name);
  const [label, setLabel] = useState(report && session.submit?.reportHash === report.evidenceHash && session.submit.label ? session.submit.label : defaultLabel);
  const [prepared, setPrepared] = useState(null);
  const [fee, setFee] = useState(null);
  const [current, setCurrent] = useState(null);
  const [tx, setTx] = useState({ stage: 'idle' });
  const [task, run] = useTask();
  const done = session.submit?.tx && session.submit.reportHash === report?.evidenceHash && session.submit.from === account?.address ? session.submit : null;
  useEffect(() => {
    setPrepared(null); setFee(null); setCurrent(null); setTx({ stage: 'idle' });
    if (!report || !account || !label.trim() || new TextEncoder().encode(label.trim()).length > 31) return;
    let alive = true;
    run('Preparing and dry-running the call…', async () => {
      const next = await (await engine()).prepareTransaction({ action: 'submit', label: label.trim(), reportHash: report.evidenceHash, from: account.address });
      if (alive) setPrepared({ ...next, forReport: report.evidenceHash, forLabel: label.trim(), forProject: project.id });
    });
    return () => { alive = false; };
  }, [report?.evidenceHash, account?.address, label]);
  // The release's current revision and the fee follow the dry-run; neither blocks signing.
  useEffect(() => {
    if (!prepared) return undefined;
    let alive = true;
    engine().then((api) => api.readRegistry({ releaseId: prepared.releaseId })).then((value) => alive && setCurrent(value)).catch(() => {});
    if (account?.kind === 'polkadot' && prepared.dryRun?.ok) walletModule().then((module) => module.nativeFee(account, prepared)).then((value) => alive && setFee(value)).catch(() => {});
    return () => { alive = false; };
  }, [prepared]);
  async function sign() {
    if (prepared?.forReport !== report.evidenceHash || prepared.forLabel !== label.trim() || prepared.forProject !== project.id) { setTx({ stage: 'error', failedAt: 'signing', error: 'The prepared call belongs to another report, label or project. Prepare again.' }); return; }
    setTx({ stage: 'signing' });
    try {
      const result = await (await walletModule()).sendRegistryCall(account, prepared, (status) => setTx((value) => ({ ...value, ...status })));
      if (!result.success) throw new Error(`Included in block #${result.blockNumber}, but the call failed${result.failure ? ` (${result.failure})` : ''}.`);
      apply('submit', { label: label.trim(), releaseId: prepared.releaseId, reportHash: report.evidenceHash, from: account.address, sender: prepared.dryRun.sender, tx: result });
      setTx({ stage: 'readback', result });
      const read = await (await engine()).readRegistry({ releaseId: prepared.releaseId });
      readback('submit', result.extrinsicHash, { readback: read });
      setTx({ stage: 'done', result });
      refresh();
    } catch (error) { setTx((value) => txFailure(value, error)); }
  }
  if (!report) return <NeedsPass id="submit" purpose="Commit a passed report’s hash to the shared ReleaseRegistry." session={session}/>;
  const readBack = done?.readBack;
  return <StepFrame id="submit" purpose="Commit the active report’s hash to the shared ReleaseRegistry. The release ID is your address plus the label, and each submission opens a new revision with no approval."
    next={done && <a className="btn btn-primary" href="#/app/run/approve">Approve it<ArrowRight size={15}/></a>}>
    <ActiveLine session={session}/>
    {blocker || <>
      <label className="field">Release label <span className="hint">1–31 bytes, stored as bytes32 · from the project name</span><input value={label} maxLength={31} onChange={(event) => setLabel(event.target.value)} disabled={!!task.busy || BUSY_TX.includes(tx.stage)} spellCheck="false"/></label>
      {prepared && <dl className="kv-list compact"><div className="kv"><dt>Release ID</dt><dd className="mono">{short(prepared.releaseId, 22)}<CopyButton value={prepared.releaseId} label="Copy"/></dd></div><div className="kv"><dt>Today</dt><dd>{current?.release?.exists ? `Revision ${current.release.revision}; this submission opens revision ${Number(current.release.revision) + 1} and clears its approval` : 'Not submitted yet; this opens revision 1'}</dd></div></dl>}
      <Working task={task}/>
      <DryRun prepared={prepared} fee={fee} info={info} account={account}/>
      <div className="step-actions"><button type="button" className="btn btn-primary" disabled={!prepared?.dryRun?.ok || !!task.busy || BUSY_TX.includes(tx.stage) || tx.uncertain} onClick={sign}><PenLine size={15}/>{done ? 'Submit again (new revision)' : 'Sign and submit'}</button><SignerLine id="submit"/></div>
      <TxProgress tx={tx}/>
      <TxError tx={tx}/>
    </>}
    {done && <div className="result-card passed">
      <div className="result-head"><Badge status="finalized">Finalized</Badge><strong>Submitted “{done.label}”{readBack ? `, revision ${readBack.release.revision}` : ''}</strong></div>
      <TxResult result={done.tx} title="Extrinsic"/>
      {readBack && <dl className="kv-list compact"><div className="kv"><dt>Read back</dt><dd>{readBack.interfacesAgree ? 'EVM RPC and ReviveApi agree' : 'Interfaces disagree'} at <ChainLink hash={readBack.block.nativeHash}>#{fmt(readBack.block.number)}</ChainLink></dd></div><div className="kv"><dt>Stored hash</dt><dd className="mono">{short(readBack.release.reportHash, 20)} {readBack.release.reportHash === `0x${report.evidenceHash}` ? <Badge status="passed">matches</Badge> : <Badge status="failed">differs</Badge>}</dd></div></dl>}
    </div>}
  </StepFrame>;
}

function ApproveStep({ studio }) {
  const { project, session, apply, readback } = studio;
  const { account, info, refresh, blocker } = useSigner();
  const passed = passedActiveReport(session);
  const submitted = passed && session.submit?.reportHash === passed.evidenceHash ? session.submit : null;
  const [releaseId, setReleaseId] = useState(submitted?.releaseId || '');
  const [approved, setApproved] = useState(session.approve?.approved ?? true);
  const [state, setState] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [fee, setFee] = useState(null);
  const [tx, setTx] = useState({ stage: 'idle' });
  const [task, run] = useTask();
  useEffect(() => { if (!releaseId && submitted?.releaseId) setReleaseId(submitted.releaseId); }, [submitted?.releaseId]);
  const valid = /^0x[0-9a-fA-F]{64}$/.test(releaseId);
  useEffect(() => {
    setState(null); setPrepared(null); setFee(null); setTx({ stage: 'idle' });
    if (!valid || !account) return;
    let alive = true;
    run('Reading the release and dry-running your decision…', async () => {
      const api = await engine();
      const reviewer = (await api.accountOverview(account.address)).evm;
      const current = await api.readRegistry({ releaseId, reviewer });
      if (!alive) return;
      setState(current);
      if (!current.release.exists) return;
      const next = await api.prepareTransaction({ action: 'review', releaseId, reportHash: current.release.reportHash, approved, from: account.address });
      if (!alive) return;
      setPrepared({ ...next, approved, forRelease: releaseId, forReport: current.release.reportHash, forRevision: current.release.revision, forProject: project.id });
      if (account.kind === 'polkadot' && next.dryRun?.ok) walletModule().then((module) => module.nativeFee(account, next)).then((value) => alive && setFee(value)).catch(() => {});
    });
    return () => { alive = false; };
  }, [releaseId, account?.address, approved]);
  async function sign() {
    if (prepared?.forRelease !== releaseId || prepared.forReport !== state?.release?.reportHash || prepared.forProject !== project.id) { setTx({ stage: 'error', failedAt: 'signing', error: 'The prepared decision names another release, report or project than the one shown. Read again.' }); return; }
    setTx({ stage: 'signing' });
    try {
      const result = await (await walletModule()).sendRegistryCall(account, prepared, (status) => setTx((value) => ({ ...value, ...status })));
      if (!result.success) throw new Error(`Included in block #${result.blockNumber}, but the call failed${result.failure ? ` (${result.failure})` : ''}.`);
      apply('approve', { releaseId, approved, reportHash: state.release.reportHash, revision: state.release.revision, reviewer: prepared.dryRun.sender, from: account.address, tx: result });
      setTx({ stage: 'readback', result });
      const read = await (await engine()).readRegistry({ releaseId, reviewer: prepared.dryRun.sender });
      readback('approve', result.extrinsicHash, { readback: read });
      setTx({ stage: 'done', result });
      refresh();
    } catch (error) { setTx((value) => txFailure(value, error)); }
  }
  // The saved decision counts for the operation in front of the visitor only: this release, the active report and the registry's current revision.
  const done = session.approve?.tx && session.approve.releaseId === releaseId ? session.approve : null;
  const decision = describeReviewReceipt(done, { releaseId, release: state?.release?.exists ? state.release : null });
  const otherReport = done && passed && String(done.reportHash).replace(/^0x/, '').toLowerCase() !== passed.evidenceHash;
  const busyTx = BUSY_TX.includes(tx.stage);
  return <StepFrame id="approve" purpose="A reviewer decides on the current revision by naming the report hash they read. Here you can review your own submission to see the mechanism; a real release would have a second account review it."
    next={done && decision.kind === 'current' && !otherReport && <a className="btn btn-primary" href="#/app/run/promote">Assess promotion<ArrowRight size={15}/></a>}>
    <ActiveLine session={session}/>
    {blocker || <>
      <label className="field">Release ID<span className="hint">{submitted?.releaseId === releaseId ? 'Your submission of the active report' : 'Paste any release ID to review it'}</span><input value={releaseId} onChange={(event) => setReleaseId(event.target.value.trim())} placeholder="0x… (32 bytes)" spellCheck="false" disabled={busyTx}/></label>
      <Working task={task}/>
      {state && (!state.release.exists ? <p className="form-error"><CircleAlert size={14}/>No release with this ID exists in the registry yet.</p> : <dl className="kv-list compact">
        <div className="kv"><dt>Owner</dt><dd className="mono">{short(state.release.owner, 16)}</dd></div>
        <div className="kv"><dt>Revision</dt><dd>{state.release.revision}{state.decision?.reviewed ? ` · you already ${state.decision.approved ? 'approved' : 'requested changes on'} it` : ''}</dd></div>
        <div className="kv"><dt>Report hash</dt><dd className="mono">{short(state.release.reportHash, 20)} {passed && state.release.reportHash === `0x${passed.evidenceHash}` ? <Badge status="passed">the active report</Badge> : <Badge status="pending">not the active report</Badge>}</dd></div>
      </dl>)}
      {state?.release.exists && <fieldset className="segmented" disabled={busyTx}><legend className="visually-hidden">Decision</legend>
        <label className={approved ? 'selected' : ''}><input type="radio" name="decision" checked={approved} onChange={() => setApproved(true)}/>Approve</label>
        <label className={!approved ? 'selected' : ''}><input type="radio" name="decision" checked={!approved} onChange={() => setApproved(false)}/>Request changes</label>
      </fieldset>}
      <DryRun prepared={prepared} fee={fee} info={info} account={account}/>
      {state?.release.exists && <div className="step-actions"><button type="button" className="btn btn-primary" disabled={!prepared?.dryRun?.ok || !!task.busy || busyTx || tx.uncertain} onClick={sign}><PenLine size={15}/>{approved ? 'Sign the approval' : 'Sign “changes requested”'}</button><SignerLine id="approve"/></div>}
      <TxProgress tx={tx}/>
      <TxError tx={tx}/>
    </>}
    {done && <div className={`result-card ${decision.kind === 'historical' || otherReport ? '' : done.approved ? 'passed' : 'failed'}`}>
      <div className="result-head"><Badge status={decision.kind === 'historical' || otherReport ? 'idle' : done.approved ? 'approved' : 'changes-requested'}>{decision.kind === 'historical' || otherReport ? 'Historical' : done.approved ? 'Approved' : 'Changes requested'}</Badge><strong>Revision {done.revision}, report {short(done.reportHash, 14)}</strong></div>
      <TxResult result={done.tx} title="Extrinsic"/>
      {decision.kind === 'historical' && <p className="muted">This decision stands as a record of revision {done.revision}; it does not approve the current revision: {decision.reasons.join('; ')}.</p>}
      {otherReport && decision.kind !== 'historical' && <p className="muted">This decision names report {short(done.reportHash, 14)}, not the active report {short(passed.evidenceHash, 14)}; it does not approve the active report.</p>}
      {done.readback?.decision && <dl className="kv-list compact"><div className="kv"><dt>Read back</dt><dd>decisionOf → reviewed {String(done.readback.decision.reviewed)}, approved {String(done.readback.decision.approved)} · {done.readback.interfacesAgree ? 'both interfaces agree' : 'interfaces disagree'} at <ChainLink hash={done.readback.block.nativeHash}>#{fmt(done.readback.block.number)}</ChainLink></dd></div></dl>}
    </div>}
    <AttestCard studio={studio}/>
  </StepFrame>;
}

function AttestCard({ studio }) {
  const { session, apply, readback, begin, settle } = studio;
  const report = passedActiveReport(session);
  const { account, blocker } = useSigner('polkadot');
  const [decision, setDecision] = useState('accepted');
  const [fee, setFee] = useState(null);
  const [tx, setTx] = useState({ stage: 'idle' });
  const [paste, setPaste] = useState('');
  const [task, run] = useTask();
  const remark = report ? `revivecheck:1:review:${decision}:${report.evidenceHash}` : '';
  useEffect(() => { setFee(null); if (!remark || account?.kind !== 'polkadot') return; walletModule().then((module) => module.nativeFee(account, { action: 'remark', remark })).then(setFee).catch(() => {}); }, [remark, account?.address]);
  async function sign() {
    setTx({ stage: 'signing' });
    try {
      const result = await (await walletModule()).sendRemark(account, remark, (status) => setTx((value) => ({ ...value, ...status })));
      if (!result.success) throw new Error(`Included in block #${result.blockNumber}, but the remark failed.`);
      apply('remark', { decision, reportHash: report.evidenceHash, tx: result });
      setTx({ stage: 'readback', result });
      const verification = await (await engine()).verifyAttestation({ extrinsicHash: result.extrinsicHash, blockHash: result.blockHash });
      readback('remark', result.extrinsicHash, { verification });
      setTx({ stage: 'done', result });
    } catch (error) { setTx((value) => txFailure(value, error)); }
  }
  async function verifyPasted(event) { event.preventDefault(); const token = begin('verified'); const verification = await run('Verifying from chain data…', async () => (await engine()).verifyAttestation({ extrinsicHash: paste.trim() })); if (verification) settle(token, verification); }
  const own = session.remark?.reportHash === report?.evidenceHash ? session.remark : null;
  const verification = own?.verification;
  return <div className="sub-card" id="attest">
    <h3>Or attest with a signed remark</h3>
    <p>A lighter record than the registry: one <code>System.remark_with_event</code> binding your decision to the active report hash. Anyone can verify it from chain data alone.</p>
    {!report ? <p className="muted">Needs a passed active report.</p> : blocker || <>
      <fieldset className="segmented" disabled={BUSY_TX.includes(tx.stage)}><legend className="visually-hidden">Remark decision</legend>
        <label className={decision === 'accepted' ? 'selected' : ''}><input type="radio" name="remark" checked={decision === 'accepted'} onChange={() => setDecision('accepted')}/>Accepted</label>
        <label className={decision === 'changes-requested' ? 'selected' : ''}><input type="radio" name="remark" checked={decision === 'changes-requested'} onChange={() => setDecision('changes-requested')}/>Changes requested</label>
      </fieldset>
      <div className="remark-preview"><code>{remark}</code><CopyButton value={remark}/></div>
      <div className="step-actions"><button type="button" className="btn btn-secondary" onClick={sign} disabled={BUSY_TX.includes(tx.stage) || tx.uncertain}><PenLine size={15}/>Sign the remark</button><span className="muted">{fee ? `Fee about ${(Number(fee) / 1e14).toFixed(4)} tPOT` : ''}</span></div>
      <TxProgress tx={tx}/>
      <TxError tx={tx}/>
    </>}
    {verification && <Verified result={verification}/>}
    <form className="paste-verify" onSubmit={verifyPasted}>
      <label htmlFor="verify-hash">Verify any ReviveCheck remark by its extrinsic hash</label>
      <div><input id="verify-hash" value={paste} onChange={(event) => setPaste(event.target.value)} placeholder="0x… (64 hex characters)" spellCheck="false"/><button type="submit" className="btn btn-secondary btn-sm" disabled={!/^0x[0-9a-fA-F]{64}$/.test(paste.trim()) || !!task.busy}>{task.busy ? <LoaderCircle className="spin" size={14}/> : <ShieldCheck size={14}/>}Verify</button></div>
    </form>
    <Working task={task}/>
    {session.verified && <Verified result={session.verified} lookup/>}
  </div>;
}

function Verified({ result, lookup = false }) {
  return result.verified ? <div className="result-card passed compact"><div className="result-head"><Badge status="passed">Verified</Badge><strong>{result.decision === 'accepted' ? 'Accepted' : 'Changes requested'} for {short(result.reportHash, 14)}</strong>{lookup && <span className="muted">a lookup; it approves nothing here</span>}</div><dl className="kv-list compact"><div className="kv"><dt>Signer</dt><dd className="mono">{short(result.reviewer, 18)}</dd></div><div className="kv"><dt>Extrinsic</dt><dd><ChainLink hash={result.extrinsicHash} kind="extrinsic"/> in #{fmt(result.blockNumber)}, finalized</dd></div></dl></div>
    : <p className="form-error block" role="alert"><CircleAlert size={15}/>Not verified: {result.reasons?.join(' ')}</p>;
}

function ConsumeStep({ studio }) {
  const { project, session, apply, readback } = studio;
  const { account, info, refresh, blocker } = useSigner();
  const passed = passedActiveReport(session);
  const plan = activePlan(session);
  const submitted = passed && session.submit?.reportHash === passed.evidenceHash ? session.submit : null;
  const releaseId = submitted?.releaseId || '';
  // The token and its decimals come from the active report's own plan: the release content that was checked, never a substituted default.
  const [token, setToken] = useState(session.consume?.reportHash && String(session.consume.reportHash).replace(/^0x/, '') === passed?.evidenceHash ? session.consume.token : plan?.listing?.address || '');
  const [decimals, setDecimals] = useState(session.consume?.reportHash && String(session.consume.reportHash).replace(/^0x/, '') === passed?.evidenceHash ? session.consume.decimals : plan?.listing?.decimals ?? '');
  const [reviewer, setReviewer] = useState(session.consume?.reviewer || (session.approve?.releaseId === releaseId ? session.approve.reviewer : '') || '');
  const [state, setState] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [fee, setFee] = useState(null);
  const [tx, setTx] = useState({ stage: 'idle' });
  const [task, run] = useTask();
  // A saved receipt counts only for the exact operation in front of the visitor: this network, this consumer and version,
  // this token, release, reviewer and the registry's current revision. Anything else is history, shown as such.
  const receipt = describeListReceipt(session.consume, { network: TESTNET, consumer: TOKEN_LIST, token, releaseId, reviewer, release: state?.release?.exists ? { reportHash: state.release.reportHash, revision: state.release.revision } : null });
  const done = receipt.kind === 'current' ? session.consume : null;
  const historical = receipt.kind === 'historical' ? session.consume : null;
  // The reviewer defaults to the connected account's own EVM address; any address that approved the release can be named.
  useEffect(() => { if (reviewer || !account) return; engine().then((api) => api.accountOverview(account.address)).then((overview) => setReviewer((current) => current || overview.evm)).catch(() => {}); }, [account?.address]);
  useEffect(() => {
    setPrepared(null); setFee(null); setState(null); setTx({ stage: 'idle' });
    if (TOKEN_LIST.knownIssue || !releaseId || !account || !/^0x[0-9a-fA-F]{40}$/.test(token) || !/^0x[0-9a-fA-F]{40}$/.test(reviewer)) return undefined;
    let alive = true;
    run('Reading the registry and dry-running the listing…', async () => {
      const api = await engine();
      const current = await api.readRegistry({ releaseId, reviewer });
      if (!alive) return;
      setState(current);
      if (!current.release.exists) return;
      const next = await api.prepareTransaction({ action: 'list', token, releaseId, reportHash: current.release.reportHash, reviewer, decimals: Number(decimals), from: account.address });
      if (!alive) return;
      setPrepared({ ...next, forRelease: releaseId, forReport: current.release.reportHash, forToken: token, forProject: project.id });
      if (account.kind === 'polkadot' && next.dryRun?.ok) walletModule().then((module) => module.nativeFee(account, next)).then((value) => alive && setFee(value)).catch(() => {});
    });
    return () => { alive = false; };
  }, [releaseId, account?.address, token, decimals, reviewer]);
  async function sign() {
    if (prepared?.forRelease !== releaseId || prepared.forToken !== token || prepared.forReport !== state?.release?.reportHash || prepared.forProject !== project.id) { setTx({ stage: 'error', failedAt: 'signing', error: 'The prepared listing names another release, token, report or project than the one shown. Read again.' }); return; }
    setTx({ stage: 'signing' });
    try {
      const result = await (await walletModule()).sendContractCall(account, prepared, (status) => setTx((value) => ({ ...value, ...status })));
      if (!result.success) throw new Error(`Included in block #${result.blockNumber}, but the call failed${result.failure ? ` (${result.failure})` : ''}.`);
      apply('consume', listReceipt({ network: TESTNET, consumer: TOKEN_LIST, token, decimals, releaseId, reportHash: state.release.reportHash, revision: state.release.revision, reviewer, from: account.address, sender: prepared.dryRun.sender, tx: result }));
      setTx({ stage: 'readback', result });
      const read = await (await engine()).readTokenList({ token });
      readback('consume', result.extrinsicHash, { readback: read });
      setTx({ stage: 'done', result });
      refresh();
    } catch (error) { setTx((value) => txFailure(value, error)); }
  }
  if (TOKEN_LIST.knownIssue) return <StepFrame id="consume" purpose="Inspect the recorded consumer while its corrected replacement awaits deployment."><Locked action={<a className="btn btn-secondary btn-sm" href="#/app/tokens">Read the recorded listing</a>}>New token-list writes are disabled for v1 because existing entries can be replaced by another release owner. The corrected v2 must be deployed, verified and activated before listing resumes. Historical transactions and live reads remain available.</Locked></StepFrame>;
  if (!passed) return <NeedsPass id="consume" purpose="Let a contract act on the approval." session={session}/>;
  if (!releaseId) return <StepFrame id="consume" purpose="Let a contract act on the approval."><ActiveLine session={session}/><Locked action={<a className="btn btn-secondary btn-sm" href="#/app/run/submit">Go to Submit</a>}>Consume needs the active report's release in the registry. Submit and approve it first.</Locked></StepFrame>;
  const busyTx = BUSY_TX.includes(tx.stage);
  return <StepFrame id="consume" purpose="The VerifiedTokenList is a contract that consumes the registry as middleware. It lists a token only from the release owner, only while the named reviewer’s approval of the exact report stands, and only if the token itself reports the claimed decimals. Name the reviewer whose approval the listing relies on: your own address by default, or the account that approved your release."
    next={done && <a className="btn btn-primary" href="#/app/run/promote">Assess promotion<ArrowRight size={15}/></a>}>
    <ActiveLine session={session}/>
    {blocker || <>
      <label className="field">Reviewer<span className="hint">the approval this listing relies on · your own address by default</span><input value={reviewer} onChange={(event) => setReviewer(event.target.value.trim())} placeholder="0x… (20 bytes)" spellCheck="false" disabled={busyTx}/></label>
      <div className="field-row two"><label className="field">Token<input value={token} onChange={(event) => setToken(event.target.value.trim())} spellCheck="false" disabled={busyTx}/></label><label className="field">Claimed decimals<input type="number" min="0" max="255" value={decimals} onChange={(event) => setDecimals(event.target.value)} disabled={busyTx}/></label></div>
      <p className="muted">The token and the decimals come from the active report's release ({plan?.listing?.symbol ?? 'the entry'}, {plan?.listing?.decimals ?? '?'} decimals). Claim another value to watch the contract refuse the listing.</p>
      <Working task={task}/>
      {state && !state.release.exists && <p className="form-error"><CircleAlert size={14}/>Your release is not in the registry yet.</p>}
      {state?.release.exists && !state.decision?.approved && <p className="form-error"><CircleAlert size={14}/>Reviewer <span className="mono">{short(reviewer, 12)}</span> has not approved the current revision; the list call checks the registry. Name the account that approved it, or approve it first.</p>}
      {state?.release.exists && state.decision?.approved && <p className="muted">Reviewer <span className="mono">{short(reviewer, 12)}</span> approved revision {state.release.revision}; the contract re-checks that approval on every <code>isListed</code> read.</p>}
      <DryRun prepared={prepared} fee={fee} info={info} account={account}/>
      <div className="step-actions"><button type="button" className="btn btn-primary" disabled={!prepared?.dryRun?.ok || !!task.busy || busyTx || tx.uncertain} onClick={sign}><PenLine size={15}/>{done ? 'List again' : 'Sign and list'}</button><SignerLine id="consume"/></div>
      <TxProgress tx={tx}/>
      <TxError tx={tx}/>
    </>}
    {done && <div className="result-card passed">
      <div className="result-head"><Badge status={receipt.completion === 'failed' ? 'failed' : receipt.listed ? 'listed' : receipt.listed === false ? 'pending' : 'finalized'}>{receipt.completion === 'failed' ? 'Failed' : receipt.listed ? 'Listed' : receipt.listed === false ? (receipt.readback?.matched ? 'Finalized · not listed' : 'Finalized · readback unmatched') : 'Finalized'}</Badge><strong>{short(done.token, 14)} in the VerifiedTokenList v{done.consumer.version}</strong></div>
      <TxResult result={done.tx} title="Extrinsic"/>
      <dl className="kv-list compact">
        <div className="kv"><dt>Bound to</dt><dd>chain {done.network.chainId} · consumer v{done.consumer.version} <span className="mono">{short(done.consumer.address, 12)}</span> · revision {done.revision} · report <span className="mono">{short(done.reportHash, 14)}</span> · reviewer <span className="mono">{short(done.reviewer, 12)}</span></dd></div>
        {done.readback ? <div className="kv"><dt>Read back</dt><dd>isListed → {String(done.readback.listed)} · {done.readback.interfacesAgree ? 'both interfaces agree' : 'interfaces disagree'}{done.readback.block ? <> at <ChainLink hash={done.readback.block.nativeHash}>#{fmt(done.readback.block.number)}</ChainLink></> : null}{receipt.readback && !receipt.readback.matched && <small className="block">This readback does not vouch for the listing: {receipt.readback.reasons.join('; ')}.</small>}</dd></div> : <div className="kv"><dt>Read back</dt><dd>No matching readback yet. Inclusion in a block alone never shows Listed.</dd></div>}
        <div className="kv"><dt>Eligibility</dt><dd>A finalized listing is a transaction fact. Whether the entry may be enabled now is a policy decision at a fresh checkpoint; a new revision or a revoked approval changes it without touching this receipt. <a className="text-link" href="#/app/projects">Your project's policy<ArrowRight size={13} aria-hidden="true"/></a></dd></div>
      </dl>
    </div>}
    {historical && <div className="result-card">
      <div className="result-head"><Badge status="idle">Historical</Badge><strong>An earlier listing signed in this browser</strong></div>
      <TxResult result={historical.tx} title="Extrinsic"/>
      <p className="muted">Kept as history, not as completion of this operation: {receipt.reasons.join('; ')}.</p>
    </div>}
  </StepFrame>;
}

function PromoteStep({ studio }) {
  const { session, begin, settle } = studio;
  const report = passedActiveReport(session);
  const [task, run] = useTask();
  const result = report && session.promote?.from === report.evidenceHash ? session.promote.report : null;
  async function start() { const token = begin('promote'); const next = await run('Reading V3 Live…', async () => (await engine()).assessPromotion(report)); if (next) settle(token, { from: report.evidenceHash, report: next }); }
  if (!report) return <NeedsPass id="promote" purpose="Ask V3 Live whether a passed testnet report can stand for it." session={session}/>;
  return <StepFrame id="promote" purpose={`Ask V3 Live itself whether report ${short(report.evidenceHash, 12)} can stand for it: network identity, the chain the release names, the runtime and the asset. Read-only.`}
    next={result && <a className="btn btn-primary" href="#/app/run/watch">Watch for changes<ArrowRight size={15}/></a>}>
    <ActiveLine session={session}/>
    <div className="step-actions"><button type="button" className="btn btn-primary" onClick={start} disabled={!!task.busy}>{task.busy && <LoaderCircle className="spin" size={15}/>}{result ? 'Assess again' : 'Assess promotion'}</button><SignerLine id="promote"/></div>
    <Working task={task}/>
    {result && !task.busy && <ReportResult report={result} title={result.status === 'passed' ? 'V3 Live can accept this release' : 'V3 Live refuses this release as it stands'}/>}
  </StepFrame>;
}

function WatchStep({ studio }) {
  const { session, identity, begin, settle } = studio;
  const report = activeReport(session);
  const head = useTestnetHead();
  const live = useNetworkHead('live');
  const [task, run] = useTask();
  const watched = report && session.watch?.comparison?.baselineHash === report.evidenceHash ? session.watch : null;
  async function start() { const token = begin('watch'); const result = await run('Rechecking at the current head…', async () => { const api = await engine(); const next = await api.checkRelease(report.input, { ...identity, previous: report }); return { report: next, comparison: api.compare(report, next) }; }); if (result) settle(token, result); }
  const pinned = report ? `${report.network?.specName}/${report.network?.specVersion}` : null;
  const now = head.specVersion ? `${head.specName}/${head.specVersion}` : null;
  return <StepFrame id="watch" purpose="A report holds for the runtime and block it pinned. This page follows both networks live; when the runtime or the release changes, recheck and the loop starts again.">
    <ActiveLine session={session}/>
    <dl className="kv-list">
      <div className="kv"><dt>Your report pinned</dt><dd>{pinned ? <>{pinned} at <ChainLink hash={report.network.finalizedNativeBlockHash}>#{fmt(report.network.finalizedBlockNumber)}</ChainLink></> : 'No report yet'}</dd></div>
      <div className="kv"><dt>Testnet now</dt><dd>{now || 'syncing…'}{head.number !== null && <> at <ChainLink hash={head.hash}>#{fmt(head.number)}</ChainLink></>} {pinned && now && <Badge status={pinned === now ? 'passed' : 'pending'}>{pinned === now ? 'same runtime' : 'runtime changed: recheck'}</Badge>}</dd></div>
      <div className="kv"><dt>V3 Live now</dt><dd>{live.specVersion ? `${live.specName}/${live.specVersion}` : 'syncing…'}{live.number !== null && <> at <ChainLink hash={live.hash} network={LIVE}>#{fmt(live.number)}</ChainLink></>}</dd></div>
      <div className="kv"><dt>Past upgrades</dt><dd>Testnet 3001 at <ChainLink hash={RUNTIME_HISTORY.testnet[1].hash}>#{fmt(RUNTIME_HISTORY.testnet[1].from)}</ChainLink>, 3002 at <ChainLink hash={RUNTIME_HISTORY.testnet[2].hash}>#{fmt(RUNTIME_HISTORY.testnet[2].from)}</ChainLink>; V3 Live 3001 at <ChainLink hash={RUNTIME_HISTORY.live[1].hash} network={LIVE}>#{fmt(RUNTIME_HISTORY.live[1].from)}</ChainLink></dd></div>
    </dl>
    {report && <div className="step-actions"><button type="button" className="btn btn-primary" onClick={start} disabled={!!task.busy}>{task.busy && <LoaderCircle className="spin" size={15}/>}<RotateCcw size={15}/>Recheck at the current head</button><SignerLine id="watch"/></div>}
    <Working task={task}/>
    {watched?.comparison && !task.busy && <div className="comparison-card"><div className="comparison-summary"><Badge status={watched.report.status}>{statusWord[watched.report.status]}</Badge><span>at #{fmt(watched.report.network.finalizedBlockNumber)}</span><span className="muted">{watched.comparison.comparisonKind === 'runtime-change' ? 'The runtime changed since your report: a new review is due.' : `${watched.comparison.summary?.unchanged || 0} checks unchanged since your report.`}</span></div><p className="muted">A watch recheck records a comparison; it does not replace the active report. Run Recheck to make a new report the active one.</p></div>}
  </StepFrame>;
}

/** The newest registry read the session holds for the active submission, so badges follow the revision the chain holds. */
function registryReadOf(session) {
  const reads = [session.submit?.readback, session.approve?.readback].filter((read) => read?.release && read.releaseId === session.submit?.releaseId);
  return reads.sort((a, b) => Number(b.block?.number ?? 0) - Number(a.block?.number ?? 0))[0] ?? null;
}

const LEDGER_WORDS = { check: 'Check', recheck: 'Recheck', replay: 'Replay', store: 'Store', submit: 'Submit', approve: 'Approve', remark: 'Remark', verified: 'Verified', consume: 'Consume', promote: 'Promote', watch: 'Watch' };
function ledgerRow(key, value, listing) {
  switch (key) {
    case 'check': case 'recheck': return [value.report.release, value.report.status, value.report.network?.finalizedNativeBlockHash, value.report.network?.finalizedBlockNumber, 'block', TESTNET];
    case 'replay': return [`${value.items.filter((item) => item.match).length}/${value.items.length}`, value.status, value.nativeHash, value.blockNumber, 'block', TESTNET];
    case 'store': return [`${value.bytes.toLocaleString('en-US')} B`, value.retrieved?.verified ? 'passed' : 'pending', value.tx.extrinsicHash, value.tx.blockNumber, 'extrinsic', TESTNET];
    case 'submit': return [value.label, 'finalized', value.tx.extrinsicHash || value.tx.blockHash, value.tx.blockNumber, value.tx.extrinsicHash ? 'extrinsic' : 'block', TESTNET];
    case 'approve': return [value.approved ? 'Approved' : 'Changes', value.approved ? 'approved' : 'changes-requested', value.tx.extrinsicHash || value.tx.blockHash, value.tx.blockNumber, value.tx.extrinsicHash ? 'extrinsic' : 'block', TESTNET];
    case 'remark': return [value.decision === 'accepted' ? 'Accepted' : 'Changes', value.verification?.verified ? 'passed' : 'pending', value.tx.extrinsicHash, value.tx.blockNumber, 'extrinsic', TESTNET];
    case 'consume': return [listing.kind === 'historical' ? 'Historical' : listing.completion === 'failed' ? 'Failed' : listing.listed ? 'Listed' : 'Finalized', listing.kind === 'historical' ? 'idle' : listing.completion === 'failed' ? 'failed' : listing.listed ? 'approved' : 'finalized', value.tx.extrinsicHash, value.tx.blockNumber, 'extrinsic', TESTNET];
    case 'promote': return [value.report.status === 'passed' ? 'Can stand' : 'Refused', value.report.status === 'passed' ? 'passed' : 'refused', value.report.network?.finalizedNativeBlockHash, value.report.network?.finalizedBlockNumber, 'block', LIVE];
    case 'watch': return ['Rechecked', value.report.status, value.report.network?.finalizedNativeBlockHash, value.report.network?.finalizedBlockNumber, 'block', TESTNET];
    default: return null;
  }
}

function Ledger({ studio, statuses }) {
  const { session, reset } = studio;
  const { account, info, openDialog } = useWallet();
  const listing = describeListReceipt(session.consume, { network: TESTNET, consumer: TOKEN_LIST, token: session.consume?.token, releaseId: session.submit?.releaseId, reviewer: session.consume?.reviewer });
  const rows = ledgerRows(session).filter((row) => row.key !== 'verified').map((row) => ({ ...row, cells: ledgerRow(row.key, row.value, listing) })).filter((row) => row.cells);
  const history = session.history || [];
  return <aside className="studio-ledger" aria-labelledby="ledger-title">
    <div className="ledger-wallet">{account ? <><span className={`wallet-kind ${account.kind}`} aria-hidden="true"/><div><strong className="mono">{short(account.address, 14)}</strong><span>{info?.available ? `${tpot(info.available)} tPOT spendable` : info?.error ? 'Balance unavailable' : 'Reading balance…'}</span></div><button type="button" className="text-link" onClick={openDialog}>Details</button></> : <><Wallet size={16} aria-hidden="true"/><div><strong>No wallet</strong><span>Reads are free; writes need one.</span></div><button type="button" className="btn btn-secondary btn-sm" onClick={openDialog}>Connect</button></>}</div>
    <h2 id="ledger-title">Your session</h2>
    {session.active && <p className="muted ledger-active">Active report <span className="mono">{short(session.active.reportHash, 12)}</span> · {session.active.release} · {statusWord[session.active.status] || session.active.status}</p>}
    {rows.length ? <ol className="ledger-list">{rows.map(({ key, cells: [what, status, hash, block, kind, network] }) => <li key={key}><span className="ledger-stage">{LEDGER_WORDS[key]}</span><Badge status={status}>{what}</Badge><span className="ledger-link">{hash ? <ChainLink hash={hash} kind={kind} network={network}>#{fmt(block)}</ChainLink> : '—'}</span></li>)}</ol> : <p className="muted">Results and transactions from this browser appear here, each linked to the official explorer.</p>}
    {history.length > 0 && <details className="ledger-history"><summary><History size={13} aria-hidden="true"/>History · {history.length} earlier {history.length === 1 ? 'entry' : 'entries'}</summary>
      <ol>{history.map((entry, index) => <li key={index}><small>{entry.reason}</small><small className="block">{Object.keys(entry.stages).map((key) => LEDGER_WORDS[key]).join(', ')}{entry.active ? ` · report ${short(entry.active.reportHash, 10)}` : ''} · {new Date(entry.archivedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</small></li>)}</ol>
      <p className="muted"><small>Receipts stay on-chain and in this list; they never complete a later report's steps.</small></p>
    </details>}
    {(rows.length > 0 || history.length > 0) && <button type="button" className="text-link danger" onClick={() => { if (confirm('Clear this project’s studio session in this browser? On-chain records stay on-chain.')) reset(); }}><Trash2 size={13} aria-hidden="true"/>Clear session</button>}
  </aside>;
}

function Completion({ session, registry }) {
  const done = completion(session, { network: TESTNET, consumer: TOKEN_LIST, registry });
  if (!done) return null;
  return <div className="completion" role="status">
    <ShieldCheck size={20} aria-hidden="true"/>
    <div><strong>Revision {done.revision} of “{done.label}” is approved on-chain for the active report {short(done.reportHash, 12)}.</strong><p>Submitted in <ChainLink hash={done.submit.tx.blockHash}>#{fmt(done.submit.tx.blockNumber)}</ChainLink>, approved in <ChainLink hash={done.approve.tx.blockHash}>#{fmt(done.approve.tx.blockNumber)}</ChainLink>, read back through both interfaces.{done.store?.tx ? ` Its report is stored on-chain in #${fmt(done.store.tx.blockNumber)}.` : ''}{done.listed ? ` The VerifiedTokenList v${done.listed.consumer.version} lists ${short(done.listed.token, 10)} on that approval, read back at #${fmt(done.listed.readback.block.number)}.` : ''} {done.promote?.report ? `V3 Live ${done.promote.report.status === 'passed' ? 'can accept it' : 'refused it, as the record shows it should'}.` : 'Assess promotion to finish the loop.'} Transaction records stay as they are; whether the entry may be enabled now is a separate policy decision.</p></div>
  </div>;
}

/** What a visitor needs before the write steps, the wallet they connected, and the project this session belongs to. */
function StudioNeeds({ studio }) {
  const { account, info, openDialog } = useWallet();
  const { project, projects, switchProject } = studio;
  return <dl className="doc-facts studio-needs">
    <div><dt>Project</dt><dd><FolderKanban size={14} aria-hidden="true"/><select className="project-select" aria-label="Project" value={project.id} onChange={(event) => switchProject(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}{item.kind === 'demo' ? ' (demonstration)' : ''}</option>)}</select><a className="text-link" href="#/app/projects">My projects<ArrowRight size={13} aria-hidden="true"/></a><small className="block">Each project has its own session, plan and policy; nothing is shared between them.</small></dd></div>
    <div><dt>Wallet</dt><dd>{account ? <><span className="wallet-kind" aria-hidden="true"/><strong className="mono">{short(account.address, 12)}</strong> · {account.kind === 'evm' ? 'EVM' : 'Polkadot'}{info?.available ? ` · ${tpot(info.available)} tPOT spendable` : ''}</> : <>Polkadot.js, Talisman, SubWallet or MetaMask, on the V3 testnet. <button type="button" className="text-link" onClick={openDialog}>Connect<ArrowRight size={13} aria-hidden="true"/></button></>}</dd></div>
    <div><dt>tPOT</dt><dd>About 1 tPOT in fees for a full run, plus storage deposits that each dry-run shows before you sign. The Portaldot team hands out testnet tPOT through Hacker House registration or a Discord ticket.</dd></div>
    <div><dt>Time</dt><dd>About five minutes. Each write waits for finality on the testnet before the next step unlocks.</dd></div>
  </dl>;
}

const STEPS = { check: CheckStep, recheck: RecheckStep, store: StoreStep, submit: SubmitStep, approve: ApproveStep, consume: ConsumeStep, promote: PromoteStep, watch: WatchStep };
export default function Try() {
  const route = useSubRoute('#/app/run');
  const studio = useStudio();
  const { project, session } = studio;
  const step = STEPS[route] ? route : route === 'replay' ? 'store' : 'check';
  const Step = STEPS[step];
  const panel = useRef(null);
  useEffect(() => { engine().then((module) => module.warm('testnet')).catch(() => {}); }, []);
  useEffect(() => { if (route) panel.current?.querySelector('h2')?.focus({ preventScroll: true }); }, [route]);
  const registry = useMemo(() => registryReadOf(session), [session]);
  const statuses = useMemo(() => stepStatuses(session, { network: TESTNET, consumer: TOKEN_LIST, registry }), [session, registry]);
  return <div className="studio">
    <header className="studio-head">
      <h1>Run the lifecycle</h1>
      <p>Eight steps on the real Portaldot V3 testnet, from this browser, for <strong>{project.name}</strong>{project.kind === 'demo' ? ' (the demonstration release)' : ' (your project)'}. Four only read and need nothing. Four write to the chain: your own wallet signs each one after a dry-run, and your testnet tPOT pays the fee and the storage deposit. ReviveCheck holds no key and pays for nothing.</p>
    </header>
    <StudioNeeds studio={studio}/>
    <Completion session={session} registry={registry}/>
    <div className="studio-grid">
      <nav className="studio-steps" aria-label="Lifecycle stages">
        <ol>{STAGES.map((stage, index) => { const Icon = STAGE_ICONS[stage.id]; const [status, word] = statuses[stage.id]; return <li key={stage.id}><a href={`#/app/run/${stage.id}`} aria-current={step === stage.id ? 'step' : undefined} className="step-link" data-status={status}><span className="step-index" aria-hidden="true">{index + 1}</span><span className="step-icon"><Icon size={15} aria-hidden="true"/></span><span className="step-name">{stage.name}{stage.kind === 'write' && <small>wallet</small>}</span><Badge status={status}>{word}</Badge></a></li>; })}</ol>
      </nav>
      <div className="studio-panel" ref={panel}><Step key={`${project.id}:${step}:${session.active?.reportHash ?? ''}`} studio={studio}/></div>
      <Ledger studio={studio} statuses={statuses}/>
    </div>
  </div>;
}
