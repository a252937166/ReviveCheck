import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { Account, bytesToHex, createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { createVM } from '@ethereumjs/vm';
import { Interface } from 'ethers';
import { compileTokenList, TOKEN_LIST_SOURCE_VERSION } from '../scripts/compile-token-list.js';
import { compileReleaseRegistry } from '../scripts/compile-release-registry.js';
import { normalizeManifest, checkArtifact, initcodeFor, compareRuntimeCode, verifyDeployment, deploymentRecord, deploymentsFromRecords, renderDeploymentsModule, PROTECTED_RECORDS } from '../lib/deployment.js';
import { TOKEN_LIST, TOKEN_LIST_VERSIONS, tokenListInterface } from '../lib/tokenlist.js';
import { TOKEN_LIST_DEPLOYMENTS } from '../lib/tokenlist.deployments.js';

// The v2 deployment tooling, offline: a validated manifest, the compiled v2 artifact, a
// deployment in an in-memory Paris EVM, and the verification the deploy and activate
// scripts run before anything is recorded. No Portaldot node, wallet or signing.
const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8').then(JSON.parse);
const manifestInput = await read('deployments/token-list-v2.manifest.json');
const v1Record = await read('public/lifecycle/token-list.json');
const v1Artifact = await read('artifacts/VerifiedTokenList.json');
const { extra, ...v2Artifact } = await compileTokenList();
const registryArtifact = await compileReleaseRegistry();
const ZERO = `0x${'00'.repeat(20)}`;

async function deployInMemory(artifact, manifest) {
  const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Paris }) });
  const deployer = createAddressFromString(manifest.deployer.evm);
  await vm.stateManager.putAccount(deployer, new Account(0n, 10n ** 18n));
  // The registry the manifest reuses, at its real address, so registry() reads back the manifest value.
  const registry = createAddressFromString(manifest.constructor.registry);
  const registryCode = await vm.evm.runCall({ caller: deployer, gasLimit: 3_000_000n, data: hexToBytes(registryArtifact.bytecode) });
  await vm.stateManager.putCode(registry, await vm.stateManager.getCode(registryCode.createdAddress));
  const result = await vm.evm.runCall({ caller: deployer, gasLimit: 3_000_000n, data: hexToBytes(initcodeFor(manifest, artifact)) });
  assert.equal(result.execResult.exceptionError, undefined, 'deployment must execute');
  const address = result.createdAddress;
  const code = bytesToHex(await vm.stateManager.getCode(address));
  const abi = new Interface(artifact.abi);
  const call = async (method) => { const out = await vm.evm.runCall({ caller: deployer, to: address, gasLimit: 500_000n, data: hexToBytes(abi.encodeFunctionData(method, [])), isStatic: true }); if (out.execResult.exceptionError) return null; const [value] = abi.decodeFunctionResult(method, bytesToHex(out.execResult.returnValue)); return typeof value === 'bigint' ? value.toString() : String(value).toLowerCase(); };
  const side = { version: await call('version'), registry: await call('registry'), curator: await call('curator') };
  const identity = { address: address.toString(), block: { number: '1', nativeHash: `0x${'aa'.repeat(32)}`, evmHash: `0x${'bb'.repeat(32)}` }, evm: side, native: { ...side }, interfacesAgree: true };
  return { vm, address: address.toString(), code, identity };
}

test('the manifest validates completely, pins the registry it reuses, and refuses to overwrite v1', () => {
  const manifest = normalizeManifest(manifestInput);
  assert.equal(manifest.version, 2);
  assert.equal(manifest.constructor.registry, v1Record.registry, 'v2 consumes the same ReleaseRegistry as v1');
  assert.equal(manifest.expects.version, 2);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(normalizeManifest({ ...manifestInput, note: undefined }).manifestHash !== manifest.manifestHash, true, 'the note is part of the manifest');
  assert.throws(() => normalizeManifest({ ...manifestInput, version: 1 }), /never redeployed/);
  assert.throws(() => normalizeManifest({ ...manifestInput, records: { journal: 'artifacts/local/token-list-deploy.json', record: 'public/lifecycle/token-list-v2.json' } }), /v1 record and is preserved/);
  assert.throws(() => normalizeManifest({ ...manifestInput, records: { journal: 'artifacts/local/x.json', record: 'public/lifecycle/token-list.json' } }), /v1 record and is preserved/);
  assert.throws(() => normalizeManifest({ ...manifestInput, deployer: { ...manifestInput.deployer, mnemonic: 'never' } }), /public addresses only/);
  assert.throws(() => normalizeManifest({ ...manifestInput, deployer: { ss58: manifestInput.deployer.ss58 } }), /public SS58 address and its mapped EVM address/);
  assert.throws(() => normalizeManifest({ ...manifestInput, compiler: { version: '0.8.25', evmVersion: 'paris', optimizerRuns: 1 } }), /solc 0.8.24/);
  assert.throws(() => normalizeManifest({ ...manifestInput, budget: {} }), /maxCostTpot/);
  assert.throws(() => normalizeManifest({ ...manifestInput, activation: { module: 'lib/tokenlist.js' } }), /generated module/);
  assert.ok(PROTECTED_RECORDS.includes('contracts/deployed/v1'));
});

