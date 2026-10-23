import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { verifyRun, validateImportedRun, canonical } from '../lib/report.js';
import { createReview, verifyReview } from '../lib/lifecycle.js';
import { normalizePlan } from '../lib/plan.js';

export const projectDefaults = { release: 'v0.1.0', profile: 'contract', logicalContractId: '', sourceRevision: '', assertions: [], contractAddress: '', account: '', transactionHash: '', transactionBlockHash: '', expectedValue: '42', expectedChainId: 420420777 };
export function validateProject(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Project details must be an object.');
  const out = {};
  for (const key of ['name', 'release', 'contractAddress', 'account', 'transactionHash', 'transactionBlockHash', 'expectedValue', 'expectedChainId']) {
    if (!(key in input)) continue;
    if (key === 'expectedChainId') {
      const value = Number(input[key]);
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Expected chain ID must be a positive safe integer.');
      out[key] = value;
    } else {
      if (typeof input[key] !== 'string') throw new Error(`${key} must be text.`);
      const value = input[key].trim();
      if (value.length > 256) throw new Error(`${key} is too long.`);
      out[key] = value;
    }
  }
  if ((!partial || 'name' in out) && !out.name) throw new Error('Give this project a name.');
  if ('contractAddress' in out && out.contractAddress && !/^0x[0-9a-fA-F]{40}$/.test(out.contractAddress)) throw new Error('Contract address must be a 20-byte 0x address.');
  for (const key of ['transactionHash', 'transactionBlockHash']) if (out[key] && !/^0x[0-9a-fA-F]{64}$/.test(out[key])) throw new Error(`${key} must be a 32-byte 0x hash.`);
  if ('account' in out && out.account && !/^(0x[0-9a-fA-F]{40}|5[1-9A-HJ-NP-Za-km-z]{46,49})$/.test(out.account)) throw new Error('Use an EVM address or a native SS58 address starting with 5.');
  if ('expectedValue' in out && !/^(0|[1-9]\d*)$/.test(out.expectedValue)) throw new Error('Expected probe value must be an unsigned integer.');
  if ('expectedValue' in out && BigInt(out.expectedValue) >= (1n << 256n)) throw new Error('Expected value exceeds uint256.');
  const planKeys = ['profile', 'logicalContractId', 'sourceRevision', 'assertions', 'nativeAsset'];
  const plan = normalizePlan({ ...projectDefaults, ...out, ...Object.fromEntries(planKeys.filter(key => key in input).map(key => [key, input[key]])) });
  for (const key of planKeys) if (!partial || key in input) {
    if (key in plan) out[key] = structuredClone(plan[key]);
    else if (key === 'nativeAsset' && key in input) out[key] = null;
  }
  return out;
}
export class Store {
  constructor(directory) { this.directory = directory; this.queue = Promise.resolve(); }
  async read() {
    try {
      const data = JSON.parse(await readFile(path.join(this.directory, 'workspace.json'), 'utf8'));
      for (const key of ['projects', 'runs']) if (!Array.isArray(data[key])) throw new Error('Workspace data is malformed; the original file has not been changed.');
      return { ...data, reviews: data.reviews || [], shares: data.shares || [], imports: data.imports || [] };
    } catch (error) { if (error.code === 'ENOENT') return { projects: [], runs: [], reviews: [], shares: [], imports: [] }; throw error; }
  }
  async mutate(callback) {
    const next = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const state = await this.read();
      const result = await callback(state);
      const temp = path.join(this.directory, `workspace-${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temp, path.join(this.directory, 'workspace.json'));
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  create(input) {
    const fields = validateProject(input);
    return this.mutate(state => { const now = new Date().toISOString(); const project = normalizePlan({ ...structuredClone(projectDefaults), ...fields, id: randomUUID(), createdAt: now, updatedAt: now, archivedAt: null }); state.projects.push(project); return project; });
  }
  update(id, input) {
    const fields = validateProject(input, true);
    return this.mutate(state => { const index = state.projects.findIndex(p => p.id === id); if (index < 0) throw Object.assign(new Error('Project not found.'), { status: 404 }); const project = normalizePlan({ ...state.projects[index], ...fields, updatedAt: new Date().toISOString() }); state.projects[index] = project; return project; });
  }
  archive(id, restore = false) {
    return this.mutate(state => { const project = state.projects.find(p => p.id === id); if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 }); project.archivedAt = restore ? null : new Date().toISOString(); project.updatedAt = new Date().toISOString(); return project; });
  }
  addRun(run) {
    validateImportedRun(run);
    return this.mutate(state => { if (state.runs.some(r => r.id === run.id)) throw new Error('A saved run cannot be overwritten.'); state.runs.push(run); return run; });
  }
  importRun(run) {
    validateImportedRun(run);
    return this.mutate(state => {
      const existing = state.runs.find(saved => saved.id === run.id || saved.evidenceHash === run.evidenceHash);
      if (existing) {
        if (existing.evidenceHash !== run.evidenceHash) throw Object.assign(new Error('A different saved report already uses this ID. The original report was not changed.'), { status: 409 });
        return { run: existing, project: state.projects.find(project => project.id === existing.projectId), imported: false };
      }
      let project = state.projects.find(project => project.id === run.projectId);
      if (!project) {
        const fields = validateProject({ ...run.input, name: run.input.name || run.projectName || 'Imported project' });
        const now = new Date().toISOString();
        project = normalizePlan({ ...structuredClone(projectDefaults), ...fields, id: run.projectId, createdAt: now, updatedAt: now, archivedAt: null });
        state.projects.push(project);
      }
      state.runs.push(structuredClone(run));
      state.imports.push({ reportHash: run.evidenceHash, importedAt: new Date().toISOString() });
      return { run, project, imported: true };
    });
  }
  addReview(runId, input) {
    return this.mutate(state => {
      const run = state.runs.find(saved => saved.id === runId);
      if (!run) throw Object.assign(new Error('Report not found.'), { status: 404 });
      const review = createReview(run, input);
      state.reviews.push(review);
      return review;
    });
  }
  importReview(review) {
    if (!verifyReview(review)) throw new Error('Review receipt integrity or schema is invalid.');
    return this.mutate(state => {
      const run = state.runs.find(saved => saved.evidenceHash === review.reportHash && verifyRun(saved));
      if (!run) throw new Error('Import the exact intact report before importing its review receipt.');
      const existing = state.reviews.find(saved => saved.id === review.id || saved.receiptHash === review.receiptHash);
      if (existing) {
        if (canonical(existing) !== canonical(review)) throw Object.assign(new Error('A different review already uses this ID. Review history cannot be overwritten.'), { status: 409 });
        return existing;
      }
      state.reviews.push(structuredClone(review));
      return review;
    });
  }
  addShare(runId, input) {
    if (!input || !['fragment', 'json', 'public-url'].includes(input.method)) throw new Error('Choose fragment, json, or public-url share preparation.');
    if (input.url !== undefined && (typeof input.url !== 'string' || input.url.length > 50000)) throw new Error('Share URL is too long.');
    if (input.url) {
      const url = new URL(input.url);
      if (url.protocol !== 'https:' || url.username || url.password || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('Use a static HTTPS viewer URL; do not expose the local workspace.');
    }
    return this.mutate(state => {
      const run = state.runs.find(saved => saved.id === runId && verifyRun(saved));
      if (!run) throw new Error('Share preparation requires an intact saved report.');
      const share = { id: randomUUID(), reportHash: run.evidenceHash, method: input.method, ...(input.url ? { url: input.url } : {}), status: 'share-prepared', createdAt: new Date().toISOString() };
      state.shares.push(share);
      return share;
    });
  }
}
