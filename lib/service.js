// ReviveCheck's capabilities as plain async functions. The browser studio, the MCP
// server and the local REST endpoints all call these, so each feature has one
// implementation. Everything here is read-only: transactions are prepared and
// dry-run, never signed. One connection per network is reused; the public nodes
// are slow to hand out metadata, so only the first call pays for the handshake.
import { abortable, availableNativeBalance, connectNative, evmRpc, formatNative, inspectWithClients, safeError, str } from './chain.js';
import { keccakAsHex } from '@polkadot/util-crypto';
import { inspectPromotionWithClients } from './promotion.js';
import { replayWithClients } from './replay.js';
import { evaluateBinding, normalizePolicy } from './policy.js';
import { sealRun, overall, compareRuns, verifyRun } from './report.js';
import { attestationRemark, locateExtrinsic, verifyAttestationWithApi } from './attestation.js';
import { readRegistryWithClients, registryInterface, decodeRegistryError, submitCall, reviewCall, releaseIdOf, REGISTRY } from './registry.js';
import { evidenceBytes, retrieveEvidenceWithApi } from './evidence.js';
import { TOKEN_LIST, assertTokenListWritable, listCall, decodeTokenListError, readTokenListWithClients } from './tokenlist.js';
import { demoPlan, DEMO_PROJECT } from './demo.js';
import { NETWORKS, blockUrl } from './networks.js';

const connections = {};
function connection(network) {
  connections[network.key] ||= connectNative({ url: network.substrateRpcUrl, signal: AbortSignal.timeout(50_000) })
    .then((api) => { api.on('disconnected', () => { delete connections[network.key]; }); return api; })
    .catch((error) => { delete connections[network.key]; throw new Error(`${network.name} did not answer in time (${error.message}). Nothing was signed; retry in a moment.`); });
  return connections[network.key];
}
export const warm = (key = 'testnet') => connection(NETWORKS[key]).catch(() => {});
export async function closeConnections() {
  const pending = Object.values(connections);
  for (const key of Object.keys(connections)) delete connections[key];
  await Promise.all(pending.map((api) => api.then((chain) => chain.disconnect(), () => {})));
}

export async function withNetwork(network, task, timeoutMs = 75_000) {
  const signal = AbortSignal.timeout(timeoutMs);
  const api = await abortable(connection(network), signal);
  return abortable(task({ api, rpc: (method, params) => evmRpc(method, params, { signal }), signal }), signal);
}
// A run whose first check could not reach the network is a retry, not a result.
function reached(result, network) {
  if (result.checks?.[0]?.status === 'unknown') throw new Error(`${network.name} did not answer in time: ${result.checks[0].observed} Nothing was signed; retry in a moment.`);
  return result;
}
const H160 = /^0x[0-9a-fA-F]{40}$/;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unwrap = (value) => value?.isSome ? value.unwrap() : value?.isNone ? null : value;
const slug = (text) => String(text || 'release').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'release';

/** Finalized head, runtime and identity of one V3 network, read through its official node. */
export async function networkStatus(key = 'testnet') {
  const network = NETWORKS[key];
  if (!network) throw new Error('Choose the testnet or live network.');
  return withNetwork(network, async ({ api, rpc, signal }) => {
    const finalizedHash = str(await abortable(api.rpc.chain.getFinalizedHead(), signal));
    const [header, version] = await abortable(Promise.all([api.rpc.chain.getHeader(finalizedHash), api.rpc.state.getRuntimeVersion(finalizedHash)]), signal);
    const number = header.number.toString();
    const genesisHash = str(api.genesisHash).toLowerCase();
    let evm = null;
    if (network.evmRpcUrl) {
      const at = await abortable(api.at(finalizedHash), signal);
      const [mapped, chainId] = await abortable(Promise.all([at.call.reviveApi.ethBlockHash(number), rpc('eth_chainId', [])]), signal);
      evm = { rpcUrl: network.evmRpcUrl, chainId: Number(BigInt(chainId)), finalizedHash: unwrap(mapped) ? str(unwrap(mapped)) : null };
    }
    return {
      network: key, name: network.name, symbol: network.symbol, decimals: network.decimals,
      chainId: Number(api.consts.revive?.chainId?.toString() ?? network.chainId), genesisHash, genesisMatches: genesisHash === network.genesisHash,
      runtime: `${version.specName}/${version.specVersion}`,
      finalized: { number, nativeHash: finalizedHash, explorerUrl: blockUrl(network, finalizedHash) },
      evm, explorer: network.explorer, observedAt: new Date().toISOString(),
    };
  });
}

