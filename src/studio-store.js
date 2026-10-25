// The browser's two stores behind the studio and My projects, and the hand-offs between
// them: the project records (src/projects.js) and one studio session per project
// (src/studio-state.js). Browser-only; the pure transitions live in those modules.
import { loadProjects, saveProjects, withProject, selectProject, createProject, noteReport, studioProject, listProjects } from './projects.js';
import { loadStudioStore, saveStudioStore, sessionFor, withSession, recordImport } from './studio-state.js';

/** The active project record and its studio session, read from the browser. */
export function readStudio() {
  const projects = loadProjects();
  const studio = loadStudioStore();
  const project = projects.projects[projects.activeProjectId];
  return { projects, studio, project, session: sessionFor(studio, studioProject(project)) };
}

/** Persist one project's session. */
export function writeSession(session) {
  const studio = loadStudioStore();
  return saveStudioStore(withSession(studio, session));
}

/** Persist one project record. */
export function writeProject(project) {
  return saveProjects(withProject(loadProjects(), project));
}

/** Make another project the active one (its own session, its own policy; nothing is shared). */
export function activateProject(id) {
  return saveProjects(selectProject(loadProjects(), id));
}

/**
 * "Use this report in my project": create the browser-local project this plan belongs to
 * (or select the one that already exists for the same name and plan), note the report in
 * it, make the report the active report of that project's studio session, and activate
 * the project. Nothing from any other project is carried over.
 */
export function adoptReport({ plan, report, projectName = plan?.name, at = new Date().toISOString() }) {
  let projects = loadProjects();
  const candidate = createProject({ name: projectName, plan, at });
  const existing = projects.projects[candidate.id];
  let project = existing ? { ...existing, updatedAt: at } : candidate;
  project = noteReport(project, report, { source: existing ? 'check' : 'import', at });
  projects = selectProject(withProject(projects, project), project.id);
  saveProjects(projects);
  let studio = loadStudioStore();
  const session = recordImport(sessionFor(studio, studioProject(project)), { plan, report, at });
  studio = saveStudioStore(withSession(studio, session));
  return { project, session, created: !existing };
}

export { listProjects };
