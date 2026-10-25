// The maintainer's decision screen: what the catalog entry may do right now, which
// fact enabled it, which event changed it, and what remains to be done. Three facts
// stay apart on this page: the on-chain approval (the registry's decision), the
// historical execution (finalized receipts, each linked to its block) and the current
// policy eligibility (an evaluation at a checkpoint and time). Everything shown comes
// from the published catalog records; "Evaluate now" runs the same evaluator the CLI
// and the Token Catalog use, in this browser, against fresh finalized reads. No wallet.
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Badge, ChainLink, CopyButton, useSubRoute } from './site.jsx';
import { short } from './components.jsx';
import { fetchJson, reviewerLink, fmt, when, useTask } from './records.js';
import { REASONS } from '../lib/policy.js';
import { approvedEntry, compareEntry, ENTRY_FIELDS } from '../examples/token-catalog/lib/catalog.js';

const engine = () => import('./engine.js');
const CATALOGS = [
  { id: 'testnet-v2', label: 'v2 · current', note: 'Consumer v2 with a separate reviewer account; every live step recorded on 2026-10-25 with its receipt.' },
  { id: 'testnet-v2-wrong-entry', label: 'Wrong entry · demonstration', note: 'The same policy and bindings under a configuration that claims 18 decimals: a valid approval never publishes an entry the report did not approve.' },
  { id: 'testnet', label: 'v1 · historical', note: 'Consumer v1 and the recorded 2026-10-23 listing, preserved as history; the application refuses new writes to it.' },
];
const STATUS_BADGE = { valid: 'passed', 'recheck-required': 'failed', expired: 'failed', unknown: 'unknown', unbound: 'idle' };
const STATUS_WORD = { valid: 'Valid', 'recheck-required': 'Recheck required', expired: 'Expired', unknown: 'Unknown', unbound: 'Unbound' };
const GROUPS = [['Evidence, target, plan and runtime', /^(evidence|target|plan|report|runtime|observation)\./], ['On-chain approval · ReleaseRegistry', /^registry\./], ['Listing · VerifiedTokenList', /^consumer\./], ['Stored report · remark.store', /^storage\./]];
const RECEIPT_WORD = { store: 'Report stored', submit: 'Submitted', review: 'Reviewed', list: 'Listed', transfer: 'Funded' };
const span = (value) => !Number.isFinite(value) ? '—' : value >= 86400 ? `${(value / 86400).toFixed(1)} days` : value >= 3600 ? `${(value / 3600).toFixed(1)} hours` : `${Math.round(value)} s`;
const reasonText = (code) => REASONS[code]?.text || (code.startsWith('entry-mismatch:') ? `The configured ${code.split(':')[1]} differs from the value the approved report verified. The entry is withheld; correct the configuration or approve a release that carries it.` : code === 'entry-unverified' ? 'The bound report approves no complete entry, so nothing can be published from it.' : code === 'no-binding' ? 'No report is bound to this entry yet.' : code);

function useCatalog(id) {
  const [state, setState] = useState({ id, loading: true });
  useEffect(() => {
    let alive = true;
    setState({ id, loading: true });
    (async () => {
      const [index, catalog, bindings, lifecycle] = await Promise.all(['index.json', 'catalog.json', 'bindings.json', 'lifecycle.json'].map((file) => fetchJson(`catalog/${id}/${file}`)));
      if (!catalog) { if (alive) setState({ id, loading: false, missing: true }); return; }
      const token = catalog.tokens[0];
      const [evaluation, report] = await Promise.all([fetchJson(`catalog/${id}/evaluations/${token.address}.json`), token.binding ? fetchJson(`reports/${token.binding.reportHash}.json`) : null]);
      if (alive) setState({ id, loading: false, index, catalog, token, bindings: bindings?.bindings || [], lifecycle, evaluation, report });
    })();
    return () => { alive = false; };
  }, [id]);
  return state;
}

function Reasons({ codes }) {
  if (!codes.length) return <span>Every policy condition held and the published entry equals the approved report.</span>;
  return <ul className="reason-list">{codes.map((code) => <li key={code}><code>{code}</code> · {reasonText(code)}</li>)}</ul>;
}

