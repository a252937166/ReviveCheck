// The studio's session, as one explicit state machine with ONE active report. Every
// badge, prepared transaction, submission, review and completion the studio shows is
// derived from the stage receipts that name the active report, the active submission
// and the registry's current revision; nothing is derived from the mere presence of a
// receipt. A new check, a new recheck or an imported report replaces the active report
// whatever its status (a failed check never falls back to an older passing report), and
// every stage bound to the previous report moves to the session's history, where it
// stays as what it was. An asynchronous answer that names another report than the one
// active when it arrives is history too, never the completion of the current operation.
//
// Pure functions over plain objects, so the same transitions run in a browser, in Node
// and in a test. The browser store (`loadStudioStore`, `saveStudioStore`) keeps one
// session per browser-local project under `revivecheck.studio.v2`; the earlier flat
// session (`revivecheck.studio.v1`) is migrated once, with every stage that cannot be
// tied to one explicit report filed as history.
//
// Asynchronous answers are fenced (repair handoff 2026-10-26, R-05): a request carries
// the project it started in and a generation; a read answer that is not the latest
// request of its project and stage is discarded, a write receipt or a readback is routed
// to the session of its ORIGIN project whatever project is active when it arrives, a
// readback attaches only to the receipt of its own transaction, and a receipt replaced by
// a later transaction of the same stage moves to the history instead of vanishing. A
// failure after a transaction was handed to the network leaves its result uncertain: the
// studio shows a stop and never signs it again on its own.
import { describeListReceipt, describeReviewReceipt } from './receipts.js';

export const SESSION_SCHEMA = 'revivecheck.studio-session.v2';
export const STORE_SCHEMA = 'revivecheck.studio-store.v1';
export const STORE_KEY = 'revivecheck.studio.v2';
export const LEGACY_KEY = 'revivecheck.studio.v1';
export const DEMO_PROJECT = Object.freeze({ id: 'demo-pusd-token-list', name: 'pUSD token list', kind: 'demo' });
/** Every stage the studio records. `check` holds the first report; the rest are bound to the active report. */
export const STAGE_KEYS = Object.freeze(['check', 'recheck', 'replay', 'store', 'submit', 'approve', 'remark', 'verified', 'consume', 'promote', 'watch']);
/** The stages that belong to one report: archived when the active report changes. `verified` is a lookup, not a receipt, and is kept. */
export const REPORT_BOUND = Object.freeze(['recheck', 'replay', 'store', 'submit', 'approve', 'remark', 'consume', 'promote', 'watch']);

const lower = (value) => String(value ?? '').toLowerCase();
const bare = (hash) => lower(hash).replace(/^0x/, '');
const sameHash = (a, b) => !!a && !!b && bare(a) === bare(b);
const empty = Object.freeze(Object.fromEntries(STAGE_KEYS.map((key) => [key, null])));

/** A fresh session for one project. */
export function emptySession(project = DEMO_PROJECT, { createdAt = new Date().toISOString() } = {}) {
  if (!project?.id) throw new Error('A session belongs to a project with an id.');
  return { schema: SESSION_SCHEMA, project: { id: project.id, name: project.name ?? project.id, kind: project.kind ?? 'own', ...(project.plan ? { plan: project.plan } : {}) }, active: null, ...empty, history: [], createdAt, updatedAt: createdAt };
}

/** The identity a stage is bound to: the report, its release, result and fingerprints. */
export function reportIdentity(report) {
  if (!report?.evidenceHash) return null;
  return { reportHash: report.evidenceHash, release: report.release ?? null, status: report.status, projectId: report.projectId ?? null, planHash: report.binding?.planHash ?? null, releaseArtifactHash: report.binding?.releaseArtifactHash ?? null, completedAt: report.completedAt ?? null, blockNumber: report.network?.finalizedBlockNumber ?? null };
}

/** The report hash a stage receipt names, or null when it names none. */
export function stageReportHash(key, value) {
  if (!value || typeof value !== 'object') return null;
  switch (key) {
    case 'check': case 'recheck': return value.report?.evidenceHash ?? null;
    case 'replay': return value.reportHash ?? null;
    case 'store': return value.reportHash ?? null;
    case 'submit': return value.reportHash ?? null;
    case 'approve': return value.reportHash ? bare(value.reportHash) : null;
    case 'remark': return value.reportHash ?? value.verification?.reportHash ?? null;
    case 'consume': return value.reportHash ? bare(value.reportHash) : null;
    case 'promote': return value.from ?? null;
    case 'watch': return value.comparison?.baselineHash ?? null;
    default: return null;
  }
}

