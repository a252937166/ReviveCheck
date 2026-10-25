// The maintainer's decision screen: what the catalog entry may do right now, which
// fact enabled it, which event changed it, and what remains to be done. Three facts
// stay apart on this page: the on-chain approval (the registry's decision), the
// historical execution (finalized receipts, each linked to its block) and the current
// policy eligibility (an evaluation at a checkpoint and time). The headline is the
// CURRENT state only: not checked, checking, valid, recheck required, expired or
// unknown. Beginning a refresh withdraws any permission until a fresh acceptable
// result exists; a failed, timed-out or orphaned refresh is unknown; a result lapses at
// the deadline its own evidence sets (the report's age limit, or the freshness limit of
// the earliest read), checked against the clock whenever it is shown, not only when a
// timer ran. The last verified result and the recorded snapshot are shown as history
// with their own checkpoint and time. "Evaluate now" runs the same evaluator the CLI
// and the Token Catalog use, in this browser. No wallet.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Badge, ChainLink, CopyButton, useSubRoute } from './site.jsx';
import { short } from './components.jsx';
import { fetchJson, reviewerLink, fmt, when } from './records.js';
import { ENTRY_FIELDS, entryDecision } from '../lib/entry.js';
import { initialDecision, beginCheck, settleCheck, failCheck, changeSelection, ageDecision, checkPermission, describeDecision, CURRENT_WORDS, VALIDITY_LIMITS } from '../lib/current.js';
import { explainReason, evidenceExpiry, RENEWAL_STEPS } from '../lib/decision.js';
import { policyAssurance } from '../lib/policy.js';

const engine = () => import('./engine.js');
const CATALOGS = [
  { id: 'testnet-v2', label: 'v2 · current', note: 'Consumer v2 with a separate reviewer account; every live step recorded on 2026-10-25 with its receipt.' },
  { id: 'testnet-v2-wrong-entry', label: 'Wrong entry · demonstration', note: 'The same policy and bindings under a configuration that claims 18 decimals: a valid approval never publishes an entry the report did not approve.' },
  { id: 'testnet', label: 'v1 · historical', note: 'Consumer v1 and the recorded 2026-10-23 listing, preserved as history; the application refuses new writes to it.' },
];
const STATUS_BADGE = { valid: 'passed', 'recheck-required': 'failed', expired: 'failed', unknown: 'unknown', unbound: 'idle', 'not-checked': 'idle', checking: 'pending' };
const STATUS_WORD = { ...CURRENT_WORDS, unbound: 'Unbound' };
const GROUPS = [['Evidence, target, plan and runtime', /^(evidence|target|plan|report|runtime|observation)\./], ['On-chain approval · ReleaseRegistry', /^registry\./], ['Listing · VerifiedTokenList', /^consumer\./], ['Stored report · remark.store', /^storage\./]];
const RECEIPT_WORD = { store: 'Report stored', submit: 'Submitted', review: 'Reviewed', list: 'Listed', transfer: 'Funded' };
const TIMEOUT_MS = 90_000;
const span = (value) => !Number.isFinite(value) ? '—' : Math.abs(value) >= 86400 ? `${(value / 86400).toFixed(1)} days` : Math.abs(value) >= 3600 ? `${(value / 3600).toFixed(1)} hours` : `${Math.round(value)} s`;
const RENEWAL_DOC = 'https://github.com/a252937166/ReviveCheck/blob/main/docs/RENEWAL.md';
const LIMIT_WORDS = { report: "the report's age limit", observation: 'the network read', registry: 'the registry read', listing: 'the listing read' };

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

/** Every reason with its documented meaning, who can act and what happens next. */
function Reasons({ codes, observed = {} }) {
  if (!codes.length) return <span>Every policy condition held and the published entry equals the approved report.</span>;
  return <ul className="reason-list">{codes.map((code) => { const reason = explainReason(code, { observed: observed[code] ?? null }); return <li key={code}><code>{code}</code> · {reason.text}{reason.observed ? <> <em className="observed">Observed: {reason.observed}.</em></> : null}<small className="block recovery"><strong>Who acts:</strong> {reason.who}. <strong>Then:</strong> {reason.then}</small></li>; })}</ul>;
}

