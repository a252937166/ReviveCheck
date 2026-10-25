// Evidence health: when the published catalog's evidence expires, when each read's
// permission lapses, whether the approval and the listing stand on the bound revision,
// whether a successor report is published, which role acts next, and the renewal stages
// with their verified state. Two sources are kept apart: the recorded last lifecycle step
// (published with the catalog) and a live read made in this browser on request. The
// planned gap before the competition freeze is stated here, not discovered. Read-only.
import React, { useEffect, useMemo, useState } from 'react';
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import { Badge, ChainLink } from './site.jsx';
import { short } from './components.jsx';
import { fetchJson, fmt, when, useTask } from './records.js';
import { evidenceHealth, renewalPlan } from '../lib/health.js';
import { policyAssurance } from '../lib/policy.js';

const engine = () => import('./engine.js');
const FREEZE = '2026-11-06T04:00:00.000Z';
const PLANNED = '2026-11-03T12:00:00.000Z';
const span = (value) => !Number.isFinite(value) ? '—' : Math.abs(value) >= 86400 ? `${(value / 86400).toFixed(1)} days` : Math.abs(value) >= 3600 ? `${(value / 3600).toFixed(1)} hours` : `${Math.round(value)} s`;
const STATE_BADGE = { fresh: 'passed', stale: 'failed', unavailable: 'unknown', undated: 'unknown', 'not-required': 'idle', approved: 'approved', 'changes-requested': 'changes-requested', pending: 'pending', missing: 'failed', unknown: 'unknown', 'listed-on-bound-report': 'listed', 'listed-on-another-report': 'failed', 'not-listed': 'pending', done: 'passed' };

function useCatalogHealth() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const [catalog, bindings, lifecycle, index] = await Promise.all(['catalog/testnet-v2/catalog.json', 'catalog/testnet-v2/bindings.json', 'catalog/testnet-v2/lifecycle.json', 'reports/index.json'].map(fetchJson));
      if (!catalog) { if (alive) setState({ loading: false, missing: true }); return; }
      const { hash, ...fields } = catalog.policy;
      const policy = { schema: 'revivecheck.policy.v1', ...fields };
      const binding = (bindings?.bindings || []).filter((item) => item.policyHash === hash).at(-1) ?? null;
      const report = binding ? await fetchJson(`reports/${binding.reportHash}.json`) : null;
      // Candidate successors: every published passed report newer than the bound one is fetched and screened by the health module.
      const candidates = (index?.reports || []).filter((item) => report && Date.parse(item.completedAt) > Date.parse(report.completedAt));
      const reports = (await Promise.all(candidates.map((item) => fetchJson(`reports/${item.evidenceHash}.json`)))).filter(Boolean);
      if (alive) setState({ loading: false, catalog, policy, binding, report, lifecycle, reports: [...reports, ...(report ? [report] : [])] });
    })();
    return () => { alive = false; };
  }, []);
  return state;
}

function Reads({ reads }) {
  return <ul className="health-reads">{Object.values(reads).map((read) => <li key={read.kind}><Badge status={STATE_BADGE[read.state] || 'idle'}>{read.kind}: {read.state}</Badge>{read.lapsesAt && <small> lapses {when(read.lapsesAt)}{Number.isFinite(read.secondsLeft) ? ` (${read.secondsLeft >= 0 ? `${span(read.secondsLeft)} left` : 'passed'})` : ''}</small>}{read.error && <small> {read.error}</small>}</li>)}</ul>;
}

