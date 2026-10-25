import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { decodeAddress } from '@polkadot/util-crypto';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount } from '../lib/chain.js';
import { loadTestnetSigner, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';

// Transfer testnet tPOT from the project's development wallet to another
// project-controlled account (the reviewer wallet), with the same guards as every
// other writer: estimate first, an explicit cap, the hash journaled before sending,
// a finalized receipt with its actual fee, and a public record of the transfer.
//
//   node scripts/fund-account.js --to 5… --amount 5                       # estimate only
//   node scripts/fund-account.js --to 5… --amount 5 --broadcast --max-fee-tpot 0.1 --wallet .private/wallet.json
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const to = option('--to', '');
const amountText = option('--amount', '');
const broadcast = args.includes('--broadcast');
const capText = option('--max-fee-tpot', '');
const purpose = option('--purpose', 'Fund the project-controlled reviewer account so registry decisions are signed by a distinct account from the release owner.');
if (!to || !amountText) throw new Error('Usage: node scripts/fund-account.js --to <ss58> --amount <tPOT> [--broadcast --max-fee-tpot <n> --wallet <file>]');
if (decodeAddress(to).length !== 32) throw new Error('--to is a native SS58 address.');
if (broadcast && !capText) throw new Error('Broadcast requires an explicit --max-fee-tpot cap.');
const journalPath = option('--journal', `artifacts/local/fund-${to.slice(0, 12)}.json`);
const recordPath = option('--record', 'public/lifecycle/funding.json');

let api, journal;
const save = async () => { await mkdir('artifacts/local', { recursive: true }); await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`); await rename(`${journalPath}.tmp`, journalPath); };
try {
  let prior;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.pending) throw new Error(`Previous transfer ${prior.pending.transactionHash} has an unknown outcome. Reconcile it first.`);
  if (prior?.finalized) throw new Error(`A transfer to ${to} is already finalized in ${prior.finalized.extrinsicHash} (${journalPath}); use another journal for a second transfer.`);
  const signer = broadcast ? await loadTestnetSigner(option('--wallet', '.private/wallet.json')) : null;
  const origin = signer ? signer.address : option('--from', JSON.parse(await readFile('docs/WALLET_PUBLIC.json', 'utf8')).ss58Address);
  api = await connectNative({ signal: AbortSignal.timeout(60_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (api.runtimeVersion.specVersion.toString() !== '3002') throw new Error('Signing is verified only for runtime 3002.');
  const decimals = api.registry.chainDecimals[0];
  const amount = parseTokenAmount(amountText, decimals);
  const existential = BigInt(api.consts.balances.existentialDeposit.toString());
  if (amount < existential) throw new Error(`The amount is below the existential deposit of ${formatNative(existential, decimals)} tPOT.`);
  const tx = api.tx.balances.transferKeepAlive(to, amount);
  const fee = BigInt((await tx.paymentInfo(origin)).partialFee.toString());
  const [account, recipient] = await Promise.all([api.query.system.account(origin), api.query.system.account(to)]);
  const available = availableNativeBalance(account, api.consts.balances.existentialDeposit);
  const stateNonce = account.nonce.toNumber();
  const poolNonce = (await api.rpc.system.accountNextIndex(origin)).toNumber();
  const estimate = { from: origin, to, amountTpot: formatNative(amount, decimals), estimatedFeeTpot: formatNative(fee, decimals), availableTpot: formatNative(available, decimals), recipientBalanceTpot: formatNative(recipient.data.free.toBigInt(), decimals), pendingTransactions: poolNonce - stateNonce };
  if (!broadcast) {
    console.log(JSON.stringify({ status: 'dry-run-complete', ...estimate, note: 'No wallet was read and no transaction was signed.' }, null, 2));
  } else {
    if (poolNonce !== stateNonce) throw new Error('The account has pending transactions; another signer may be active.');
    if (fee * 2n > parseTokenAmount(capText, decimals)) throw new Error(`Fee reserve ${formatNative(fee * 2n, decimals)} tPOT exceeds the ${capText} tPOT cap.`);
    if (amount + fee * 2n >= available) throw new Error('Insufficient available test tokens.');
    journal = { schemaVersion: 1, network: NETWORK, nativeAccount: signer.address, purpose, estimate };
    const receipt = await sendFinalized(api, tx, signer, async (transactionHash) => { journal.pending = { transactionHash, signedAt: new Date().toISOString() }; await save(); console.log(JSON.stringify({ status: 'signed-and-journaled', transactionHash })); });
    const header = await api.rpc.chain.getHeader(receipt.transactionBlockHash);
    journal.finalized = { extrinsicHash: receipt.transactionHash, blockHash: receipt.transactionBlockHash, blockNumber: header.number.toString(), finalizedAt: receipt.finalizedAt };
    journal.stages = [{ stage: 'transfer', ...receipt }];
    const stop = recordFinalizedNativeFee(journal, receipt, fee * 2n);
    delete journal.pending;
    await save();
    const after = await api.query.system.account(to);
    const record = await readFile(recordPath, 'utf8').then(JSON.parse).catch(() => ({ schema: 'revivecheck.funding.v1', network: 'testnet', scope: 'Transfers between project-controlled testnet accounts. A funded reviewer account demonstrates role separation on-chain, not independent review.', items: [] }));
    record.items.push({ from: signer.address, to, amountTpot: estimate.amountTpot, purpose, ...journal.finalized, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals), recipientBalanceAfterTpot: formatNative(after.data.free.toBigInt(), decimals) });
    await mkdir('public/lifecycle', { recursive: true });
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ status: 'transferred', ...journal.finalized, amountTpot: estimate.amountTpot, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals), recipientBalanceAfterTpot: formatNative(after.data.free.toBigInt(), decimals), record: recordPath }, null, 2));
    if (stop) throw new Error(stop);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600), note: 'A journaled pending transaction is an unknown outcome.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
