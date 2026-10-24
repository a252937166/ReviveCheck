// A stand-in for the V3 testnet that runs on this machine: the compiled ReleaseRegistry
// and VerifiedTokenList v2 execute in an in-memory Paris EVM (the same bytecode the
// tests use), a stub with decimals() = 6 sits at pUSD's real precompile address, and
// reports are sealed from fixture reads with mode `rehearsal` and scope
// `local-rehearsal`. Everything it returns is labelled simulated. It exists so the
// catalog's whole lifecycle can be exercised without tPOT, a wallet or a network; it
// proves the contracts' and the policy's behaviour, not testnet execution.
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { Account, bytesToHex, createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { createVM } from '@ethereumjs/vm';
import { AbiCoder, Interface, id as keccakText, keccak256 } from 'ethers';
import { compileReleaseRegistry } from '../../../scripts/compile-release-registry.js';
import { compileTokenList } from '../../../scripts/compile-token-list.js';
import { inspectWithClients, NETWORK } from '../../../lib/chain.js';
import { sealRun, overall } from '../../../lib/report.js';
import { REGISTRY, registryInterface, releaseLabel } from '../../../lib/registry.js';
import { tokenListInterface } from '../../../lib/tokenlist.js';
import { DEMO_PRECOMPILE } from '../../../lib/demo.js';

const ZERO = `0x${'00'.repeat(20)}`, ZERO32 = `0x${'00'.repeat(32)}`;
const PUSD_STUB = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
/// A stand-in for the pUSD ERC-20 precompile: only decimals(), which VerifiedTokenList.list reads.
contract PUSDStub { function decimals() external pure returns (uint8) { return 6; } }`;

/** Fixture identities. The accounts are controlled by this example; the token list address is not deployed anywhere. */
export const FIXTURE = Object.freeze({
  chainId: NETWORK.chainId, genesisHash: NETWORK.genesisHash, specName: 'portaldot-v3', specVersion: '3002',
  registry: REGISTRY.address, tokenList: '0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e', token: DEMO_PRECOMPILE.toLowerCase(),
  accounts: Object.freeze({ owner: `0x${'a1'.repeat(20)}`, reviewer: `0x${'b2'.repeat(20)}`, stranger: `0x${'c3'.repeat(20)}` }),
  label: 'SIMULATED: fixture accounts A (owner), B (reviewer) and C (stranger) are controlled by this example; contracts run in an in-memory EVM; no Portaldot network is read.',
});

/** The reads `inspectWithClients` makes, answered from fixtures that describe pUSD as the chain does (6 decimals). */
function fixtureClients({ block, runtime, decimals = 6 }) {
  const native = '5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt', h160 = `0x${'48'.repeat(20)}`;
  const word = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
  const text = (value) => AbiCoder.defaultAbiCoder().encode(['string'], [value]);
  const some = (value) => ({ isSome: true, isNone: false, unwrap: () => value });
  const bytes = (value) => ({ toUtf8: () => value });
  const api = {
    genesisHash: NETWORK.genesisHash,
    runtimeVersion: { specName: runtime.specName, specVersion: runtime.specVersion, transactionVersion: 2, stateVersion: 1 },
    registry: { chainDecimals: [14], chainTokens: ['tPOT'] },
    consts: { revive: { chainId: NETWORK.chainId, nativeToEthRatio: '10000', allowEVMBytecode: 'true', autoMap: 'true', depositPerByte: '6000000000000', depositPerItem: '15000000000000', gasScale: '5' }, balances: { existentialDeposit: '10000000000000' } },
    rpc: { chain: { getFinalizedHead: async () => block.nativeHash, getHeader: async () => ({ number: Number(block.number) }), getBlockHash: async () => block.nativeHash }, state: { getRuntimeVersion: async () => ({ specName: runtime.specName, specVersion: runtime.specVersion, transactionVersion: 2, stateVersion: 1 }) } },
    call: { reviveApi: { ethBlockHash: async () => block.evmHash, accountId: async () => native, address: async () => h160 } },
    query: { assets: { asset: async () => some({ owner: native, supply: '100000000000' }), metadata: async () => ({ decimals, symbol: bytes('pUSD'), name: bytes('Portaldot USD (test)') }), account: async () => some({ balance: '99543035000' }) } },
  };
  api.at = async () => api;
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return `0x${NETWORK.chainId.toString(16)}`;
    if (method === 'eth_getBlockByNumber') return { number: `0x${Number(block.number).toString(16)}`, hash: block.evmHash };
    if (method !== 'eth_call') throw new Error(`Unexpected ${method}`);
    const selector = params[0].data.slice(0, 10);
    return { '0x18160ddd': word('100000000000'), '0x70a08231': word('99543035000'), '0x313ce567': word(decimals), '0x95d89b41': text('pUSD'), '0x06fdde03': text('Portaldot USD (test)') }[selector];
  };
  return { api, rpc };
}

export async function createLocalChain({ clock = () => new Date() } = {}) {
  const [registryArtifact, listArtifact] = await Promise.all([compileReleaseRegistry(), compileTokenList({ extraSources: { 'PUSDStub.sol': PUSD_STUB } })]);
  const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Paris }) });
  const address = (hex) => createAddressFromString(hex);
  for (const account of Object.values(FIXTURE.accounts)) await vm.stateManager.putAccount(address(account), new Account(0n, 10n ** 20n));
  const deployer = address(FIXTURE.accounts.owner);
  // Deploy each contract, then copy its runtime code to the address the catalog's policy names.
  const place = async (bytecode, at) => {
    const result = await vm.evm.runCall({ caller: deployer, gasLimit: 5_000_000n, data: hexToBytes(bytecode) });
    if (result.execResult.exceptionError) throw new Error(`Fixture deployment failed: ${result.execResult.exceptionError.error}`);
    await vm.stateManager.putCode(address(at), await vm.stateManager.getCode(result.createdAddress));
  };
  await place(registryArtifact.bytecode, FIXTURE.registry);
  await place(`${listArtifact.bytecode}${new Interface(listArtifact.abi).encodeDeploy([FIXTURE.registry, ZERO]).slice(2)}`, FIXTURE.tokenList);
  await place(`0x${listArtifact.extra['PUSDStub.sol'].PUSDStub.evm.bytecode.object}`, FIXTURE.token);
  let height = 1000, runtime = { specName: FIXTURE.specName, specVersion: FIXTURE.specVersion }, reachable = true;
  const block = () => ({ number: String(height), nativeHash: keccakText(`local-native-${height}`), evmHash: keccakText(`local-evm-${height}`) });
  const reach = () => { if (!reachable) throw new Error('Local fixture node is unavailable (simulated outage).'); };
  const write = async (actor, to, iface, method, args) => {
    const result = await vm.evm.runCall({ caller: address(actor), to: address(to), gasLimit: 2_000_000n, data: hexToBytes(iface.encodeFunctionData(method, args)) });
    height += 1;
    if (result.execResult.exceptionError) {
      let revert = null;
      try { revert = iface.parseError(bytesToHex(result.execResult.returnValue))?.name ?? null; } catch { /* no custom error */ }
      const error = new Error(`${method} reverted${revert ? `: ${revert}` : ''}`);
      error.revert = revert;
      throw error;
    }
    // Logs as plain strings, so a transcript serializes without BigInt.
    const logs = result.execResult.logs.map(([, topics, data]) => { try { const log = iface.parseLog({ topics: topics.map(bytesToHex), data: bytesToHex(data) }); return log && { name: log.name, args: Object.fromEntries(log.fragment.inputs.map((input) => [input.name, String(log.args[input.name])])) }; } catch { return null; } }).filter(Boolean);
    return { blockNumber: String(height), logs };
  };
  const read = async (to, iface, method, args) => {
    const result = await vm.evm.runCall({ caller: deployer, to: address(to), gasLimit: 1_000_000n, data: hexToBytes(iface.encodeFunctionData(method, args)), isStatic: true });
    if (result.execResult.exceptionError) throw new Error(`${method} failed in the fixture EVM`);
    return iface.decodeFunctionResult(method, bytesToHex(result.execResult.returnValue));
  };
  const lower = (value) => String(value).toLowerCase();
  return {
    simulation: true, label: FIXTURE.label, accounts: FIXTURE.accounts, registry: FIXTURE.registry, tokenList: FIXTURE.tokenList, token: FIXTURE.token,
    height: () => height, block,
    /** Fixture controls: a runtime upgrade and a node outage, both simulated. */
    setRuntime(specVersion) { runtime = { ...runtime, specVersion: String(specVersion) }; },
    setReachable(flag) { reachable = !!flag; },
    async submit(actor, label, reportHash) {
      const { blockNumber, logs } = await write(actor, FIXTURE.registry, registryInterface, 'submit', [releaseLabel(label), `0x${reportHash}`]);
      const log = logs.find((entry) => entry.name === 'ReportSubmitted');
      return { releaseId: lower(log.args.releaseId), revision: log.args.revision, blockNumber };
    },
    review: (actor, releaseId, reportHash, approved) => write(actor, FIXTURE.registry, registryInterface, 'review', [releaseId, `0x${reportHash}`, approved]),
    list: (actor, { token, releaseId, reportHash, reviewer, decimals }) => write(actor, FIXTURE.tokenList, tokenListInterface, 'list', [token, releaseId, `0x${reportHash}`, reviewer, decimals]),
    delist: (actor, token) => write(actor, FIXTURE.tokenList, tokenListInterface, 'delist', [token]),
    /** Shaped like lib/service.js readRegistry: one checkpoint, every trusted reviewer's decision. */
    async readRegistry({ releaseId, reviewers = [] }) {
      reach();
      const [owner, revision, reportHash] = await read(FIXTURE.registry, registryInterface, 'releaseOf', [releaseId]);
      const decisions = {};
      for (const reviewer of reviewers) { const [reviewed, approved] = await read(FIXTURE.registry, registryInterface, 'decisionOf', [releaseId, reviewer]); decisions[lower(reviewer)] = { reviewer: lower(reviewer), reviewed, approved }; }
      return { address: FIXTURE.registry, releaseId: lower(releaseId), block: block(), observedAt: clock().toISOString(), release: { exists: revision !== 0n, owner: lower(owner), revision: revision.toString(), reportHash: lower(reportHash) }, decision: null, decisions, interfacesAgree: true, simulation: true };
    },
    /** Shaped like lib/service.js readTokenList. */
    async readTokenList({ token }) {
      reach();
      const [listed] = await read(FIXTURE.tokenList, tokenListInterface, 'isListed', [token]);
      const [releaseId, reportHash, reviewer] = await read(FIXTURE.tokenList, tokenListInterface, 'entryOf', [token]);
      const [version] = await read(FIXTURE.tokenList, tokenListInterface, 'version', []);
      const [registry] = await read(FIXTURE.tokenList, tokenListInterface, 'registry', []);
      const [curator] = await read(FIXTURE.tokenList, tokenListInterface, 'curator', []);
      const side = { version: version.toString(), registry: lower(registry), curator: lower(curator) };
      const identity = { address: FIXTURE.tokenList, block: block(), evm: side, native: { ...side }, version: Number(version), versionSource: 'on-chain-version-getter', runtimeCodeHash: keccak256(bytesToHex(await vm.stateManager.getCode(address(FIXTURE.tokenList)))), interfacesAgree: true, simulation: true };
      return { token: lower(token), list: FIXTURE.tokenList, block: block(), observedAt: clock().toISOString(), listed, entry: releaseId === ZERO32 ? null : { releaseId: lower(releaseId), reportHash: lower(reportHash), reviewer: lower(reviewer) }, interfacesAgree: true, identity, simulation: true };
    },
    /** Shaped like lib/service.js networkStatus. */
    observe() {
      reach();
      const current = block();
      return { network: 'local', name: 'Local rehearsal fixtures', chainId: FIXTURE.chainId, genesisHash: FIXTURE.genesisHash, runtime: `${runtime.specName}/${runtime.specVersion}`, finalized: { number: current.number, nativeHash: current.nativeHash }, observedAt: clock().toISOString(), simulation: true };
    },
    /** A sealed report of a plan against the fixtures: the real inspector, fixture reads, rehearsal scope. */
    async check(plan, { previous = null, decimals = 6 } = {}) {
      height += 1;
      const result = await inspectWithClients(plan, fixtureClients({ block: block(), runtime, decimals }));
      const network = { ...result.network, name: 'Local rehearsal fixtures', source: 'synthetic-local-fixture' };
      const at = clock().toISOString();
      return sealRun({ id: `local-${height}`, projectId: 'token-catalog-local', projectName: 'pUSD token list (simulated)', release: plan.release, input: plan, mode: 'rehearsal', scope: 'local-rehearsal', scenario: 'token-catalog-local', trigger: previous ? 'recheck' : 'manual', startedAt: at, completedAt: at, previousRunId: previous?.id ?? null, status: overall(result.checks), checks: result.checks, network, limitations: [...result.limitations, FIXTURE.label] });
    },
  };
}
