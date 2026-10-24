import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount } from '../lib/chain.js';
import { loadTestnetSigner, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';
import { evidenceBytes, retrieveEvidenceWithApi } from '../lib/evidence.js';
import { validateImportedRun } from '../lib/report.js';

// Store one published report on Portaldot through the native Remark module
// (remark.store). Default is a read-only estimate; --broadcast signs with the
// isolated test wallet, then retrieves the report from the block and verifies it.
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const hash = option('--report', '').replace(/^0x/, '').toLowerCase();
const broadcast = args.includes('--broadcast');
const capText = option('--max-fee-tpot', '');
if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Usage: node scripts/store-evidence.js --report <64-hex report hash> [--broadcast --max-fee-tpot <n>]');
if (broadcast && !capText) throw new Error('Broadcast requires an explicit --max-fee-tpot cap.');
const journalPath = option('--journal', `artifacts/local/evidence-${hash.slice(0, 12)}.json`);
const recordPath = 'public/lifecycle/evidence.json';

let api, journal;
const save = async () => { await mkdir('artifacts/local', { recursive: true }); await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`); await rename(`${journalPath}.tmp`, journalPath); };
try {
  const run = JSON.parse(await readFile(`public/reports/${hash}.json`, 'utf8'));
  validateImportedRun(run);
  const evidence = evidenceBytes(run);
  let prior;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.pending) throw new Error(`Previous store ${prior.pending.transactionHash} has an unknown outcome. Reconcile it first.`);
  if (prior?.stored) throw new Error(`Already stored in extrinsic ${prior.stored.extrinsicHash}.`);
  const signer = await loadTestnetSigner(option('--wallet', '.private/wallet.json'));
  api = await connectNative({ signal: AbortSignal.timeout(60_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (api.runtimeVersion.specVersion.toString() !== '3002') throw new Error('Signing is verified only for runtime 3002.');
  const decimals = api.registry.chainDecimals[0];
  const tx = api.tx.remark.store(evidence.hex);
  const fee = BigInt((await tx.paymentInfo(signer)).partialFee.toString());
  const account = await api.query.system.account(signer.address);
  const available = availableNativeBalance(account, api.consts.balances.existentialDeposit);
  const stateNonce = account.nonce.toNumber();
  const poolNonce = (await api.rpc.system.accountNextIndex(signer.address)).toNumber();
  const estimate = { reportHash: hash, bytes: evidence.length, contentHash: evidence.contentHash, estimatedFeeTpot: formatNative(fee, decimals), availableTpot: formatNative(available, decimals), pendingTransactions: poolNonce - stateNonce };
  if (!broadcast) {
    console.log(JSON.stringify({ status: 'dry-run-complete', ...estimate, note: 'No transaction was signed.' }, null, 2));
  } else {
    if (poolNonce !== stateNonce) throw new Error('The account has pending transactions; another signer may be active.');
    if (fee * 2n > parseTokenAmount(capText, decimals)) throw new Error(`Fee reserve ${formatNative(fee * 2n, decimals)} tPOT exceeds the ${capText} tPOT cap.`);
    if (fee * 2n >= available) throw new Error('Insufficient available test tokens.');
    journal = { schemaVersion: 1, network: NETWORK, nativeAccount: signer.address, estimate };
    const receipt = await sendFinalized(api, tx, signer, async (transactionHash) => { journal.pending = { transactionHash, signedAt: new Date().toISOString() }; await save(); console.log(JSON.stringify({ status: 'signed-and-journaled', transactionHash })); });
    const header = await api.rpc.chain.getHeader(receipt.transactionBlockHash);
    journal.stored = { extrinsicHash: receipt.transactionHash, blockHash: receipt.transactionBlockHash, blockNumber: header.number.toString(), finalizedAt: receipt.finalizedAt };
    journal.stages = [{ stage: 'store', ...receipt }];
    const stop = recordFinalizedNativeFee(journal, receipt, fee * 2n);
    delete journal.pending;
    await save();
    const retrieved = await retrieveEvidenceWithApi(api, { extrinsicHash: journal.stored.extrinsicHash, blockHash: journal.stored.blockHash, expectedHash: hash }, { signal: AbortSignal.timeout(60_000) });
    if (!retrieved.verified) throw new Error(`Stored, but retrieval did not verify: ${retrieved.reasons.join(' ')}`);
    let record;
    try { record = JSON.parse(await readFile(recordPath, 'utf8')); } catch { record = { schema: 'revivecheck.evidence.v1', network: 'testnet', items: [] }; }
    record.items = record.items.filter((item) => item.reportHash !== hash);
    record.items.push({ reportHash: hash, release: run.release, projectName: run.projectName, bytes: evidence.length, contentHash: evidence.contentHash, publisher: signer.address, ...journal.stored, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals), retrievedAt: new Date().toISOString() });
    await mkdir('public/lifecycle', { recursive: true });
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ status: 'stored', ...journal.stored, bytes: evidence.length, contentHash: evidence.contentHash, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals), retrieved: retrieved.verified }, null, 2));
    if (stop) throw new Error(stop);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600), note: 'A journaled pending transaction is an unknown outcome.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