/** Evidence age against the policy clock, and observation freshness against its limit. */
function Freshness({ catalog, evaluation, report }) {
  const maxAge = catalog.policy.evidence.maxAgeSeconds, maxObservation = catalog.policy.evidence.maxObservationAgeSeconds;
  const evaluatedAt = Date.parse(evaluation.evaluatedAt);
  const reportAge = report ? (evaluatedAt - Date.parse(report.completedAt)) / 1000 : NaN;
  const used = Number.isFinite(reportAge) ? Math.min(100, Math.max(0, (reportAge / maxAge) * 100)) : 0;
  const observation = evaluation.checks.find((check) => check.id === 'observation.fresh');
  return <dl className="kv-list compact">
    <div className="kv"><dt>Evaluated</dt><dd>{when(evaluation.evaluatedAt)} · a point-in-time result; the evaluator reads fresh finalized state only when it is invoked and does not monitor continuously</dd></div>
    <div className="kv"><dt>Evidence age</dt><dd>{report ? <>{span(reportAge)} of the {span(maxAge)} the policy allows, since the report sealed at {when(report.completedAt)}<div className="age-track" aria-hidden="true"><div className={`age-fill ${used >= 100 ? 'spent' : ''}`} style={{ width: `${used}%` }}/></div></> : 'no bound report'}</dd></div>
    <div className="kv"><dt>Observation</dt><dd>{observation ? `${observation.observed} at evaluation; the policy accepts at most ${maxObservation} s` : 'no fresh network observation was available'} · checkpoints: registry #{fmt(evaluation.checkpoint.registry?.number)}, listing #{fmt(evaluation.checkpoint.listing?.number)}, observation #{fmt(evaluation.checkpoint.observation?.number)}</dd></div>
  </dl>;
}

function Checks({ checks }) {
  return GROUPS.map(([title, pattern]) => {
    const rows = checks.filter((check) => pattern.test(check.id));
    if (!rows.length) return null;
    return <div key={title} className="check-group"><h3>{title}</h3><ul className="check-grid">{rows.map((check) => <li key={check.id} className={check.status}>{check.status === 'passed' ? <Check size={14} aria-label="passed"/> : <X size={14} aria-label={check.status}/>}<span><code>{check.id}</code> · {check.observed}{check.status !== 'passed' && <em> · expected {check.expected}</em>}</span></li>)}</ul></div>;
  });
}

function EntryTable({ entry }) {
  return <table className="data-table entry-table">
    <thead><tr><th scope="col">Field</th><th scope="col">Configured</th><th scope="col">Approved report</th><th scope="col"><span className="visually-hidden">Match</span></th></tr></thead>
    <tbody>{ENTRY_FIELDS.map((field) => { const mismatch = entry.mismatches.some((item) => item.field === field); return <tr key={field}><th scope="row">{field}</th><td className={`mono ${mismatch ? 'mismatch' : ''}`}>{String(entry.configured?.[field] ?? '—')}</td><td className="mono">{entry.approved ? String(entry.approved[field]) : '—'}</td><td>{entry.approved ? (mismatch ? <X size={15} aria-label="differs"/> : <Check size={15} aria-label="equal"/>) : '—'}</td></tr>; })}</tbody>
  </table>;
}

