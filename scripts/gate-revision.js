import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { Interface } from 'ethers';
import { u8aEq } from '@polkadot/util';
import { decodeAddress } from '@polkadot/util-crypto';
import { compileReleaseGate } from './compile-release-gate.js';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount, inspectChain } from '../lib/chain.js';
import { loadTestnetSigner, assertDryRun, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';
import { sealRun, overall, validateImportedRun, reportHtml } from '../lib/report.js';

// Commit a newer passing report to the deployed ReleaseGate and review it:
// submit(hash) resets approval and increments the revision; review(true) approves
// that exact revision. Default is a read-only estimate. --broadcast signs with the
// isolated test wallet, journaling each hash before it is sent.
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const broadcast = args.includes('--broadcast');
const budgetText = option('--max-cost-tpot', '');
const gate = option('--gate', '0xf062d47c63613da90e3573e0ee2bba126347f3d3').toLowerCase();
const reportHash = option('--report', '');
if (!/^[a-f0-9]{64}$/.test(reportHash)) throw new Error('Pass --report <64-character published report hash>.');
if (broadcast && !budgetText) throw new Error('Broadcast requires an explicit --max-cost-tpot cap.');
const journalPath = option('--journal', `artifacts/local/gate-revision-${reportHash.slice(0, 12)}.json`);
const report = validateImportedRun(JSON.parse(await readFile(`public/reports/${reportHash}.json`, 'utf8')));
if (report.status !== 'passed' || report.scope !== 'portaldot-testnet-readonly') throw new Error('Only a passing live testnet report can be submitted for review.');
const commitment = `0x${reportHash}`;

let api, journal;
async function saveJournal() {
  await mkdir('artifacts/local', { recursive: true });
  await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`);
  await rename(`${journalPath}.tmp`, journalPath);
}
try {
  const signer = await loadTestnetSigner(option('--wallet', '.private/wallet.json'));
  api = await connectNative({ signal: AbortSignal.timeout(30_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (api.runtimeVersion.specName.toString() !== 'portaldot-v3' || api.runtimeVersion.specVersion.toString() !== '3002') throw new Error('Signing is verified only for portaldot-v3 runtime 3002.');
  const decimals = api.registry.chainDecimals[0];
  const evmAccount = (await api.call.reviveApi.address(signer.address)).toHex();
  if (!u8aEq(decodeAddress((await api.call.reviveApi.accountId(evmAccount)).toString()), decodeAddress(signer.address))) throw new Error('Native/EVM account mapping does not round-trip.');
  const artifact = await compileReleaseGate();
  const iface = new Interface(artifact.abi);
  const view = async (name, at = 'latest') => iface.decodeFunctionResult(name, await evmRpc('eth_call', [{ to: gate, data: iface.encodeFunctionData(name) }, at]))[0];
  const state = async (at) => ({ owner: String(await view('owner', at)).toLowerCase(), reviewer: String(await view('reviewer', at)).toLowerCase(), reportHash: String(await view('reportHash', at)).toLowerCase(), approved: Boolean(await view('approved', at)), revision: (await view('revision', at)).toString() });
  const before = await state();
  if (before.owner !== evmAccount.toLowerCase() || before.reviewer !== evmAccount.toLowerCase()) throw new Error('This wallet is not both owner and reviewer of the gate.');
  const stateNonce = (await api.query.system.account(signer.address)).nonce.toNumber();
  const poolNonce = (await api.rpc.system.accountNextIndex(signer.address)).toNumber();
  if (poolNonce !== stateNonce) throw new Error(`The account has ${poolNonce - stateNonce} pending transaction(s). Another signer may be active; nothing was sent.`);
  let prior;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.pending) throw new Error(`Previous submission has an unknown outcome: ${prior.pending.transactionHash}. Reconcile it before continuing.`);
  if (prior?.actualFeeNeedsReconciliation || prior?.budgetNeedsReconciliation) throw new Error('The previous finalized fee or budget needs reconciliation.');
  journal = prior || { schemaVersion: 1, network: NETWORK, gate, nativeAccount: signer.address, evmAccount, sourceSha256: artifact.sourceSha256, reportHash: commitment, before, stages: [], estimatedCommittedRaw: '0', actualNativeFeesRaw: '0', reviewerScope: 'Owner and reviewer are the same isolated test account. This is a facilitated demonstration, not independent review.' };
  const budget = budgetText ? parseTokenAmount(budgetText, decimals) : null;
  let committed = BigInt(journal.estimatedCommittedRaw);
  async function execute(stage, method, values) {
    const input = iface.encodeFunctionData(method, values);
    const simulation = await api.call.reviveApi.call(signer.address, gate, '0', null, null, input);
    assertDryRun(api, simulation);
    const limit = simulation.maxStorageDeposit.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
    const tx = api.tx.revive.call(gate, '0', simulation.weightRequired.toJSON(), limit, input);
    const fee = BigInt((await tx.paymentInfo(signer)).partialFee.toString());
    const feeReserve = fee * 2n, cost = BigInt(limit) + feeReserve;
    const summary = { stage, method, values, callData: input, estimatedFeeRaw: fee.toString(), feeReserveRaw: feeReserve.toString(), maxStorageDepositRaw: limit, estimatedCostTpot: formatNative(cost, decimals) };
    if (!broadcast) { console.log(JSON.stringify({ status: 'dry-run-complete', ...summary, note: 'No transaction was signed.' }, null, 2)); return null; }
    if (committed + cost > budget) throw new Error(`Cumulative estimated cost exceeds the ${budgetText} tPOT cap.`);
    if (cost >= availableNativeBalance(await api.query.system.account(signer.address), api.consts.balances.existentialDeposit)) throw new Error('Insufficient available test tokens while preserving the native account.');
    const receipt = await sendFinalized(api, tx, signer, async (transactionHash) => {
      journal.pending = { stage, transactionHash, signedAt: new Date().toISOString() };
      await saveJournal();
      console.log(JSON.stringify({ status: 'signed-and-journaled', stage, transactionHash }));
    });
    committed += cost;
    journal.estimatedCommittedRaw = committed.toString();
    const header = await api.rpc.chain.getHeader(receipt.transactionBlockHash);
    journal.stages.push({ ...summary, ...receipt, blockNumber: header.number.toString() });
    const stop = recordFinalizedNativeFee(journal, receipt, feeReserve);
    delete journal.pending;
    await saveJournal();
    if (stop) throw new Error(stop);
    return receipt;
  }
  const done = (stage) => journal.stages.find((entry) => entry.stage === stage);
  if (!done('submit')) {
    if (before.reportHash === commitment && before.approved) throw new Error('This exact report is already the approved revision.');
    await execute('submit', 'submit', [commitment]);
  }
  if (broadcast && done('submit') && !journal.resetObserved) {
    const blockHash = done('submit').transactionBlockHash;
    const mapped = await (await api.at(blockHash)).call.reviveApi.ethBlockHash(done('submit').blockNumber);
    if (mapped.isNone) throw new Error('ReviveApi has no EVM hash for the submit block.');
    const evmHash = (mapped.unwrap ? mapped.unwrap() : mapped).toHex();
    const after = await state({ blockHash: evmHash, requireCanonical: true });
    if (after.reportHash !== commitment || after.approved || after.revision !== String(BigInt(before.revision) + 1n)) throw new Error('The submit block does not show the reset revision.');
    journal.resetObserved = { blockNumber: done('submit').blockNumber, nativeBlockHash: blockHash, evmBlockHash: evmHash, ...after };
    await saveJournal();
  }
  if (broadcast && done('submit') && !done('review')) await execute('review', 'review', [true]);
  // The readback is read-only; --redo-readback replaces one that the network left incomplete.
  const redo = args.includes('--redo-readback') && journal.readbackHash && journal.readbackStatus !== 'passed';
  if (done('review') && (!journal.readbackHash || redo)) {
    const review = done('review');
    const revision = journal.resetObserved.revision;
    const plan = { name: 'ReviveCheck release gate', release: report.release, logicalContractId: 'release-gate', sourceRevision: artifact.sourceSha256, profile: 'contract', expectedChainId: NETWORK.chainId, account: signer.address, contractAddress: gate, transactionHash: review.transactionHash, transactionBlockHash: review.transactionBlockHash, assertions: [
      { id: 'owner', label: 'Developer owns this release gate', signature: 'owner()', returns: 'address', args: [], expected: evmAccount.toLowerCase() },
      { id: 'reviewer', label: 'Configured test reviewer', signature: 'reviewer()', returns: 'address', args: [], expected: evmAccount.toLowerCase() },
      { id: 'revision', label: 'Submitted report revision', signature: 'revision()', returns: 'uint256', args: [], expected: revision },
      { id: 'approved', label: 'Facilitated reviewer decision', signature: 'approved()', returns: 'bool', args: [], expected: true },
      { id: 'report', label: 'Exact submitted report commitment', signature: 'reportHash()', returns: 'bytes32', args: [], expected: commitment },
    ] };
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await inspectChain(plan);
      if (result.checks[0]?.status !== 'unknown') break;
    }
    const now = new Date().toISOString();
    const run = sealRun({ schemaVersion: 2, id: `release-gate-revision-${revision}-${Date.now()}`, projectId: 'release-gate-reference', projectName: plan.name, release: plan.release, input: plan, mode: 'live', scope: 'portaldot-testnet-readonly', scenario: null, trigger: 'gate-revision', startedAt: now, completedAt: now, previousRunId: null, status: overall(result.checks), ...result });
    if (redo) for (const extension of ['json', 'html']) await rm(`public/reports/${journal.readbackHash}.${extension}`, { force: true });
    await writeFile(`public/reports/${run.evidenceHash}.json`, `${JSON.stringify(run, null, 2)}\n`);
    await writeFile(`public/reports/${run.evidenceHash}.html`, reportHtml(run));
    journal.readbackHash = run.evidenceHash;
    journal.readbackStatus = run.status;
    journal.completedAt = now;
    await saveJournal();
    const index = JSON.parse(await readFile('public/reports/index.json', 'utf8'));
    index.reports = index.reports.filter((entry) => !(entry.role === 'gate-revision' && entry.revision === revision && entry.evidenceHash !== run.evidenceHash));
    if (!index.reports.some((entry) => entry.evidenceHash === run.evidenceHash)) index.reports.push({ evidenceHash: run.evidenceHash, projectName: run.projectName, release: run.release, profile: 'contract', completedAt: run.completedAt, role: 'gate-revision', revision, committedReportHash: reportHash });
    await writeFile('public/reports/index.json', `${JSON.stringify(index, null, 2)}\n`);
    const ledger = JSON.parse(await readFile('public/lifecycle/release-gate.json', 'utf8'));
    ledger.revisions = ledger.revisions.filter((entry) => entry.revision !== Number(revision)).concat({ revision: Number(revision), reportHash: commitment, submit: { extrinsicHash: done('submit').transactionHash, blockHash: done('submit').transactionBlockHash, blockNumber: done('submit').blockNumber, finalizedAt: done('submit').finalizedAt }, resetObserved: { blockNumber: journal.resetObserved.blockNumber, approved: journal.resetObserved.approved, revision: journal.resetObserved.revision }, review: { extrinsicHash: review.transactionHash, blockHash: review.transactionBlockHash, blockNumber: review.blockNumber, finalizedAt: review.finalizedAt }, readbackReportHash: run.evidenceHash, readbackStatus: run.status, actualNativeFeesRaw: journal.actualNativeFeesRaw });
    await writeFile('public/lifecycle/release-gate.json', `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(JSON.stringify({ status: run.status === 'passed' ? 'revision-approved-and-read-back' : 'readback-needs-attention', gate, revision, commitment, submit: done('submit').transactionHash, review: review.transactionHash, readback: run.evidenceHash, readbackStatus: run.status, fees: formatNative(BigInt(journal.actualNativeFeesRaw), decimals) }, null, 2));
    if (run.status !== 'passed') process.exitCode = 2;
  }
  if (!broadcast) console.log(JSON.stringify({ status: 'dry-run-state', gate, before, commitment, stateNonce, poolNonce, availableTpot: formatNative(availableNativeBalance(await api.query.system.account(signer.address), api.consts.balances.existentialDeposit), decimals) }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 700), note: 'A journaled pending transaction is an unknown outcome. Never resend it without reconciliation.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
