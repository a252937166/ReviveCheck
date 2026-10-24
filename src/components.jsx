import React from 'react';
import { CircleCheck, CircleAlert, CircleDashed, Clock3, ChevronDown, Code2, RotateCcw, Radio, FlaskConical, ArrowRight, GitCompareArrows, LoaderCircle, ShieldCheck } from 'lucide-react';
import ExplorerEvidence from './ExplorerEvidence.jsx';

export const labels = { passed:'Passed', failed:'Failed', blocked:'Blocked', unknown:'Unknown', inconclusive:'Inconclusive', accepted:'Accepted', 'changes-requested':'Changes requested', sample:'Sample', unreviewed:'Not reviewed', 'share-prepared':'Share prepared', 'not-shared':'Not shared', 'current-snapshot':'Snapshot saved', 'plan-changed':'Plan changed', 'release-changed':'Release changed', 'target-changed':'Target changed', 'environment-changed':'Environment changed' };
export const text = value => value === null || value === undefined || value === '' ? 'Not supplied' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export const short = (value, length = 22) => !value ? 'Not supplied' : String(value).length > length ? `${String(value).slice(0, Math.ceil(length / 2))}…${String(value).slice(-Math.floor(length / 2))}` : String(value);
export const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Time not recorded' : new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d); };
export const scope = run => run?.mode === 'rehearsal' ? 'Sample · synthetic fixtures' : run?.scope === 'portaldot-live-readonly' ? 'Live · V3 Live, read-only' : 'Live · testnet, read-only';
const assertionObservation = item => item.error ? `Error: ${text(item.error)}` : item.evmValue !== undefined || item.nativeValue !== undefined ? `EVM: ${text(item.evmValue)} · Native: ${text(item.nativeValue)}` : text(item.observed ?? item.value ?? item.result);
const tones = { passed:'pass', accepted:'pass', failed:'fail', 'changes-requested':'fail', blocked:'hold', unknown:'hold', inconclusive:'hold', unreviewed:'quiet', sample:'hold' };

// Two interfaces, one verdict: the native lane and the EVM lane meet in one check.
export function Mark({ size = 28, title = '' }) {
  return <svg className="mark" width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title || undefined}>
    <rect width="32" height="32" rx="8" fill="#0a0a0b"/>
    <path d="M5.8 20.6c4.4 0 5.6-4.6 9.2-4.6" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2.2" strokeLinecap="round"/>
    <path d="M5.8 11.4c4.4 0 5.6 4.6 9.2 4.6" fill="none" stroke="#6f7bff" strokeWidth="2.2" strokeLinecap="round"/>
    <path d="M15 16l3.4 3.4 7.4-8.6" fill="none" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
// The official Portaldot mark, unaltered, as published on its DoraHacks organizer profile.
export function BuiltOn({ compact = false }) {
  return <a className={`built-on ${compact ? 'compact' : ''}`} href="https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail" target="_blank" rel="noreferrer" aria-label="Built on Portaldot V3 for Portaldot Hacker House 2026"><span className="built-on-label">Built on</span><img src="./brand/portaldot-mark-128.png" width="18" height="18" alt=""/><strong><span className="built-on-name">Portaldot </span>V3</strong></a>;
}
export function Stamp({ tone = 'quiet', small = false, children }) { return <span className={`stamp ${tone} ${small ? 'small' : ''}`}>{children}</span>; }
export function Brand({href='#/'}) { return <a className="wordmark" href={href}><Mark size={26}/><span>ReviveCheck</span></a>; }
export function StateIcon({status,size=17}) { const Icon=['passed','accepted'].includes(status)?CircleCheck:status==='failed'||status==='changes-requested'?CircleAlert:status==='unknown'||status==='inconclusive'?Clock3:CircleDashed; return <Icon size={size} aria-hidden="true"/>; }
export function Pill({status,children}) { return <Stamp tone={tones[status] || 'quiet'} small>{children || labels[status] || status}</Stamp>; }
export function FileControl({children,onFile,accept='.json,application/json',disabled=false,className=''}) { return <label className={`line-button file-control ${className}`} aria-disabled={disabled || undefined}>{children}<input type="file" accept={accept} disabled={disabled} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)onFile(file);}}/></label>; }

