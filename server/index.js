import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { overall, sealRun, compareRuns, reportHtml, verifyRun, buildRunBinding } from '../lib/report.js';
import { workspaceLifecycle, lifecycleForRun, verifyReview } from '../lib/lifecycle.js';
import { rehearse } from '../lib/rehearsal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const port = Number(process.env.PORT || 4173);
const store = new Store(process.env.REVIVECHECK_DATA_DIR || path.join(root, '.revivecheck'));
const network = { name: 'Portaldot V3 Testnet', chainId: 420420777, evmRpcUrl: 'https://test-evm-rpc-v3.portaldot.dev', substrateRpcUrl: 'wss://test-node-v3.portaldot.dev' };
app.disable('x-powered-by');
// The public data feed is a static file under /api, served before the loopback-only API.
app.use('/api', express.static(path.join(root, 'public', 'api'), { index: false, fallthrough: true }));
app.use('/api', (req, res, next) => {
  if (!['localhost', '127.0.0.1', '::1'].includes(req.hostname)) return res.status(403).json({ error: 'This prototype accepts localhost requests only.' });
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return res.status(403).json({ error: 'Use this workspace from its local origin.' });
  if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
  next();
});
app.use(express.json({ limit: '512kb' }));
app.get('/api/workspace', async (req, res) => {
  const state = await store.read();
  res.json({ ...state, lifecycleByRun: workspaceLifecycle(state), network, capabilities: { liveReadOnly: true, signing: false, importReports: true, reviewReceipts: 'self-declared', sharing: 'static-viewer-or-json' } });
});
app.post('/api/projects', async (req, res) => res.status(201).json(await store.create(req.body)));
app.patch('/api/projects/:id', async (req, res) => res.json(await store.update(req.params.id, req.body)));
for (const action of ['archive', 'restore']) app.post(`/api/projects/:id/${action}`, async (req, res) => res.json(await store.archive(req.params.id, action === 'restore')));
const running = new Set();
const runProject = async (req, res, recheck = false) => {
  const state = await store.read(), project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  if (project.archivedAt) return res.status(409).json({ error: 'Restore this project before running another acceptance check.' });
  if (running.has(project.id)) return res.status(409).json({ error: 'An acceptance run is already in progress for this project.' });
  const { mode = recheck ? 'live' : undefined, scenario = 'wrong-network' } = req.body;
  if (recheck && mode !== 'live') return res.status(400).json({ error: 'A recheck creates a new live read-only run.' });
  if (!['rehearsal', 'live'].includes(mode)) return res.status(400).json({ error: 'Choose local rehearsal or live read-only mode.' });
  running.add(project.id);
  try {
    const startedAt = new Date().toISOString();
    const input = structuredClone(project);
    const result = mode === 'rehearsal' ? rehearse(input, scenario) : await (await import('../lib/chain.js')).inspectChain(input, { signal: AbortSignal.timeout(60000) });
    const previous = state.runs.filter(r => r.projectId === project.id && r.mode === mode).at(-1);
    const run = sealRun({ id: randomUUID(), projectId: project.id, projectName: project.name, release: project.release, mode, scenario: mode === 'rehearsal' ? scenario : null, trigger: recheck ? 'recheck' : 'manual', startedAt, completedAt: new Date().toISOString(), scope: mode === 'rehearsal' ? 'local-rehearsal' : 'portaldot-testnet-readonly', status: overall(result.checks), checks: result.checks, network: result.network, input, previousRunId: previous?.id || null, limitations: result.limitations });
    await store.addRun(run);
    res.status(201).json(run);
  } finally { running.delete(project.id); }
};
app.post('/api/projects/:id/runs', (req, res) => runProject(req, res));
app.post('/api/projects/:id/recheck', (req, res) => runProject(req, res, true));
app.post('/api/runs/import', async (req, res) => {
  const result = await store.importRun(req.body.run);
  const state = await store.read();
  res.status(result.imported ? 201 : 200).json({ ...result, lifecycle: lifecycleForRun(result.run, { ...state, project: result.project }) });
});
app.get('/api/runs/:id', async (req, res) => {
  const run = (await store.read()).runs.find(r => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  if (!verifyRun(run)) return res.status(409).json({ error: 'Saved evidence failed its integrity check.' });
  res.json(run);
});
app.get('/api/runs/:id/lifecycle', async (req, res) => {
  const state = await store.read(), run = state.runs.find(saved => saved.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  res.json(lifecycleForRun(run, { ...state, project: state.projects.find(project => project.id === run.projectId) }));
});
app.get('/api/runs/:id/plan', async (req, res) => {
  const run = (await store.read()).runs.find(saved => saved.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  if (!verifyRun(run)) return res.status(409).json({ error: 'Saved evidence failed its integrity check.' });
  res.json({ plan: run.input, binding: buildRunBinding(run), reportHash: run.evidenceHash });
});
app.post('/api/runs/:id/reviews', async (req, res) => res.status(201).json(await store.addReview(req.params.id, req.body)));
app.get('/api/runs/:id/reviews', async (req, res) => {
  const state = await store.read(), run = state.runs.find(saved => saved.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  res.json({ reviews: state.reviews.filter(review => review.reportHash === run.evidenceHash), lifecycle: lifecycleForRun(run, { ...state, project: state.projects.find(project => project.id === run.projectId) }) });
});
app.post('/api/reviews/import', async (req, res) => res.status(201).json(await store.importReview(req.body.review)));
app.get('/api/reviews/:id/export', async (req, res) => {
  const review = (await store.read()).reviews.find(saved => saved.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review receipt not found.' });
  if (!verifyReview(review)) return res.status(409).json({ error: 'Review receipt integrity check failed.' });
  res.attachment(`revivecheck-review-${review.id}.json`).json(review);
});
app.post('/api/runs/:id/shares', async (req, res) => res.status(201).json(await store.addShare(req.params.id, req.body)));
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
// The MCP tools, served as JSON over HTTP on loopback: the same handlers and input schemas.
const tools = () => import('../mcp/tools.js').then((module) => module.TOOLS);
app.get('/api/tools', async (req, res) => res.json({ tools: (await tools()).map(({ name, title, description, annotations }) => ({ name, title, description, readOnly: !!annotations?.readOnlyHint })) }));
app.post('/api/tools/:name', async (req, res) => {
  const tool = (await tools()).find((item) => item.name === req.params.name);
  if (!tool) return res.status(404).json({ error: 'Unknown tool. GET /api/tools lists them.' });
  const { z } = await import('zod');
  const parsed = z.object(tool.inputSchema).strict().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') });
  res.json(await tool.run(parsed.data));
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
