#!/usr/bin/env node
// Test the distributed artifact as a product. Packs this checkout with `npm pack`, installs
// the tarball into an empty project outside the source tree, and from there: resolves
// every documented export, runs the CLI help, starts the MCP server over stdio, lists its
// tools and resources and reads every resource, comparing it with the checkout's public
// record. It also checks that nothing private is packed and measures the artifact and the
// install. Exit 1 on any failure. Network: only the npm registry, for the dependencies.
//
//   node scripts/verify-artifact.mjs [--out <record.json>] [--keep]
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = '') => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const keep = args.includes('--keep');
const FORBIDDEN = [/^\.private\//, /wallet\.json$/, /^scratchpad\//, /^artifacts\//, /^\.revivecheck/, /^video\//, /^server\//, /^src\//, /^test\//, /^examples\/(?!release-gate-starter\/)/, /^deployments\//, /\.env/];
const DOCUMENTED_EXPORTS = ['revivecheck', 'revivecheck/policy', 'revivecheck/entry', 'revivecheck/current', 'revivecheck/decision', 'revivecheck/catalog-release', 'revivecheck/health', 'revivecheck/service', 'revivecheck/report', 'revivecheck/registry', 'revivecheck/tokenlist', 'revivecheck/networks', 'revivecheck/chain', 'revivecheck/evidence', 'revivecheck/plan', 'revivecheck/demo', 'revivecheck/lib/share.js', 'revivecheck/contracts/VerifiedTokenList.sol', 'revivecheck/package.json'];
const NAMED = { 'revivecheck/policy': ['normalizePolicy', 'policyHash', 'createBinding', 'verifyBinding', 'evaluateBinding', 'summarizeEvaluation', 'REASONS'], 'revivecheck/service': ['retrieveEvidence', 'collectPolicyInputs', 'evaluatePolicy', 'readRegistry', 'readTokenList', 'networkStatus', 'closeConnections'], 'revivecheck/report': ['verifyRun', 'validateImportedRun', 'fingerprint', 'canonical'], 'revivecheck/entry': ['approvedEntry', 'compareEntry', 'entryDecision', 'canonicalEntry', 'entryIdentity', 'ENTRY_FIELDS'], 'revivecheck/current': ['initialDecision', 'beginCheck', 'settleCheck', 'failCheck', 'changeSelection', 'ageDecision', 'canAct', 'describeDecision'], 'revivecheck/decision': ['buildDecisionEvidence', 'reconstructDecision', 'formatReconstruction', 'decisionSheetHtml', 'explainReason', 'evidenceExpiry', 'RENEWAL_STEPS', 'RECOVERY'], 'revivecheck/catalog-release': ['buildCatalogRelease', 'verifyCatalogRelease', 'readCatalogRelease', 'compareCatalogReleases', 'releaseDiagnostics', 'gateOutcome', 'loadConsumerConfig', 'selectorFrom', 'EXIT'], 'revivecheck/health': ['evidenceHealth', 'renewalPlan', 'successorReports', 'successorConsumerConfig', 'diffConsumerConfigs'] };

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const findings = [];
const fail = (what) => { findings.push(what); console.error(`FAIL ${what}`); };
const ok = (what) => console.log(`ok   ${what}`);
async function dirSize(dir) { let total = 0, files = 0; for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { const sub = await dirSize(full); total += sub.bytes; files += sub.files; } else { total += (await stat(full)).size; files += 1; } } return { bytes: total, files }; }

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const work = await mkdtemp(path.join(tmpdir(), 'revivecheck-artifact-'));
const record = { schema: 'revivecheck.artifact-verification.v1', version: pkg.version, verifiedAt: new Date().toISOString(), node: process.version, workDir: work };
try {
  // 1. Pack, and inspect the tarball's file list.
  const packed = JSON.parse((await exec('npm', ['pack', '--json', '--pack-destination', work], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout)[0];
  const tarball = path.join(work, packed.filename);
  const bytes = await readFile(tarball);
  record.artifact = { filename: packed.filename, sha256: sha256(bytes), bytes: bytes.length, unpackedBytes: packed.unpackedSize, files: packed.entryCount, entries: packed.files.map((file) => file.path) };
  const leaked = record.artifact.entries.filter((entry) => FORBIDDEN.some((pattern) => pattern.test(entry)));
  if (leaked.length) fail(`forbidden paths packed: ${leaked.join(', ')}`); else ok(`${record.artifact.files} files packed, nothing private (${record.artifact.bytes} bytes, sha256 ${record.artifact.sha256.slice(0, 16)}…)`);
  for (const required of ['lib/policy.js', 'lib/service.js', 'lib/entry.js', 'lib/current.js', 'lib/decision.js', 'mcp/server.js', 'mcp/tools.js', 'scripts/revivecheck.js', 'scripts/catalog-release.js', 'examples/release-gate-starter/project.json', 'examples/release-gate-starter/read-example.mjs', 'examples/release-gate-starter/README.md', 'examples/release-gate-starter/fixtures/reapprove-r2.inputs.json', 'public/lifecycle/reference.json', 'public/lifecycle/registry.json', 'docs/LIBRARY.md', 'docs/POLICY.md', 'README.md', 'LICENSE']) if (!record.artifact.entries.includes(required)) fail(`${required} is not in the artifact`);

  // 2. Install into an empty project outside the checkout.
  const project = path.join(work, 'consumer');
  await exec('mkdir', ['-p', project]);
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'artifact-check', private: true, type: 'module', dependencies: { revivecheck: `file:${tarball}` } }, null, 2));
  const started = Date.now();
  await exec('npm', ['install', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: project, maxBuffer: 16 * 1024 * 1024 });
  const installMs = Date.now() - started;
  const lock = JSON.parse(await readFile(path.join(project, 'package-lock.json'), 'utf8'));
  const size = await dirSize(path.join(project, 'node_modules'));
  record.install = { ms: installMs, packages: Object.keys(lock.packages).filter((key) => key.startsWith('node_modules/')).length, nodeModulesBytes: size.bytes, nodeModulesFiles: size.files };
  ok(`installed in ${installMs} ms: ${record.install.packages} packages, ${(size.bytes / 1e6).toFixed(1)} MB in node_modules`);

  // 3. Every documented export resolves from the installed copy, with the named functions present.
  const probe = `
    const results = {};
    for (const specifier of ${JSON.stringify(DOCUMENTED_EXPORTS)}) {
      try {
        if (specifier.endsWith('.sol')) { const { createRequire } = await import('node:module'); const r = createRequire(import.meta.url); const { readFileSync } = await import('node:fs'); results[specifier] = { ok: readFileSync(r.resolve(specifier), 'utf8').includes('contract VerifiedTokenList') }; continue; }
        const module = specifier.endsWith('.json') ? (await import(specifier, { with: { type: 'json' } })).default : await import(specifier);
        const missing = (${JSON.stringify(NAMED)}[specifier] || []).filter((name) => module[name] === undefined);
        results[specifier] = { ok: missing.length === 0, missing };
      } catch (error) { results[specifier] = { ok: false, error: error.message }; }
    }
    const service = await import('revivecheck/service'); await service.closeConnections();
    console.log(JSON.stringify(results));
  `;
  await writeFile(path.join(project, 'probe.mjs'), probe);
  const exportsResult = JSON.parse((await exec(process.execPath, ['probe.mjs'], { cwd: project })).stdout.trim().split('\n').at(-1));
  record.exports = exportsResult;
  for (const [specifier, result] of Object.entries(exportsResult)) if (!result.ok) fail(`${specifier}: ${result.error || `missing ${result.missing.join(', ')}`}`);
  if (Object.values(exportsResult).every((result) => result.ok)) ok(`${DOCUMENTED_EXPORTS.length} documented export specifiers resolve with every named function`);

  // 4. The CLI help lists the tools.
  const help = await exec(path.join(project, 'node_modules', '.bin', 'revivecheck'), ['--help'], { cwd: project });
  const toolCount = help.stdout.split('\n').filter((line) => /^\s{2}[a-z_]+\s{2,}/.test(line)).length;
  record.cli = { toolsListed: toolCount };
  if (toolCount < 10) fail(`revivecheck --help lists ${toolCount} tools`); else ok(`revivecheck --help lists ${toolCount} tools`);

  // 5. The MCP server starts from the installed copy; every advertised resource reads and equals the checkout's public record.
  const mcpProbe = `
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
    const transport = new StdioClientTransport({ command: process.execPath, args: ['node_modules/revivecheck/mcp/server.js'], stderr: 'pipe' });
    const client = new Client({ name: 'artifact-check', version: '1.0.0' });
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    const resources = [];
    for (const resource of (await client.listResources()).resources) {
      try { const response = await client.readResource({ uri: resource.uri }); resources.push({ uri: resource.uri, readable: true, bytes: response.contents[0].text.length, sha256: (await import('node:crypto')).createHash('sha256').update(response.contents[0].text).digest('hex') }); }
      catch (error) { resources.push({ uri: resource.uri, readable: false, error: error.message }); }
    }
    await client.close();
    console.log(JSON.stringify({ tools, resources }));
  `;
  await writeFile(path.join(project, 'mcp-probe.mjs'), mcpProbe);
  // The SDK is a dependency of the package; resolve it through the installed copy.
  const mcp = JSON.parse((await exec(process.execPath, ['--preserve-symlinks', 'mcp-probe.mjs'], { cwd: project, env: { ...process.env, NODE_PATH: path.join(project, 'node_modules') }, timeout: 60_000 })).stdout.trim().split('\n').at(-1));
  record.mcp = mcp;
  if (mcp.tools.length < 10) fail(`MCP lists ${mcp.tools.length} tools`); else ok(`MCP server started from the installed copy: ${mcp.tools.length} tools`);
  const expectedResources = { 'revivecheck://lifecycle/reference': 'public/lifecycle/reference.json', 'revivecheck://registry': 'public/lifecycle/registry.json' };
  for (const resource of mcp.resources) {
    const file = expectedResources[resource.uri];
    if (!file) { fail(`unexpected resource ${resource.uri}`); continue; }
    if (!resource.readable) { fail(`${resource.uri} does not read from the installed copy: ${resource.error}`); continue; }
    const local = sha256(await readFile(path.join(root, file), 'utf8'));
    if (local !== resource.sha256) fail(`${resource.uri} differs from ${file} in this checkout`); else ok(`${resource.uri} reads and equals ${file}`);
  }
  for (const uri of Object.keys(expectedResources)) if (!mcp.resources.some((resource) => resource.uri === uri)) fail(`${uri} is not advertised`);

  // 6. The release gate starter, from the installed copy alone: configure, gate on captured reads, write the release only when permitted, read it in another process.
  const starterSource = path.join(project, 'node_modules', 'revivecheck', 'examples', 'release-gate-starter');
  const starter = path.join(work, 'starter');
  await exec('cp', ['-R', starterSource, starter]);
  await exec('cp', [tarball, path.join(starter, 'revivecheck.tgz')]);
  const starterInstall = Date.now();
  await exec('npm', ['install', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: starter, maxBuffer: 16 * 1024 * 1024 });
  const gate = path.join(starter, 'node_modules', '.bin', 'revivecheck-catalog');
  const permitted = await exec(gate, ['prepare', '--config', 'project.json', '--out', 'releases', '--fixture', 'fixtures/reapprove-r2.inputs.json'], { cwd: starter }).then((result) => ({ status: 0, ...result }), (error) => ({ status: error.code, stdout: error.stdout, stderr: error.stderr }));
  const releaseFile = path.join(starter, 'releases', 'catalog-release-1.json');
  const release = permitted.status === 0 ? JSON.parse(await readFile(releaseFile, 'utf8')) : null;
  const refused = await exec(gate, ['prepare', '--config', 'project.json', '--out', 'releases-refused', '--fixture', 'fixtures/revoke-r2.inputs.json'], { cwd: starter }).then((result) => ({ status: 0, ...result }), (error) => ({ status: error.code, stdout: error.stdout, stderr: error.stderr }));
  const refusedOutcome = JSON.parse(await readFile(path.join(starter, 'releases-refused', 'outcome.json'), 'utf8'));
  const refusedWroteRelease = await stat(path.join(starter, 'releases-refused', 'catalog-release-1.json')).then(() => true, () => false);
  const reader = release ? await exec(process.execPath, ['read-example.mjs', releaseFile, '--now', release.generatedAt], { cwd: starter }).then((result) => ({ status: 0, ...result }), (error) => ({ status: error.code, stdout: error.stdout, stderr: error.stderr })) : { status: null };
  record.starter = { installMs: Date.now() - starterInstall, permitted: { status: permitted.status, version: release?.version ?? null, releaseHash: release?.releaseHash ?? null, validUntil: release?.validity?.validUntil ?? null }, refused: { status: refused.status, outcome: refusedOutcome.status, reasons: refusedOutcome.reasons, wroteRelease: refusedWroteRelease }, reader: { status: reader.status, usable: /At least one entry may be used now/.test(reader.stdout || '') } };
  if (permitted.status !== 0 || !release) fail(`starter: the permitted case did not write a release (exit ${permitted.status}): ${(permitted.stderr || permitted.stdout || '').slice(0, 300)}`); else ok(`starter: release ${release.version} written from the installed copy on captured reads (${release.releaseHash.slice(0, 12)}…)`);
  if (refused.status !== 1 || refusedOutcome.status !== 'refused' || refusedWroteRelease) fail(`starter: the revoked case was not refused cleanly (exit ${refused.status}, outcome ${refusedOutcome.status}, release written ${refusedWroteRelease})`); else ok(`starter: the revoked case was refused (exit 1, ${refusedOutcome.reasons.join(', ')}), no release written`);
  if (reader.status !== 0 || !record.starter.reader.usable) fail(`starter: the example reader did not use the release (exit ${reader.status})`); else ok('starter: the example reader verified the release and filled the selector in a separate process');
} catch (error) {
  fail(error.stdout || error.stderr ? `${error.message}\n${error.stdout || ''}${error.stderr || ''}` : error.message);
} finally {
  if (!keep) await rm(work, { recursive: true, force: true });
}
record.ok = findings.length === 0;
record.findings = findings;
const out = option('--out');
if (out) await writeFile(path.resolve(root, out), `${JSON.stringify({ ...record, workDir: keep ? work : undefined }, null, 2)}\n`);
console.log(JSON.stringify({ ok: record.ok, artifact: record.artifact && { sha256: record.artifact.sha256, bytes: record.artifact.bytes, files: record.artifact.files }, install: record.install, findings }, null, 2));
process.exitCode = record.ok ? 0 : 1;