export function CheckLedger({checks=[]}) {
  return <div className="checks-ledger">{checks.map(check=><details className={`check-row ${check.status}`} key={check.id} open={['failed','unknown'].includes(check.status) || undefined}>
    <summary><StateIcon status={check.status}/><span className="check-title">{check.title || check.id}</span><Stamp tone={tones[check.status]} small>{labels[check.status] || check.status}</Stamp><ChevronDown className="check-chevron" size={15}/></summary>
    <div className="check-detail"><dl><div><dt>Observed</dt><dd>{text(check.observed)}</dd></div><div><dt>Expected</dt><dd>{text(check.expected)}</dd></div></dl>
      {Array.isArray(check.evidence?.assertions) && <div className="assertion-results">{check.evidence.assertions.filter(item=>item&&typeof item==='object').slice(0,8).map((item,index)=><div key={String(item.id || index)}><div><StateIcon status={item.status}/><strong>{text(item.label || item.signature || item.id || `Assertion ${index+1}`)}</strong><span>{labels[item.status] || text(item.status)}</span></div><p>{assertionObservation(item)} <span>expected {text(item.expected)}</span></p></div>)}</div>}
      {Array.isArray(check.evidence?.fields) && <div className="assertion-results">{check.evidence.fields.map(field=><div key={field.field}><div><StateIcon status={field.status}/><strong>{field.field}</strong><span>{labels[field.status]}</span></div><p>listed {text(field.claimed)} · native {text(field.native)} · ERC-20 {text(field.evm)}</p></div>)}</div>}
      {check.remediation && check.status!=='passed' && <div className="remediation"><RotateCcw size={14}/><p>{text(check.remediation)}</p></div>}
      {check.evidence && <details className="raw-evidence"><summary><Code2 size={13}/> Source evidence</summary><pre>{JSON.stringify(check.evidence,null,2)}</pre></details>}
    </div>
  </details>)}</div>;
}

export function ReportCard({run,actions,integrity=false}) {
  const sample=run.mode==='rehearsal';
  const promotion=run.scope==='portaldot-live-readonly';
  const headline=sample?'Sample workflow result':promotion?(run.status==='passed'?'Promotion can stand':'Promotion refused'):run.status==='passed'?'Acceptance checks passed':run.status==='failed'?'A check needs a fix':run.status==='blocked'?'Resolve the next evidence gap':'The result needs investigation';
  return <article className={`report exhibit ${sample?'sample-report':''}`} id="report">
    {sample && <div className="sample-ribbon"><FlaskConical size={15}/> Synthetic sample: scenario changes do not establish a repair</div>}
    <div className={`report-overview ${run.status}`}><div className="result-stamp"><Stamp tone={tones[run.status]}>{promotion&&run.status!=='passed'?'Refused':labels[run.status]}</Stamp></div><div><div className="report-mode"><span className={`scope-tag ${run.mode}`}>{sample?<FlaskConical size={12}/>:<Radio size={12}/>} {scope(run)}</span><span>{run.release || run.input?.release}</span></div><h2 id="report-title" tabIndex={-1}>{headline}</h2><p>{sample?'Workflow fixtures; no query, deployment or transaction.':promotion?'A read-only assessment of whether an accepted testnet report can stand on V3 Live. Nothing was deployed or listed.':`${run.input?.profile==='native-asset'?(run.input?.listing?'Token-list release acceptance':'Existing public asset acceptance'):'Saved acceptance plan'} at a finalized observation. No transaction was signed by this check.`}</p></div></div>
    <div className="report-meta"><span>{date(run.completedAt || run.startedAt)}</span><span>{run.checks.filter(item=>item.status==='passed').length}/{run.checks.length} checks passed</span><span>Checkpoint <strong>{run.network?.finalizedBlockNumber ? `#${run.network.finalizedBlockNumber}` : 'not established'}</strong></span><span>Runtime <strong>{run.network?.specVersion || 'not recorded'}</strong></span>{integrity && <span className="integrity-good"><ShieldCheck size={13}/> JSON fingerprint matches</span>}</div>
    <CheckLedger checks={run.checks}/>
    <ExplorerEvidence run={run}/>
    <details className="limitations"><summary><CircleAlert size={14}/> Evidence scope & limitations<ChevronDown size={14}/></summary><p>A matching fingerprint detects content changes. It does not authenticate RPC responses, the project owner, or the reviewer.</p><ul>{(run.limitations || []).map((item,index)=><li key={index}>{text(item)}</li>)}</ul></details>
    <details className="saved-plan"><summary><Code2 size={14}/> Saved acceptance plan<ChevronDown size={14}/></summary><pre>{JSON.stringify(run.input,null,2)}</pre></details>
    <div className="report-footer"><div className="evidence-hash"><span>Report SHA-256</span><code title={run.evidenceHash}>{short(run.evidenceHash,30)}</code></div>{actions}</div>
  </article>;
}

