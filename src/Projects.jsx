// My projects: the visitor's browser-local projects, each with its own supported plan,
// policy draft, reviewer trust declaration, release identity, storage locator, binding
// candidate and explicit bindings. The facts the studio established for a project (its
// active report, where it is stored, which release and revision it was submitted as, how
// it was reviewed) are read from that project's own session; the candidate they make is
// shown with its exact report hash before anything is bound, and a candidate is not an
// approval. The policy is evaluated here with the same evaluator the Catalog decision,
// the CLI and the separate consumer use, on fresh reads, under the current-decision model
// with its evidence-derived deadline. Export: a versioned project bundle, and the consumer
// configuration the Token eligibility demo and the catalog release gate read. Import
// recomputes every fingerprint and holds imported reviewer trust apart until confirmed.
// Read-only; no wallet; nothing leaves the browser unless the visitor downloads it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, Download, FolderKanban, LoaderCircle, Play, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Badge, ChainLink, CopyButton, useSubRoute } from './site.jsx';
import { short } from './components.jsx';
import { fmt, when } from './records.js';
import { downloadJson } from '../lib/share.js';
import { entryDecision } from '../lib/entry.js';
import { policyAssurance } from '../lib/policy.js';
import { initialDecision, beginCheck, settleCheck, failCheck, changeSelection, ageDecision, checkPermission, describeDecision, CURRENT_WORDS, VALIDITY_LIMITS } from '../lib/current.js';
import { explainReason, RENEWAL_STEPS } from '../lib/decision.js';
import { loadProjects, saveProjects, withProject, selectProject, removeProject, listProjects, projectView, policyStatus, updatePolicy, updateRoles, renameProject, setReleaseLabel, confirmReviewers, bindCandidate, consumerConfigFor, exportBundle, importBundle, entryFor, POLICY_DEFAULTS } from './projects.js';
import { loadStudioStore, sessionFor, withSession, saveStudioStore, activeReport, recordImport } from './studio-state.js';
import { studioProject } from './projects.js';
import { activateProject } from './studio-store.js';

const engine = () => import('./engine.js');
const TIMEOUT_MS = 90_000;
const STATUS_BADGE = { valid: 'passed', 'recheck-required': 'failed', expired: 'failed', unknown: 'unknown', 'not-checked': 'idle', checking: 'pending' };
const LIMIT_WORDS = { report: "the report's age limit", observation: 'the network read', registry: 'the registry read', listing: 'the listing read', subject: 'the subject read' };
const span = (value) => !Number.isFinite(value) ? '—' : Math.abs(value) >= 86400 ? `${(value / 86400).toFixed(1)} days` : Math.abs(value) >= 3600 ? `${(value / 3600).toFixed(1)} hours` : `${Math.round(value)} s`;

/** Both stores, read once and written on every change. */
function useProjects() {
  const [state, setState] = useState(() => ({ projects: loadProjects(), studio: loadStudioStore() }));
  const update = (project) => setState((current) => { const projects = saveProjects(withProject(current.projects, project)); return { ...current, projects }; });
  const updateSession = (session) => setState((current) => ({ ...current, studio: saveStudioStore(withSession(current.studio, session)) }));
  const select = (id) => setState((current) => ({ ...current, projects: saveProjects(selectProject(current.projects, id)) }));
  const remove = (id) => setState((current) => { const projects = saveProjects(removeProject(current.projects, id)); return { ...current, projects }; });
  const reload = () => setState({ projects: loadProjects(), studio: loadStudioStore() });
  return { ...state, update, updateSession, select, remove, reload };
}

function Field({ label, hint, children }) { return <label className="field">{label}{hint && <span className="hint">{hint}</span>}{children}</label>; }

