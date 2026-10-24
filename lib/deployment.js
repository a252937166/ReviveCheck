// Versioned contract deployments described by a validated manifest, verified
// before activation. A manifest says which sources, compiler settings and
// constructor arguments a deployment uses and where its records go; nothing
// here edits source text. Every function is pure so the checks run offline
// against an in-memory EVM as well as against the testnet.
import { Interface } from 'ethers';
import { fingerprint } from './report.js';

export const MANIFEST_SCHEMA = 'revivecheck.deployment-manifest.v1';
export const DEPLOYMENT_RECORD_SCHEMA = 'revivecheck.token-list-deployment.v1';
const H160 = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/, BARE = /^[a-f0-9]{64}$/, SS58 = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;
const lower = (value) => String(value ?? '').toLowerCase();
const freeze = (value) => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
// The v1 records stay where they are; a manifest can never point a new deployment at them.
export const PROTECTED_RECORDS = Object.freeze(['public/lifecycle/token-list.json', 'artifacts/local/token-list-deploy.json', 'artifacts/VerifiedTokenList.json', 'contracts/deployed/v1']);

export function normalizeManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A deployment manifest is an object.');
  if (input.schema !== MANIFEST_SCHEMA) throw new Error(`A deployment manifest declares schema ${MANIFEST_SCHEMA}.`);
  if (input.contract !== 'VerifiedTokenList') throw new Error('This manifest format describes a VerifiedTokenList deployment.');
  const version = Number(input.version);
  if (!Number.isSafeInteger(version) || version < 2) throw new Error('A manifest deploys version 2 or later; v1 is the historical deployment and is never redeployed.');
  if (input.network !== 'testnet') throw new Error('Deployments are verified for the V3 testnet only.');
  const chainId = Number(input.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !HASH.test(input.genesisHash || '')) throw new Error('The manifest pins chainId and genesisHash.');
  const runtime = input.runtime || {};
  if (!runtime.specName || !/^\d+$/.test(String(runtime.specVersion ?? ''))) throw new Error('The manifest pins runtime.specName and runtime.specVersion.');
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.some((path) => typeof path !== 'string' || !path.startsWith('contracts/') || !path.endsWith('.sol'))) throw new Error('sources lists the Solidity files under contracts/, in compile order.');
  if (!BARE.test(input.sourceSha256 || '')) throw new Error('sourceSha256 is the 64-hex SHA-256 of the joined sources.');
  const compiler = input.compiler || {};
  if (compiler.version !== '0.8.24' || compiler.evmVersion !== 'paris' || !Number.isSafeInteger(Number(compiler.optimizerRuns)) || Number(compiler.optimizerRuns) < 1) throw new Error('compiler pins solc 0.8.24, the paris EVM version and the optimizer runs.');
  const constructorArgs = input.constructor || {};
  if (!H160.test(constructorArgs.registry || '') || !H160.test(constructorArgs.curator || '')) throw new Error('constructor names the ReleaseRegistry address and the curator (zero for an open list).');
  const deployer = input.deployer || {};
  if (!SS58.test(deployer.ss58 || '') || !H160.test(deployer.evm || '')) throw new Error('deployer names the public SS58 address and its mapped EVM address; no secret belongs in a manifest.');
  for (const key of Object.keys(deployer)) if (/mnemonic|seed|secret|private|key/i.test(key)) throw new Error('A manifest carries public addresses only.');
  const budget = input.budget || {};
  if (!/^\d+(\.\d+)?$/.test(String(budget.maxCostTpot ?? ''))) throw new Error('budget.maxCostTpot is a decimal tPOT amount: the most the deployment may commit, deposit included.');
  const records = input.records || {};
  if (typeof records.journal !== 'string' || !records.journal.startsWith('artifacts/local/') || !records.journal.endsWith('.json')) throw new Error('records.journal is a JSON file under artifacts/local/.');
  if (typeof records.record !== 'string' || !records.record.startsWith('public/lifecycle/') || !records.record.endsWith('.json')) throw new Error('records.record is a JSON file under public/lifecycle/.');
  for (const path of [records.journal, records.record]) if (PROTECTED_RECORDS.includes(path)) throw new Error(`${path} is a v1 record and is preserved; choose a versioned path.`);
  const activation = input.activation || {};
  if (activation.module !== 'lib/tokenlist.deployments.js') throw new Error('activation.module is lib/tokenlist.deployments.js, the generated module the library reads.');
  const manifest = {
    schema: MANIFEST_SCHEMA, contract: 'VerifiedTokenList', version, network: 'testnet', chainId, genesisHash: lower(input.genesisHash),
    runtime: { specName: String(runtime.specName), specVersion: String(runtime.specVersion) },
    sources: [...input.sources], sourceSha256: input.sourceSha256,
    compiler: { version: '0.8.24', evmVersion: 'paris', optimizerRuns: Number(compiler.optimizerRuns) },
    constructor: { registry: lower(constructorArgs.registry), curator: lower(constructorArgs.curator) },
    expects: { version, registry: lower(constructorArgs.registry), curator: lower(constructorArgs.curator) },
    deployer: { ss58: deployer.ss58, evm: lower(deployer.evm) },
    budget: { maxCostTpot: String(budget.maxCostTpot) },
    records: { journal: records.journal, record: records.record },
    activation: { module: activation.module },
    ...(input.note ? { note: String(input.note).slice(0, 600) } : {}),
  };
  return freeze({ ...manifest, manifestHash: fingerprint(manifest) });
}