test('the compiled v2 sources match the manifest, and the preserved v1 artifact does not', () => {
  const manifest = normalizeManifest(manifestInput);
  assert.equal(checkArtifact(manifest, v2Artifact), true);
  assert.equal(TOKEN_LIST_SOURCE_VERSION, 2);
  assert.throws(() => checkArtifact(manifest, v1Artifact), /sourceSha256/);
  assert.equal(v1Artifact.sourceSha256, v1Record.sourceSha256, 'artifacts/VerifiedTokenList.json is still the v1 artifact');
  assert.equal((v1Artifact.deployedBytecode.length - 2) / 2, v1Record.runtimeBytes);
  assert.ok(Object.keys(v2Artifact.immutableReferences).length >= 2, 'registry and curator are immutables');
  const initcode = initcodeFor(manifest, v2Artifact);
  assert.ok(initcode.startsWith(v2Artifact.bytecode));
  assert.equal(initcode.length, v2Artifact.bytecode.length + 128, 'two ABI words of constructor arguments ride on the initcode');
});

test('deployed runtime code matches the artifact only once the immutable words are masked', async () => {
  const manifest = normalizeManifest(manifestInput);
  const { code } = await deployInMemory(v2Artifact, manifest);
  assert.notEqual(code, v2Artifact.deployedBytecode, 'immutables are written into the code at deployment');
  const comparison = compareRuntimeCode(code, v2Artifact);
  assert.equal(comparison.match, true, `mismatch at ${comparison.mismatchAt}`);
  assert.equal(comparison.maskedWords, Object.values(v2Artifact.immutableReferences).flat().length);
  const tampered = `${code.slice(0, -4)}${code.slice(-4) === '0000' ? 'ffff' : '0000'}`;
  assert.equal(compareRuntimeCode(tampered, v2Artifact).match, false);
  assert.equal(compareRuntimeCode(tampered, v2Artifact).mismatchAt, comparison.observedBytes - 1, 'the changed last byte is reported');
  assert.equal(compareRuntimeCode('0x', v2Artifact).match, false);
  assert.equal(compareRuntimeCode(v1Artifact.deployedBytecode, v2Artifact).match, false, 'the v1 runtime is not the v2 runtime');
});

