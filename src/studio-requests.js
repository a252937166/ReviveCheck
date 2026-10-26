// Ownership of the studio's asynchronous answers ABOVE any mount of the studio page
// (repair follow-up 2026-10-26, R-05). One request fence per browser tab, created when
// the module loads, so a read started in an earlier mount of the page stays accountable
// after the page unmounts and mounts again: a later request of the same project and
// stage, or a reset of the project, supersedes it, whichever mount started it, and a
// superseded answer is discarded at settlement wherever it arrives. Answers are applied
// to the session of the project they started in (src/studio-store.js), and listeners (the
// mounted page) learn about every applied answer, so a mount that did not start a request
// still shows its result when it is current. Finalized write receipts and readbacks are
// never discarded: they belong to their transaction, not to a mount.
import { createRequestFence, beginRequest, requestIsCurrent, supersedeRequests, READ_STAGES } from './studio-state.js';
import { applyToProject } from './studio-store.js';

/** A request owner: `storage` is injected for tests and defaults to the browser's; `log` receives one line per settled answer. */
export function createStudioRequests({ storage = undefined, log = () => {} } = {}) {
  const fence = createRequestFence();
  const listeners = new Set();
  const options = () => (storage ? { storage } : {});
  const notify = (event) => { for (const listener of [...listeners]) listener(event); };
  return Object.freeze({
    /** Start a read request for a project; the token names the origin, the stage and the generation. */
    begin: (projectId, key) => beginRequest(fence, projectId, key),
    /** Whether a token is still the latest request of its project and stage. */
    isCurrent: (token) => requestIsCurrent(fence, token),
    /** Settle a read request: applied to its origin when still current, discarded when a later request of the same project and stage started or the project was reset, whichever mount did either. */
    settle: (token, value, { at } = {}) => {
      if (READ_STAGES.includes(token.key) && !requestIsCurrent(fence, token)) { log(`studio: the ${token.key} answer of request ${token.generation} for ${token.projectId} arrived after a later request or a reset; discarded`); notify({ projectId: token.projectId, key: token.key, token, applied: false, reason: 'superseded' }); return { applied: false, reason: 'superseded' }; }
      const result = applyToProject({ projectId: token.projectId, key: token.key, value, ...(at ? { at } : {}), ...options() });
      log(`studio: the ${token.key} answer of request ${token.generation} for ${token.projectId} applied${value?.report?.evidenceHash ? ` (${value.report.evidenceHash})` : ''}`);
      notify({ projectId: token.projectId, key: token.key, token, applied: true, result });
      return { applied: true, ...result };
    },
    /** A finalized write receipt for its origin project. Never discarded. */
    apply: (projectId, key, value, { at } = {}) => { const result = applyToProject({ projectId, key, value, ...(at ? { at } : {}), ...options() }); notify({ projectId, key, applied: true, result }); return result; },
    /** A readback for ONE transaction of its origin project. Never discarded. */
    readback: (projectId, stage, extrinsicHash, patch, { at } = {}) => { const result = applyToProject({ projectId, key: 'readback', value: { stage, extrinsicHash, patch }, ...(at ? { at } : {}), ...options() }); notify({ projectId, key: 'readback', applied: true, result }); return result; },
    /** Every read request of a project is superseded (a reset): their answers are discarded when they arrive. */
    supersede: (projectId) => supersedeRequests(fence, projectId),
    /** Learn about every answer applied or discarded; returns the unsubscribe function. */
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  });
}

/** The browser's request owner: one per tab, outliving every mount of the studio page. */
export const studioRequests = createStudioRequests({ log: (line) => { if (typeof console !== 'undefined') console.info(line); } });