/** Run an acceptance plan against the V3 testnet and seal the report. */
export async function checkRelease(plan, { previous = null, projectId, projectName } = {}) {
  const startedAt = new Date().toISOString();
  const result = reached(await withNetwork(NETWORKS.testnet, (clients) => inspectWithClients(plan, clients)), NETWORKS.testnet);
  return sealRun({
    id: crypto.randomUUID(), projectId: projectId || previous?.projectId || slug(plan.logicalContractId || plan.name), projectName: projectName || plan.name || 'Release', release: plan.release, input: plan,
    mode: 'live', scope: NETWORKS.testnet.scope, scenario: null, trigger: previous ? 'recheck' : 'manual', startedAt, completedAt: new Date().toISOString(),
    previousRunId: previous?.id ?? null, status: overall(result.checks), checks: result.checks, network: result.network, limitations: result.limitations,
  });
}
export const checkDemoRelease = (version, previous = null) => checkRelease(demoPlan(version), { previous, projectId: 'demo-pusd-token-list', projectName: DEMO_PROJECT.name });

/** Ask V3 Live whether an accepted testnet report can stand for it. Nothing is deployed or listed. */
export async function assessPromotion(accepted) {
  if (!verifyRun(accepted)) throw new Error('The accepted report failed its integrity check.');
  if (accepted.scope !== NETWORKS.testnet.scope || accepted.status !== 'passed') throw new Error('Promotion starts from a passed V3 testnet report.');
  const input = { ...accepted.input, promotionOf: { reportHash: accepted.evidenceHash, release: accepted.release, network: 'testnet', specVersion: accepted.network.specVersion, finalizedBlockNumber: accepted.network.finalizedBlockNumber } };
  const startedAt = new Date().toISOString();
  const result = reached(await withNetwork(NETWORKS.live, ({ api, signal }) => inspectPromotionWithClients(input, accepted, { api, signal })), NETWORKS.live);
  return sealRun({
    id: crypto.randomUUID(), projectId: accepted.projectId, projectName: accepted.projectName, release: accepted.release, input,
    mode: 'live', scope: NETWORKS.live.scope, scenario: null, trigger: 'promotion', startedAt, completedAt: new Date().toISOString(),
    previousRunId: accepted.id, status: overall(result.checks), checks: result.checks, network: result.network, limitations: result.limitations,
  });
}

/** Re-read a sealed testnet report at its own pinned block, through both interfaces. */
export async function replay(run) {
  if (!verifyRun(run)) throw new Error('The report failed its integrity check, so there is nothing trustworthy to replay.');
  const result = await withNetwork(NETWORKS.testnet, (clients) => replayWithClients(run, clients));
  if (result.status === 'unavailable') throw new Error(`${result.error || 'The replay could not read the pinned block.'} Retry in a moment.`);
  return result;
}

/** Which checks changed between two reports of one release target, and whether the comparison is meaningful. */
export function compare(baseline, candidate) {
  const { baseline: _before, candidate: _after, changes, ...result } = compareRuns(baseline, candidate);
  return {
    baselineHash: baseline?.evidenceHash ?? null, candidateHash: candidate?.evidenceHash ?? null, ...result,
    changes: changes.map(({ id, title, before, after, transition }) => ({ id, title, transition, before: before?.status ?? null, after: after?.status ?? null, observed: after?.observed ?? null })),
  };
}

