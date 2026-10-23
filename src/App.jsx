import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Archive, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleDashed, Clock3, Code2, Copy, ExternalLink, FileCheck2, FlaskConical, Folder, GitCompareArrows, History, Layers3, LoaderCircle, Plus, Radio, RotateCcw, Settings2, ShieldCheck, X } from 'lucide-react';

const defaults = { name: '', release: 'v0.1.0', account: '', contractAddress: '', expectedValue: '42', expectedChainId: 420420777, transactionHash: '', transactionBlockHash: '' };
const scenarios = [
  { id: 'wrong-network', title: 'Wrong network', detail: 'Start with a known configuration failure.' },
  { id: 'ready', title: 'Corrected configuration', detail: 'Rehearse a passing acceptance flow.' },
  { id: 'missing-code', title: 'Contract missing', detail: 'See how missing deployment evidence blocks a release.' },
];
const labels = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', unknown: 'Unknown', inconclusive: 'Inconclusive' };
const short = (value, length = 18) => !value ? 'Not supplied' : value.length > length ? `${value.slice(0, length / 2)}…${value.slice(-length / 2 + 1)}` : value;
const date = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const scopeLabel = run => run?.mode === 'live' ? 'Live read-only' : 'Local rehearsal';
const checkLabel = check => { const status = typeof check === 'object' ? check?.status : check; return labels[status] || status || 'Missing'; };

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : body.error?.message || body.message || `Request failed (${response.status}).`);
  return body;
}

function StateIcon({ status, size = 17 }) {
  const Icon = status === 'passed' ? CircleCheck : status === 'failed' ? CircleAlert : status === 'blocked' ? CircleDashed : Clock3;
  return <Icon size={size} aria-hidden="true" />;
}

function Pill({ status }) { return <span className={`status-pill ${status}`}><StateIcon status={status} size={13}/>{labels[status] || status}</span>; }