/** The policy draft, field by field; every change is validated by `normalizePolicy` through `policyStatus`. */
function PolicyEditor({ project, view, onChange }) {
  const draft = project.policy;
  const status = policyStatus(project, view);
  const set = (patch) => onChange(updatePolicy(project, patch));
  const reviewers = draft.reviewers.trusted.join('\n');
  return <div className="card-body project-policy">
    <div className="field-row two">
      <Field label="Policy name"><input value={draft.name} maxLength={120} onChange={(event) => set({ name: event.target.value })}/></Field>
      <Field label="Release label" hint="1–31 bytes; the registry release ID is derived from the owner and this label"><input value={project.release.label} maxLength={31} spellCheck="false" onChange={(event) => { try { onChange(setReleaseLabel(project, event.target.value)); } catch { /* keep typing */ } }}/></Field>
    </div>
    <Field label="Trusted reviewers" hint="one H160 address per line; only these decisions count, each once"><textarea rows={2} spellCheck={false} value={reviewers} onChange={(event) => set({ reviewers: { trusted: event.target.value.split(/\s+/).map((item) => item.trim()).filter(Boolean) } })} placeholder="0x…"/></Field>
    <div className="field-row two">
      <Field label="Threshold" hint="approvals needed"><input type="number" min="1" value={draft.reviewers.threshold} onChange={(event) => set({ reviewers: { threshold: Number(event.target.value) || 1 } })}/></Field>
      <Field label="Why these reviewers are trusted, and what that does not establish" hint="required; copied into every evaluation"><input value={draft.reviewers.basis} maxLength={400} onChange={(event) => set({ reviewers: { basis: event.target.value } })} placeholder="A separate account this project names; its control is stated in the roles."/></Field>
    </div>
    {draft.reviewers.confirmed === false && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Imported reviewer trust.</strong> This project was imported with {draft.reviewers.imported?.trusted?.length ?? 0} trusted reviewer(s) declared by the exporter. A checksum does not make a reviewer trustworthy: confirm that naming them is your own policy choice, or edit the list. <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(confirmReviewers(project))}>Confirm these reviewers as my choice</button></div></div>}
    <div className="field-row">
      <Field label="Report age limit (s)" hint="604800 = 7 days"><input type="number" min="1" value={draft.evidence.maxAgeSeconds} onChange={(event) => set({ evidence: { maxAgeSeconds: Number(event.target.value) } })}/></Field>
      <Field label="Read freshness limit (s)" hint="each read's age"><input type="number" min="1" value={draft.evidence.maxObservationAgeSeconds} onChange={(event) => set({ evidence: { maxObservationAgeSeconds: Number(event.target.value) } })}/></Field>
      <Field label="Stored report required"><select value={String(draft.evidence.requireStoredOnChain)} onChange={(event) => set({ evidence: { requireStoredOnChain: event.target.value === 'true' } })}><option value="true">yes (remark.store)</option><option value="false">no</option></select></Field>
    </div>
    <div className="field-row two">
      <Field label="Fresh subject read" hint="re-read symbol, name, decimals and the address mapping on every evaluation"><select value={String(draft.evidence.requireFreshSubject === true)} onChange={(event) => set({ evidence: { requireFreshSubject: event.target.value === 'true' } })}><option value="false">no: metadata from the approved report</option><option value="true">yes: compare the current metadata with the approved report</option></select></Field>
      <p className="muted assurance">{status.complete ? policyAssurance(status.policy).text : 'Complete the policy to see what a valid evaluation will assure about the subject.'}</p>
    </div>
    <div className="field-row">
      <Field label="Consumer contract" hint="the VerifiedTokenList this policy reads"><select value={draft.consumer ? 'yes' : 'no'} onChange={(event) => set({ consumer: event.target.value === 'yes' ? { ...POLICY_DEFAULTS.consumer } : null })}><option value="yes">required: VerifiedTokenList v{POLICY_DEFAULTS.consumer.version}</option><option value="no">not required</option></select></Field>
      {draft.consumer && <Field label="Consumer address"><input value={draft.consumer.address} spellCheck="false" onChange={(event) => set({ consumer: { address: event.target.value.trim() } })}/></Field>}
      {draft.consumer && <Field label="Version"><input type="number" min="1" value={draft.consumer.version} onChange={(event) => set({ consumer: { version: Number(event.target.value) } })}/></Field>}
    </div>
    <p className={status.complete ? 'muted' : 'form-error'}>{status.complete ? <>Policy complete · hash <span className="mono">{short(status.policyHash, 16)}</span><CopyButton value={status.policyHash}/>{view?.submission?.owner ? ` · owner ${short(view.submission.owner, 10)} from this project's submission` : project.release?.owner ? ` · owner ${short(project.release.owner, 10)} declared by the imported bundle; verified against the registry when the project is evaluated` : ' · no owner yet: the submission in the studio establishes it'}</> : <><CircleAlert size={14} aria-hidden="true"/> {status.error}</>}</p>
  </div>;
}