/** The active report itself (the check or recheck report the active identity names), or null. */
export function activeReport(session) {
  const hash = session?.active?.reportHash;
  if (!hash) return null;
  return [session.recheck?.report, session.check?.report].find((report) => report?.evidenceHash === hash) ?? null;
}
/** The active report when it passed; the write steps start from nothing else. */
export const passedActiveReport = (session) => { const report = activeReport(session); return report?.status === 'passed' ? report : null; };
/** The plan the active report was made on (its sealed input), or the project's plan. */
export const activePlan = (session) => activeReport(session)?.input ?? session?.project?.plan ?? null;

function archive(session, reason, keys, at) {
  const stages = Object.fromEntries(keys.filter((key) => session[key] !== null && session[key] !== undefined).map((key) => [key, session[key]]));
  const cleared = Object.fromEntries(keys.map((key) => [key, null]));
  if (!Object.keys(stages).length) return { ...session, ...cleared };
  return { ...session, ...cleared, history: [...(session.history || []), { archivedAt: at, reason, active: session.active, stages }] };
}

/** A check answered: it is the active report now, whatever its result. Every stage bound to the previous report is history. */
export function recordCheck(session, { choice, custom = null, report, at = new Date().toISOString(), source = 'check' }) {
  if (!report?.evidenceHash) throw new Error('A check records a sealed report.');
  const next = archive(session, `a new check (${report.release ?? 'release'}, ${report.status}) replaced the active report`, [...REPORT_BOUND, 'check'], at);
  return { ...next, check: { choice, custom, report }, active: { ...reportIdentity(report), source, at }, updatedAt: at };
}

/** A recheck answered: it is the active report now, whatever its result; the first report stays as the comparison baseline. */
export function recordRecheck(session, { choice, custom = null, report, comparison = null, at = new Date().toISOString() }) {
  if (!report?.evidenceHash) throw new Error('A recheck records a sealed report.');
  if (!session.check?.report) throw new Error('A recheck compares against the check report; run a check first.');
  const next = archive(session, `a recheck (${report.release ?? 'release'}, ${report.status}) replaced the active report`, REPORT_BOUND, at);
  return { ...next, recheck: { choice, custom, report, comparison }, active: { ...reportIdentity(report), source: 'recheck', at }, updatedAt: at };
}

/** A report handed over from Check my token: the active report of this project's session, with nothing carried over from an earlier one. The same report handed over again changes nothing. */
export function recordImport(session, { plan, report, at = new Date().toISOString() }) {
  if (!report?.evidenceHash) throw new Error('An import records a sealed report.');
  if (sameHash(session?.active?.reportHash, report.evidenceHash)) return { ...session, updatedAt: at };
  const custom = plan ? { symbol: plan.listing?.symbol, name: plan.listing?.name, decimals: plan.listing?.decimals, plan } : null;
  return recordCheck(session, { choice: 'own', custom, report, at, source: 'import' });
}

/**
 * A stage receipt or readback arrived. It is applied only when it names the active
 * report (or names none and the stage is not report-bound); an answer for another
 * report is filed in the history as an orphan, and the current stage is untouched.
 * `value` may be an updater over the current stage value, as React's setState allows.
 */
export function applyStage(session, key, value, { at = new Date().toISOString() } = {}) {
  if (!STAGE_KEYS.includes(key)) throw new Error(`Unknown stage ${key}.`);
  if (key === 'check' || key === 'recheck') throw new Error(`${key} is recorded with recordCheck or recordRecheck.`);
  const next = typeof value === 'function' ? value(session[key]) : value;
  if (next === null || next === undefined) return { ...session, [key]: null, updatedAt: at };
  const named = stageReportHash(key, next);
  if (REPORT_BOUND.includes(key)) {
    if (!session.active) return { ...session, history: [...(session.history || []), { archivedAt: at, reason: `${key} answered while no report was active`, active: null, stages: { [key]: next } }], updatedAt: at };
    if (named && !sameHash(named, session.active.reportHash)) return { ...session, history: [...(session.history || []), { archivedAt: at, reason: `${key} answered for report ${bare(named).slice(0, 12)}…, not the active ${session.active.reportHash.slice(0, 12)}…`, active: session.active, stages: { [key]: next } }], updatedAt: at };
  }
  // A finalized receipt replaced by a later transaction of the same stage is history, never dropped: both transactions happened.
  const current = session[key];
  const replaces = current?.tx && next.tx && txHash(current.tx) && txHash(current.tx) !== txHash(next.tx);
  const history = replaces ? [...(session.history || []), { archivedAt: at, reason: `${key} receipt ${txHash(current.tx).slice(0, 12)}… replaced by a later ${key} (${txHash(next.tx).slice(0, 12)}…); the earlier transaction stays as history`, active: session.active, stages: { [key]: current } }] : (session.history || []);
  return { ...session, [key]: next, history, updatedAt: at };
}
const txHash = (tx) => lower(tx?.extrinsicHash ?? tx?.txHash ?? '');

