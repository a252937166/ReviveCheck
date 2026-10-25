// Check my token: a visitor's own native-asset release checked against the V3 testnet
// through the same checker the studio, the CLI and the MCP server use. The form carries
// the supported input only; the effective acceptance plan is shown with the two
// fingerprints a policy or a release relies on, and it survives export and import
// unchanged. A changed input is a different plan: the check seals a new report with its
// own hash, and using that report in a bound release needs its own approval and an
// explicit binding. The limits are stated beside the form, not discovered afterwards.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, Download, LoaderCircle, Upload } from 'lucide-react';
import { ownPlanDefaults, ownPlanFromForm, describeOwnPlan, exportOwnPlan, importOwnPlan, derivedAddress, derivedContractId, OWN_PLAN_LIMITS } from './own-plan.js';
import { ReportResult } from './Try.jsx';
import { CopyButton } from './site.jsx';
import { short } from './components.jsx';
import { downloadJson } from '../lib/share.js';
import { NETWORKS } from '../lib/networks.js';
import { adoptReport } from './studio-store.js';

const engine = () => import('./engine.js');
const TESTNET = NETWORKS.testnet;
const EXAMPLE = { projectName: 'pUSD token list', logicalContractId: 'token-list:portaldot-v3:pusd', release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', assetId: '7777', holder: '', symbol: 'pUSD', tokenName: 'Portaldot USD (test)', decimals: '6' };

/**
 * "Use this report in my project": the browser-local project this plan belongs to is
 * created (or selected when it already exists for the same name and plan), the report
 * becomes the active report of that project's own studio session, and the visitor lands
 * where the report leads: the studio (replay, store, submit) or the project page (policy,
 * binding candidate, export). Nothing of another project or an earlier report carries over.
 */
function useInProject(plan, report, destination) {
  const { project } = adoptReport({ plan, report });
  location.hash = destination === 'project' ? `#/app/projects/${encodeURIComponent(project.id)}` : report.status === 'passed' ? '#/app/run/replay' : '#/app/run/recheck';
}

export default function CheckTokenPage() {
  const [form, setForm] = useState(ownPlanDefaults);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [task, setTask] = useState({});
  const [result, setResult] = useState(null); // { plan, described, report }
  const timer = useRef();
  const fileInput = useRef();
  useEffect(() => () => clearInterval(timer.current), []);
  const effective = useMemo(() => { try { const plan = ownPlanFromForm(form); return { plan, described: describeOwnPlan(plan), error: '' }; } catch (error) { return { plan: null, described: null, error: error.message }; } }, [form]);
  const address = derivedAddress(form.assetId);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const touched = Object.keys(ownPlanDefaults).some((key) => form[key] !== ownPlanDefaults[key]);

  function applyImport(text) {
    try { const imported = importOwnPlan(text); setForm(imported.form); setImportError(''); setImportText(''); }
    catch (error) { setImportError(error.message); }
  }
  async function readFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { applyImport(await file.text()); } catch (error) { setImportError(error.message); }
    event.target.value = '';
  }
  async function runCheck() {
    if (!effective.plan) return;
    const started = Date.now();
    setTask({ busy: true, elapsed: 0 });
    clearInterval(timer.current);
    timer.current = setInterval(() => setTask((current) => current.busy ? { ...current, elapsed: Math.round((Date.now() - started) / 1000) } : current), 1000);
    try {
      const api = await engine();
      const report = await api.checkRelease(effective.plan, { projectId: effective.plan.logicalContractId.replace(/[^a-z0-9._-]+/gi, '-'), projectName: effective.plan.name });
      setResult({ plan: effective.plan, described: effective.described, report });
      setTask({});
    } catch (error) { setTask({ error: error?.message || String(error) }); }
    finally { clearInterval(timer.current); }
  }
  const stale = result && effective.described && result.described.releaseArtifactHash !== effective.described.releaseArtifactHash || (result && effective.described && result.described.planHash !== effective.described.planHash);

  return <>
    <div className="page-head">
      <div><h1>Check my token</h1><p>Bring your own native-asset release: the entry a token list would publish for an asset on the V3 testnet. The same checker the studio, the CLI and the MCP server run reads native Assets storage and the ERC-20 precompile at one finalized block and seals a report. Read-only: no wallet, no gas, nothing stored.</p></div>
      <div className="step-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setForm(EXAMPLE); setResult(null); }}>Fill with the pUSD example</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm(ownPlanDefaults); setResult(null); setImportError(''); }} disabled={!touched}>Clear</button></div>
    </div>
    <div className="own-grid">
      <section className="card" aria-labelledby="own-form-title">
        <div className="card-head"><h2 id="own-form-title">1 · Your release</h2><span className="card-note">native-asset profile · {TESTNET.name}</span></div>
        <div className="card-body own-form">
          <form onSubmit={(event) => { event.preventDefault(); runCheck(); }}>
            <div className="field-row two">
              <label>Project name<input value={form.projectName} maxLength={120} onChange={set('projectName')} placeholder="My token list" required/></label>
              <label>Release label<input value={form.release} maxLength={64} onChange={set('release')} placeholder="v1.0.0" required/></label>
            </div>
            <div className="field-row two">
              <label>Native asset ID<input value={form.assetId} inputMode="numeric" onChange={set('assetId')} placeholder="7777" required/></label>
              <label>Decimals the release claims<input value={form.decimals} inputMode="numeric" maxLength={3} onChange={set('decimals')} placeholder="6" required/></label>
            </div>
            <div className="field-row two">
              <label>Symbol<input value={form.symbol} maxLength={64} onChange={set('symbol')} placeholder="pUSD" required/></label>
              <label>Token name<input value={form.tokenName} maxLength={64} onChange={set('tokenName')} placeholder="Portaldot USD (test)" required/></label>
            </div>
            <details className="own-more"><summary>Optional: release line, source revision, holder</summary>
              <div className="field-row two">
                <label>Logical contract ID<input value={form.logicalContractId} maxLength={200} onChange={set('logicalContractId')} placeholder={derivedContractId(form.projectName)}/></label>
                <label>Source revision<input value={form.sourceRevision} maxLength={200} onChange={set('sourceRevision')} placeholder="my-token-list@1.0.0"/></label>
              </div>
              <label>Holder for the parity check<input value={form.holder} maxLength={64} onChange={set('holder')} placeholder="empty: the asset owner at the checkpoint"/></label>
              <p className="muted">The logical contract ID names the release line a policy pins through the plan fingerprint; it is derived from the project name unless given. The holder is the account whose balance is compared through both interfaces.</p>
            </details>
            <p className="own-derived">Precompile address, derived from the asset ID: {address ? <><span className="mono">{address}</span><CopyButton value={address}/></> : <em>enter a u32 asset ID</em>}</p>
            {effective.error && touched && <div className="form-error" role="alert"><CircleAlert size={15} aria-hidden="true"/><span>{effective.error}</span></div>}
            <div className="step-actions">
              <button type="submit" className="btn btn-primary" disabled={!effective.plan || !!task.busy}>{task.busy ? <LoaderCircle className="spin" size={15} aria-hidden="true"/> : null}{result && !stale ? 'Check again' : 'Run the check'}</button>
              <span className="signer-line"><span className="signer-dot read" aria-hidden="true"/><span>Runs in this browser · reads {TESTNET.substrateRpcUrl.replace('wss://', '')} · nothing to sign</span></span>
            </div>
          </form>
          {task.busy && <div className="working" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true"/><div><strong>Reading the V3 testnet through both interfaces…</strong><span>{task.elapsed ? `${task.elapsed} s` : ''}{task.elapsed > 8 ? ' · the public node can take up to a minute to hand out metadata on first contact' : ''}</span></div></div>}
          {task.error && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Nothing was recorded.</strong> {task.error}</div></div>}
        </div>
      </section>

      <section className="card" aria-labelledby="own-plan-title">
        <div className="card-head"><h2 id="own-plan-title">2 · The effective acceptance plan</h2><span className="card-note">what the checker runs</span></div>
        <div className="card-body">
          {effective.described ? <>
            <dl className="kv-list compact">
              <div className="kv"><dt>Plan fingerprint</dt><dd><span className="mono">{short(effective.described.planHash, 20)}</span><CopyButton value={effective.described.planHash}/><small className="block">SHA-256 of the acceptance plan (profile, release line, asset, holder). A policy pins this value as <code>planHash</code>; a report made under another plan is refused as <code>plan-changed</code>.</small></dd></div>
              <div className="kv"><dt>Release artifact</dt><dd><span className="mono">{short(effective.described.releaseArtifactHash, 20)}</span><CopyButton value={effective.described.releaseArtifactHash}/><small className="block">SHA-256 of the listing entry itself. A changed symbol, name or decimals is a different artifact and gets a report of its own.</small></dd></div>
              <div className="kv"><dt>Checks</dt><dd>{OWN_PLAN_LIMITS.checks.map((id) => <code key={id} className="own-check">{id}</code>)}</dd></div>
            </dl>
            <figure className="code-block entry"><figcaption><span>{effective.plan.logicalContractId} · plan</span><span className="step-actions"><button type="button" className="text-link" onClick={() => downloadJson(exportOwnPlan(effective.plan), `revivecheck-plan-${effective.plan.release}-${effective.described.planHash.slice(0, 12)}.json`)}><Download size={13} aria-hidden="true"/>Export plan</button></span></figcaption><pre tabIndex={0}><code>{JSON.stringify(effective.plan, null, 2)}</code></pre></figure>
          </> : <p className="muted">Fill in the release, or import a plan, to see the effective plan and its fingerprints.</p>}
          <details className="own-import" open={!!importError}>
            <summary><Upload size={14} aria-hidden="true"/>Import a plan (JSON)</summary>
            <p className="muted">An exported plan document or a bare plan. It is validated like any plan the server accepts, then held to this form's supported input; the fingerprints it states must match its content.</p>
            <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={5} spellCheck={false} placeholder='{"schema":"revivecheck.own-plan.v1","plan":{…},"planHash":"…"}' aria-label="Plan JSON"/>
            <div className="step-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => applyImport(importText)} disabled={!importText.trim()}>Import from text</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>Choose a file…</button><input ref={fileInput} type="file" accept="application/json,.json" onChange={readFile} hidden/></div>
            {importError && <div className="form-error" role="alert"><CircleAlert size={15} aria-hidden="true"/><span>{importError}</span></div>}
          </details>
        </div>
      </section>
    </div>

    {result && <section className="card" aria-labelledby="own-result-title">
      <div className="card-head"><h2 id="own-result-title">3 · The report</h2><span className="card-note">sealed at block #{result.report.network?.finalizedBlockNumber}</span></div>
      <div className="card-body">
        {stale && <p className="form-error" role="status"><CircleAlert size={15} aria-hidden="true"/><span>The form has changed since this report was sealed (plan {short(result.described.planHash, 8)}, artifact {short(result.described.releaseArtifactHash, 8)}). A changed input needs a new check; this report stays what it was.</span></p>}
        <ReportResult report={result.report} title={`${result.report.release} · ${result.report.status === 'passed' ? 'every check passed' : result.report.status === 'failed' ? 'a check failed' : 'not established'}`}/>
        <p className="muted own-next">This report belongs to the plan it names (fingerprint <span className="mono">{short(result.described.planHash, 12)}</span>). To use it in a bound release, make it the active report of your own browser-local project (<strong>{result.plan.name}</strong>): the studio then replays it at its block, stores it on-chain, submits its hash and lets a reviewer approve that exact hash; the project page holds your policy, the binding candidate and the exported consumer configuration. A later report, even for the same asset, needs the same steps again. Nothing from the demonstration or from another project is carried over.</p>
        <div className="step-actions"><button type="button" className="btn btn-primary" onClick={() => useInProject(result.plan, result.report, 'studio')}>Use this report in my project<ArrowRight size={15} aria-hidden="true"/></button><button type="button" className="btn btn-secondary" onClick={() => useInProject(result.plan, result.report, 'project')}>Open the project page</button><button type="button" className="btn btn-secondary" onClick={() => downloadJson(result.report, `revivecheck-${result.report.release}-${result.report.evidenceHash.slice(0, 12)}.json`)}><Download size={14} aria-hidden="true"/>Report JSON</button></div>
      </div>
    </section>}

    <section className="card" aria-labelledby="own-limits-title">
      <div className="card-head"><h2 id="own-limits-title">What this form supports, and what it does not</h2><span className="card-note">stated up front</span></div>
      <div className="card-body">
        <dl className="kv-list compact">
          <div className="kv"><dt>Network</dt><dd>{OWN_PLAN_LIMITS.network.name} (chain {OWN_PLAN_LIMITS.network.chainId}) only. {OWN_PLAN_LIMITS.network.note}</dd></div>
          <div className="kv"><dt>Profile</dt><dd><code>{OWN_PLAN_LIMITS.profile.supported}</code> only. {OWN_PLAN_LIMITS.profile.note}</dd></div>
          <div className="kv"><dt>Runtime and adapter</dt><dd>{OWN_PLAN_LIMITS.runtime.specName}/{OWN_PLAN_LIMITS.runtime.specVersion}. {OWN_PLAN_LIMITS.runtime.note}</dd></div>
          <div className="kv"><dt>Reads</dt><dd>{OWN_PLAN_LIMITS.reads.note}</dd></div>
          <div className="kv"><dt>Same input elsewhere</dt><dd>CLI: <code>npm run rc -- check_release --plan plan.json</code> · MCP: <code>check_release</code> with the plan · library: <code>checkRelease(plan)</code>. The plan exported above is the input all three accept.</dd></div>
        </dl>
      </div>
    </section>
  </>;
}