function RolesEditor({ project, onChange }) {
  const set = (role, control) => onChange(updateRoles(project, { [role]: { control } }));
  return <div className="card-body project-roles">
    <p className="muted">Who controls each account, copied into every exported document. Role separation on-chain is not independent review when one party controls both accounts; say so here.</p>
    {['owner', 'reviewer', 'operator'].map((role) => <Field key={role} label={role}><input value={project.roles[role].control} maxLength={300} onChange={(event) => set(role, event.target.value)}/></Field>)}
  </div>;
}

/** The facts the studio established and the candidate they make. */
function Candidate({ project, view }) {
  const { report, storage, submission, review, candidate, missing } = view;
  return <dl className="kv-list compact">
    <div className="kv"><dt>Active report</dt><dd>{report ? <><span className="mono">{report.evidenceHash}</span><CopyButton value={report.evidenceHash}/> · <Badge status={report.status}>{report.status}</Badge> · {report.release} · block #{fmt(report.network?.finalizedBlockNumber)} · {when(report.completedAt)}</> : <span className="muted">none: run the check in the studio or on Check my token</span>}</dd></div>
    <div className="kv"><dt>Stored on-chain</dt><dd>{storage ? <>extrinsic <ChainLink hash={storage.extrinsicHash} kind="extrinsic"/> in #{fmt(storage.blockNumber)}{storage.verified === true ? ' · retrieved and verified' : storage.verified === false ? ' · retrieval not verified' : ''}</> : <span className="muted">not stored in this browser{project.policy.evidence.requireStoredOnChain ? ' (the policy requires it)' : ''}</span>}</dd></div>
    <div className="kv"><dt>Submitted</dt><dd>{submission ? <>“{submission.label}” · release <span className="mono">{short(submission.releaseId, 18)}</span> · revision {submission.revision ?? 'not read back'} · owner <span className="mono">{short(submission.owner, 12)}</span> · #{fmt(submission.blockNumber)}</> : <span className="muted">not submitted in this browser</span>}</dd></div>
    <div className="kv"><dt>Reviewed</dt><dd>{review ? <><Badge status={review.approved ? 'approved' : 'changes-requested'}>{review.approved ? 'approved' : 'changes requested'}</Badge> revision {review.revision} by <span className="mono">{short(review.reviewer, 12)}</span> · #{fmt(review.blockNumber)} (a receipt of this browser; the policy evaluation reads the registry itself)</> : <span className="muted">no review receipt in this browser</span>}</dd></div>
    <div className="kv"><dt>Binding candidate</dt><dd>{candidate ? <><strong>report <span className="mono">{candidate.reportHash}</span></strong> on release <span className="mono">{short(candidate.releaseId, 14)}</span>, revision {candidate.revision}{candidate.storage ? `, stored in ${short(candidate.storage.extrinsicHash, 12)}` : ''}. {candidate.complete ? 'Complete. A candidate is not an approval: binding records what this project relies on; the evaluation says whether it holds.' : `Incomplete: ${missing.join('; ')}.`}</> : <span className="muted">none yet: {missing.join('; ')}</span>}</dd></div>
    {view.declared && <div className="kv declared"><dt>Declared by the imported bundle</dt><dd><Badge status="idle">declaration</Badge> owner <span className="mono">{view.declared.owner ? short(view.declared.owner, 12) : 'none'}</span> · release <span className="mono">{view.declared.releaseId ? short(view.declared.releaseId, 14) : 'none'}</span>{view.declared.submission?.revision ? ` · revision ${view.declared.submission.revision}` : ''}{view.declared.storage?.extrinsicHash ? <> · stored in <ChainLink hash={view.declared.storage.extrinsicHash} kind="extrinsic"/></> : ''}<small className="block">{view.declared.note} Exported {when(view.declared.exportedAt)}; imported {when(view.declared.at)}. Not a receipt of this browser.</small></dd></div>}
    {view.missingEvidence.length > 0 && <div className="kv missing-evidence"><dt>Missing evidence</dt><dd><Badge status="pending">not in this browser</Badge> {view.missingEvidence.map((hash) => <span key={hash} className="mono block">{hash}</span>)}<small className="block">This project references these sealed reports but holds no copy of them; nothing is fabricated in their place. Import the report JSON (Check my token → Import a plan reads plans; the report itself comes from its exporter or from the public reports) to evaluate the binding.</small></dd></div>}
  </dl>;
}

function Bindings({ project }) {
  if (!project.bindings.length) return <p className="muted">No explicit binding yet. The consumer configuration is exported from the latest binding.</p>;
  return <ol className="binding-list">{project.bindings.map((binding, index) => <li key={binding.id}><span className="mono">{short(binding.id, 13)}</span><span>{index === project.bindings.length - 1 ? <Badge status="passed">current</Badge> : <Badge status="idle">history</Badge>} revision {binding.revision} · report <span className="mono">{short(binding.reportHash, 14)}</span>{binding.storage?.extrinsicHash ? <> · stored <ChainLink hash={binding.storage.extrinsicHash} kind="extrinsic"/></> : null}<small className="block">{when(binding.boundAt)} · {binding.boundBy}{binding.note ? ` · ${binding.note}` : ''} · policy {short(binding.policyHash, 10)}</small></span></li>)}</ol>;
}

/** The same evaluator the Catalog decision and the consumer use, on the latest binding, under the current-decision model. */
function Evaluation({ project, view, status }) {
  const binding = view.latestBinding;
  const [decision, setDecision] = useState(() => initialDecision({ selection: { project: project.id, binding: binding?.bindingHash ?? null } }));
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  const [now, setNow] = useState(() => new Date());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { setDecision((current) => changeSelection(current, { project: project.id, binding: binding?.bindingHash ?? null })); }, [project.id, binding?.bindingHash]);
  useEffect(() => {
    const tick = () => { const at = new Date(); setNow(at); setDecision((current) => ageDecision(current, { now: at })); };
    const timer = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
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
  async function evaluateNow() {
    const selection = { project: project.id, binding: binding?.bindingHash ?? null };
    const begun = beginCheck(decisionRef.current, { selection });
    setDecision(begun);
    const request = begun.request;
    try {
      if (!status.complete) throw new Error(status.error);
      if (!binding) throw new Error('Bind the candidate first; the evaluation is of a binding.');
      const report = view.report?.evidenceHash === binding.reportHash ? view.report : null;
      if (!report) throw new Error(`The bound report ${binding.reportHash.slice(0, 12)}… is not the active report of this project's session; make it active (Check my token, or import it) before evaluating.`);
      const policy = status.policy;
      const work = (async () => {
        const api = await engine();
        const inputs = await api.collectPolicyInputs({ policy, binding });
        const evaluation = api.evaluateBinding({ policy, binding, report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence: inputs.evidence, subject: inputs.subject ?? null, now: new Date() });
        return { evaluation, entry: entryDecision(entryFor(project), report), inputs, policy, report };
      })();
      const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`No answer within ${TIMEOUT_MS / 1000} s. The public nodes can be slow; read again.`), { kind: 'timeout' })), TIMEOUT_MS));
      const result = await Promise.race([work, timeout]);
      setNow(new Date());
      setDecision((current) => settleCheck(current, { request, selection, ...result }));
    } catch (error) { setDecision((current) => failCheck(current, { request, selection, error, kind: error?.kind === 'timeout' ? 'timeout' : 'error' })); }
  }
  const permission = checkPermission(decision, { now });
  const described = describeDecision(decision, { subject: 'the entry', now });
  const current = decision.current;
  const codes = current ? [...current.evaluation.reasons.map((reason) => reason.code), ...current.entry.reasons] : [];
  return <div className="card-body">
    <div className="decision-row"><div><p className="decision-verdict">{described.headline}</p><p className="decision-sub">{described.detail}</p></div><div className="decision-facts"><Badge status={STATUS_BADGE[decision.state] || 'idle'}>Current: {described.word}</Badge>{current && <Badge status={current.entry.match ? 'passed' : 'failed'}>{current.entry.match ? 'Entry equals the approved report' : `Entry differs: ${current.entry.mismatches.map((item) => item.field).join(', ')}`}</Badge>}</div></div>
    {permission.allowed && <p className="decision-deadline"><strong>Permission ends {when(permission.validUntil)}</strong> ({LIMIT_WORDS[permission.limitedBy]}; {span(permission.secondsLeft)} left at {when(now)}). <small className="block">{VALIDITY_LIMITS.map((kind) => current.validity.deadlines[kind] ? `${kind}: ${current.validity.deadlines[kind].until ? when(current.validity.deadlines[kind].until) : 'undated'}` : `${kind}: not required`).join(' · ')}</small></p>}
    {current && permission.reason !== 'lapsed' && <dl className="kv-list compact">
      <div className="kv"><dt>Reasons</dt><dd>{codes.length ? <ul className="reason-list">{codes.map((code) => { const reason = explainReason(code); return <li key={code}><code>{code}</code> · {reason.text}<small className="block recovery"><strong>Who acts:</strong> {reason.who}. <strong>Then:</strong> {reason.then}</small></li>; })}</ul> : 'Every policy condition held and the entry equals the approved report.'}</dd></div>
      <div className="kv"><dt>Checkpoints</dt><dd>registry #{fmt(current.inputs?.registry?.block?.number)} · listing #{fmt(current.inputs?.listing?.block?.number)} · observation #{fmt(current.inputs?.observation?.finalized?.number)} · evaluated at {when(current.evaluation.evaluatedAt)} · evaluation <span className="mono">{short(current.evaluation.evaluationHash, 16)}</span></dd></div>
    </dl>}
    {current && permission.reason === 'lapsed' && <p className="muted">The lapsed answer was <strong>{CURRENT_WORDS[current.status]}</strong>, evaluated at {when(current.evaluatedAt)}; its permission ended at {when(current.validity.validUntil ?? current.validity.lapsesAt)}. It permits nothing now.</p>}
    <div className="step-actions"><button type="button" className="btn btn-primary" onClick={evaluateNow} disabled={decision.state === 'checking'}>{decision.state === 'checking' ? <LoaderCircle className="spin" size={15} aria-hidden="true"/> : <RefreshCw size={15} aria-hidden="true"/>}{decision.state === 'checking' ? 'Evaluating…' : current ? 'Refresh status' : 'Evaluate now'}</button><span className="muted">Fresh reads of the registry, the consumer and the network at the current finalized block, through both interfaces; the stored report is retrieved when the policy requires it. Nothing is signed.</span></div>
    {decision.state === 'checking' && <div className="working" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true"/><div><strong>Reading the registry, the token list, the stored report and the finalized head…</strong><span>{elapsed ? `${elapsed} s` : ''}{elapsed > 8 ? ' · the public node can take up to a minute on first contact' : ''}</span></div></div>}
    {decision.error && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div><strong>Nothing was evaluated.</strong> {decision.error.message}</div></div>}
    {decision.lastVerified && <p className="muted"><small>Last verified in this browser: {when(decision.lastVerified.evaluatedAt)} · permitted until {when(decision.lastVerified.validUntil)} · a past valid result is not a current permission.</small></p>}
  </div>;
}

function ProjectDetail({ store, project }) {
  const session = useMemo(() => sessionFor(store.studio, studioProject(project)), [store.studio, project.id]);
  const view = useMemo(() => projectView(project, session), [project, session]);
  const status = policyStatus(project, view);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [boundBy, setBoundBy] = useState('the visitor running this browser (project operator)');
  const [note, setNote] = useState('');
  const fileInput = useRef();
  const report = view.report;
  const say = (text) => { setNotice(text); setError(''); };
  const fail = (text) => { setError(text); setNotice(''); };
  function bind() {
    try { const { project: next, binding } = bindCandidate(project, { view, report, boundBy, note }); store.update(next); say(`Bound: ${binding.id} names report ${binding.reportHash.slice(0, 12)}… on revision ${binding.revision}.`); } catch (reason) { fail(reason.message); }
  }
  function exportConfig() {
    try { const config = consumerConfigFor(project, view); downloadJson(config, `revivecheck-consumer-config-${project.release.label}-${config.release.revision}.json`); say('Consumer configuration exported: the Token eligibility demo and the catalog release gate read this document as their config/allowlist.json.'); } catch (reason) { fail(reason.message); }
  }
  function exportProject() {
    const reports = [report, session.check?.report, session.recheck?.report].filter(Boolean);
    downloadJson(exportBundle(project, view, { reports }), `revivecheck-project-${project.id}.json`);
    say('Project bundle exported. Its fingerprints are recomputed on import; chain evidence is verified by evaluating, not by importing.');
  }
  function openStudio() { activateProject(project.id); location.hash = '#/app/run'; }
  return <>
    <div className="page-head">
      <div><h1>{project.name}</h1><p>{project.kind === 'demo' ? 'The demonstration project: the pUSD token list the studio has always run. Its two releases are chosen in the studio; its policy and bindings here are yours to edit, like any project.' : `Your browser-local project for ${project.plan.listing.symbol} (asset ${project.plan.nativeAsset.assetId}) on the V3 testnet.`} Plan fingerprint <span className="mono">{short(project.planHash, 12)}</span> · release artifact <span className="mono">{short(project.releaseArtifactHash, 12)}</span>.</p></div>
      <div className="step-actions"><button type="button" className="btn btn-primary" onClick={openStudio}><Play size={15} aria-hidden="true"/>Open in the studio</button><a className="btn btn-secondary" href="#/app/projects">All projects</a></div>
    </div>
    {notice && <p className="form-ok block" role="status">{notice}</p>}
    {error && <div className="form-error block" role="alert"><CircleAlert size={15} aria-hidden="true"/><div>{error}</div></div>}
    <div className="project-grid">
      <section className="card" aria-labelledby="facts-title">
        <div className="card-head"><h2 id="facts-title">What the studio established, and the candidate</h2><span className="card-note">from this project's own session</span></div>
        <div className="card-body"><Candidate project={project} view={view}/>
          <div className="field-row two"><Field label="Bound by" hint="who makes this binding, and whether the account is project-controlled"><input value={boundBy} maxLength={160} onChange={(event) => setBoundBy(event.target.value)}/></Field><Field label="Note"><input value={note} maxLength={400} onChange={(event) => setNote(event.target.value)}/></Field></div>
          <div className="step-actions"><button type="button" className="btn btn-primary" disabled={!view.candidate?.complete || !status.complete} onClick={bind}>Bind the candidate explicitly</button><span className="muted">{!status.complete ? 'Complete the policy first.' : !view.candidate?.complete ? 'The candidate is incomplete.' : 'Records an explicit binding under the current policy; the earlier ones stay as history.'}</span></div>
        </div>
      </section>
      <section className="card" aria-labelledby="policy-title">
        <div className="card-head"><h2 id="policy-title">Policy</h2><span className="card-note">revivecheck.policy.v1 · validated as you type</span></div>
        <PolicyEditor project={project} view={view} onChange={store.update}/>
      </section>
      <section className="card" aria-labelledby="roles-title">
        <div className="card-head"><h2 id="roles-title">Roles</h2><span className="card-note">copied into every export</span></div>
        <RolesEditor project={project} onChange={store.update}/>
      </section>
      <section className="card" aria-labelledby="bindings-title">
        <div className="card-head"><h2 id="bindings-title">Bindings</h2><span className="card-note">append-only · {project.bindings.length}</span></div>
        <div className="card-body"><Bindings project={project}/></div>
      </section>
      <section className="card" aria-labelledby="evaluate-title">
        <div className="card-head"><h2 id="evaluate-title">Current decision under this policy</h2><span className="card-note">the latest binding, evaluated on fresh reads</span></div>
        <Evaluation project={project} view={view} status={status}/>
      </section>
      <section className="card" aria-labelledby="export-title">
        <div className="card-head"><h2 id="export-title">Export</h2><span className="card-note">portable files · nothing is uploaded</span></div>
        <div className="card-body">
          <div className="step-actions"><button type="button" className="btn btn-secondary" onClick={exportConfig}><Download size={14} aria-hidden="true"/>Consumer configuration</button><button type="button" className="btn btn-secondary" onClick={exportProject}><Download size={14} aria-hidden="true"/>Project bundle</button>{report && <button type="button" className="btn btn-secondary" onClick={() => downloadJson(report, `revivecheck-${report.release}-${report.evidenceHash.slice(0, 12)}.json`)}><Download size={14} aria-hidden="true"/>Active report</button>}</div>
          <p className="muted">The consumer configuration (<code>revivecheck-consumer.config.v1</code>) is read by the separate Token eligibility demo and by the catalog release gate; it names this policy, the bound report, release and revision, the storage locator, the entry and the roles. The bundle (<code>revivecheck.project-bundle.v1</code>) carries the project's declarations and references; a local file is not proof of hosting or delivery.</p>
          <dl className="kv-list compact"><div className="kv"><dt>Entry</dt><dd className="mono">{JSON.stringify(entryFor(project))}</dd></div></dl>
          <details className="own-import"><summary>Renewal, role by role</summary><ol className="steps">{RENEWAL_STEPS.map((step) => <li key={step.step}><b>{step.role}</b>: {step.action}</li>)}</ol></details>
        </div>
      </section>
    </div>
  </>;
}

function ProjectList({ store }) {
  const projects = listProjects(store.projects);
  const [name, setName] = useState('');
  const [importError, setImportError] = useState('');
  const [importText, setImportText] = useState('');
  const fileInput = useRef();
  function applyImport(text) {
    try {
      const imported = importBundle(text);
      // An id in use stays untouched: the import becomes a separate project.
      const project = store.projects.projects[imported.project.id] ? { ...imported.project, id: `${imported.project.id}-${Date.now().toString(36)}`, name: `${imported.project.name} (imported)` } : imported.project;
      const { sealedReports } = imported;
      store.update(project);
      // The sealed report the bindings name becomes the active report of the new project's own session (an intact artifact, verified by its hash); nothing else is created for it: no receipt, no approval, no storage.
      const active = sealedReports.find((item) => project.bindings.at(-1)?.reportHash === item.evidenceHash) ?? sealedReports.at(-1);
      if (active) { const session = recordImport(sessionFor(store.studio, studioProject(project)), { plan: project.plan, report: active }); store.updateSession(session); }
      setImportError(''); setImportText('');
      location.hash = `#/app/projects/${encodeURIComponent(project.id)}`;
    } catch (error) { setImportError(error.message); }
  }
  async function readFile(event) { const file = event.target.files?.[0]; if (!file) return; try { applyImport(await file.text()); } catch (error) { setImportError(error.message); } event.target.value = ''; }
  return <>
    <div className="page-head"><div><h1>My projects</h1><p>Your browser-local projects: each one is a supported release with its own policy, reviewer trust, release identity, storage locator, binding candidate and bindings. Nothing here leaves the browser unless you export it; nothing needs a login or a wallet to read.</p></div><a className="btn btn-primary" href="#/app/check">New project from Check my token<ArrowRight size={15} aria-hidden="true"/></a></div>
    <section className="card" aria-label="Projects">
      <ul className="projects-list">{projects.map((project) => { const session = sessionFor(store.studio, studioProject(project)); const view = projectView(project, session); const status = policyStatus(project, view); return <li key={project.id}>
        <a href={`#/app/projects/${encodeURIComponent(project.id)}`}><FolderKanban size={16} aria-hidden="true"/><span><strong>{project.name}</strong>{project.kind === 'demo' && <Badge status="idle">demonstration</Badge>}<small className="block">{project.plan.listing.symbol} · asset {project.plan.nativeAsset.assetId} · plan {short(project.planHash, 10)} · label “{project.release.label}” · {project.reports.length} report{project.reports.length === 1 ? '' : 's'} · {project.bindings.length} binding{project.bindings.length === 1 ? '' : 's'}</small></span></a>
        <span className="project-state">{view.report ? <Badge status={view.report.status}>{view.report.status}</Badge> : <Badge status="idle">no report</Badge>}<Badge status={status.complete ? 'passed' : 'pending'}>{status.complete ? 'policy complete' : 'policy incomplete'}</Badge>{view.candidate?.complete ? <Badge status="finalized">candidate ready</Badge> : null}{store.projects.activeProjectId === project.id ? <Badge status="approved">active in the studio</Badge> : <button type="button" className="text-link" onClick={() => store.select(project.id)}>Make active</button>}{project.kind !== 'demo' && <button type="button" className="text-link danger" onClick={() => { if (confirm(`Remove ${project.name} from this browser? Its on-chain records stay on-chain; its session is kept until cleared in the studio.`)) store.remove(project.id); }}><Trash2 size={13} aria-hidden="true"/></button>}</span>
      </li>; })}</ul>
    </section>
    <section className="card" aria-labelledby="import-title">
      <div className="card-head"><h2 id="import-title">Import a project bundle</h2><span className="card-note">revivecheck.project-bundle.v1</span></div>
      <div className="card-body">
        <p className="muted">The plan is validated like any plan the checker accepts, the fingerprints are recomputed, every binding and sealed report is verified. Reviewer trust in the bundle is the exporter's declaration: it is held apart until you confirm it as your own choice.</p>
        <textarea className="import-area" rows={4} spellCheck={false} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder='{"schema":"revivecheck.project-bundle.v1", …}' aria-label="Bundle JSON"/>
        <div className="step-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => applyImport(importText)} disabled={!importText.trim()}><Upload size={14} aria-hidden="true"/>Import from text</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>Choose a file…</button><input ref={fileInput} type="file" accept="application/json,.json" onChange={readFile} hidden/></div>
        {importError && <div className="form-error" role="alert"><CircleAlert size={15} aria-hidden="true"/><span>{importError}</span></div>}
      </div>
    </section>
  </>;
}

export default function ProjectsPage() {
  const sub = useSubRoute('#/app/projects');
  const store = useProjects();
  const id = sub ? decodeURIComponent(sub) : '';
  const project = id ? store.projects.projects[id] : null;
  if (id && !project) return <div className="page-head"><div><h1>No such project</h1><p>This browser has no project <span className="mono">{id}</span>. <a href="#/app/projects">All projects</a>.</p></div></div>;
  return project ? <ProjectDetail store={store} project={project}/> : <ProjectList store={store}/>;
}