/** Verify a System.remark_with_event review attestation from chain data alone. */
export async function verifyAttestation({ extrinsicHash, blockHash }) {
  const network = NETWORKS.testnet;
  const located = blockHash ? { blockHash } : await locateExtrinsic(network, extrinsicHash, { signal: AbortSignal.timeout(15_000) });
  if (!located) return { verified: false, extrinsicHash: String(extrinsicHash).toLowerCase(), reasons: ['The official explorer has not indexed this extrinsic yet. Supply its block hash, or try again shortly.'] };
  return withNetwork(network, ({ api, signal }) => verifyAttestationWithApi(api, { extrinsicHash, blockHash: located.blockHash }, { signal }));
}

/** Read one release from the shared ReleaseRegistry through both interfaces at one finalized block. */
export async function readRegistry({ releaseId, owner, label, reviewer, reviewers }) {
  const id = releaseId || releaseIdOf(owner, label);
  return withNetwork(NETWORKS.testnet, (clients) => readRegistryWithClients(clients, { releaseId: id, reviewer, reviewers }));
}

/**
 * Evaluate a policy binding against fresh reads: the network observation, the
 * registry with every trusted reviewer's decision, the consumer listing when the
 * policy requires it, and the stored report when it requires that. Each read that
 * fails is handed to the evaluator as an error, which makes the result `unknown`
 * rather than throwing: an unavailable verification blocks, it never passes.
 */
export async function collectPolicyInputs({ policy, binding }) {
  const normalized = normalizePolicy(policy);
  if (normalized.simulation) throw new Error('A local-rehearsal policy is evaluated offline against a local chain; the service reads the live networks only.');
  if (normalized.registry.address !== REGISTRY.address) throw new Error(`The service reads the ReleaseRegistry at ${REGISTRY.address}; the policy names ${normalized.registry.address}.`);
  const network = NETWORKS[normalized.network.key];
  const capture = (promise) => promise.catch((error) => ({ error: safeError(error) }));
  const [observation, registry, listing] = await Promise.all([
    capture(networkStatus(network.key)),
    capture(withNetwork(network, (clients) => readRegistryWithClients(clients, { releaseId: binding?.releaseId, reviewers: normalized.reviewers.trusted }))),
    normalized.consumer?.requireListed ? capture(withNetwork(network, (clients) => readTokenListWithClients(clients, { token: binding?.subject, address: normalized.consumer.address }))) : Promise.resolve(null),
  ]);
  const evidence = normalized.evidence.requireStoredOnChain
    ? (binding?.storage?.extrinsicHash ? await capture(retrieveEvidence({ ...binding.storage, expectedHash: binding.reportHash })) : { error: 'The binding names no stored-evidence extrinsic.' })
    : null;
  return { observation, registry, listing, evidence, collectedAt: new Date().toISOString() };
}

export async function evaluatePolicy({ policy, binding, report, now }) {
  const inputs = await collectPolicyInputs({ policy, binding });
  return evaluateBinding({ policy, binding, report, ...inputs, now });
}

/** Retrieve a report stored through remark.store and verify it from chain data alone. */
export async function retrieveEvidence({ extrinsicHash, blockHash, expectedHash }) {
  const network = NETWORKS.testnet;
  const located = blockHash ? { blockHash } : await locateExtrinsic(network, extrinsicHash, { signal: AbortSignal.timeout(15_000) });
  if (!located) return { verified: false, extrinsicHash: String(extrinsicHash).toLowerCase(), reasons: ['The official explorer has not indexed this extrinsic yet. Supply its block hash, or try again shortly.'] };
  return withNetwork(network, ({ api, signal }) => retrieveEvidenceWithApi(api, { extrinsicHash, blockHash: located.blockHash, expectedHash }, { signal }));
}

/** Read one token's listing in the VerifiedTokenList through both interfaces at one finalized block. */
export async function readTokenList({ token }) {
  return withNetwork(NETWORKS.testnet, (clients) => readTokenListWithClients(clients, { token }));
}

