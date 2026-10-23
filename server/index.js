import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { overall, sealRun, compareRuns, reportHtml, verifyRun } from '../lib/report.js';
import { rehearse } from '../lib/rehearsal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const port = Number(process.env.PORT || 4173);
const store = new Store(process.env.REVIVECHECK_DATA_DIR || path.join(root, '.revivecheck'));
const network = { name: 'Portaldot V3 Testnet', chainId: 420420777, evmRpcUrl: 'https://test-evm-rpc-v3.portaldot.dev', substrateRpcUrl: 'wss://test-node-v3.portaldot.dev' };
app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  if (!['localhost', '127.0.0.1', '::1'].includes(req.hostname)) return res.status(403).json({ error: 'This prototype accepts localhost requests only.' });
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return res.status(403).json({ error: 'Use this workspace from its local origin.' });
  if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/api/workspace', async (req, res) => res.json({ ...await store.read(), network, capabilities: { liveReadOnly: true, signing: false } }));
app.post('/api/projects', async (req, res) => res.status(201).json(await store.create(req.body)));
app.patch('/api/projects/:id', async (req, res) => res.json(await store.update(req.params.id, req.body)));
for (const action of ['archive', 'restore']) app.post(`/api/projects/:id/${action}`, async (req, res) => res.json(await store.archive(req.params.id, action === 'restore')));
const running = new Set();
app.post('/api/projects/:id/runs', async (req, res) => {
  const state = await store.read(), project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  if (project.archivedAt) return res.status(409).json({ error: 'Restore this project before running another acceptance check.' });
  if (running.has(project.id)) return res.status(409).json({ error: 'An acceptance run is already in progress for this project.' });
  const { mode, scenario = 'wrong-network' } = req.body;
  if (!['rehearsal', 'live'].includes(mode)) return res.status(400).json({ error: 'Choose local rehearsal or live read-only mode.' });
  running.add(project.id);
  try {
    const startedAt = new Date().toISOString();
    const input = structuredClone(project);
    const result = mode === 'rehearsal' ? rehearse(input, scenario) : await (await import('../lib/chain.js')).inspectChain(input, { signal: AbortSignal.timeout(25000) });
    const previous = state.runs.filter(r => r.projectId === project.id && r.mode === mode).at(-1);
    const run = sealRun({ id: randomUUID(), projectId: project.id, projectName: project.name, release: project.release, mode, scenario: mode === 'rehearsal' ? scenario : null, startedAt, completedAt: new Date().toISOString(), scope: mode === 'rehearsal' ? 'local-rehearsal' : 'portaldot-testnet-readonly', status: overall(result.checks), checks: result.checks, network: result.network, input, previousRunId: previous?.id || null, limitations: result.limitations });
    await store.addRun(run);
    res.status(201).json(run);
  } finally { running.delete(project.id); }
});
app.get('/api/runs/:id', async (req, res) => {
  const run = (await store.read()).runs.find(r => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  if (!verifyRun(run)) return res.status(409).json({ error: 'Saved evidence failed its integrity check.' });
  res.json(run);
});
app.get('/api/runs/:id/export', async (req, res) => {
  const run = (await store.read()).runs.find(r => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  if (!verifyRun(run)) return res.status(409).json({ error: 'Saved evidence failed its integrity check.' });
  const html = req.query.format === 'html';
  res.setHeader('Content-Disposition', `attachment; filename="revivecheck-${run.id}.${html ? 'html' : 'json'}"`);
  res.type(html ? 'html' : 'json').send(html ? reportHtml(run) : JSON.stringify(run, null, 2));
});
app.get('/api/compare', async (req, res) => {
  const state = await store.read(), baseline = state.runs.find(r => r.id === req.query.baseline), candidate = state.runs.find(r => r.id === req.query.candidate);
  if (!baseline || !candidate) return res.status(404).json({ error: 'Choose two saved runs.' });
  res.json(compareRuns(baseline, candidate));
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route.' }));
app.use((error, req, res, next) => {
  if (req.path.startsWith('/api/')) res.status(error.status || 400).json({ error: error.message || 'Request failed.' });
  else next(error);
});
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.use((req, res, next) => req.method === 'GET' ? res.sendFile(path.join(root, 'dist', 'index.html')) : next());
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(port, '127.0.0.1', () => process.stdout.write(`ReviveCheck available at http://127.0.0.1:${port}\n`));
server.on('error', error => { process.stderr.write(`${error.message}\n`); process.exit(1); });