export default function App() {
  const [workspace, setWorkspace] = useState({ projects: [], runs: [], network: {} });
  const [selectedId, setSelectedId] = useState('');
  const [runId, setRunId] = useState('');
  const [form, setForm] = useState(defaults);
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', release: 'v0.1.0' });
  const [showArchived, setShowArchived] = useState(false);
  const [mode, setMode] = useState('rehearsal');
  const [scenario, setScenario] = useState('wrong-network');
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [baseline, setBaseline] = useState('');
  const [comparison, setComparison] = useState(null);
  const [copied, setCopied] = useState(false);

  const project = workspace.projects.find(item => item.id === selectedId);
  const runs = useMemo(() => workspace.runs.filter(item => item.projectId === selectedId).sort((a,b) => new Date(b.startedAt) - new Date(a.startedAt)), [workspace.runs, selectedId]);
  const run = runs.find(item => item.id === runId) || runs[0];
  const compatibleRuns = runs.filter(item => item.id !== run?.id && item.mode === run?.mode && item.scope === run?.scope);
  const dirty = project && Object.keys(defaults).some(key => String(form[key] ?? '') !== String(project[key] ?? defaults[key]));
  const activeProjects = workspace.projects.filter(item => showArchived || !item.archivedAt);

  async function refresh(preferredId) {
    const data = await api('/api/workspace');
    setWorkspace(data);
    if (preferredId) setSelectedId(preferredId);
    else if (!selectedId && data.projects.length) setSelectedId(data.projects.find(item => !item.archivedAt)?.id || data.projects[0].id);
    return data;
  }

  useEffect(() => { let alive = true; api('/api/workspace').then(data => { if (!alive) return; setWorkspace(data); setSelectedId(data.projects.find(item => !item.archivedAt)?.id || data.projects[0]?.id || ''); }).catch(e => alive && setError(e.message)).finally(() => alive && setBusy('')); return () => { alive = false; }; }, []);
  useEffect(() => { if (project) setForm(Object.fromEntries(Object.keys(defaults).map(key => [key, project[key] ?? defaults[key]]))); setRunId(''); setComparison(null); setBaseline(''); setError(''); }, [selectedId]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 5500); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => { setComparison(null); setBaseline(''); }, [run?.id]);
  useEffect(() => { if (!showCreate) return; const onKey = event => { if (event.key === 'Escape' && !busy) setShowCreate(false); if (event.key === 'Tab') { const items = [...document.querySelectorAll('.create-modal button:not(:disabled), .create-modal input:not(:disabled)')]; const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [showCreate, busy]);

  function chooseProject(id) { setSelectedId(id); setNotice(''); }
  function edit(key, value) { setForm(current => ({ ...current, [key]: value })); }

  async function createProject(event) {
    event.preventDefault(); setBusy('create'); setError('');
    try {
      const created = await api('/api/projects', { method: 'POST', body: JSON.stringify({ ...defaults, ...newProject, name: newProject.name.trim() }) });
      await refresh(created.id); setShowCreate(false); setNewProject({ name: '', release: 'v0.1.0' }); setNotice('Project created. Start a rehearsal or add your testnet contract.');
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function saveProject(event) {
    event?.preventDefault(); setBusy('save'); setError('');
    try { await api(`/api/projects/${selectedId}`, { method: 'PATCH', body: JSON.stringify({ ...form, expectedChainId: Number(form.expectedChainId) }) }); await refresh(selectedId); setNotice('Configuration saved. Existing reports keep their original inputs.'); } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function startRun() {
    setBusy('run'); setError(''); setComparison(null);
    try {
      const saved = await api(`/api/projects/${selectedId}`, { method: 'PATCH', body: JSON.stringify({ ...form, expectedChainId: Number(form.expectedChainId) }) });
      const result = await api(`/api/projects/${selectedId}/runs`, { method: 'POST', body: JSON.stringify({ mode, scenario: mode === 'rehearsal' ? scenario : undefined }) });
      const data = await refresh(selectedId); setForm(Object.fromEntries(Object.keys(defaults).map(key => [key, saved[key] ?? defaults[key]]))); setRunId(result.id);
      setNotice(`${scopeLabel(result)} completed. The report is saved in your run history.`);
      document.getElementById('report-title')?.focus();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function changeArchive() {
    setBusy('archive'); setError('');
    try { await api(`/api/projects/${selectedId}/${project.archivedAt ? 'restore' : 'archive'}`, { method: 'POST', body: '{}' }); await refresh(selectedId); setNotice(project.archivedAt ? 'Project restored.' : 'Project archived. Its reports remain available.'); } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function compare() {
    setBusy('compare'); setError('');
    try { setComparison(await api(`/api/compare?baseline=${encodeURIComponent(baseline)}&candidate=${encodeURIComponent(run.id)}`)); } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function copyHash() {
    try { await navigator.clipboard.writeText(run.evidenceHash); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setNotice('Select the hash in the report to copy it.'); }
  }

  return <div className="app-shell">
    <aside className="project-rail">
      <a className="brand" href="/" aria-label="ReviveCheck home"><span className="brand-symbol"><CheckCheck size={23} strokeWidth={2.7}/></span><span>ReviveCheck<span className="brand-caption">Portaldot release acceptance</span></span></a>
      <div className="rail-project-heading"><span>Your projects</span><button className="rail-icon" onClick={() => { setShowCreate(true); setError(''); }} aria-label="Create project"><Plus size={18}/></button></div>
      <nav className="project-list" aria-label="Projects">
        {activeProjects.map(item => <button key={item.id} className={`project-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => chooseProject(item.id)}><Folder size={17}/><span><strong>{item.name}</strong><small>{item.archivedAt ? 'Archived' : item.release}</small></span>{selectedId === item.id && <ChevronRight size={16}/>}</button>)}
        {!activeProjects.length && <p className="rail-empty">Your acceptance reports start with a project.</p>}
      </nav>
      <button className="rail-create" onClick={() => { setShowCreate(true); setError(''); }}><Plus size={16}/> New project</button>
      <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/> Show archived projects</label>
      <div className="rail-bottom"><div className="rail-network"><span className="network-dot"/><span>Portaldot V3 testnet</span></div><p>Build a release record.<br/>Keep the proof with the fix.</p><a href="https://github.com/ItsCogumellum/portaldot-v3-testnet-guide" target="_blank" rel="noreferrer">V3 developer guide <ArrowUpRight size={14}/></a></div>
    </aside>

    <main className="workspace">
      <header className="workspace-header"><div className="breadcrumb"><Layers3 size={16}/><span>Workspace</span><ChevronRight size={13}/><strong>{project?.name || 'Get started'}</strong></div><span className="local-label"><ShieldCheck size={15}/> Local workspace</span></header>
      {notice && <div className="toast" role="status"><CircleCheck size={18}/><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15}/></button></div>}
      {error && !showCreate && <div className="error-banner" role="alert"><CircleAlert size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}

      {busy === 'loading' ? <div className="loading-state"><LoaderCircle className="spin" size={24}/><p>Opening your workspace…</p></div> : !project ? <section className="welcome">
        <div className="welcome-graphic" aria-hidden="true"><div className="sheet-line"/><div className="sheet-line"/><span><CheckCheck size={40}/></span><div className="sheet-line short"/></div>
        <h1>Make the fix verifiable.</h1><p>Catch Portaldot V3 migration failures, rerun the same acceptance plan, and show exactly what changed.</p>
        <button className="button primary large" onClick={() => setShowCreate(true)}><Plus size={18}/> Create your first project</button>
        <div className="welcome-steps"><span><FlaskConical size={18}/> Rehearse a failure</span><ChevronRight size={14}/><span><RotateCcw size={18}/> Prove the fix</span><ChevronRight size={14}/><span><FileCheck2 size={18}/> Keep the evidence</span></div>
        <p className="welcome-note">Start with a local rehearsal. Add your own account and contract for live read-only checks. This app never asks for a private key.</p>
      </section> : <>
        <section className="project-intro"><div><div className="project-title-row"><h1>{project.name}</h1><span className="release-tag">{project.release}</span>{project.archivedAt && <span className="status-pill blocked"><Archive size={13}/>Archived</span>}</div><p>Catch a migration failure. Verify the fix. Keep the evidence.</p></div><button className="text-button archive-action" onClick={changeArchive} disabled={!!busy}>{project.archivedAt ? <RotateCcw size={15}/> : <Archive size={15}/>} {project.archivedAt ? 'Restore project' : 'Archive project'}</button></section>
        <div className="lifecycle" aria-label="Acceptance lifecycle"><span className="active"><Settings2 size={16}/> Configure</span><i/><span className={runs.length ? 'active' : ''}><Activity size={16}/> Run checks</span><i/><span className={run ? 'active' : ''}><FileCheck2 size={16}/> Inspect evidence</span><i/><span className={comparison ? 'active' : ''}><GitCompareArrows size={16}/> Compare & export</span></div>
        {project.archivedAt && <div className="archive-banner"><Archive size={18}/><span>This project is archived. Its evidence stays available. Restore it to run new checks.</span></div>}

        <div className="workbench">
          <section className="configuration panel" aria-labelledby="configuration-title">
            <div className="panel-heading"><h2 id="configuration-title">Acceptance plan</h2>{dirty && <span className="unsaved">Unsaved changes</span>}</div>
            <form onSubmit={saveProject}>
              <fieldset disabled={!!busy || !!project.archivedAt}>
                <div className="field-pair"><label>Project name<input required maxLength={80} value={form.name} onChange={e => edit('name',e.target.value)}/></label><label>Release<input required maxLength={40} value={form.release} onChange={e => edit('release',e.target.value)} placeholder="v0.1.0"/></label></div>
                <label>Deployer account<input className="code-input" value={form.account} onChange={e => edit('account',e.target.value.trim())} placeholder="Native SS58 or 0x address" spellCheck="false"/><small>A public address only. Never enter a seed or private key.</small></label>
                <label>Probe contract<input className="code-input" value={form.contractAddress} onChange={e => edit('contractAddress',e.target.value.trim())} placeholder="0x… deployed on V3 testnet" spellCheck="false"/><small>Use a deployed ReviveProbe contract for the value check.</small></label>
                <div className="field-pair values"><label>Expected value<input value={form.expectedValue} onChange={e => edit('expectedValue',e.target.value)} inputMode="numeric" pattern="[0-9]+" required/></label><label>Expected chain ID<input value={form.expectedChainId} onChange={e => edit('expectedChainId',e.target.value)} inputMode="numeric" pattern="[0-9]+" required/></label></div>
                <details className="deployment-settings"><summary><Code2 size={13}/> Deployment evidence <ChevronDown size={13}/></summary><div><p>Add the native extrinsic and block hashes to check finality. Missing hashes remain blocked in live reports.</p><label>Transaction / extrinsic hash<input className="code-input" value={form.transactionHash} onChange={e=>edit('transactionHash',e.target.value.trim())} placeholder="0x… 32-byte hash" spellCheck="false"/></label><label>Containing block hash<input className="code-input" value={form.transactionBlockHash} onChange={e=>edit('transactionBlockHash',e.target.value.trim())} placeholder="0x… 32-byte hash" spellCheck="false"/></label></div></details>
                <button className="button secondary save-button" type="submit" disabled={!dirty || !!busy}>{busy === 'save' ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>} Save configuration</button>
              </fieldset>
            </form>
            <div className="execution-area">
              <div className="execution-title"><h3>Run this plan</h3><span>Read-only execution</span></div>
              <div className="mode-switch" role="group" aria-label="Evidence mode"><button className={mode==='rehearsal'?'selected':''} onClick={()=>setMode('rehearsal')} disabled={!!busy}><FlaskConical size={16}/> Local rehearsal</button><button className={mode==='live'?'selected':''} onClick={()=>setMode('live')} disabled={!!busy}><Radio size={16}/> Live testnet</button></div>
              {mode === 'rehearsal' ? <><label className="scenario-label">Rehearsal scenario<select value={scenario} onChange={e => setScenario(e.target.value)} disabled={!!busy}>{scenarios.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label><p className="mode-description">{scenarios.find(item=>item.id===scenario)?.detail} Fixture data exercises the workflow; it does not prove testnet deployment.</p></> : <p className="mode-description">Queries the official V3 network with your saved inputs. Missing deployment or transaction evidence remains blocked. No transactions are signed.</p>}
              <button className="button primary run-button" disabled={!!busy || !!project.archivedAt || !form.name.trim() || !form.release.trim()} onClick={startRun}>{busy === 'run' ? <><LoaderCircle className="spin" size={18}/> Checking your release…</> : <><Activity size={18}/> {mode === 'rehearsal' ? 'Run rehearsal' : 'Run live checks'}<ArrowRight size={17}/></>}</button>
              <small className="execution-note">Current inputs are saved before each run.</small>
            </div>
          </section>

          <section className="report-column" aria-label="Acceptance report">
            {busy === 'run' ? <div className="report-loading panel" role="status" aria-live="polite"><div className="running-orbit"><Activity size={31}/></div><h2>Checking the release</h2><p>Capturing observations and saving a new report.<br/>Your earlier evidence will stay intact.</p><div className="progress-track"><span/></div></div> : run ? <article className="report panel">
              <div className={`report-overview ${run.status}`}><div className="result-glyph"><StateIcon status={run.status} size={34}/></div><div className="report-overview-copy"><div className="report-mode"><span className={`scope-tag ${run.mode}`}>{run.mode==='live'?<Radio size={12}/>:<FlaskConical size={12}/>} {scopeLabel(run)}</span><span>{run.release}</span></div><h2 id="report-title" tabIndex={-1}>{run.status === 'passed' ? run.mode === 'live' ? 'Read-only checks passed' : 'Rehearsal passed' : run.status === 'failed' ? 'A check needs a fix' : run.status === 'blocked' ? 'More evidence is needed' : 'The result is inconclusive'}</h2><p>{run.mode === 'rehearsal' ? 'Local fixture results. This is not a verified testnet deployment.' : 'Observed testnet state. This report does not perform a deployment.'}</p></div></div>
              <div className="report-meta"><span><Clock3 size={13}/>{date(run.completedAt || run.startedAt)}</span><span>{run.checks.filter(item=>item.status==='passed').length} of {run.checks.length} checks passed</span><Pill status={run.status}/></div>
              <div className="checks-ledger">{run.checks.map((check,index)=><details className={`check-row ${check.status}`} key={`${run.id}-${check.id}`} open={['failed','unknown'].includes(check.status) || undefined}><summary><span className="check-state"><StateIcon status={check.status}/></span><span className="check-title">{check.title}</span><span className="check-status">{labels[check.status]}</span><ChevronDown className="check-chevron" size={15}/></summary><div className="check-detail"><dl><div><dt>Observed</dt><dd>{typeof check.observed === 'object' ? JSON.stringify(check.observed) : check.observed || 'No observation'}</dd></div><div><dt>Expected</dt><dd>{typeof check.expected === 'object' ? JSON.stringify(check.expected) : check.expected || 'Not specified'}</dd></div></dl>{check.remediation && check.status!=='passed' && <div className="remediation"><RotateCcw size={14}/><p>{check.remediation}</p></div>}{check.evidence && <details className="raw-evidence"><summary><Code2 size={13}/> Raw evidence</summary><pre>{JSON.stringify(check.evidence,null,2)}</pre></details>}</div></details>)}</div>
              {run.limitations?.length>0 && <details className="limitations"><summary><CircleAlert size={14}/> What this report does not prove <ChevronDown size={14}/></summary><ul>{run.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></details>}
              <div className="report-footer"><div className="evidence-hash"><span>Evidence fingerprint</span><button onClick={copyHash} title={run.evidenceHash || ''}><code>{short(run.evidenceHash || '',25)}</code>{copied?<Check size={13}/>:<Copy size={13}/>}</button></div><div className="export-buttons"><a className="button secondary small" href={`/api/runs/${run.id}/export?format=json`} download><ArrowDownToLine size={14}/> JSON</a><a className="button secondary small" href={`/api/runs/${run.id}/export?format=html`} download><ArrowDownToLine size={14}/> HTML</a></div></div>
            </article> : <div className="report-empty panel"><div className="empty-report-mark"><FileCheck2 size={37}/></div><h2>Your first report goes here.</h2><p>Start with “Wrong network” to catch a failure. Then run “Corrected configuration” and compare the reports.</p><div className="empty-example"><span><CircleAlert size={16}/> Catch the failure</span><span><RotateCcw size={16}/> Rerun the same plan</span><span><GitCompareArrows size={16}/> Show what improved</span></div><small>Ready for your contract? Switch to live testnet checks.</small></div>}

            {run && <section className="comparison panel" aria-labelledby="comparison-title"><div className="panel-heading"><h2 id="comparison-title"><GitCompareArrows size={18}/> Verify the change</h2></div><p className="section-description">Compare this report with an earlier run from the same project and evidence mode.</p>{compatibleRuns.length ? <><div className="compare-controls"><label>Baseline report<select value={baseline} onChange={e=>{setBaseline(e.target.value);setComparison(null);}}><option value="">Choose a baseline</option>{compatibleRuns.map(item=><option key={item.id} value={item.id}>{item.release} — {labels[item.status]} — {date(item.startedAt)}</option>)}</select></label><button className="button secondary" onClick={compare} disabled={!baseline || !!busy}>{busy==='compare'?<LoaderCircle className="spin" size={15}/>:<GitCompareArrows size={15}/>} Compare</button></div>{comparison && (comparison.compatible===false ? <div className="comparison-error" role="alert">{comparison.reason || 'These reports cannot be compared.'}</div> : <div className="comparison-result">{comparison.caveat && <p className="comparison-caveat"><CircleAlert size={15}/><span>{comparison.caveat}</span></p>}<div className="comparison-summary"><span className="improved"><CircleCheck size={15}/>{comparison.summary?.improved || 0} improved</span><span className="regressed"><CircleAlert size={15}/>{comparison.summary?.regressed || 0} regressed</span><span>{comparison.summary?.unchanged || 0} unchanged</span></div><div className="change-list">{comparison.changes?.map(change=><div className={`change-row ${change.transition}`} key={change.id}><span>{change.title}</span><div><span>{checkLabel(change.before)}</span><ArrowRight size={13}/><strong>{checkLabel(change.after)}</strong></div></div>)}</div>{comparison.inputChanges?.length>0 && <details className="input-changes"><summary>Saved inputs changed ({comparison.inputChanges.length})<ChevronDown size={13}/></summary><dl>{comparison.inputChanges.map(change=><div key={change.key}><dt>{({name:'Project name',release:'Release',account:'Deployer account',contractAddress:'Probe contract',expectedValue:'Expected value',expectedChainId:'Expected chain ID',transactionHash:'Transaction hash',transactionBlockHash:'Containing block hash'})[change.key] || change.key}</dt><dd><span>{String(change.before ?? 'Empty') || 'Empty'}</span><ArrowRight size={12}/><strong>{String(change.after ?? 'Empty') || 'Empty'}</strong></dd></div>)}</dl></details>}</div>)}</> : <div className="comparison-empty"><History size={19}/><p>Run the plan again to compare results. Earlier reports stay unchanged.</p></div>}</section>}
          </section>
        </div>

        <section className="history-panel panel" aria-labelledby="history-title"><div className="panel-heading"><h2 id="history-title"><History size={18}/> Run history</h2><span className="history-count">{runs.length} saved {runs.length===1?'report':'reports'}</span></div>{runs.length ? <div className="history-table" role="table" aria-label="Saved reports"><div className="history-table-head" role="row"><span role="columnheader">Release</span><span role="columnheader">Evidence mode</span><span role="columnheader">Result</span><span role="columnheader">Completed</span><span role="columnheader">Report</span></div>{runs.map(item=><button className={`history-row ${run?.id===item.id?'selected':''}`} key={item.id} onClick={()=>{setRunId(item.id);setComparison(null);}} aria-label={`Open ${item.release} ${scopeLabel(item)} report ${date(item.startedAt)}`}><span className="history-release"><FileCheck2 size={16}/><strong>{item.release}</strong></span><span className={`history-mode ${item.mode}`}>{scopeLabel(item)}</span><span><Pill status={item.status}/></span><span className="history-date">{date(item.completedAt || item.startedAt)}</span><span className="open-report">{run?.id===item.id?'Viewing':'Open'}<ChevronRight size={14}/></span></button>)}</div> : <div className="history-empty"><History size={20}/><p>Each run saves an immutable report here. Changes to your plan never rewrite old evidence.</p></div>}</section>
        <footer className="workspace-footer"><span>ReviveCheck prototype</span><span>Portaldot V3 release evidence, from first failure to verified fix.</span></footer>
      </>}
    </main>

    {showCreate && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget && !busy)setShowCreate(false);}}><section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="modal-close" onClick={()=>setShowCreate(false)} aria-label="Close create project" disabled={!!busy}><X size={20}/></button><div className="modal-symbol"><Folder size={25}/></div><h2 id="create-title">Start a release record.</h2><p>Give your application a project. Every run will preserve the inputs, results and evidence for that release.</p>{error && <div className="error-banner" role="alert">{error}</div>}<form onSubmit={createProject}><label>Project name<input autoFocus required maxLength={80} placeholder="e.g. My Portaldot app" value={newProject.name} onChange={e=>setNewProject({...newProject,name:e.target.value})}/></label><label>First release<input required maxLength={40} value={newProject.release} onChange={e=>setNewProject({...newProject,release:e.target.value})}/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={()=>setShowCreate(false)} disabled={!!busy}>Cancel</button><button className="button primary" type="submit" disabled={!!busy || !newProject.name.trim()}>{busy==='create'?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>}Create project</button></div></form></section></div>}
  </div>;
}
