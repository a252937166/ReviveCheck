import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connectNative, assertTestnet, evmRpc, availableNativeBalance, formatNative, parseTokenAmount } from '../lib/chain.js';
import { loadTestnetSigner, sendFinalized } from '../lib/execution.js';
import { attestationRemark, verifyAttestationWithApi } from '../lib/attestation.js';
import { validateImportedRun } from '../lib/report.js';

// Records a review decision for one published report as System.remark_with_event.
// Default is a read-only estimate; --broadcast signs with the isolated test wallet.
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const reportHash = option('--report', '');
const decision = option('--decision', 'accepted');
const broadcast = args.includes('--broadcast');
const capText = option('--max-fee-tpot', '');
if (!/^[a-f0-9]{64}$/.test(reportHash)) throw new Error('Pass --report <64-character published report hash>.');
if (broadcast && !capText) throw new Error('Broadcast requires an explicit --max-fee-tpot cap.');
const report = validateImportedRun(JSON.parse(await readFile(`public/reports/${reportHash}.json`, 'utf8')));
if (report.evidenceHash !== reportHash) throw new Error('The report file does not match its fingerprint.');
const remark = attestationRemark({ reportHash, decision });

let api;
try {
  const signer = await loadTestnetSigner(option('--wallet', '.private/wallet.json'));
  api = await connectNative({ signal: AbortSignal.timeout(30_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  const decimals = api.registry.chainDecimals[0];
  const tx = api.tx.system.remarkWithEvent(remark);
  const fee = BigInt((await tx.paymentInfo(signer.address)).partialFee.toString());
  const available = availableNativeBalance(await api.query.system.account(signer.address), api.consts.balances.existentialDeposit);
  const estimate = { remark, callData: tx.method.toHex(), signer: signer.address, estimatedFeeTpot: formatNative(fee, decimals), availableTpot: formatNative(available, decimals) };
  if (!broadcast || available <= fee * 2n) {
    console.log(JSON.stringify({ status: available <= fee * 2n ? 'awaiting-test-tokens' : 'dry-run-complete', ...estimate, note: 'No transaction was signed or sent.' }, null, 2));
    process.exitCode = available <= fee * 2n ? 2 : 0;
  } else {
    if (fee * 2n > parseTokenAmount(capText, decimals)) throw new Error(`The conservative fee reserve exceeds the ${capText} tPOT cap.`);
    const receipt = await sendFinalized(api, tx, signer, async (hash) => console.log(JSON.stringify({ status: 'signed', extrinsicHash: hash })));
    const verified = await verifyAttestationWithApi(api, { extrinsicHash: receipt.transactionHash, blockHash: receipt.transactionBlockHash });
    if (!verified.verified) throw new Error(`Finalized, but verification failed: ${verified.reasons.join(' ')}`);
    const entry = { reportHash, decision, remark, extrinsicHash: receipt.transactionHash, blockHash: receipt.transactionBlockHash, blockNumber: verified.blockNumber, signer: verified.reviewer, finalizedAt: receipt.finalizedAt, scope: 'Author attestation from the isolated test wallet; not an independent review.' };
    await mkdir('public/lifecycle', { recursive: true });
    let ledger = { schema: 'revivecheck.attestations.v1', attestations: [] };
    try { ledger = JSON.parse(await readFile('public/lifecycle/attestations.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    ledger.attestations = ledger.attestations.filter((item) => item.extrinsicHash !== entry.extrinsicHash).concat(entry);
    await writeFile('public/lifecycle/attestations.json', `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(JSON.stringify({ status: 'attested', ...entry }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600), note: 'A signed but unconfirmed remark is an unknown outcome. Inspect it before retrying.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