/**
 * Prepare an unsigned transaction. With `from` (a native SS58 or EVM address), a
 * contract call is also dry-run through ReviveApi, which returns the weight and
 * storage deposit a native Revive.call needs, and the revert reason if it would fail.
 */
export async function prepareTransaction({ action, label, reportHash, releaseId, approved = true, decision = 'accepted', report, token, reviewer, decimals, from }) {
  if (action === 'list') assertTokenListWritable();
  const network = NETWORKS.testnet;
  if (action === 'remark') {
    const remark = attestationRemark({ reportHash: String(reportHash || '').replace(/^0x/, '').toLowerCase(), decision });
    return { action, network: network.key, remark, native: { pallet: 'system', call: 'remarkWithEvent', args: { remark } }, verify: 'After it is finalized, pass the extrinsic hash to verify_attestation.' };
  }
  if (action === 'store') {
    const evidence = evidenceBytes(report);
    return { action, network: network.key, bytes: evidence.length, sha256: evidence.sha256, contentHash: evidence.contentHash, hex: evidence.hex, native: { pallet: 'remark', call: 'store', args: { remark: evidence.hex } }, verify: 'After it is finalized, pass the extrinsic hash to retrieve_evidence.' };
  }
  if (!['submit', 'review', 'list'].includes(action)) throw new Error('Choose submit, review, list, store or remark.');
  const call = action === 'submit' ? submitCall(label, reportHash) : action === 'review' ? reviewCall(releaseId, reportHash, approved) : listCall({ token, releaseId, reportHash, reviewer, decimals: Number(decimals) });
  const prepared = {
    action, contract: action === 'list' ? 'VerifiedTokenList' : 'ReleaseRegistry', network: network.key, chainId: network.chainId, to: call.to, data: call.data, value: '0x0',
    releaseId: action === 'submit' ? null : releaseId,
    evm: { method: 'eth_sendTransaction', params: [{ to: call.to, data: call.data, value: '0x0' }], rpcUrl: network.evmRpcUrl },
    native: { pallet: 'revive', call: 'call', args: { dest: call.to, value: '0', weightLimit: 'weightRequired from the dry-run', storageDepositLimit: 'maxStorageDeposit from the dry-run', data: call.data } },
  };
  if (!from) return prepared;
  prepared.dryRun = await withNetwork(network, async ({ api, signal }) => {
    const evmFrom = H160.test(from);
    const origin = evmFrom ? (await abortable(api.call.reviveApi.accountId(from), signal)).toString() : from;
    const sender = evmFrom ? from.toLowerCase() : str(await abortable(api.call.reviveApi.address(origin), signal)).toLowerCase();
    const simulation = await abortable(api.call.reviveApi.call(origin, call.to, '0', null, null, call.data), signal);
    const deposit = simulation.maxStorageDeposit?.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
    if (!simulation.result?.isOk) return { ok: false, origin, sender, error: simulation.result?.asErr?.toString() ?? 'Dispatch error' };
    const flags = simulation.result.asOk.flags.toJSON();
    const reverted = (BigInt(flags?.bits ?? flags) & 1n) !== 0n;
    const data = str(simulation.result.asOk.data);
    return {
      ok: !reverted, origin, sender, reverted, revertReason: reverted ? (action === 'list' ? decodeTokenListError(data) || decodeRegistryError(data) : decodeRegistryError(data)) : null,
      weightRequired: simulation.weightRequired.toJSON(), maxStorageDepositRaw: deposit, maxStorageDeposit: `${formatNative(deposit, network.decimals)} ${network.symbol}`,
      returned: !reverted && action === 'submit' ? registryInterface.decodeFunctionResult('submit', data).map(String) : null,
    };
  });
  if (action === 'submit') prepared.releaseId = releaseIdOf(prepared.dryRun.sender, label);
  if (prepared.dryRun.ok) prepared.native.args = { ...prepared.native.args, weightLimit: prepared.dryRun.weightRequired, storageDepositLimit: prepared.dryRun.maxStorageDepositRaw };
  return prepared;
}

