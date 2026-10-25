import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount, str } from '../lib/chain.js';
import { loadTestnetSigner, assertDryRun, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';
import { REGISTRY, submitCall, reviewCall, releaseIdOf, decodeRegistryError, registryEvents, readRegistryWithClients } from '../lib/registry.js';

// Submit a report hash to the ReleaseRegistry, or review a revision, from the
// isolated test wallet. The browser studio signs the same calls in a visitor's
// wallet; this helper exists so a recorded lifecycle can be driven from a terminal
// with the same guards as the other writers: dry-run first, an explicit cap, the
// hash journaled before sending, a finalized receipt with its fee, and a readback
// through both interfaces. Default is a dry-run from the public wallet address.
//
//   node scripts/registry-write.js --action submit --label pusd-catalog-v2 --report <64-hex> [--previous-report <64-hex>]
//   node scripts/registry-write.js --action review --release-id 0x… --report <64-hex> [--approved false]
//   add --broadcast --max-cost-tpot <n> [--wallet .private/wallet.json] to sign
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const action = option('--action', '');
const broadcast = args.includes('--broadcast');
const capText = option('--max-cost-tpot', '');
const label = option('--label', '');
const reportHash = option('--report', '').replace(/^0x/, '').toLowerCase();
const approved = option('--approved', 'true') !== 'false';
const recordPath = option('--record', 'public/lifecycle/registry-writes.json');
if (!['submit', 'review'].includes(action)) throw new Error('--action is submit or review.');
if (!/^[a-f0-9]{64}$/.test(reportHash)) throw new Error('--report is the 64-hex report fingerprint.');
if (action === 'submit' && !label) throw new Error('submit needs --label.');
if (broadcast && !capText) throw new Error('Broadcast requires an explicit --max-cost-tpot cap.');

let api, journal;
let journalPath;
const save = async () => { await mkdir('artifacts/local', { recursive: true }); await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`); await rename(`${journalPath}.tmp`, journalPath); };
try {
  const signer = broadcast ? await loadTestnetSigner(option('--wallet', '.private/wallet.json')) : null;
  const origin = signer ? signer.address : option('--from', JSON.parse(await readFile('docs/WALLET_PUBLIC.json', 'utf8')).ss58Address);
  api = await connectNative({ signal: AbortSignal.timeout(60_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (api.runtimeVersion.specVersion.toString() !== '3002') throw new Error('Signing is verified only for runtime 3002.');
  const decimals = api.registry.chainDecimals[0];
  const signal = AbortSignal.timeout(90_000);
  const clients = { api, rpc: (method, params) => evmRpc(method, params, { signal }), signal };
  const sender = str(await api.call.reviveApi.address(origin)).toLowerCase();
  const releaseId = action === 'submit' ? releaseIdOf(sender, label) : option('--release-id', '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(releaseId)) throw new Error('review needs --release-id (32 bytes).');
  journalPath = option('--journal', `artifacts/local/registry-${action}-${releaseId.slice(2, 14)}-${reportHash.slice(0, 12)}.json`);
  let prior;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.pending) throw new Error(`Previous ${action} ${prior.pending.transactionHash} has an unknown outcome. Reconcile it first.`);
  if (prior?.finalized) throw new Error(`This ${action} is already finalized in ${prior.finalized.extrinsicHash} (${journalPath}).`);
  const before = await readRegistryWithClients(clients, { releaseId, reviewer: sender });
  if (action === 'review' && !before.release.exists) throw new Error(`Release ${releaseId} is not in the registry.`);
  if (action === 'review' && before.release.reportHash !== `0x${reportHash}`) throw new Error(`The current report of revision ${before.release.revision} is ${before.release.reportHash}, not 0x${reportHash}; a decision on a superseded report reverts with StaleReport.`);
  const call = action === 'submit' ? submitCall(label, reportHash) : reviewCall(releaseId, reportHash, approved);
  const simulation = await api.call.reviveApi.call(origin, call.to, '0', null, null, call.data);
  if (simulation.result?.isOk && (BigInt(simulation.result.asOk.flags.toJSON()?.bits ?? simulation.result.asOk.flags.toJSON()) & 1n) !== 0n) throw new Error(`The ${action} call would revert: ${decodeRegistryError(str(simulation.result.asOk.data)) || str(simulation.result.asOk.data).slice(0, 20)}`);
  assertDryRun(api, simulation);
  const limit = simulation.maxStorageDeposit.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
  const tx = api.tx.revive.call(call.to, '0', simulation.weightRequired.toJSON(), limit, call.data);
  const fee = BigInt((await tx.paymentInfo(origin)).partialFee.toString());
  const cost = BigInt(limit) + fee * 2n;
  const account = await api.query.system.account(origin);
  const available = availableNativeBalance(account, api.consts.balances.existentialDeposit);
  const stateNonce = account.nonce.toNumber();
  const poolNonce = (await api.rpc.system.accountNextIndex(origin)).toNumber();
  const estimate = { action, releaseId, label: label || null, reportHash, approved: action === 'review' ? approved : null, sender, currentRevision: before.release.exists ? before.release.revision : '0', nextRevision: action === 'submit' ? String(Number(before.release.exists ? before.release.revision : 0) + 1) : null, maxStorageDepositTpot: formatNative(BigInt(limit), decimals), estimatedFeeTpot: formatNative(fee, decimals), estimatedCostTpot: formatNative(cost, decimals), availableTpot: formatNative(available, decimals), pendingTransactions: poolNonce - stateNonce };
  if (!broadcast) {
    console.log(JSON.stringify({ status: 'dry-run-complete', ...estimate, note: 'No wallet was read and no transaction was signed.' }, null, 2));
  } else {
    if (poolNonce !== stateNonce) throw new Error('The account has pending transactions; another signer may be active.');
    if (cost > parseTokenAmount(capText, decimals)) throw new Error(`Estimated cost ${estimate.estimatedCostTpot} tPOT exceeds the ${capText} tPOT cap.`);
    if (cost >= available) throw new Error('Insufficient available test tokens.');
    journal = { schemaVersion: 1, network: NETWORK, nativeAccount: signer.address, contract: REGISTRY.address, estimate };
    const receipt = await sendFinalized(api, tx, signer, async (transactionHash) => { journal.pending = { transactionHash, signedAt: new Date().toISOString() }; await save(); console.log(JSON.stringify({ status: 'signed-and-journaled', transactionHash })); });
    const header = await api.rpc.chain.getHeader(receipt.transactionBlockHash);
    const events = registryEvents(receipt.events);
    journal.finalized = { extrinsicHash: receipt.transactionHash, blockHash: receipt.transactionBlockHash, blockNumber: header.number.toString(), finalizedAt: receipt.finalizedAt };
    journal.events = events;
    journal.stages = [{ stage: action, ...receipt }];
    const stop = recordFinalizedNativeFee(journal, receipt, fee * 2n);
    delete journal.pending;
    await save();
    const after = await readRegistryWithClients(clients, { releaseId, reviewer: sender });
    const expectedRevision = action === 'submit' ? estimate.nextRevision : before.release.revision;
    if (!after.interfacesAgree || after.release.revision !== expectedRevision || after.release.reportHash !== `0x${reportHash}` || (action === 'review' && after.decision?.approved !== approved)) throw new Error('Finalized, but the readback does not show the write through both interfaces. The journal is kept.');
    let record;
    try { record = JSON.parse(await readFile(recordPath, 'utf8')); } catch { record = { schema: 'revivecheck.registry-writes.v1', network: 'testnet', registry: REGISTRY.address, scope: 'Writes driven from a terminal with project-controlled test wallets: the development wallet (docs/WALLET_PUBLIC.json) owns releases, the reviewer wallet (docs/REVIEWER_WALLET_PUBLIC.json) signs decisions. Distinct signers show role separation; both are controlled by the project, so this is not independent review.', items: [] }; }
    record.items.push({ action, label: label || null, releaseId, revision: after.release.revision, reportHash: `0x${reportHash}`, approved: action === 'review' ? approved : null, sender, signer: signer.address, ...journal.finalized, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals), maxStorageDepositTpot: estimate.maxStorageDepositTpot, events, readback: { block: after.block, revision: after.release.revision, reportHash: after.release.reportHash, decision: after.decision, interfacesAgree: after.interfacesAgree } });
    await mkdir('public/lifecycle', { recursive: true });
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ status: action === 'submit' ? 'submitted' : approved ? 'approved' : 'changes-requested', releaseId, revision: after.release.revision, ...journal.finalized, readback: { block: after.block.number, interfacesAgree: after.interfacesAgree, decision: after.decision }, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals), record: recordPath }, null, 2));
    if (stop) throw new Error(stop);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600), note: 'A journaled pending transaction is an unknown outcome.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