function HealthView({ health, label }) {
  return <dl className="kv-list compact">
    <div className="kv"><dt>Source</dt><dd>{label}</dd></div>
    <div className="kv"><dt>Report</dt><dd><span className="mono">{short(health.report.reportHash, 16)}</span> sealed {when(health.report.completedAt)} · acceptable until <strong>{when(health.report.expiresAt)}</strong> · {health.report.expired ? <Badge status="failed">expired</Badge> : <>{span(health.report.secondsLeft)} left at {when(health.at)}</>}</dd></div>
    <div className="kv"><dt>Reads</dt><dd><Reads reads={health.reads}/></dd></div>
    <div className="kv"><dt>Approval</dt><dd><Badge status={STATE_BADGE[health.approval.state] || 'idle'}>{health.approval.state}</Badge> {health.approval.detail}</dd></div>
    <div className="kv"><dt>Binding</dt><dd>revision {health.bound.revision} · report <span className="mono">{short(health.bound.reportHash, 14)}</span> · {health.bound.onCurrentRevision === null ? 'registry not read' : health.bound.onCurrentRevision ? 'current in the registry' : 'superseded in the registry'}</dd></div>
    <div className="kv"><dt>Listing</dt><dd><Badge status={STATE_BADGE[health.listed.state] || 'idle'}>{health.listed.state}</Badge></dd></div>
    <div className="kv"><dt>Successor</dt><dd>{health.successors.length ? <>{health.successors.map((item) => <span key={item.reportHash} className="block"><span className="mono">{short(item.reportHash, 14)}</span> sealed {when(item.completedAt)}, acceptable until {when(item.expiresAt)}</span>)}</> : 'no successor report published yet'} · next revision {health.nextRevision ?? 'unknown until the registry is read'}</dd></div>
    <div className="kv"><dt>Next</dt><dd><strong>{health.nextRole.role}</strong>: {health.nextRole.action}</dd></div>
    {health.warnings.length > 0 && <div className="kv"><dt>Warnings</dt><dd><ul className="reason-list">{health.warnings.map((item) => <li key={item.code}><code>{item.code}</code> · {item.text}</li>)}</ul></dd></div>}
  </dl>;
}

function Plan({ plan }) {
  return <>
    {plan.stop && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Stop.</strong> {plan.stop.reason}</div></div>}
    <div className="table-wrap flat"><table className="data-table renewal-table"><thead><tr><th scope="col">Stage</th><th scope="col">Role</th><th scope="col">State</th><th scope="col">Verified by, or the dry-run command</th></tr></thead><tbody>{plan.stages.map((stage) => <tr key={stage.stage} className={plan.next?.stage === stage.stage ? 'next' : ''}><th scope="row"><code>{stage.stage}</code>{plan.next?.stage === stage.stage ? <small className="block">next</small> : null}</th><td>{stage.role}</td><td><Badge status={STATE_BADGE[stage.status] || 'pending'}>{stage.status}</Badge></td><td>{stage.status === 'done' ? <span className="mono">{JSON.stringify(stage.verified)}</span> : <><small className="block">{stage.verified.reason}</small><code className="block">{stage.command}</code></>}</td></tr>)}</tbody></table></div>
    <p className="muted">Guards: {plan.guards.join('; ')}. Preserved: {plan.preserves.join('; ')}.</p>
  </>;
}