/** Two separate limits: how long the approved report stays acceptable, and how recently the network state was read. */
function Freshness({ catalog, evaluation, report, now }) {
  const policy = { schema: 'revivecheck.policy.v1', ...Object.fromEntries(Object.entries(catalog.policy).filter(([key]) => key !== 'hash')) };
  const maxAge = catalog.policy.evidence.maxAgeSeconds, maxObservation = catalog.policy.evidence.maxObservationAgeSeconds;
  let expiry = null;
  try { expiry = report ? evidenceExpiry(report, policy, now) : null; } catch { expiry = null; }
  const evaluatedAt = evaluation ? Date.parse(evaluation.evaluatedAt) : NaN;
  const ageAtEvaluation = report && evaluation ? (evaluatedAt - Date.parse(report.completedAt)) / 1000 : NaN;
  const ageNow = report ? (now.getTime() - Date.parse(report.completedAt)) / 1000 : NaN;
  const used = Number.isFinite(ageNow) ? Math.min(100, Math.max(0, (ageNow / maxAge) * 100)) : 0;
  const observation = evaluation?.checks.find((check) => check.id === 'observation.fresh');
  return <dl className="kv-list compact">
    <div className="kv"><dt>Evidence age</dt><dd>{report ? <>{span(ageNow)} of the {span(maxAge)} the policy allows, since the report sealed at {when(report.completedAt)}. {expiry?.expiresAt ? <>{expiry.expired ? <strong>Expired at {when(expiry.expiresAt)}.</strong> : <>Acceptable until <strong>{when(expiry.expiresAt)}</strong> ({span(expiry.secondsLeft)} left).</>}</> : null}<div className="age-track" aria-hidden="true"><div className={`age-fill ${used >= 100 ? 'spent' : used >= 75 ? 'late' : ''}`} style={{ width: `${used}%` }}/></div><small className="block">A fresh registry read does not renew the report's age; only a new check, a new approval of its exact hash and an explicit binding do.</small></> : 'no bound report'}</dd></div>
    <div className="kv"><dt>Observation</dt><dd>{evaluation ? <>{observation ? `${observation.observed} at the recorded evaluation` : 'no fresh network observation was available at the recorded evaluation'}; the policy accepts a read at most {maxObservation} s old. Checkpoints: registry #{fmt(evaluation.checkpoint.registry?.number)}, listing #{fmt(evaluation.checkpoint.listing?.number)}, observation #{fmt(evaluation.checkpoint.observation?.number)}.</> : 'no evaluation recorded'}{Number.isFinite(ageAtEvaluation) && <small className="block">At the recorded evaluation ({when(evaluation.evaluatedAt)}) the report was {span(ageAtEvaluation)} old.</small>}</dd></div>
    <div className="kv"><dt>Subject metadata</dt><dd>{(() => { try { const assurance = policyAssurance(policy); return <><Badge status={assurance.subject === 'fresh-read' ? 'passed' : 'idle'}>{assurance.subject === 'fresh-read' ? 'read again on every evaluation' : 'from the approved report'}</Badge> {assurance.text}</>; } catch { return 'unknown'; } })()}</dd></div>
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

/** When the fresh result stops permitting anything, limit by limit; derived from its own evidence, never from the evaluation time. */
function Validity({ validity, now }) {
  if (!validity) return 'unknown';
  const left = validity.validUntil ? Math.floor((Date.parse(validity.validUntil) - now.getTime()) / 1000) : null;
  return <>
    {validity.validUntil ? <>{when(validity.validUntil)} · {LIMIT_WORDS[validity.limitedBy]} · {left > 0 ? `${span(left)} left` : 'passed'}</> : <strong>no deadline can be derived (missing: {validity.missing.join(', ')}); nothing is permitted</strong>}
    <small className="block">{VALIDITY_LIMITS.map((kind) => validity.deadlines[kind] ? `${kind}: ${validity.deadlines[kind].until ? when(validity.deadlines[kind].until) : 'undated'}` : `${kind}: not required`).join(' · ')}. A change on the chain since these reads is seen by a new check only.</small>
  </>;
}

/** The fresh result in this browser: the authoritative current state. */
function CurrentResult({ decision, now }) {
  const { current } = decision;
  const { evaluation, entry, inputs } = current;
  const observed = Object.fromEntries(evaluation.checks.filter((check) => check.status !== 'passed').flatMap((check) => evaluation.reasons.filter((reason) => check.id.startsWith(reason.code.split('-')[0])).map((reason) => [reason.code, check.observed])));
  const codes = [...evaluation.reasons.map((reason) => reason.code), ...entry.reasons];
  return <dl className="kv-list compact current-result">
    <div className="kv"><dt>Reasons</dt><dd><Reasons codes={codes} observed={observed}/></dd></div>
    <div className="kv"><dt>Checkpoints</dt><dd>registry #{fmt(inputs?.registry?.block?.number)} · listing #{fmt(inputs?.listing?.block?.number)} · observation #{fmt(inputs?.observation?.finalized?.number)} · {inputs?.observation?.runtime || 'runtime not read'} · evaluated at {when(evaluation.evaluatedAt)}</dd></div>
    <div className="kv"><dt>Permission ends</dt><dd><Validity validity={current.validity} now={now}/></dd></div>
    <div className="kv"><dt>Next action</dt><dd>{current.available ? evaluation.nextAction : entry.match ? evaluation.nextAction : 'Do not publish this entry: correct the configuration to the approved values, or check and approve a release that carries the configured values.'}</dd></div>
    <div className="kv"><dt>Evaluation hash</dt><dd className="mono">{short(evaluation.evaluationHash, 24)}<CopyButton value={evaluation.evaluationHash}/></dd></div>
  </dl>;
}

export default function CatalogPage() {
  const sub = useSubRoute('#/app/catalog');
  const id = CATALOGS.some((item) => item.id === sub) ? sub : 'testnet-v2';
  const data = useCatalog(id);
  const { catalog, token, evaluation, report, lifecycle, bindings } = data;
  const [decision, setDecision] = useState(() => initialDecision({ selection: { catalog: id } }));
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { setDecision((current) => changeSelection(current, { catalog: id })); }, [id]);
  // The permission lapses at its own deadline and is re-read when the tab comes back; nothing revives it but a new check.
  useEffect(() => {
    const tick = () => { const at = new Date(); setNow(at); setDecision((current) => ageDecision(current, { now: at })); };
    const timer = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  // A precise timer at the deadline itself, so the screen changes at that instant and not at the next tick. The words and the tone check the clock on every render regardless.
  const lapsesAt = decision.current?.validity?.lapsesAt ?? null;
  useEffect(() => {
    const until = Date.parse(lapsesAt);
    if (!Number.isFinite(until)) return undefined;
    const timer = setTimeout(() => { const at = new Date(); setNow(at); setDecision((current) => ageDecision(current, { now: at })); }, Math.min(Math.max(0, until - Date.now() + 1), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [lapsesAt]);
  useEffect(() => {
    if (decision.state !== 'checking') { setElapsed(0); return undefined; }
    const started = Date.parse(decision.startedAt);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [decision.state, decision.startedAt]);
  const last = lifecycle?.steps?.at(-1) || null;
  const codes = useMemo(() => token ? token.reasons : [], [token]);

  async function evaluateNow() {
    const selection = { catalog: id };
    const begun = beginCheck(decisionRef.current, { selection });
    setDecision(begun);
    const request = begun.request;
    const settle = (fields) => setDecision((current) => settleCheck(current, { request, selection, ...fields }));
    const fail = (error, kind) => setDecision((current) => failCheck(current, { request, selection, error, kind }));
    try {
      const { hash, ...fields } = catalog.policy;
      const policy = { schema: 'revivecheck.policy.v1', ...fields };
      const binding = bindings.filter((item) => item.policyHash === hash && item.subject === token.address).at(-1);
      if (!binding) throw new Error('This catalog has no binding under its current policy, so there is nothing to evaluate.');
      if (!report) throw new Error('The bound report could not be loaded.');
      const work = (async () => {
        const api = await engine();
        const inputs = await api.collectPolicyInputs({ policy, binding });
        const result = api.evaluateBinding({ policy, binding, report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence: inputs.evidence, subject: inputs.subject ?? null, now: new Date() });
        return { evaluation: result, entry: entryDecision(token.entry.configured, report), inputs, policy, report };
      })();
      const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`No answer within ${TIMEOUT_MS / 1000} s. The public nodes can be slow; read again.`), { kind: 'timeout' })), TIMEOUT_MS));
      const result = await Promise.race([work, timeout]);
      settle(result);
    } catch (error) { fail(error, error?.kind === 'timeout' ? 'timeout' : 'error'); }
  }

  const permission = checkPermission(decision, { now });
  const described = describeDecision(decision, { subject: 'the published entry', now });
  const tone = decision.state === 'checking' ? 'checking' : permission.allowed ? 'available' : decision.state === 'not-checked' ? 'idle' : 'withheld';
  const buttonWord = decision.state === 'checking' ? 'Evaluating…' : decision.error ? 'Retry the evaluation' : decision.current ? 'Refresh status' : 'Evaluate now';
  return <>
    <div className="page-head">
      <div><h1>Catalog decision</h1><p>What the pUSD entry may do right now, which fact enabled it, which event changed it and what remains to be done. Three facts are kept apart: the on-chain approval, the recorded execution, and the current policy eligibility. Reads need no wallet.</p></div>
      <div className="filter" role="group" aria-label="Catalog">{CATALOGS.map((item) => <a key={item.id} href={`#/app/catalog/${item.id}`} aria-pressed={id === item.id} className="filter-link">{item.label}</a>)}</div>
    </div>
    <p className="muted catalog-note">{CATALOGS.find((item) => item.id === id).note}</p>
    {data.loading && <div className="skeleton-block"/>}
    {data.missing && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>No published catalog.</strong> Run <code>node examples/token-catalog/catalog.js publish --config …</code> to publish this catalog's records.</div></div>}
    {catalog && token && <>
      <section className={`card decision-card ${tone}`} aria-labelledby="decision-title" aria-live="polite">
        <div className="card-body">
          <p className="hc-label" id="decision-title">Current decision · {catalog.name}</p>
          <div className="decision-row">
            <div><p className="decision-verdict">{described.headline}</p><p className="decision-sub">{token.symbol} · <span className="mono">{short(token.address, 18)}</span> · {token.decimals} decimals · asset {token.assetId}{catalog.simulation ? ' · SIMULATED' : ''}</p></div>
            <div className="decision-facts"><Badge status={STATUS_BADGE[decision.state] || 'idle'}>Current: {described.word}</Badge>{decision.current && <Badge status={decision.current.entry.match ? 'passed' : 'failed'}>{decision.current.entry.match ? 'Entry equals the approved report' : `Entry differs: ${decision.current.entry.mismatches.map((item) => item.field).join(', ')}`}</Badge>}</div>
          </div>
          <p className="decision-detail">{described.detail}</p>
          {permission.allowed && <p className="decision-deadline"><strong>Permission ends {when(permission.validUntil)}</strong> ({LIMIT_WORDS[permission.limitedBy]}; {span(permission.secondsLeft)} left at {when(now)}). Checked against the clock every time this page is drawn, and again before any action.</p>}
          {decision.current && permission.reason !== 'lapsed' && <CurrentResult decision={decision} now={now}/>}
          {decision.current && permission.reason === 'lapsed' && <p className="muted">The lapsed answer was <strong>{STATUS_WORD[decision.current.status]}</strong>, evaluated at {when(decision.current.evaluatedAt)} · evaluation <span className="mono">{short(decision.current.evaluation.evaluationHash, 16)}</span> · its permission ended at {when(decision.current.validity.validUntil ?? decision.current.validity.lapsesAt)}. It stays visible as what it was; it permits nothing now.</p>}
          <div className="step-actions"><button type="button" className="btn btn-primary" onClick={evaluateNow} disabled={decision.state === 'checking' || !token.binding}>{decision.state === 'checking' ? <LoaderCircle className="spin" size={15} aria-hidden="true"/> : <RefreshCw size={15} aria-hidden="true"/>}{buttonWord}</button><span className="muted">The same evaluator the CLI and the Token Catalog use, run in this browser against the current finalized block. Nothing is signed; the result holds at its checkpoints and time only.</span></div>
          {decision.state === 'checking' && <div className="working" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true"/><div><strong>Reading the registry, the token list, the stored report and the finalized head through both interfaces…</strong><span>{elapsed ? `${elapsed} s` : ''}{elapsed > 8 ? ' · the public node can take up to a minute to hand out metadata on first contact' : ''}{elapsed > 60 ? ` · gives up at ${TIMEOUT_MS / 1000} s` : ''}</span></div></div>}
          {decision.error && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Nothing was evaluated.</strong> {decision.error.message}</div></div>}
          <div className="history-grid">
            <div className="history-block"><h3>Last verified in this browser</h3>{decision.lastVerified ? <p>{when(decision.lastVerified.evaluatedAt)} · registry #{fmt(decision.lastVerified.checkpoint?.registry?.number)} · listing #{fmt(decision.lastVerified.checkpoint?.listing?.number)} · evaluation <span className="mono">{short(decision.lastVerified.evaluationHash, 16)}</span> · permitted until {when(decision.lastVerified.validUntil)}<small className="block">History: a past valid result is not a current permission.</small></p> : <p className="muted">No valid result has been verified in this browser yet.</p>}</div>
            <div className="history-block"><h3>Recorded snapshot</h3>{token.evaluation ? <p><Badge status={token.available ? 'passed' : 'failed'}>{token.available ? 'available' : 'withheld'}</Badge> <Badge status={STATUS_BADGE[token.status]}>{STATUS_WORD[token.status]}</Badge> {when(token.evaluation.evaluatedAt)} · evaluation <span className="mono">{short(token.evaluation.evaluationHash, 16)}</span> · {token.evaluation.checks} checks{token.evaluation.failed.length ? `, failed: ${token.evaluation.failed.join(', ')}` : ', all passed'}<small className="block">Published with the catalog records at that checkpoint and time; it is evidence of what held then, not a permission now.</small>{codes.length > 0 && <small className="block">Recorded reasons: {codes.join(', ')}.</small>}</p> : <p className="muted">No evaluation is recorded for this catalog.</p>}</div>
          </div>
        </div>
      </section>
      <div className="fact-grid">
        <section className="card" aria-labelledby="approval-title">
          <div className="card-head"><h2 id="approval-title">On-chain approval</h2><span className="card-note">ReleaseRegistry</span></div>
          <div className="card-body">
            <dl className="kv-list compact">
              <div className="kv"><dt>Release</dt><dd>{catalog.policy.registry.label || 'by ID'} · <span className="mono">{short(token.binding?.releaseId, 18)}</span></dd></div>
              <div className="kv"><dt>Registry</dt><dd>{last?.registry && !last.registry.error ? <>revision {last.registry.revision} · report <a className="hash-link" href={reviewerLink(String(last.registry.reportHash).replace(/^0x/, ''))}>{short(String(last.registry.reportHash).replace(/^0x/, ''), 14)}</a> · {last.registry.interfacesAgree ? 'both interfaces agree' : 'interfaces disagree'} at #{fmt(last.registry.block?.number)} (recorded)</> : 'read live with Evaluate now'}</dd></div>
              <div className="kv"><dt>Trusted reviewers</dt><dd>{catalog.policy.reviewers.trusted.map((address) => <span key={address} className="block"><span className="mono">{address}</span>{last?.registry?.decisions?.[address] ? ` · reviewed ${String(last.registry.decisions[address].reviewed)}, approved ${String(last.registry.decisions[address].approved)} (recorded)` : ''}</span>)}<small className="block">{catalog.policy.reviewers.basis}</small></dd></div>
            </dl>
          </div>
        </section>
        <section className="card" aria-labelledby="listing-title">
          <div className="card-head"><h2 id="listing-title">Listing</h2><span className="card-note">VerifiedTokenList v{catalog.policy.consumer?.version}</span></div>
          <div className="card-body">
            <dl className="kv-list compact">
              <div className="kv"><dt>Consumer</dt><dd className="mono">{catalog.policy.consumer?.address}</dd></div>
              <div className="kv"><dt>isListed</dt><dd>{last?.listing && !last.listing.error ? <>{last.listing.listed ? <Badge status="listed">listed</Badge> : <Badge status="pending">not listed</Badge>} · {last.listing.interfacesAgree ? 'both interfaces agree' : 'interfaces disagree'} at #{fmt(last.listing.block?.number)} (recorded){last.listing.entry ? <small className="block">entry: release {short(last.listing.entry.releaseId, 12)} · report {short(last.listing.entry.reportHash, 12)} · reviewer {short(last.listing.entry.reviewer, 12)}</small> : null}</> : 'read live with Evaluate now'}</dd></div>
              <div className="kv"><dt>Rule</dt><dd>The contract lists only from the release owner, only while the named reviewer's approval of the exact report stands; a new revision or a revoked approval un-lists it with no off-chain step.</dd></div>
            </dl>
          </div>
        </section>
        <section className="card" aria-labelledby="eligibility-title">
          <div className="card-head"><h2 id="eligibility-title">Evidence age and observation freshness</h2><span className="card-note">{catalog.policy.name}</span></div>
          <div className="card-body"><Freshness catalog={catalog} evaluation={evaluation} report={report} now={now}/></div>
        </section>
      </div>
      <section className="card" aria-labelledby="entry-title">
        <div className="card-head"><h2 id="entry-title">Published entry</h2><span className="card-note">{token.entry.source}</span></div>
        <div className="card-body">
          <p className="muted">{token.entry.match ? <>Every verified field equals the entry report <a className="hash-link" href={reviewerLink(token.entry.reportHash)}>{short(token.entry.reportHash, 14)}</a> approved; entry identity <span className="mono">{short(token.entry.identity, 16)}</span>.</> : token.entry.reason}</p>
          <div className="table-wrap flat"><EntryTable entry={token.entry}/></div>
        </div>
      </section>
      <section className="card" aria-labelledby="renewal-title">
        <div className="card-head"><h2 id="renewal-title">Renewal checklist</h2><span className="card-note">before the evidence expires</span></div>
        <div className="card-body">
          <p className="muted">Refreshing the registry does not renew the report's age, and a new report never inherits an old approval. Each step is performed by its own role; nothing moves on its own.</p>
          <div className="table-wrap flat"><table className="data-table renewal-table"><thead><tr><th scope="col">Step</th><th scope="col">Role</th><th scope="col">What happens</th></tr></thead><tbody>{RENEWAL_STEPS.map((step) => <tr key={step.step}><th scope="row"><code>{step.step}</code></th><td>{step.role}</td><td>{step.action}</td></tr>)}</tbody></table></div>
          <p className="muted">The exact commands and guards are in the repository: <a className="text-link" href={RENEWAL_DOC} target="_blank" rel="noreferrer">docs/RENEWAL.md<ArrowUpRight size={13} aria-hidden="true"/></a></p>
        </div>
      </section>
      {evaluation && <section className="card" aria-labelledby="checks-title">
        <div className="card-head"><h2 id="checks-title">Recorded checks</h2><span className="card-note">{evaluation.checks.length} checks at {when(evaluation.evaluatedAt)} · recorded snapshot</span></div>
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
