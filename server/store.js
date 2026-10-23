import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { verifyRun } from '../lib/report.js';

export const projectDefaults = { release: 'v0.1.0', contractAddress: '', account: '', transactionHash: '', transactionBlockHash: '', expectedValue: '42', expectedChainId: 420420777 };
export function validateProject(input, partial = false) {
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
  return out;
}
export class Store {
  constructor(directory) { this.directory = directory; this.queue = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await readFile(path.join(this.directory, 'workspace.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { projects: [], runs: [] }; throw error; }
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
    return this.mutate(state => { const now = new Date().toISOString(); const project = { ...projectDefaults, ...fields, id: randomUUID(), createdAt: now, updatedAt: now, archivedAt: null }; state.projects.push(project); return project; });
  }
  update(id, input) {
    const fields = validateProject(input, true);
    return this.mutate(state => { const project = state.projects.find(p => p.id === id); if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 }); Object.assign(project, fields, { updatedAt: new Date().toISOString() }); return project; });
  }
  archive(id, restore = false) {
    return this.mutate(state => { const project = state.projects.find(p => p.id === id); if (!project) throw Object.assign(new Error('Project not found.'), { status: 404 }); project.archivedAt = restore ? null : new Date().toISOString(); project.updatedAt = new Date().toISOString(); return project; });
  }
  addRun(run) {
    if (!verifyRun(run)) throw new Error('Run integrity check failed.');
    return this.mutate(state => { if (state.runs.some(r => r.id === run.id)) throw new Error('A saved run cannot be overwritten.'); state.runs.push(run); return run; });
  }
}