/** The compiled artifact must be exactly what the manifest describes, or nothing is estimated or signed. */
export function checkArtifact(manifest, artifact) {
  const problems = [];
  if (artifact.sourceSha256 !== manifest.sourceSha256) problems.push(`sourceSha256 ${artifact.sourceSha256} differs from the manifest's ${manifest.sourceSha256}`);
  if (!String(artifact.compiler || '').startsWith(`${manifest.compiler.version}+`)) problems.push(`compiler ${artifact.compiler} is not ${manifest.compiler.version}`);
  if (artifact.target !== `evm-${manifest.compiler.evmVersion}`) problems.push(`target ${artifact.target} is not evm-${manifest.compiler.evmVersion}`);
  if (Number(artifact.optimizerRuns) !== manifest.compiler.optimizerRuns) problems.push(`optimizer runs ${artifact.optimizerRuns} differ from ${manifest.compiler.optimizerRuns}`);
  const names = manifest.sources.map((path) => path.split('/').pop());
  if (JSON.stringify(artifact.sources) !== JSON.stringify(names)) problems.push(`sources ${JSON.stringify(artifact.sources)} differ from ${JSON.stringify(names)}`);
  if (!/^0x[0-9a-fA-F]+$/.test(artifact.bytecode || '') || !/^0x[0-9a-fA-F]+$/.test(artifact.deployedBytecode || '')) problems.push('the artifact has no bytecode');
  if (problems.length) throw new Error(`The compiled artifact does not match the manifest: ${problems.join('; ')}.`);
  return true;
}

/** EVM initcode for revive: constructor arguments ride on the initcode; separate native constructor data is refused for EVM bytecode. */
export function initcodeFor(manifest, artifact) {
  checkArtifact(manifest, artifact);
  return `${artifact.bytecode}${new Interface(artifact.abi).encodeDeploy([manifest.constructor.registry, manifest.constructor.curator]).slice(2)}`;
}

/** Immutable values are written into the runtime code at deployment, so those words are masked before comparing. */
export function compareRuntimeCode(observed, artifact) {
  const expected = lower(artifact.deployedBytecode).replace(/^0x/, '');
  const actual = lower(observed).replace(/^0x/, '');
  const ranges = Object.values(artifact.immutableReferences || {}).flat().map(({ start, length }) => [start * 2, (start + length) * 2]);
  const masked = (hex) => { let out = hex; for (const [from, to] of ranges) out = `${out.slice(0, from)}${'_'.repeat(Math.max(0, Math.min(to, out.length) - from))}${out.slice(to)}`; return out; };
  const expectedMasked = masked(expected), actualMasked = masked(actual);
  let mismatchAt = null;
  if (expectedMasked.length !== actualMasked.length) mismatchAt = Math.min(expectedMasked.length, actualMasked.length) / 2;
  else for (let index = 0; index < expectedMasked.length; index += 2) if (expectedMasked.slice(index, index + 2) !== actualMasked.slice(index, index + 2)) { mismatchAt = index / 2; break; }
  return { match: mismatchAt === null && actual.length > 0, expectedBytes: expected.length / 2, observedBytes: actual.length / 2, maskedWords: ranges.length, mismatchAt };
}

/**
 * Everything that must hold before a deployment is recorded or activated: the
 * runtime code, and version(), registry() and curator() read through both
 * interfaces at one finalized block, each equal to what the manifest expects.
 */
