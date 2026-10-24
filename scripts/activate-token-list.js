import { readFile, writeFile } from 'node:fs/promises';
import { connectNative, evmRpc, assertTestnet, str } from '../lib/chain.js';
import { normalizeManifest, checkArtifact, verifyDeployment, deploymentsFromRecords, renderDeploymentsModule } from '../lib/deployment.js';
import { readTokenListIdentityWithClients } from '../lib/tokenlist.js';
import { TOKEN_LIST_DEPLOYMENTS } from '../lib/tokenlist.deployments.js';
import { compileTokenList } from './compile-token-list.js';

// Make a verified deployment the one the library, the site and the tools use.
// Default: re-read the deployment from the chain (runtime code, version(), registry()
// and curator() through both interfaces at a finalized block) and compare it with
// the manifest and the record; change nothing. --write regenerates
// lib/tokenlist.deployments.js with that version active, only when every check
// passed. --render rebuilds the module from the records on disk without the network
// and without changing which version is active.
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const manifestPath = option('--manifest', 'deployments/token-list-v2.manifest.json');
const write = args.includes('--write');
const renderOnly = args.includes('--render');
const V1_RECORD = 'public/lifecycle/token-list.json';

const manifest = normalizeManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
const v1 = JSON.parse(await readFile(V1_RECORD, 'utf8'));
let api;
try {
  let v2 = null;
  try { v2 = JSON.parse(await readFile(manifest.records.record, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (renderOnly) {
    const deployments = deploymentsFromRecords({ v1, v2: v2 ? { ...v2, recordPath: manifest.records.record } : null, active: TOKEN_LIST_DEPLOYMENTS.active });
    const source = renderDeploymentsModule(deployments);
    const current = await readFile(manifest.activation.module, 'utf8');
    if (source !== current) await writeFile(manifest.activation.module, source);
    console.log(JSON.stringify({ status: source === current ? 'unchanged' : 'rendered', module: manifest.activation.module, active: deployments.active, versions: Object.keys(deployments).filter((key) => key !== 'active' && deployments[key]) }, null, 2));
  } else {
    if (!v2) throw new Error(`No deployment record at ${manifest.records.record}. Deploy first: node scripts/deploy-token-list.js --manifest ${manifestPath}`);
    if (v2.manifestHash !== manifest.manifestHash || v2.version !== manifest.version) throw new Error('The record was written for a different manifest.');
    const { extra, ...artifact } = await compileTokenList();
    checkArtifact(manifest, artifact);
    if (v2.sourceSha256 !== artifact.sourceSha256) throw new Error('The record names other sources than the ones compiled now.');
    api = await connectNative({ signal: AbortSignal.timeout(60_000) });
    assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
    if (str(api.genesisHash).toLowerCase() !== manifest.genesisHash) throw new Error('The node is not the network the manifest pins.');
    const runtime = `${api.runtimeVersion.specName}/${api.runtimeVersion.specVersion}`;
    const signal = AbortSignal.timeout(90_000);
    const clients = { api, rpc: (method, params) => evmRpc(method, params, { signal }), signal };
    const identity = await readTokenListIdentityWithClients(clients, v2.address);
    const code = await evmRpc('eth_getCode', [v2.address, { blockHash: identity.block.evmHash, requireCanonical: true }], { signal });
    const verification = verifyDeployment({ manifest, artifact, code, identity });
    const runtimeOk = runtime === `${manifest.runtime.specName}/${manifest.runtime.specVersion}`;
    verification.checks.push({ id: 'runtime.pinned', status: runtimeOk ? 'passed' : 'failed', observed: runtime, expected: `${manifest.runtime.specName}/${manifest.runtime.specVersion}` });
    const ok = verification.ok && runtimeOk;
    const result = { status: ok ? (write ? 'activated' : 'verified') : 'not-activated', version: manifest.version, contract: v2.address, block: identity.block, checks: verification.checks, written: false };
    if (ok && write) {
      const deployments = deploymentsFromRecords({ v1, v2: { ...v2, recordPath: manifest.records.record }, active: `v${manifest.version}` });
      await writeFile(manifest.activation.module, renderDeploymentsModule(deployments));
      result.written = true;
      result.module = manifest.activation.module;
      result.next = 'npm test && npx vite build; then rebuild the feed with node scripts/index-registry.js';
    }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = ok ? 0 : 1;
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600) }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