test('a deployment is verified by code, version, registry and curator through both interfaces', async () => {
  const manifest = normalizeManifest(manifestInput);
  const { code, identity } = await deployInMemory(v2Artifact, manifest);
  assert.deepEqual(identity.evm, { version: '2', registry: manifest.constructor.registry, curator: ZERO });
  const verification = verifyDeployment({ manifest, artifact: v2Artifact, code, identity });
  assert.equal(verification.ok, true, JSON.stringify(verification.checks.filter((check) => check.status !== 'passed')));
  assert.deepEqual(verification.checks.map((check) => check.id), ['code.runtime', 'version.evm', 'version.native', 'registry.evm', 'registry.native', 'curator.evm', 'curator.native', 'interfaces.agree', 'checkpoint.finalized']);
  const wrongVersion = verifyDeployment({ manifest, artifact: v2Artifact, code, identity: { ...identity, evm: { ...identity.evm, version: null }, native: { ...identity.native, version: null } } });
  assert.equal(wrongVersion.ok, false);
  assert.deepEqual(wrongVersion.checks.filter((check) => check.status !== 'passed').map((check) => check.id), ['version.evm', 'version.native']);
  const otherCurator = normalizeManifest({ ...manifestInput, constructor: { ...manifestInput.constructor, curator: manifestInput.deployer.evm } });
  const curatorMismatch = verifyDeployment({ manifest: otherCurator, artifact: v2Artifact, code, identity });
  assert.deepEqual(curatorMismatch.checks.filter((check) => check.status !== 'passed').map((check) => check.id), ['curator.evm', 'curator.native']);
  const split = verifyDeployment({ manifest, artifact: v2Artifact, code, identity: { ...identity, native: { ...identity.native, registry: ZERO }, interfacesAgree: false } });
  assert.deepEqual(split.checks.filter((check) => check.status !== 'passed').map((check) => check.id), ['registry.native', 'interfaces.agree']);
  const noCheckpoint = verifyDeployment({ manifest, artifact: v2Artifact, code, identity: { ...identity, block: null } });
  assert.equal(noCheckpoint.ok, false);
  assert.throws(() => deploymentRecord({ manifest, artifact: v2Artifact, journal: { contractAddress: identity.address }, code, identity, verification: wrongVersion }), /only after every verification check passed/);
  const journal = { contractAddress: identity.address, deploy: { extrinsicHash: `0x${'11'.repeat(32)}`, blockHash: `0x${'22'.repeat(32)}`, blockNumber: '1', finalizedAt: '2026-10-24T00:00:00.000Z' }, estimate: { estimatedCostTpot: '1' }, actualNativeFeesRaw: '1' };
  const record = deploymentRecord({ manifest, artifact: v2Artifact, journal, code, identity, verification });
  assert.equal(record.version, 2);
  assert.equal(record.address, identity.address.toLowerCase());
  assert.equal(record.registry, v1Record.registry);
  assert.equal(record.runtimeBytes, (code.length - 2) / 2);
  assert.equal(record.manifestHash, manifest.manifestHash);
});

test('the generated deployments module is in sync with the records, deterministic, and switches only to a recorded version', async () => {
  const fromRecords = deploymentsFromRecords({ v1: v1Record });
  const rendered = renderDeploymentsModule(fromRecords);
  assert.equal(rendered, await readFile(new URL('lib/tokenlist.deployments.js', root), 'utf8'), 'lib/tokenlist.deployments.js is regenerated from the records, not edited');
  assert.equal(renderDeploymentsModule(fromRecords), rendered);
  assert.equal(TOKEN_LIST_DEPLOYMENTS.active, 'v1');
  assert.equal(TOKEN_LIST.address, v1Record.contract);
  assert.equal(TOKEN_LIST.version, 1);
  assert.equal(TOKEN_LIST.record, 'public/lifecycle/token-list.json');
  assert.equal(TOKEN_LIST.registry, v1Record.registry);
  assert.equal(TOKEN_LIST_VERSIONS.v2, null);
  assert.throws(() => deploymentsFromRecords({ v1: v1Record, active: 'v2' }), /no verified deployment record/);
  const manifest = normalizeManifest(manifestInput);
  const v2 = { address: `0x${'cd'.repeat(20)}`, curator: ZERO, registry: v1Record.registry, sourceSha256: manifest.sourceSha256, deploy: { blockNumber: '2' }, recordPath: manifest.records.record };
  const activated = deploymentsFromRecords({ v1: v1Record, v2, active: 'v2' });
  assert.equal(activated.v2.record, 'public/lifecycle/token-list-v2.json');
  assert.equal(activated.v1.address, v1Record.contract, 'v1 stays listed after v2 is activated');
  assert.throws(() => deploymentsFromRecords({ v1: v1Record, v2: { ...v2, registry: `0x${'ee'.repeat(20)}` }, active: 'v2' }), /same ReleaseRegistry/);
  const dir = await mkdtemp(path.join(tmpdir(), 'revivecheck-deployments-'));
  const file = path.join(dir, 'deployments.js');
  await writeFile(file, renderDeploymentsModule(activated));
  const loaded = await import(pathToFileURL(file).href);
  assert.equal(loaded.TOKEN_LIST_DEPLOYMENTS.active, 'v2');
  assert.equal(loaded.TOKEN_LIST_DEPLOYMENTS.v2.address, v2.address);
  assert.ok(Object.isFrozen(loaded.TOKEN_LIST_DEPLOYMENTS));
});

test('the identity reader handles a contract without version() as the v1 deployment', () => {
  // v1 has no version() selector: the ABI still encodes the call, and both interfaces answer with nothing decodable.
  const data = tokenListInterface.encodeFunctionData('version', []);
  assert.equal(data.length, 10);
  assert.throws(() => tokenListInterface.decodeFunctionResult('version', '0x'));
});
