import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { AbiCoder, Interface } from 'ethers';
import { decodeAddress } from '@polkadot/util-crypto';
import { compileReleaseGate } from './compile-release-gate.js';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount, inspectChain } from '../lib/chain.js';
import { loadTestnetSigner, assertDryRun, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';
import { sealRun, overall, validateImportedRun } from '../lib/report.js';

const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const broadcast = args.includes('--broadcast');
const budgetText = option('--max-cost-tpot', '');
const journalPath = option('--journal', 'artifacts/local/release-execution.json');
const reportFile = option('--report-file', 'public/reports/0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5.json');
const sourceReport = JSON.parse(await readFile(reportFile, 'utf8'));
validateImportedRun(sourceReport);
const reportHash = `0x${sourceReport.evidenceHash}`;
if (broadcast && !budgetText) throw new Error('Broadcast requires an explicit --max-cost-tpot cap.');

let api;
let journal;
async function saveJournal() {
  await mkdir(new URL('../artifacts/local/', import.meta.url), { recursive: true });
  await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`);
  await rename(`${journalPath}.tmp`, journalPath);
}
try {
  const signer = await loadTestnetSigner(option('--wallet', '.private/wallet.json'));
  api = await connectNative({ signal: AbortSignal.timeout(30_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (api.runtimeVersion.specName.toString() !== 'portaldot-v3' || api.runtimeVersion.specVersion.toString() !== '3002') throw new Error('Automatic execution is verified only for portaldot-v3 runtime 3002. Revalidate before signing on a changed runtime.');
  const decimals = api.registry.chainDecimals[0];
  const account = await api.query.system.account(signer.address);
  const available = availableNativeBalance(account, api.consts.balances.existentialDeposit);
  if (available <= 0n) {
    console.log(JSON.stringify({ status: 'awaiting-test-tokens', checkedAt: new Date().toISOString(), nativeAccount: signer.address, availableTpot: formatNative(available, decimals), note: 'No transaction was signed or sent.' }, null, 2));
    process.exitCode = 2;
  } else {
    if (!api.consts.revive.allowEVMBytecode.isTrue) throw new Error('The pinned runtime does not allow EVM bytecode.');
    const evmAccount = (await api.call.reviveApi.address(signer.address)).toHex();
    const roundTrip = await api.call.reviveApi.accountId(evmAccount);
    if (!Buffer.from(decodeAddress(roundTrip.toString())).equals(Buffer.from(decodeAddress(signer.address)))) throw new Error('Funded native/EVM account mapping does not round-trip.');
    const artifact = await compileReleaseGate();
    const iface = new Interface(artifact.abi);
    const budget = budgetText ? parseTokenAmount(budgetText, decimals) : null;
    let prior;
    try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (prior?.pending) throw new Error(`Previous submission has an unknown outcome: ${prior.pending.transactionHash}. Inspect it and reconcile the journal before continuing.`);
    if (prior?.actualFeeNeedsReconciliation || prior?.budgetNeedsReconciliation) throw new Error('The previous finalized fee or cumulative budget needs reconciliation before another transaction.');
    if (prior && !args.includes('--resume')) throw new Error('A journal already exists. Inspect it, then use --resume to continue finalized stages.');
    if (prior && (prior.nativeAccount !== signer.address || prior.network.genesisHash !== NETWORK.genesisHash || prior.reportHash !== reportHash || prior.sourceSha256 !== artifact.sourceSha256)) throw new Error('Resume target, source, or report differs from the existing journal.');
    if (prior?.stages.some(entry => entry.stage === 'deploy') && !prior.contractAddress) throw new Error('A finalized deployment is already journaled without its address. Reconcile its Instantiated event; do not redeploy.');
    journal = prior || { schemaVersion: 1, network: NETWORK, nativeAccount: signer.address, evmAccount, sourceSha256: artifact.sourceSha256, reportHash, sourceReportFile: reportFile, stages: [], estimatedCommittedRaw: '0', actualNativeFeesRaw: '0', reviewerScope: 'Both developer and reviewer are the isolated test account. This is a facilitated execution demo, not independent adoption or official approval.' };
    let committed = BigInt(journal.estimatedCommittedRaw);
    async function execute(stage, simulation, tx, details = {}) {
      const charge = simulation.maxStorageDeposit?.isCharge ? BigInt(simulation.maxStorageDeposit.asCharge.toString()) : 0n;
      const fee = BigInt((await tx.paymentInfo(signer)).partialFee.toString());
      const feeReserve = fee * 2n;
      const cost = charge + feeReserve;
      const summary = { stage, estimatedFeeRaw: fee.toString(), feeReserveRaw: feeReserve.toString(), maxStorageDepositRaw: charge.toString(), estimatedCostTpot: formatNative(cost, decimals), explicitEstimateCapTpot: budgetText || null, budgetScope: 'Cumulative maximum storage deposits plus twice estimated native fees. Actual fee changes cannot be strictly capped by this helper.', weight: simulation.weightRequired.toJSON(), ...details };
      if (!broadcast) { console.log(JSON.stringify({ status: 'dry-run-complete', ...summary, note: 'No transaction was signed. Following writes are estimated only after deployment.' }, null, 2)); return null; }
      if (committed + cost > budget) throw new Error(`Cumulative estimated fee plus deposit exceeds the ${budgetText} tPOT cap.`);
      const fresh = await api.query.system.account(signer.address);
      if (cost >= availableNativeBalance(fresh, api.consts.balances.existentialDeposit)) throw new Error('Insufficient available test tokens while preserving the native account.');
      const receipt = await sendFinalized(api, tx, signer, async transactionHash => {
        journal.pending = { stage, transactionHash, signedAt: new Date().toISOString() };
        await saveJournal();
        console.log(JSON.stringify({ status: 'signed-and-journaled', stage, transactionHash }));
      });
      if (stage === 'deploy') {
        const event = receipt.events.find(event => event.section === 'revive' && event.method === 'Instantiated');
        const deployedAddress = event?.data?.[1];
        if (typeof deployedAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(deployedAddress)) throw new Error('Finalized deployment lacks a valid Instantiated address. The pending journal is retained; inspect before retrying.');
        journal.contractAddress = deployedAddress;
      }
      committed += cost;
      journal.estimatedCommittedRaw = committed.toString();
      journal.stages.push({ ...summary, ...receipt });
      const feeStopReason = recordFinalizedNativeFee(journal, receipt, feeReserve);
      delete journal.pending;
      await saveJournal();
      if (feeStopReason) throw new Error(feeStopReason);
      return receipt;
    }
    if (!journal.contractAddress) {
      const initCode = artifact.bytecode + AbiCoder.defaultAbiCoder().encode(['address'], [evmAccount]).slice(2);
      const simulation = await api.call.reviveApi.instantiate(signer.address, '0', null, null, { Upload: initCode }, '0x', null);
      assertDryRun(api, simulation, true);
      const limit = simulation.maxStorageDeposit.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
      const tx = api.tx.revive.instantiateWithCode('0', simulation.weightRequired.toJSON(), limit, initCode, '0x', null);
      await execute('deploy', simulation, tx);
    }
    if (journal.contractAddress) {
      for (const [stage, method, values] of [['submit-report', 'submit', [reportHash]], ['review-report', 'review', [true]]]) {
        if (journal.stages.some(entry => entry.stage === stage)) continue;
        const input = iface.encodeFunctionData(method, values);
        const simulation = await api.call.reviveApi.call(signer.address, journal.contractAddress, '0', null, null, input);
        assertDryRun(api, simulation);
        const limit = simulation.maxStorageDeposit.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
        const tx = api.tx.revive.call(journal.contractAddress, '0', simulation.weightRequired.toJSON(), limit, input);
        const receipt = await execute(stage, simulation, tx, { method, values });
        if (!receipt) break;
      }
      if (broadcast && journal.stages.some(stage => stage.stage === 'review-report')) {
        const last = journal.stages.at(-1);
        const plan = { name: 'ReviveCheck release gate', release: 'v0.2.0', logicalContractId: 'release-gate', sourceRevision: artifact.sourceSha256, profile: 'contract', expectedChainId: NETWORK.chainId, account: signer.address, contractAddress: journal.contractAddress, transactionHash: last.transactionHash, transactionBlockHash: last.transactionBlockHash, assertions: [
          { id: 'owner', label: 'Developer owns this release gate', signature: 'owner()', returns: 'address', args: [], expected: evmAccount },
          { id: 'reviewer', label: 'Configured test reviewer', signature: 'reviewer()', returns: 'address', args: [], expected: evmAccount },
          { id: 'revision', label: 'Submitted report revision', signature: 'revision()', returns: 'uint256', args: [], expected: '1' },
          { id: 'approved', label: 'Facilitated reviewer decision', signature: 'approved()', returns: 'bool', args: [], expected: true },
          { id: 'report', label: 'Exact submitted report commitment', signature: 'reportHash()', returns: 'bytes32', args: [], expected: reportHash },
        ] };
        const result = await inspectChain(plan);
        const now = new Date().toISOString();
        const run = sealRun({ schemaVersion: 2, id: `release-gate-${Date.now()}`, projectId: 'release-gate-reference', projectName: plan.name, release: plan.release, input: plan, mode: 'live', scope: 'portaldot-testnet-readonly', scenario: null, startedAt: now, completedAt: now, previousRunId: null, status: overall(result.checks), ...result });
        await writeFile('artifacts/local/release-gate.plan.json', `${JSON.stringify(plan, null, 2)}\n`);
        await writeFile('artifacts/local/release-gate-readback.json', `${JSON.stringify(run, null, 2)}\n`);
        journal.readbackHash = run.evidenceHash;
        journal.readbackStatus = run.status;
        journal.completedAt = now;
        await saveJournal();
        console.log(JSON.stringify({ status: run.status === 'passed' ? 'execution-and-readback-complete' : 'readback-needs-attention', contractAddress: journal.contractAddress, transactions: journal.stages.map(({ stage, transactionHash, transactionBlockHash }) => ({ stage, transactionHash, transactionBlockHash })), readbackStatus: run.status, reviewerScope: journal.reviewerScope }, null, 2));
        if (run.status !== 'passed') process.exitCode = 2;
      }
    }
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 700), note: 'A journal pending transaction is an unknown outcome. Never submit it again without reconciliation.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
