import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount, str } from '../lib/chain.js';
import { loadTestnetSigner, assertDryRun, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';
import { readRegistryWithClients, releaseIdOf, decodeRegistryError } from '../lib/registry.js';
import { TOKEN_LIST, assertTokenListWritable, listCall, decodeTokenListError, readTokenListWithClients } from '../lib/tokenlist.js';
import { DEMO_PRECOMPILE } from '../lib/demo.js';

// List a token in the VerifiedTokenList from the release owner's wallet: the
// consumer side of the registry. Default is a read-only dry-run; --broadcast signs
// with the isolated test wallet, then reads the listing back through both interfaces.
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const broadcast = args.includes('--broadcast');
const capText = option('--max-cost-tpot', '');
const token = option('--token', DEMO_PRECOMPILE);
const label = option('--label', 'pusd-token-list');
const decimals = Number(option('--decimals', '6'));
if (broadcast && !capText) throw new Error('Broadcast requires an explicit --max-cost-tpot cap.');
const journalPath = option('--journal', `artifacts/local/list-${token.slice(2, 14)}.json`);

let api, journal;
const save = async () => { await mkdir('artifacts/local', { recursive: true }); await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`); await rename(`${journalPath}.tmp`, journalPath); };
try {
  assertTokenListWritable();
  if (!TOKEN_LIST.address) throw new Error('Deploy the VerifiedTokenList first.');
  let prior;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.pending) throw new Error(`Previous listing ${prior.pending.transactionHash} has an unknown outcome. Reconcile it first.`);
  const signer = await loadTestnetSigner(option('--wallet', '.private/wallet.json'));
  api = await connectNative({ signal: AbortSignal.timeout(60_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (api.runtimeVersion.specVersion.toString() !== '3002') throw new Error('Signing is verified only for runtime 3002.');
  const chainDecimals = api.registry.chainDecimals[0];
  const signal = AbortSignal.timeout(90_000);
  const clients = { api, rpc: (method, params) => evmRpc(method, params, { signal }), signal };
  const owner = str(await api.call.reviveApi.address(signer.address)).toLowerCase();
  const releaseId = option('--release-id', releaseIdOf(owner, label));
  const reviewer = option('--reviewer', owner);
  const current = await readRegistryWithClients(clients, { releaseId, reviewer });
  if (!current.release.exists) throw new Error(`Release ${releaseId} is not in the registry.`);
  const reportHash = option('--report', current.release.reportHash);
  const call = listCall({ token, releaseId, reportHash, reviewer, decimals });
  const simulation = await api.call.reviveApi.call(signer.address, call.to, '0', null, null, call.data);
  if (simulation.result?.isOk && (BigInt(simulation.result.asOk.flags.toJSON()?.bits ?? simulation.result.asOk.flags.toJSON()) & 1n) !== 0n) {
    const data = str(simulation.result.asOk.data);
    throw new Error(`The list call would revert: ${decodeTokenListError(data) || decodeRegistryError(data) || data.slice(0, 20)}`);
  }
  assertDryRun(api, simulation);
  const limit = simulation.maxStorageDeposit.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
  const tx = api.tx.revive.call(call.to, '0', simulation.weightRequired.toJSON(), limit, call.data);
  const fee = BigInt((await tx.paymentInfo(signer)).partialFee.toString());
  const cost = BigInt(limit) + fee * 2n;
  const account = await api.query.system.account(signer.address);
  const available = availableNativeBalance(account, api.consts.balances.existentialDeposit);
  const stateNonce = account.nonce.toNumber();
  const poolNonce = (await api.rpc.system.accountNextIndex(signer.address)).toNumber();
  const estimate = { token, releaseId, reportHash, reviewer, decimals, approvedNow: current.decision?.approved === true, maxStorageDepositTpot: formatNative(BigInt(limit), chainDecimals), estimatedFeeTpot: formatNative(fee, chainDecimals), estimatedCostTpot: formatNative(cost, chainDecimals), availableTpot: formatNative(available, chainDecimals), pendingTransactions: poolNonce - stateNonce };
  if (!broadcast) {
    console.log(JSON.stringify({ status: 'dry-run-complete', ...estimate, note: 'No transaction was signed.' }, null, 2));
  } else {
    if (poolNonce !== stateNonce) throw new Error('The account has pending transactions; another signer may be active.');
    if (cost > parseTokenAmount(capText, chainDecimals)) throw new Error(`Estimated cost ${estimate.estimatedCostTpot} tPOT exceeds the ${capText} tPOT cap.`);
    if (cost >= available) throw new Error('Insufficient available test tokens.');
    journal = { schemaVersion: 1, network: NETWORK, nativeAccount: signer.address, contract: TOKEN_LIST.address, estimate };
    const receipt = await sendFinalized(api, tx, signer, async (transactionHash) => { journal.pending = { transactionHash, signedAt: new Date().toISOString() }; await save(); console.log(JSON.stringify({ status: 'signed-and-journaled', transactionHash })); });
    const header = await api.rpc.chain.getHeader(receipt.transactionBlockHash);
    journal.listed = { extrinsicHash: receipt.transactionHash, blockHash: receipt.transactionBlockHash, blockNumber: header.number.toString(), finalizedAt: receipt.finalizedAt };
    journal.stages = [{ stage: 'list', ...receipt }];
    const stop = recordFinalizedNativeFee(journal, receipt, fee * 2n);
    delete journal.pending;
    await save();
    const readback = await readTokenListWithClients(clients, { token });
    if (!readback.listed || !readback.interfacesAgree) throw new Error('Listed, but the readback does not show it through both interfaces.');
    // Listings are appended to the active deployment's own record; a v1 record never receives v2 listings.
    const record = JSON.parse(await readFile(TOKEN_LIST.record, 'utf8'));
    record.listings = (record.listings || []).filter((item) => item.token !== token.toLowerCase());
    record.listings.push({ token: token.toLowerCase(), releaseId, reportHash, reviewer, decimals, ...journal.listed, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), chainDecimals), readback: { block: readback.block, listed: readback.listed, interfacesAgree: readback.interfacesAgree } });
    await writeFile(TOKEN_LIST.record, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ status: 'listed', ...journal.listed, readback: { block: readback.block.number, listed: readback.listed, interfacesAgree: readback.interfacesAgree }, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), chainDecimals) }, null, 2));
    if (stop) throw new Error(stop);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600), note: 'A journaled pending transaction is an unknown outcome.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