/** Both identities of an account and its spendable tPOT: a native SS58 address or an EVM address. */
export async function accountOverview(address) {
  const network = NETWORKS.testnet;
  return withNetwork(network, async ({ api, signal }) => {
    const evm = H160.test(address || '');
    const native = evm ? (await abortable(api.call.reviveApi.accountId(address), signal)).toString() : address;
    const mapped = evm ? address.toLowerCase() : str(await abortable(api.call.reviveApi.address(address), signal)).toLowerCase();
    const account = await abortable(api.query.system.account(native), signal);
    const available = availableNativeBalance(account, api.consts.balances.existentialDeposit);
    return { native, evm: mapped, availableRaw: available.toString(), available: formatNative(available, network.decimals), symbol: network.symbol, nonce: account.nonce.toNumber() };
  }, 60_000);
}

/** Events of one extrinsic, decoded, with its dispatch outcome. */
export async function extrinsicEvents(api, blockHash, index) {
  const records = await (await api.at(blockHash)).query.system.events();
  const events = records.filter((record) => record.phase.isApplyExtrinsic && record.phase.asApplyExtrinsic.toNumber() === index).map(({ event }) => ({ section: event.section, method: event.method, data: event.data.toJSON() }));
  const success = events.some((event) => event.section === 'system' && event.method === 'ExtrinsicSuccess') && !events.some((event) => event.section === 'system' && event.method === 'ExtrinsicFailed');
  return { events, success };
}

/**
 * Follow an Ethereum transaction sent through the official EVM RPC until its block
 * is finalized, then find the native revive.ethTransact extrinsic that carried it,
 * so the explorer can link the exact extrinsic.
 */
export async function settleEthTransaction(txHash, { onStatus = () => {}, timeoutMs = 300_000 } = {}) {
  const network = NETWORKS.testnet;
  const deadline = Date.now() + timeoutMs;
  let receipt = null;
  while (!receipt) {
    if (Date.now() > deadline) throw new Error(`No receipt for ${txHash} yet. Check the explorer before sending again.`);
    receipt = await evmRpc('eth_getTransactionReceipt', [txHash]).catch(() => null);
    if (!receipt) await pause(3_000);
  }
  const blockNumber = Number(BigInt(receipt.blockNumber));
  onStatus({ stage: 'in-block', txHash, blockNumber });
  return withNetwork(network, async ({ api }) => {
    for (;;) {
      const finalized = (await api.rpc.chain.getHeader(await api.rpc.chain.getFinalizedHead())).number.toNumber();
      if (finalized >= blockNumber) break;
      if (Date.now() > deadline) throw new Error(`Block #${blockNumber} is not finalized yet. Check the explorer before sending again.`);
      await pause(3_000);
    }
    const blockHash = str(await api.rpc.chain.getBlockHash(blockNumber)).toLowerCase();
    const block = await api.rpc.chain.getBlock(blockHash);
    const index = block.block.extrinsics.findIndex((extrinsic) => extrinsic.method.section === 'revive' && extrinsic.method.method === 'ethTransact' && keccakAsHex(extrinsic.method.args[0].toU8a(true)) === txHash.toLowerCase());
    const outcome = index < 0 ? { events: [], success: BigInt(receipt.status) === 1n } : await extrinsicEvents(api, blockHash, index);
    return {
      route: 'evm', txHash: txHash.toLowerCase(), blockNumber: String(blockNumber), blockHash, evmBlockHash: receipt.blockHash,
      extrinsicHash: index < 0 ? null : str(block.block.extrinsics[index].hash).toLowerCase(), extrinsicIndex: index < 0 ? null : index,
      success: BigInt(receipt.status) === 1n && outcome.success, logs: receipt.logs, events: outcome.events, finalizedAt: new Date().toISOString(),
    };
  }, timeoutMs);
}

export { REGISTRY, TOKEN_LIST };