/**
 * A readback (registry read, retrieval, attestation verification) for ONE transaction,
 * named by its extrinsic hash: it attaches to the current receipt of the stage when that
 * receipt is the same transaction, to the historical receipt of that transaction when a
 * later one replaced it, and otherwise is filed as an orphan. It never attaches to another
 * transaction, and never makes a historical receipt current.
 */
export function recordReadback(session, key, { extrinsicHash, patch }, { at = new Date().toISOString() } = {}) {
  if (!REPORT_BOUND.includes(key)) throw new Error(`${key} has no transaction readback.`);
  const hash = lower(extrinsicHash);
  if (!hash) throw new Error('A readback names the extrinsic it belongs to.');
  const current = session[key];
  if (current?.tx && txHash(current.tx) === hash) return { ...session, [key]: { ...current, ...patch }, updatedAt: at };
  const history = [...(session.history || [])];
  const index = history.findIndex((entry) => entry.stages?.[key]?.tx && txHash(entry.stages[key].tx) === hash);
  if (index >= 0) { history[index] = { ...history[index], stages: { ...history[index].stages, [key]: { ...history[index].stages[key], ...patch } } }; return { ...session, history, updatedAt: at }; }
  return { ...session, history: [...history, { archivedAt: at, reason: `${key} readback for extrinsic ${hash.slice(0, 12)}… arrived with no matching receipt in this session; kept as history, attached to nothing`, active: session.active, stages: { [key]: { readbackOnly: true, extrinsicHash: hash, ...patch } } }], updatedAt: at };
}

/** The stages whose answer is a read: a superseded request's answer is discarded. A write receipt is never discarded. */
export const READ_STAGES = Object.freeze(['check', 'recheck', 'replay', 'promote', 'watch', 'verified']);
/** A fence over asynchronous requests: per project and stage, only the latest-started request may answer. */
export const createRequestFence = () => ({ latest: Object.create(null) });
export function beginRequest(fence, projectId, key) { const id = `${projectId}:${key}`; const generation = (fence.latest[id] ?? 0) + 1; fence.latest[id] = generation; return Object.freeze({ projectId, key, generation }); }
export const requestIsCurrent = (fence, token) => fence.latest[`${token.projectId}:${token.key}`] === token.generation;
/** Every request of a project is superseded (a reset): their answers are discarded when they arrive. */
export function supersedeRequests(fence, projectId) { for (const id of Object.keys(fence.latest)) if (id.startsWith(`${projectId}:`)) fence.latest[id] += 1; }

/** The stages at which a failure leaves the transaction's fate unknown: it was handed to the network and may still be included. */
export const UNCERTAIN_STAGES = Object.freeze(['submitted', 'in-block']);
/** A transaction failure as the studio records it: where it failed, whether the send is uncertain, and what that means. An uncertain send is a stop condition, never a retry. */
export function txFailure(current, error) {
  const failedAt = current?.stage && current.stage !== 'idle' && current.stage !== 'error' ? current.stage : (current?.failedAt ?? 'signing');
  const uncertain = UNCERTAIN_STAGES.includes(failedAt);
  const note = uncertain ? 'The transaction was handed to the network and its result could not be established; it may still be included. Do not sign it again until the chain has been read: a second signature is a second transaction.' : failedAt === 'finalized' || failedAt === 'readback' ? 'The transaction is final; only the readback failed. Read again; nothing needs to be signed.' : 'Nothing was sent.';
  return { ...(current || {}), stage: 'error', failedAt, uncertain, error: String(error?.message || error || 'The transaction failed.'), note };
}

/** The studio session is cleared; the project identity stays. */
export const clearSession = (session, { at = new Date().toISOString() } = {}) => emptySession(session.project, { createdAt: at });

/**
 * How each stage stands for the ACTIVE report. `context` carries the network, the
 * consumer deployment and, when known, the registry's current revision of the active
 * submission, so a receipt on a superseded revision reads as history.
 */
