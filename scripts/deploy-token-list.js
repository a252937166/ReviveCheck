import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount, str } from '../lib/chain.js';
import { loadTestnetSigner, assertDryRun, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';
import { normalizeManifest, checkArtifact, initcodeFor, verifyDeployment, deploymentRecord } from '../lib/deployment.js';
import { readTokenListIdentityWithClients } from '../lib/tokenlist.js';
import { compileTokenList } from './compile-token-list.js';

// Deploy a versioned VerifiedTokenList from a validated manifest. The default is an
// estimate from the manifest's public deployer address (or --from <ss58>): no wallet
// file is read and nothing is signed. --broadcast loads the isolated test wallet,
// requires an explicit cap within the manifest budget, journals the hash before
// sending, and records the deployment only after its runtime code, version(),
// registry() and curator() were verified through both interfaces at a finalized
// block. Activation is a separate step (scripts/activate-token-list.js). The v1
// records under public/lifecycle and artifacts/ are never touched.
//
//   node scripts/deploy-token-list.js                                   # estimate for the manifest deployer
//   node scripts/deploy-token-list.js --from 5…                         # estimate for another public address
//   node scripts/deploy-token-list.js --broadcast --max-cost-tpot 200   # sign with .private/wallet.json
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const broadcast = args.includes('--broadcast');
const manifestPath = option('--manifest', 'deployments/token-list-v2.manifest.json');
const capText = option('--max-cost-tpot', '');
const from = option('--from', '');
// The official guide's public example account, used only to simulate when the deployer is underfunded (see docs/CHAIN_FINDINGS.md).
const simulateFrom = option('--simulate-from', '0xf7eC65d11e35375A250e474059a917B537804142');
if (broadcast && !capText) throw new Error('Broadcast requires an explicit --max-cost-tpot cap.');
const H160 = /^0x[0-9a-fA-F]{40}$/;
// From the v1 deployment's finalized events at #164220 (extrinsic 0xe3efb1e7…56570): the code deposit covered 2186 bytes for 2116 bytes of runtime code.
const V1_REFERENCE = Object.freeze({ codeOverheadBytes: 70, contractDepositRaw: '4699800000000000', feeRaw: '25301083110655' });

const manifest = normalizeManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
const journalPath = manifest.records.journal;
let api, journal;
const save = async () => { await mkdir(path.dirname(journalPath), { recursive: true }); await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`); await rename(`${journalPath}.tmp`, journalPath); };
try {
  const { extra, ...artifact } = await compileTokenList();
  checkArtifact(manifest, artifact);
  const initcode = initcodeFor(manifest, artifact);
  let prior;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.pending) throw new Error(`Previous deployment ${prior.pending.transactionHash} has an unknown outcome. Reconcile it first.`);
  if (prior?.contractAddress) throw new Error(`Version ${manifest.version} is already deployed at ${prior.contractAddress} (${journalPath}). Verify and activate it with scripts/activate-token-list.js.`);
  if (prior && prior.manifestHash !== manifest.manifestHash) throw new Error('The journal was written for a different manifest. Keep one journal per manifest.');
  // The signer is read only to broadcast; an estimate uses a public address.
  const signer = broadcast ? await loadTestnetSigner(option('--wallet', '.private/wallet.json')) : null;
  if (signer && signer.address !== manifest.deployer.ss58) throw new Error(`The wallet (${signer.address}) is not the manifest deployer (${manifest.deployer.ss58}).`);
  const origin = signer ? signer.address : (from || manifest.deployer.ss58);
  api = await connectNative({ signal: AbortSignal.timeout(60_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (str(api.genesisHash).toLowerCase() !== manifest.genesisHash || api.consts.revive.chainId.toString() !== String(manifest.chainId)) throw new Error('The node is not the network the manifest pins.');
  const runtime = `${api.runtimeVersion.specName}/${api.runtimeVersion.specVersion}`;
  if (runtime !== `${manifest.runtime.specName}/${manifest.runtime.specVersion}`) throw new Error(`The manifest is verified for ${manifest.runtime.specName}/${manifest.runtime.specVersion}; the node runs ${runtime}. Revalidate before deploying.`);
  const decimals = api.registry.chainDecimals[0];
  const mappedEvm = str(await api.call.reviveApi.address(origin)).toLowerCase();
  if (!from && mappedEvm !== manifest.deployer.evm) throw new Error(`${origin} maps to ${mappedEvm}, not the manifest deployer ${manifest.deployer.evm}.`);
  const registryCode = await evmRpc('eth_getCode', [manifest.constructor.registry, 'latest']);
  if (!/^0x[0-9a-fA-F]{2,}$/.test(registryCode)) throw new Error(`The ReleaseRegistry the manifest reuses, ${manifest.constructor.registry}, has no code on this network.`);
  const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
  const account = await api.query.system.account(origin);
  const available = availableNativeBalance(account, api.consts.balances.existentialDeposit);
  const stateNonce = account.nonce.toNumber();
  const poolNonce = (await api.rpc.system.accountNextIndex(origin)).toNumber();
  const budget = parseTokenAmount(manifest.budget.maxCostTpot, decimals);
  // The dry-run itself is refused when the origin cannot pay the deposit. The deposit and the weight do not
  // depend on the origin, so an estimate may simulate from a funded public account (the official guide's
  // example by default) and, failing that, project the deposit from the runtime constants and the v1 events.
  let simulation = null, limit = '0', fee = 0n, basis = 'dry-run from the deployer';
  try {
    simulation = await api.call.reviveApi.instantiate(origin, '0', null, null, { Upload: initcode }, '0x', null);
    assertDryRun(api, simulation, true);
  } catch (error) {
    if (broadcast || !/StorageDepositNotEnoughFunds|funds|balance/i.test(error.message)) throw error;
    basis = `the deployer cannot pay the deposit (${error.message.replace(/^Dry-run rejected: /, '')})`;
    try {
      const alt = H160.test(simulateFrom) ? (await api.call.reviveApi.accountId(simulateFrom)).toString() : simulateFrom;
      simulation = await api.call.reviveApi.instantiate(alt, '0', null, null, { Upload: initcode }, '0x', null);
      assertDryRun(api, simulation, true);
      basis += `; deposit and weight simulated from the funded public account ${simulateFrom}`;
    } catch (alternative) { simulation = null; basis += `; simulation from ${simulateFrom} failed too (${alternative.message.slice(0, 120)})`; }
  }
  if (simulation) {
    limit = simulation.maxStorageDeposit.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
    fee = BigInt((await api.tx.revive.instantiateWithCode('0', simulation.weightRequired.toJSON(), limit, initcode, '0x', null).paymentInfo(origin)).partialFee.toString());
  } else {
    // Projection: the v1 deployment at #164220 held depositPerByte × (2116 runtime bytes + 70) for the code and
    // 46.998 tPOT for the contract record, and paid 0.253 tPOT in fees. Same compiler, same shape of contract.
    const perByte = BigInt(api.consts.revive.depositPerByte.toString());
    limit = (perByte * BigInt(runtimeBytes + V1_REFERENCE.codeOverheadBytes) + BigInt(V1_REFERENCE.contractDepositRaw)).toString();
    fee = BigInt(V1_REFERENCE.feeRaw);
    basis += '; deposit projected from depositPerByte × (runtime bytes + 70) plus the v1 contract record deposit, fee taken from the v1 deployment';
  }
  const tx = simulation ? api.tx.revive.instantiateWithCode('0', simulation.weightRequired.toJSON(), limit, initcode, '0x', null) : null;
  const cost = BigInt(limit) + fee * 2n;
  const estimate = {
    version: manifest.version, runtimeBytes, initcodeBytes: (initcode.length - 2) / 2, registry: manifest.constructor.registry, curator: manifest.constructor.curator,
    origin, originEvm: mappedEvm, runtime, maxStorageDepositTpot: formatNative(BigInt(limit), decimals), estimatedFeeTpot: formatNative(fee, decimals), feeReserveTpot: formatNative(fee * 2n, decimals), estimatedCostTpot: formatNative(cost, decimals),
    budgetCapTpot: manifest.budget.maxCostTpot, availableTpot: formatNative(available, decimals), shortfallTpot: cost > available ? formatNative(cost - available, decimals) : '0',
    withinBudget: cost <= budget, funded: cost < available, pendingTransactions: poolNonce - stateNonce, projected: !simulation, basis, estimatedAt: new Date().toISOString(),
  };
  if (!broadcast) {
    const status = estimate.funded && estimate.withinBudget ? 'estimate-ready' : estimate.withinBudget ? 'estimate-pending-funding' : 'estimate-over-budget';
    console.log(JSON.stringify({ status, manifest: manifestPath, manifestHash: manifest.manifestHash, sourceSha256: artifact.sourceSha256, ...estimate, note: 'No wallet file was read and no transaction was signed. The storage deposit is held, not spent; the fee is spent. Estimates can change before inclusion.' }, null, 2));
    process.exitCode = status === 'estimate-ready' ? 0 : 2;
  } else {
    if (!tx) throw new Error('No dry-run from the deployer; nothing is signed on a projection.');
    if (poolNonce !== stateNonce) throw new Error('The account has pending transactions; another signer may be active.');
    const cap = parseTokenAmount(capText, decimals);
    if (cap > budget) throw new Error(`--max-cost-tpot ${capText} exceeds the manifest budget of ${manifest.budget.maxCostTpot} tPOT.`);
    if (cost > cap) throw new Error(`Estimated cost ${estimate.estimatedCostTpot} tPOT exceeds the ${capText} tPOT cap.`);
    if (cost >= available) throw new Error(`Insufficient available test tokens: ${estimate.availableTpot} tPOT available, ${estimate.estimatedCostTpot} tPOT needed.`);
    journal = { schemaVersion: 2, manifestPath, manifestHash: manifest.manifestHash, version: manifest.version, network: NETWORK, nativeAccount: signer.address, deployerEvm: manifest.deployer.evm, sourceSha256: artifact.sourceSha256, estimate };
    const receipt = await sendFinalized(api, tx, signer, async (transactionHash) => { journal.pending = { transactionHash, signedAt: new Date().toISOString() }; await save(); console.log(JSON.stringify({ status: 'signed-and-journaled', transactionHash })); });
    const instantiated = receipt.events.find((event) => event.section === 'revive' && event.method === 'Instantiated');
    const contractAddress = instantiated?.data?.[1];
    if (!H160.test(contractAddress || '')) throw new Error('Finalized deployment lacks an Instantiated address; the pending journal is kept.');
    const header = await api.rpc.chain.getHeader(receipt.transactionBlockHash);
    journal.contractAddress = contractAddress.toLowerCase();
    journal.deploy = { extrinsicHash: receipt.transactionHash, blockHash: receipt.transactionBlockHash, blockNumber: header.number.toString(), finalizedAt: receipt.finalizedAt };
    journal.stages = [{ stage: 'deploy', ...receipt }];
    const stop = recordFinalizedNativeFee(journal, receipt, fee * 2n);
    delete journal.pending;
    await save();
    // Verify before anything public is written: code, identity and the dual-interface readback.
    const signal = AbortSignal.timeout(90_000);
    const clients = { api, rpc: (method, params) => evmRpc(method, params, { signal }), signal };
    const identity = await readTokenListIdentityWithClients(clients, journal.contractAddress);
    const code = await evmRpc('eth_getCode', [journal.contractAddress, { blockHash: identity.block.evmHash, requireCanonical: true }], { signal });
    const verification = verifyDeployment({ manifest, artifact, code, identity });
    journal.verification = { checkedAt: new Date().toISOString(), ok: verification.ok, block: identity.block, checks: verification.checks };
    await save();
    if (!verification.ok) {
      console.error(JSON.stringify({ status: 'deployed-unverified', contract: journal.contractAddress, deploy: journal.deploy, checks: verification.checks.filter((check) => check.status !== 'passed'), note: 'The deployment is journaled but not recorded or activated. Inspect it before any further step.' }, null, 2));
      process.exitCode = 1;
    } else {
      const record = deploymentRecord({ manifest, artifact, journal, code, identity, verification });
      await mkdir(path.dirname(manifest.records.record), { recursive: true });
      await writeFile(manifest.records.record, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
      console.log(JSON.stringify({ status: 'deployed-verified', version: manifest.version, contract: record.address, deploy: record.deploy, runtimeBytes: record.runtimeBytes, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals), record: manifest.records.record, next: `node scripts/activate-token-list.js --manifest ${manifestPath} --write` }, null, 2));
    }
    if (stop) throw new Error(stop);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600), note: 'A journaled pending transaction is an unknown outcome.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