function Lifecycle({ lifecycle }) {
  if (!lifecycle?.steps?.length) return <p className="muted">No live steps are recorded for this catalog. The v1 listing was recorded before step-by-step recording existed; its receipts are on the Activity page.</p>;
  return <div className="table-wrap flat"><table className="data-table lifecycle-table">
    <thead><tr><th scope="col">#</th><th scope="col">Step</th><th scope="col">Actor</th><th scope="col">On-chain</th><th scope="col">Listed</th><th scope="col">Policy</th><th scope="col">Entry</th></tr></thead>
    <tbody>{lifecycle.steps.map((step) => <tr key={step.index}>
      <td className="mono">{step.index}</td>
      <th scope="row"><strong>{step.step}</strong><small className="block">{step.action}{step.note ? ` ${step.note}` : ''}</small></th>
      <td>{step.actor}</td>
      <td>{step.receipts.length ? step.receipts.map((receipt) => <span key={receipt.extrinsicHash} className="block">{RECEIPT_WORD[receipt.kind] || receipt.kind}{receipt.kind === 'review' ? (receipt.approved ? ' · approved' : ' · changes requested') : ''} <ChainLink hash={receipt.extrinsicHash} kind="extrinsic">#{fmt(receipt.blockNumber)}</ChainLink></span>) : <span className="muted">no transaction</span>}<small className="block">read at #{fmt(step.listing?.block?.number ?? step.registry?.block?.number)} · {when(step.at)}</small></td>
      <td>{step.listing?.listed === true ? <Badge status="listed">listed</Badge> : step.listing?.listed === false ? <Badge status="pending">not listed</Badge> : <Badge status="unknown">not read</Badge>}</td>
      <td><Badge status={STATUS_BADGE[step.status] || 'idle'}>{STATUS_WORD[step.status] || step.status}</Badge>{step.reasons.length ? <small className="block">{step.reasons.join(', ')}</small> : null}</td>
      <td>{step.available ? <Badge status="passed">available</Badge> : <Badge status="failed">withheld</Badge>}</td>
    </tr>)}</tbody>
  </table></div>;
}

function Bindings({ catalog, bindings }) {
  const current = catalog.history?.current || bindings.filter((binding) => binding.policyHash === catalog.policy.hash);
  const historical = catalog.history?.historical || bindings.filter((binding) => binding.policyHash !== catalog.policy.hash);
  const row = (binding, note) => <li key={binding.id}><span className="mono">{short(binding.id, 13)}</span><span>revision {binding.revision} · report <a className="hash-link" href={reviewerLink(binding.reportHash)}>{short(binding.reportHash, 14)}</a>{binding.storage?.extrinsicHash ? <> · stored <ChainLink hash={binding.storage.extrinsicHash} kind="extrinsic"/></> : null}<small className="block">{when(binding.boundAt)} · {binding.boundBy}{binding.note ? ` · ${binding.note}` : ''}{note ? ` · ${note}` : ''}</small></span></li>;
  return <>
    <ol className="binding-list">{current.map((binding) => row(binding))}</ol>
    {historical.length > 0 && <><h3>Under a superseded policy</h3><ol className="binding-list historical">{historical.map((binding) => row(binding, binding.historical?.note || 'superseded policy'))}</ol></>}
  </>;
}

function LiveResult({ live }) {
  const { evaluation, entry, inputs } = live;
  const available = evaluation.enable && entry.match;
  return <div className={`result-card ${available ? 'passed' : 'failed'}`}>
    <div className="result-head"><Badge status={available ? 'passed' : 'failed'}>{available ? 'Available now' : 'Withheld now'}</Badge><Badge status={STATUS_BADGE[evaluation.status]}>{STATUS_WORD[evaluation.status]}</Badge><strong>Evaluated in this browser at {when(evaluation.evaluatedAt)}</strong></div>
    <dl className="kv-list compact">
      <div className="kv"><dt>Reasons</dt><dd><Reasons codes={[...evaluation.reasons.map((reason) => reason.code), ...(entry.match ? [] : entry.mismatches.map((item) => `entry-mismatch:${item.field}`))]}/></dd></div>
      <div className="kv"><dt>Checkpoints</dt><dd>registry #{fmt(inputs.registry?.block?.number)} · listing #{fmt(inputs.listing?.block?.number)} · observation #{fmt(inputs.observation?.finalized?.number)} · {inputs.observation?.runtime || 'runtime not read'}</dd></div>
      <div className="kv"><dt>Next action</dt><dd>{available ? evaluation.nextAction : entry.match ? evaluation.nextAction : 'Do not publish this entry: correct the configuration to the approved values, or check and approve a release that carries the configured values.'}</dd></div>
      <div className="kv"><dt>Evaluation hash</dt><dd className="mono">{short(evaluation.evaluationHash, 24)}<CopyButton value={evaluation.evaluationHash}/></dd></div>
    </dl>
  </div>;
}

export default function CatalogPage() {
  const sub = useSubRoute('#/app/catalog');
  const id = CATALOGS.some((item) => item.id === sub) ? sub : 'testnet-v2';
  const data = useCatalog(id);
  const [live, setLive] = useState(null);
  const [task, run] = useTask();
  useEffect(() => { setLive(null); }, [id]);
  const { catalog, token, evaluation, report, lifecycle, bindings } = data;
  const last = lifecycle?.steps?.at(-1) || null;
  const codes = useMemo(() => token ? token.reasons : [], [token]);
  async function evaluateNow() {
    const result = await run('Reading the registry, the token list, the stored report and the finalized head through both interfaces…', async () => {
      const api = await engine();
      const { hash, ...fields } = catalog.policy;
      const policy = { schema: 'revivecheck.policy.v1', ...fields };
      const binding = bindings.filter((item) => item.policyHash === hash && item.subject === token.address).at(-1);
      if (!binding) throw new Error('This catalog has no binding under its current policy, so there is nothing to evaluate.');
      if (!report) throw new Error('The bound report could not be loaded.');
      const inputs = await api.collectPolicyInputs({ policy, binding });
      const result = api.evaluateBinding({ policy, binding, report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence: inputs.evidence, now: new Date() });
      return { evaluation: result, entry: compareEntry(token.entry.configured, approvedEntry(report).entry), inputs };
    });
    if (result) setLive(result);
  }
  return <>
    <div className="page-head">
      <div><h1>Catalog decision</h1><p>What the pUSD entry may do right now, which fact enabled it, which event changed it and what remains to be done. Three facts are kept apart: the on-chain approval, the recorded execution, and the current policy eligibility. Reads need no wallet.</p></div>
      <div className="filter" role="group" aria-label="Catalog">{CATALOGS.map((item) => <a key={item.id} href={`#/app/catalog/${item.id}`} aria-pressed={id === item.id} className="filter-link">{item.label}</a>)}</div>
    </div>
    <p className="muted catalog-note">{CATALOGS.find((item) => item.id === id).note}</p>
    {data.loading && <div className="skeleton-block"/>}
    {data.missing && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>No published catalog.</strong> Run <code>node examples/token-catalog/catalog.js publish --config …</code> to publish this catalog's records.</div></div>}
    {catalog && token && <>
      <section className={`card decision-card ${token.available ? 'available' : 'withheld'}`} aria-labelledby="decision-title">
        <div className="card-body">
          <p className="hc-label" id="decision-title">Decision · {catalog.name}</p>
          <div className="decision-row">
            <div><p className="decision-verdict">{token.available ? 'Available' : 'Withheld'}</p><p className="decision-sub">{token.symbol} · <span className="mono">{short(token.address, 18)}</span> · {token.decimals} decimals · asset {token.assetId}{catalog.simulation ? ' · SIMULATED' : ''}</p></div>
            <div className="decision-facts"><Badge status={STATUS_BADGE[token.status]}>Policy: {STATUS_WORD[token.status]}</Badge><Badge status={token.entry.match ? 'passed' : 'failed'}>{token.entry.match ? 'Entry equals the approved report' : `Entry differs: ${token.entry.mismatches.map((item) => item.field).join(', ')}`}</Badge></div>
          </div>
          <dl className="kv-list compact">
            <div className="kv"><dt>Why</dt><dd><Reasons codes={codes}/></dd></div>
            <div className="kv"><dt>Next action</dt><dd>{token.nextAction}</dd></div>
            <div className="kv"><dt>Recorded</dt><dd>{token.evaluation ? <>{when(token.evaluation.evaluatedAt)} · evaluation <span className="mono">{short(token.evaluation.evaluationHash, 16)}</span> · {token.evaluation.checks} checks{token.evaluation.failed.length ? `, failed: ${token.evaluation.failed.join(', ')}` : ', all passed'}</> : 'no evaluation recorded'}</dd></div>
          </dl>
          <div className="step-actions"><button type="button" className="btn btn-primary" onClick={evaluateNow} disabled={!!task.busy || !token.binding}>{task.busy ? <LoaderCircle className="spin" size={15} aria-hidden="true"/> : <RefreshCw size={15} aria-hidden="true"/>}Evaluate now</button><span className="muted">The same evaluator the CLI and the Token Catalog use, run in this browser against the current finalized block. Nothing is signed.</span></div>
          {task.busy && <div className="working" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true"/><div><strong>{task.busy}</strong><span>{task.elapsed ? `${task.elapsed} s` : ''}</span></div></div>}
          {task.error && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Nothing was evaluated.</strong> {task.error}</div></div>}
          {live && !task.busy && <LiveResult live={live}/>}
        </div>
      </section>
      <div className="fact-grid">
        <section className="card" aria-labelledby="approval-title">
          <div className="card-head"><h2 id="approval-title">On-chain approval</h2><span className="card-note">ReleaseRegistry</span></div>
          <div className="card-body">
            <dl className="kv-list compact">
              <div className="kv"><dt>Release</dt><dd>{catalog.policy.registry.label || 'by ID'} · <span className="mono">{short(token.binding?.releaseId, 18)}</span></dd></div>
              <div className="kv"><dt>Registry</dt><dd>{last?.registry && !last.registry.error ? <>revision {last.registry.revision} · report <a className="hash-link" href={reviewerLink(String(last.registry.reportHash).replace(/^0x/, ''))}>{short(String(last.registry.reportHash).replace(/^0x/, ''), 14)}</a> · {last.registry.interfacesAgree ? 'both interfaces agree' : 'interfaces disagree'} at #{fmt(last.registry.block?.number)}</> : 'read live with Evaluate now'}</dd></div>
              <div className="kv"><dt>Trusted reviewers</dt><dd>{catalog.policy.reviewers.trusted.map((address) => <span key={address} className="block"><span className="mono">{address}</span>{last?.registry?.decisions?.[address] ? ` · reviewed ${String(last.registry.decisions[address].reviewed)}, approved ${String(last.registry.decisions[address].approved)}` : ''}</span>)}<small className="block">{catalog.policy.reviewers.basis}</small></dd></div>
            </dl>
          </div>
        </section>
        <section className="card" aria-labelledby="listing-title">
          <div className="card-head"><h2 id="listing-title">Listing</h2><span className="card-note">VerifiedTokenList v{catalog.policy.consumer?.version}</span></div>
          <div className="card-body">
            <dl className="kv-list compact">
              <div className="kv"><dt>Consumer</dt><dd className="mono">{catalog.policy.consumer?.address}</dd></div>
              <div className="kv"><dt>isListed</dt><dd>{last?.listing && !last.listing.error ? <>{last.listing.listed ? <Badge status="listed">listed</Badge> : <Badge status="pending">not listed</Badge>} · {last.listing.interfacesAgree ? 'both interfaces agree' : 'interfaces disagree'} at #{fmt(last.listing.block?.number)}{last.listing.entry ? <small className="block">entry: release {short(last.listing.entry.releaseId, 12)} · report {short(last.listing.entry.reportHash, 12)} · reviewer {short(last.listing.entry.reviewer, 12)}</small> : null}</> : 'read live with Evaluate now'}</dd></div>
              <div className="kv"><dt>Rule</dt><dd>The contract lists only from the release owner, only while the named reviewer's approval of the exact report stands; a new revision or a revoked approval un-lists it with no off-chain step.</dd></div>
            </dl>
          </div>
        </section>
        <section className="card" aria-labelledby="eligibility-title">
          <div className="card-head"><h2 id="eligibility-title">Policy eligibility</h2><span className="card-note">{catalog.policy.name}</span></div>
          <div className="card-body">{evaluation ? <Freshness catalog={catalog} evaluation={evaluation} report={report}/> : <p className="muted">No evaluation has been recorded for this catalog yet.</p>}</div>
        </section>
      </div>
      <section className="card" aria-labelledby="entry-title">
        <div className="card-head"><h2 id="entry-title">Published entry</h2><span className="card-note">{token.entry.source}</span></div>
        <div className="card-body">
          <p className="muted">{token.entry.match ? <>Every verified field equals the entry report <a className="hash-link" href={reviewerLink(token.entry.reportHash)}>{short(token.entry.reportHash, 14)}</a> approved; entry identity <span className="mono">{short(token.entry.identity, 16)}</span>.</> : token.entry.reason}</p>
          <div className="table-wrap flat"><EntryTable entry={token.entry}/></div>
        </div>
      </section>
      {evaluation && <section className="card" aria-labelledby="checks-title">
        <div className="card-head"><h2 id="checks-title">Recorded checks</h2><span className="card-note">{evaluation.checks.length} checks at {when(evaluation.evaluatedAt)}</span></div>
        <div className="card-body"><Checks checks={evaluation.checks}/></div>
      </section>}
      <section className="card" aria-labelledby="lifecycle-title">
        <div className="card-head"><h2 id="lifecycle-title">Recorded execution</h2><span className="card-note">each receipt links to the official explorer</span></div>
        <Lifecycle lifecycle={lifecycle}/>
      </section>
      <section className="card" aria-labelledby="bindings-title">
        <div className="card-head"><h2 id="bindings-title">Binding history</h2><span className="card-note">append-only</span></div>
        <div className="card-body"><Bindings catalog={catalog} bindings={bindings}/></div>
      </section>
      <p className="caveat">{catalog.caveat} Roles: owner, {catalog.roles.owner.control}; reviewer, {catalog.roles.reviewer.control}; operator, {catalog.roles.operator.control}. <a className="text-link" href="#/docs/policy">How the policy is evaluated<ArrowUpRight size={13} aria-hidden="true"/></a></p>
    </>}
  </>;
}
