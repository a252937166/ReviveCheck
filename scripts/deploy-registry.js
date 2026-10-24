import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount } from '../lib/chain.js';
import { loadTestnetSigner, assertDryRun, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';
import { compileReleaseRegistry } from './compile-release-registry.js';

// Deploy the shared ReleaseRegistry once, so any visitor's wallet can submit and
// review on-chain. Default is a read-only estimate; --broadcast signs with the
// isolated test wallet after journaling the transaction hash.
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const broadcast = args.includes('--broadcast');
const capText = option('--max-cost-tpot', '');
const journalPath = option('--journal', 'artifacts/local/registry-deploy.json');
if (broadcast && !capText) throw new Error('Broadcast requires an explicit --max-cost-tpot cap.');

let api, journal;
const save = async () => { await mkdir('artifacts/local', { recursive: true }); await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`); await rename(`${journalPath}.tmp`, journalPath); };
try {
  const signer = await loadTestnetSigner(option('--wallet', '.private/wallet.json'));
  api = await connectNative({ signal: AbortSignal.timeout(60_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (api.runtimeVersion.specVersion.toString() !== '3002') throw new Error('Signing is verified only for runtime 3002.');
  const decimals = api.registry.chainDecimals[0];
  const artifact = await compileReleaseRegistry();
  let prior;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.pending) throw new Error(`Previous deployment ${prior.pending.transactionHash} has an unknown outcome. Reconcile it first.`);
  if (prior?.contractAddress) throw new Error(`Already deployed at ${prior.contractAddress}.`);
  const simulation = await api.call.reviveApi.instantiate(signer.address, '0', null, null, { Upload: artifact.bytecode }, '0x', null);
  assertDryRun(api, simulation, true);
  const limit = simulation.maxStorageDeposit.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
  const tx = api.tx.revive.instantiateWithCode('0', simulation.weightRequired.toJSON(), limit, artifact.bytecode, '0x', null);
  const fee = BigInt((await tx.paymentInfo(signer)).partialFee.toString());
  const cost = BigInt(limit) + fee * 2n;
  const available = availableNativeBalance(await api.query.system.account(signer.address), api.consts.balances.existentialDeposit);
  const stateNonce = (await api.query.system.account(signer.address)).nonce.toNumber();
  const poolNonce = (await api.rpc.system.accountNextIndex(signer.address)).toNumber();
  const estimate = { runtimeBytes: (artifact.deployedBytecode.length - 2) / 2, maxStorageDepositTpot: formatNative(BigInt(limit), decimals), estimatedFeeTpot: formatNative(fee, decimals), estimatedCostTpot: formatNative(cost, decimals), availableTpot: formatNative(available, decimals), pendingTransactions: poolNonce - stateNonce };
  if (!broadcast) {
    console.log(JSON.stringify({ status: 'dry-run-complete', ...estimate, note: 'No transaction was signed.' }, null, 2));
  } else {
    if (poolNonce !== stateNonce) throw new Error('The account has pending transactions; another signer may be active.');
    if (cost > parseTokenAmount(capText, decimals)) throw new Error(`Estimated cost ${estimate.estimatedCostTpot} tPOT exceeds the ${capText} tPOT cap.`);
    if (cost >= available) throw new Error('Insufficient available test tokens.');
    journal = { schemaVersion: 1, network: NETWORK, nativeAccount: signer.address, sourceSha256: artifact.sourceSha256, estimate };
    const receipt = await sendFinalized(api, tx, signer, async (transactionHash) => { journal.pending = { transactionHash, signedAt: new Date().toISOString() }; await save(); console.log(JSON.stringify({ status: 'signed-and-journaled', transactionHash })); });
    const instantiated = receipt.events.find((event) => event.section === 'revive' && event.method === 'Instantiated');
    const contractAddress = instantiated?.data?.[1];
    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress || '')) throw new Error('Finalized deployment lacks an Instantiated address; the pending journal is kept.');
    const header = await api.rpc.chain.getHeader(receipt.transactionBlockHash);
    journal.contractAddress = contractAddress.toLowerCase();
    journal.deploy = { extrinsicHash: receipt.transactionHash, blockHash: receipt.transactionBlockHash, blockNumber: header.number.toString(), finalizedAt: receipt.finalizedAt };
    journal.stages = [{ stage: 'deploy', ...receipt }];
    const stop = recordFinalizedNativeFee(journal, receipt, fee * 2n);
    delete journal.pending;
    await save();
    const code = await evmRpc('eth_getCode', [journal.contractAddress, 'latest']);
    const record = { schema: 'revivecheck.release-registry.v1', network: 'testnet', chainId: NETWORK.chainId, contract: journal.contractAddress, deployer: signer.address, sourceSha256: artifact.sourceSha256, compiler: artifact.compiler, runtimeBytes: (code.length - 2) / 2, deploy: journal.deploy, abi: artifact.abi };
    await mkdir('public/lifecycle', { recursive: true });
    await writeFile('public/lifecycle/registry.json', `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ status: 'deployed', contract: record.contract, deploy: record.deploy, runtimeBytes: record.runtimeBytes, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals) }, null, 2));
    if (stop) throw new Error(stop);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600), note: 'A journaled pending transaction is an unknown outcome.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