export function verifyDeployment({ manifest, artifact, code, identity }) {
  const checks = [];
  const add = (id, ok, observed, expected) => { checks.push({ id, status: ok ? 'passed' : 'failed', observed: String(observed), expected: String(expected) }); return ok; };
  const comparison = compareRuntimeCode(code || '', artifact);
  add('code.runtime', comparison.match, comparison.match ? `${comparison.observedBytes} bytes match (${comparison.maskedWords} immutable words masked)` : comparison.observedBytes ? `differs at byte ${comparison.mismatchAt} (${comparison.observedBytes} observed, ${comparison.expectedBytes} expected)` : 'no code', `${comparison.expectedBytes} bytes of the compiled runtime`);
  const evm = identity?.evm || {}, native = identity?.native || {};
  for (const [field, expected] of [['version', String(manifest.expects.version)], ['registry', manifest.expects.registry], ['curator', manifest.expects.curator]]) {
    const observedEvm = evm[field] === null || evm[field] === undefined ? 'unavailable' : lower(evm[field]);
    const observedNative = native[field] === null || native[field] === undefined ? 'unavailable' : lower(native[field]);
    add(`${field}.evm`, observedEvm === expected, observedEvm, expected);
    add(`${field}.native`, observedNative === expected, observedNative, expected);
  }
  add('interfaces.agree', identity?.interfacesAgree === true, identity?.interfacesAgree === true ? 'EVM RPC and ReviveApi agree' : 'the interfaces disagree or were not both read', 'agreement at one finalized block');
  add('checkpoint.finalized', !!(identity?.block?.number && identity?.block?.nativeHash), identity?.block ? `#${identity.block.number} ${identity.block.nativeHash}` : 'none', 'a finalized native block with its EVM hash');
  return { ok: checks.every((check) => check.status === 'passed'), checks, comparison };
}

/** The public, versioned record of one deployment. Separate from the v1 record; never merged into it. */
export function deploymentRecord({ manifest, artifact, journal, code, identity, verification }) {
  if (!verification?.ok) throw new Error('A deployment is recorded only after every verification check passed.');
  if (!H160.test(journal?.contractAddress || '')) throw new Error('The journal has no contract address.');
  return {
    schema: DEPLOYMENT_RECORD_SCHEMA, contract: 'VerifiedTokenList', version: manifest.version, network: manifest.network, chainId: manifest.chainId, genesisHash: manifest.genesisHash,
    address: lower(journal.contractAddress), registry: manifest.constructor.registry, curator: manifest.constructor.curator, deployer: manifest.deployer,
    sources: manifest.sources, sourceSha256: manifest.sourceSha256, compiler: artifact.compiler, optimizerRuns: manifest.compiler.optimizerRuns, evmVersion: manifest.compiler.evmVersion,
    runtimeBytes: (lower(code).replace(/^0x/, '').length) / 2, runtime: manifest.runtime, manifestHash: manifest.manifestHash,
    deploy: journal.deploy, estimate: journal.estimate ?? null, actualNativeFeesRaw: journal.actualNativeFeesRaw ?? null,
    verification: { checkedAt: new Date().toISOString(), block: identity.block, checks: verification.checks },
    abi: artifact.abi,
  };
}

const V1_KNOWN_ISSUE = 'v1: any release owner can replace a token entry with their own approved release (review F-02, 2026-10-24); v2 adds entry ownership, delist and a curator override';

/** The deployments the library can point at, built from the public records. `active` names the one the site and tools use. */
export function deploymentsFromRecords({ v1, v2 = null, active = 'v1' }) {
  if (!v1 || !H160.test(v1.contract || '')) throw new Error('The v1 record (public/lifecycle/token-list.json) is required.');
  const entries = {
    v1: { version: 1, address: lower(v1.contract), curator: lower(v1.curator), sources: 'contracts/deployed/v1', sourceSha256: v1.sourceSha256, record: 'public/lifecycle/token-list.json', deploy: v1.deploy, knownIssue: V1_KNOWN_ISSUE },
    v2: v2 ? { version: 2, address: lower(v2.address), curator: lower(v2.curator), sources: 'contracts', sourceSha256: v2.sourceSha256, record: v2.recordPath, deploy: v2.deploy, knownIssue: null } : null,
  };
  if (!entries[active]) throw new Error(`Cannot activate ${active}: it has no verified deployment record.`);
  if (v2 && v2.registry !== lower(v1.registry)) throw new Error('A v2 deployment must consume the same ReleaseRegistry as v1.');
  return { active, ...entries };
}

/** The generated ES module `lib/tokenlist.deployments.js`. Deterministic, so a regeneration without change is a no-op diff. */
export function renderDeploymentsModule(deployments) {
  const body = JSON.stringify(deployments, null, 2);
  return `// Generated by scripts/activate-token-list.js from the deployment records under public/lifecycle/.\n// Do not edit by hand: a deployment is added here only after its code, version, registry and curator\n// were verified through both interfaces at a finalized block. Regenerate with --render.\nexport const TOKEN_LIST_DEPLOYMENTS = Object.freeze(${body});\n`;
}