export function stepStatuses(session, { network, consumer, registry = null } = {}) {
  const active = session.active, report = activeReport(session), passed = report?.status === 'passed';
  const word = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', unknown: 'Unknown', inconclusive: 'Inconclusive' };
  const bound = (key) => session[key] && sameHash(stageReportHash(key, session[key]) ?? active?.reportHash, active?.reportHash) ? session[key] : null;
  const submit = bound('submit');
  // A review receipt is current only when it names the active report, the active submission's release and the registry's current revision.
  const approve = bound('approve');
  const review = describeReviewReceipt(approve, { releaseId: submit?.releaseId ?? approve?.releaseId, release: registry?.release?.exists ? registry.release : null });
  const remark = bound('remark');
  const listing = describeListReceipt(bound('consume'), { network, consumer, token: session.consume?.token, releaseId: submit?.releaseId, reviewer: session.consume?.reviewer, release: registry?.release?.exists ? registry.release : approve?.tx && review.kind === 'current' ? { reportHash: approve.reportHash, revision: approve.revision } : null });
  const store = bound('store'), replay = bound('replay'), promote = bound('promote'), watch = bound('watch');
  return {
    check: session.check?.report ? [session.check.report.status, word[session.check.report.status] || session.check.report.status, session.check.report.evidenceHash] : ['idle', 'Start here', null],
    recheck: session.recheck?.report ? [session.recheck.report.status, word[session.recheck.report.status] || session.recheck.report.status, session.recheck.report.evidenceHash] : session.check?.report ? ['idle', 'Ready', null] : ['locked', 'After Check', null],
    store: store ? ['passed', store.retrieved?.verified ? 'On-chain' : 'Finalized', store.reportHash] : replay ? [replay.status, 'Replayed', replay.reportHash] : passed ? ['idle', 'Wallet', null] : ['locked', 'Needs a pass', null],
    submit: submit?.tx ? ['finalized', submit.readback ? `Revision ${submit.readback.release.revision}` : 'Finalized', submit.reportHash] : passed ? ['idle', 'Wallet', null] : ['locked', 'Needs a pass', null],
    approve: approve?.tx && review.kind === 'current' ? [approve.approved ? 'approved' : 'changes-requested', approve.approved ? 'Approved' : 'Changes', bare(approve.reportHash)]
      : approve?.tx ? ['idle', 'Historical', bare(approve.reportHash)]
        : remark?.verification?.verified ? ['approved', 'Remark', remark.reportHash]
          : submit?.tx ? ['idle', 'Wallet', null] : ['locked', 'After Submit', null],
    consume: listing.kind === 'current' ? (listing.completion === 'failed' ? ['failed', 'Failed', bare(session.consume.reportHash)] : listing.listed ? ['approved', 'Listed', bare(session.consume.reportHash)] : ['finalized', 'Finalized', bare(session.consume.reportHash)])
      : listing.kind === 'historical' ? ['idle', 'Historical', bare(session.consume?.reportHash)]
        : approve?.tx && approve.approved && review.kind === 'current' ? ['idle', 'Wallet', null] : ['locked', 'After Approve', null],
    promote: promote?.report ? [promote.report.status === 'passed' ? 'passed' : 'refused', promote.report.status === 'passed' ? 'Can stand' : 'Refused', promote.from] : passed ? ['idle', 'Ready', null] : ['locked', 'Needs a pass', null],
    watch: watch?.report ? [watch.report.status, 'Rechecked', watch.comparison?.baselineHash ?? null] : ['idle', 'Live', null],
  };
}

/**
 * The completion of the lifecycle for the active report: the submission and the
 * approval both name the active report, the approval names the active submission's
 * release, and (when a registry read is given) the registry still holds that revision.
 */
export function completion(session, context = {}) {
  const statuses = stepStatuses(session, context);
  const active = session.active;
  const submit = session.submit, approve = session.approve;
  if (!active || !submit?.tx || !approve?.tx || !approve.approved) return null;
  if (!sameHash(submit.reportHash, active.reportHash) || !sameHash(approve.reportHash, active.reportHash) || lower(approve.releaseId) !== lower(submit.releaseId)) return null;
  if (statuses.approve[0] !== 'approved') return null;
  return { reportHash: active.reportHash, release: active.release, label: submit.label, releaseId: submit.releaseId, revision: approve.revision, submit, approve, store: statuses.store[0] === 'passed' ? session.store : null, listed: statuses.consume[0] === 'approved' ? session.consume : null, promote: statuses.promote[2] === active.reportHash ? session.promote : null };
}

/** The rows of the session ledger: every receipt the browser holds for the active report, then the history. */
export function ledgerRows(session) {
  const rows = [];
  for (const key of STAGE_KEYS) if (session[key]) rows.push({ key, value: session[key], active: !REPORT_BOUND.includes(key) || sameHash(stageReportHash(key, session[key]) ?? session.active?.reportHash, session.active?.reportHash) });
  return rows;
}