const kinds={'same-target':'Same deployment','configuration-correction':'Configuration correction','deployment-version':'Across deployment versions','runtime-change':'Runtime changed','fixture-scenario':'Sample scenario changed'};
export function Comparison({runs,run,baseline,setBaseline,comparison,onCompare,busy}) {
  return <section className="comparison form-panel" id="comparison"><div className="panel-heading"><h2><GitCompareArrows size={18}/> Compare evidence</h2></div><p className="section-description">Keep logical contract and assertions stable. New deployments and environment changes are shown as context changes.</p>
    {runs.length?<><div className="compare-controls"><label>Baseline report<select value={baseline} onChange={event=>setBaseline(event.target.value)}><option value="">Choose a saved report</option>{runs.map(item=><option key={item.id} value={item.id}>{item.release} · {labels[item.status]} · {date(item.startedAt)}</option>)}</select></label><button className="line-button" disabled={!baseline || busy} onClick={onCompare}>{busy?<LoaderCircle className="spin" size={15}/>:<GitCompareArrows size={15}/>}Compare</button></div>
    {comparison && <div className="comparison-result"><div className={`comparison-caveat ${comparison.compatible===false?'warning':''}`} role={comparison.compatible===false?'status':undefined}><CircleAlert size={16}/><div><strong>{kinds[comparison.comparisonKind] || (comparison.compatible===false?'Different acceptance context':'Evidence comparison')}</strong><p>{comparison.caveat || comparison.reason || 'This comparison describes observations; it does not establish what caused a change.'}</p></div></div>
      {comparison.compatible!==false && <><div className="comparison-summary"><span className="improved">{comparison.summary?.improved || 0} improved</span><span className="regressed">{comparison.summary?.regressed || 0} regressed</span><span>{comparison.summary?.changed || 0} context changed</span><span>{comparison.summary?.unchanged || 0} unchanged</span></div><div className="change-list">{comparison.changes?.map(change=><div className={`change-row ${change.transition}`} key={change.id}><span>{change.title || change.id}<small>{change.transition==='context-changed'?'Context changed; no repair credited':change.transition}</small></span><div><span>{labels[change.before?.status || change.before] || change.before?.status || 'Missing'}</span><ArrowRight size={13}/><strong>{labels[change.after?.status || change.after] || change.after?.status || 'Missing'}</strong></div></div>)}</div></>}
      {!!comparison.inputChanges?.length && <details className="input-changes"><summary>Plan changes ({comparison.inputChanges.length})<ChevronDown size={14}/></summary><dl>{comparison.inputChanges.map(change=><div key={change.key}><dt>{change.key}</dt><dd><span>{text(change.before)}</span><ArrowRight size={12}/><strong>{text(change.after)}</strong></dd></div>)}</dl></details>}
    </div>}</>:<div className="inline-empty">Run this plan again, then compare its evidence with the saved baseline.</div>}
  </section>;
}