export default function HealthPage() {
  const data = useCatalogHealth();
  const { catalog, policy, binding, report, lifecycle, reports } = data;
  const [now, setNow] = useState(() => new Date());
  const [live, setLive] = useState(null);
  const [task, run] = useTask();
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(timer); }, []);
  const last = lifecycle?.steps?.at(-1) ?? null;
  const recorded = useMemo(() => {
    if (!policy || !binding || !report || !last) return null;
    const registry = last.registry?.error ? { error: last.registry.error } : { ...last.registry, address: policy.registry.address, releaseId: binding.releaseId, release: { exists: last.registry.exists, revision: last.registry.revision, reportHash: last.registry.reportHash, owner: policy.registry.owner }, observedAt: last.at };
    const listing = last.listing?.error ? { error: last.listing.error } : { ...last.listing, observedAt: last.at };
    const observation = last.observation?.error ? { error: last.observation.error } : { ...last.observation };
    try { return evidenceHealth({ policy, binding, report, registry, listing, observation, reports, now, freezeAt: FREEZE, plannedRenewalAt: PLANNED }); } catch (error) { return { error: error.message }; }
  }, [policy, binding, report, last, reports, now]);
  async function readNow() {
    const result = await run('Reading the registry, the consumer and the finalized head through both interfaces…', async () => {
      const api = await engine();
      const inputs = await api.collectPolicyInputs({ policy, binding });
      const at = new Date();
      const health = evidenceHealth({ policy, binding, report, registry: inputs.registry, listing: inputs.listing, observation: inputs.observation, reports, now: at, freezeAt: FREEZE, plannedRenewalAt: PLANNED });
      const successor = health.successors[0] ? reports.find((item) => item.evidenceHash === health.successors[0].reportHash) : null;
      const plan = renewalPlan({ policy, binding, report, successor, registry: inputs.registry, listing: inputs.listing, bindings: [], now: at, releaseLabel: policy.registry.label ?? null });
      return { health, plan, at };
    });
    if (result) setLive(result);
  }
  const assurance = policy ? policyAssurance(policy) : null;
  return <>
    <div className="page-head"><div><h1>Evidence health</h1><p>When the published catalog's evidence stops being acceptable, which reads have lapsed, whether the approval and the listing still stand on the bound revision, whether a successor report exists, and who acts next. Renewal is prepared read-only: each stage is done only when a chain read or an intact artifact shows it, the next revision comes from the registry, and a pending send stops the plan.</p></div></div>
    {data.loading && <div className="skeleton-block"/>}
    {data.missing && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>No published catalog.</strong> Run <code>node examples/token-catalog/catalog.js publish --config …</code>.</div></div>}
    {catalog && binding && report && <>
      <section className="card" aria-labelledby="gap-title">
        <div className="card-head"><h2 id="gap-title">The planned gap, stated</h2><span className="card-note">policy lifetime against the review period</span></div>
        <div className="card-body">
          <p>The bound report <span className="mono">{short(binding.reportHash, 14)}</span> is acceptable under this policy until <strong>{when(recorded?.report?.expiresAt ?? '')}</strong>. The competition freeze is {when(FREEZE)}. Renewal is planned for {when(PLANNED)} (the runbook's November 3 or 4 window, so that the renewed evidence covers the freeze); between the expiry and the moment the successor report is approved, bound and listed, every evaluation returns <code>expired</code> and the entry is withheld. That denial period is expected, stated here, and will be recorded like the 2026-10-25 steps.</p>
          {assurance && <p className="muted"><strong>Subject assurance of this policy:</strong> {assurance.text}</p>}
        </div>
      </section>
      <section className="card" aria-labelledby="recorded-title">
        <div className="card-head"><h2 id="recorded-title">From the recorded last step</h2><span className="card-note">{last ? `step ${last.index} · ${last.step} · ${when(last.at)}` : 'no recorded step'}</span></div>
        <div className="card-body">{recorded?.error ? <p className="form-error">{recorded.error}</p> : recorded ? <HealthView health={recorded} label={`the published lifecycle record, read at #${fmt(last.registry?.block?.number)}; the clock is now`}/> : <p className="muted">No recorded step.</p>}</div>
      </section>
      <section className="card" aria-labelledby="live-title">
        <div className="card-head"><h2 id="live-title">Read now</h2><span className="card-note">fresh reads in this browser · nothing signed</span></div>
        <div className="card-body">
          <div className="step-actions"><button type="button" className="btn btn-primary" onClick={readNow} disabled={!!task.busy}>{task.busy ? <LoaderCircle className="spin" size={15} aria-hidden="true"/> : <RefreshCw size={15} aria-hidden="true"/>}{live ? 'Read again' : 'Read the chain now'}</button><span className="muted">The registry for every trusted reviewer, the consumer listing, the finalized head and the stored report, through both interfaces.</span></div>
          {task.busy && <div className="working" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true"/><div><strong>{task.busy}</strong><span>{task.elapsed ? `${task.elapsed} s` : ''}</span></div></div>}
          {task.error && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Nothing was read.</strong> {task.error}</div></div>}
          {live && !task.busy && <>
            <HealthView health={live.health} label={`live reads at ${when(live.at)}`}/>
            <h3>Renewal stages, from the live state</h3>
            <Plan plan={live.plan}/>
          </>}
        </div>
      </section>
      {last && <section className="card" aria-labelledby="checkpoint-title"><div className="card-head"><h2 id="checkpoint-title">Where the record stands</h2></div><div className="card-body"><p className="muted">Recorded step {last.index} ({last.step}) read the registry at <ChainLink hash={last.registry?.block?.nativeHash}>#{fmt(last.registry?.block?.number)}</ChainLink> and found revision {last.registry?.revision} · policy evaluation {last.status} · entry {last.available ? 'available' : 'withheld'}. The full runbook with the guarded commands is <code>docs/RENEWAL.md</code>; <code>node scripts/renewal-prepare.js</code> writes the same health and plan from a terminal, with the pending-send check on both signing accounts.</p></div></section>}
    </>}
  </>;
}
