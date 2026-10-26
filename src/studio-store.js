// The browser's two stores behind the studio and My projects, and the hand-offs between
// them: the project records (src/projects.js) and one studio session per project
// (src/studio-state.js). Browser-only by default (`storage` defaults to localStorage) and
// injectable for tests; the pure transitions live in those modules. Every asynchronous
// answer of the studio is applied here to the session of the project it STARTED in, read
// from the store at the moment it arrives (repair handoff 2026-10-26, R-05): the project
// active on screen at that moment is irrelevant.
import { loadProjects, saveProjects, withProject, selectProject, createProject, adoptPlan, noteReport, studioProject, listProjects } from './projects.js';
import { loadStudioStore, saveStudioStore, sessionFor, withSession, recordImport, recordCheck, recordRecheck, recordReadback, applyStage } from './studio-state.js';

const browser = () => globalThis.localStorage;

/** The active project record and its studio session, read from the browser. */
export function readStudio({ storage = browser() } = {}) {
  const projects = loadProjects({ storage });
  const studio = loadStudioStore({ storage });
  const project = projects.projects[projects.activeProjectId];
  return { projects, studio, project, session: sessionFor(studio, studioProject(project)) };
}

/** Persist one project's session. */
export function writeSession(session, { storage = browser() } = {}) {
  const studio = loadStudioStore({ storage });
  return saveStudioStore(withSession(studio, session), { storage });
}

/** Persist one project record. */
export function writeProject(project, { storage = browser() } = {}) {
  return saveProjects(withProject(loadProjects({ storage }), project), { storage });
}

/** Make another project the active one (its own session, its own policy; nothing is shared). */
export function activateProject(id, { storage = browser() } = {}) {
  return saveProjects(selectProject(loadProjects({ storage }), id), { storage });
}

/**
 * "Use this report in my project": the browser-local project this plan belongs to is
 * created, or found when it already exists for the same name and acceptance plan. Either
 * way the adopted plan becomes the project's CURRENT release content (plan and both
 * fingerprints, from the adopted input, validated against the report), the report is
 * noted in the project and made the active report of its studio session (every receipt
 * of the earlier active report moves to the history), and the project is activated. The
 * project's identity, policy, roles, label, references and bindings stay; nothing from
 * any other project is carried over, and nothing inherits an approval.
 */
export function adoptReport({ plan, report, projectName = plan?.name, at = new Date().toISOString(), storage = browser() }) {
  let projects = loadProjects({ storage });
  const candidate = createProject({ name: projectName, plan, at });
  const existing = projects.projects[candidate.id];
  let project = adoptPlan(existing ?? candidate, { plan, report, at });
  project = noteReport(project, report, { source: existing ? 'check' : 'import', at });
  projects = selectProject(withProject(projects, project), project.id);
  saveProjects(projects, { storage });
  let studio = loadStudioStore({ storage });
  const session = recordImport(sessionFor(studio, studioProject(project)), { plan, report, at });
  studio = saveStudioStore(withSession(studio, session), { storage });
  return { project, session, created: !existing };
}

/**
 * Apply one answer to the session of its ORIGIN project in the store: a check or recheck
 * report, a stage receipt, or a readback (`key: 'readback'` with `{ stage, extrinsicHash,
 * patch }`). The store is read at this moment, so an answer arriving after a project
 * switch, a reset of another project or a page change lands in the right session and is
 * written there; the caller decides whether the screen follows.
 */
export function applyToProject({ projectId, key, value, at = new Date().toISOString(), storage = browser() }) {
  const projects = loadProjects({ storage });
  const record = projects.projects[projectId] ?? null;
  const studio = loadStudioStore({ storage });
  const session = sessionFor(studio, record ? studioProject(record) : { id: projectId, name: projectId, kind: 'own' });
  let next;
  if (key === 'check') next = recordCheck(session, { ...value, at });
  else if (key === 'recheck') next = recordRecheck(session, { ...value, at });
  else if (key === 'readback') next = recordReadback(session, value.stage, { extrinsicHash: value.extrinsicHash, patch: value.patch }, { at });
  else next = applyStage(session, key, value, { at });
  saveStudioStore(withSession(studio, next), { storage });
  let project = record;
  if ((key === 'check' || key === 'recheck') && value.report && record) { project = noteReport(record, value.report, { source: key, at }); saveProjects(withProject(projects, project), { storage }); }
  return { session: next, project };
}

export { listProjects };