/**
 * Migrate the flat v1 session (`revivecheck.studio.v1`) into one explicit-report session.
 * The active report is the most recently completed of the check and recheck reports;
 * stages that name it are kept, every other stage is history, and a stage whose
 * identity cannot be established is history too, never "unverified but current".
 */
export function migrateSession(raw, project = DEMO_PROJECT, { at = new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptySession(project, { createdAt: at });
  if (raw.schema === SESSION_SCHEMA) return { ...emptySession(raw.project ?? project, { createdAt: raw.createdAt ?? at }), ...raw, history: Array.isArray(raw.history) ? raw.history : [] };
  const reports = [raw.check?.report, raw.recheck?.report].filter((report) => report?.evidenceHash);
  const latest = [...reports].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0] ?? null;
  const ownProject = raw.check?.choice === 'own' && raw.check?.custom?.plan ? { id: `own-${bare(raw.check.custom.plan.logicalContractId ?? raw.check.custom.plan.name ?? 'project').replace(/[^a-z0-9._-]+/g, '-').slice(0, 60)}`, name: raw.check.custom.plan.name, kind: 'own', plan: raw.check.custom.plan } : null;
  let session = emptySession(ownProject ?? project, { createdAt: at });
  if (!latest) return session;
  session = { ...session, check: raw.check?.report ? { choice: raw.check.choice, custom: raw.check.custom ?? null, report: raw.check.report } : null, recheck: raw.recheck?.report ? { choice: raw.recheck.choice, custom: raw.recheck.custom ?? null, report: raw.recheck.report, comparison: raw.recheck.comparison ?? null } : null, active: { ...reportIdentity(latest), source: raw.recheck?.report?.evidenceHash === latest.evidenceHash ? 'recheck' : 'check', at, migrated: true } };
  for (const key of REPORT_BOUND.filter((stage) => stage !== 'recheck')) {
    if (!raw[key]) continue;
    const named = stageReportHash(key, raw[key]);
    if (named && sameHash(named, latest.evidenceHash)) session = { ...session, [key]: raw[key] };
    else session = { ...session, history: [...session.history, { archivedAt: at, reason: named ? `${key} from the earlier session named report ${bare(named).slice(0, 12)}…, not the active ${latest.evidenceHash.slice(0, 12)}…` : `${key} from the earlier session named no report; kept as history, not as a current result`, active: session.active, stages: { [key]: raw[key] } }] };
  }
  if (raw.verified) session = { ...session, verified: raw.verified };
  return session;
}

// ---- The browser store: one session per browser-local project ----

/** Read the store, migrating the earlier flat session once. `storage` is injectable for tests. */
export function loadStudioStore({ storage = globalThis.localStorage, at = new Date().toISOString() } = {}) {
  let store = null;
  try { store = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null'); } catch { store = null; }
  if (!store || store.schema !== STORE_SCHEMA || typeof store.sessions !== 'object' || store.sessions === null) store = { schema: STORE_SCHEMA, activeProjectId: DEMO_PROJECT.id, sessions: {} };
  let legacy = null;
  try { legacy = JSON.parse(storage?.getItem(LEGACY_KEY) ?? 'null'); } catch { legacy = null; }
  if (legacy && typeof legacy === 'object' && Object.keys(legacy).length) {
    const migrated = migrateSession(legacy, DEMO_PROJECT, { at });
    if (!store.sessions[migrated.project.id]) store.sessions[migrated.project.id] = migrated;
    store.activeProjectId = store.activeProjectId ?? migrated.project.id;
    store.migratedFrom = { key: LEGACY_KEY, at };
    try { storage?.removeItem(LEGACY_KEY); } catch { /* the legacy session stays; it is ignored from now on */ }
    saveStudioStore(store, { storage });
  }
  return store;
}
export function saveStudioStore(store, { storage = globalThis.localStorage } = {}) {
  try { storage?.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* the store lives in memory only */ }
  return store;
}
/** The session of one project, created empty when absent. */
export function sessionFor(store, project) {
  const existing = store.sessions[project.id];
  if (!existing) return emptySession(project);
  const migrated = migrateSession(existing, project);
  // The session's project identity follows the project record (its name, kind and CURRENT plan); the receipts and the active report are the session's own.
  return { ...migrated, project: { ...migrated.project, id: project.id, ...(project.name ? { name: project.name } : {}), ...(project.kind ? { kind: project.kind } : {}), ...(project.plan ? { plan: project.plan } : {}) } };
}
export function withSession(store, session) {
  return { ...store, sessions: { ...store.sessions, [session.project.id]: session } };
}
