import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { Interface } from 'ethers';
import { connectNative, evmRpc, assertTestnet, NETWORK, availableNativeBalance, formatNative, parseTokenAmount } from '../lib/chain.js';
import { loadTestnetSigner, assertDryRun, sendFinalized, recordFinalizedNativeFee } from '../lib/execution.js';
import { REGISTRY } from '../lib/registry.js';
import { compileTokenList } from './compile-token-list.js';

// Deploy the VerifiedTokenList, the registry's reference consumer. Default is a
// read-only estimate; --broadcast signs with the isolated test wallet after
// journaling the transaction hash. --curator <h160> pins a reviewer; the default
// is open, so any lister names the reviewer they rely on.
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const broadcast = args.includes('--broadcast');
const capText = option('--max-cost-tpot', '');
const curator = option('--curator', `0x${'00'.repeat(20)}`);
const journalPath = option('--journal', 'artifacts/local/token-list-deploy.json');
if (broadcast && !capText) throw new Error('Broadcast requires an explicit --max-cost-tpot cap.');
if (!/^0x[0-9a-fA-F]{40}$/.test(curator)) throw new Error('--curator must be an H160 address.');

let api, journal;
const save = async () => { await mkdir('artifacts/local', { recursive: true }); await writeFile(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`); await rename(`${journalPath}.tmp`, journalPath); };
try {
  const signer = await loadTestnetSigner(option('--wallet', '.private/wallet.json'));
  api = await connectNative({ signal: AbortSignal.timeout(60_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (api.runtimeVersion.specVersion.toString() !== '3002') throw new Error('Signing is verified only for runtime 3002.');
  const decimals = api.registry.chainDecimals[0];
  const { extra, ...artifact } = await compileTokenList();
  // The constructor arguments ride on the initcode: separate native constructor data is refused by revive for EVM bytecode.
  const initcode = `${artifact.bytecode}${new Interface(artifact.abi).encodeDeploy([REGISTRY.address, curator]).slice(2)}`;
  let prior;
  try { prior = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.pending) throw new Error(`Previous deployment ${prior.pending.transactionHash} has an unknown outcome. Reconcile it first.`);
  if (prior?.contractAddress) throw new Error(`Already deployed at ${prior.contractAddress}.`);
  const simulation = await api.call.reviveApi.instantiate(signer.address, '0', null, null, { Upload: initcode }, '0x', null);
  assertDryRun(api, simulation, true);
  const limit = simulation.maxStorageDeposit.isCharge ? simulation.maxStorageDeposit.asCharge.toString() : '0';
  const tx = api.tx.revive.instantiateWithCode('0', simulation.weightRequired.toJSON(), limit, initcode, '0x', null);
  const fee = BigInt((await tx.paymentInfo(signer)).partialFee.toString());
  const cost = BigInt(limit) + fee * 2n;
  const account = await api.query.system.account(signer.address);
  const available = availableNativeBalance(account, api.consts.balances.existentialDeposit);
  const stateNonce = account.nonce.toNumber();
  const poolNonce = (await api.rpc.system.accountNextIndex(signer.address)).toNumber();
  const estimate = { runtimeBytes: (artifact.deployedBytecode.length - 2) / 2, curator, maxStorageDepositTpot: formatNative(BigInt(limit), decimals), estimatedFeeTpot: formatNative(fee, decimals), estimatedCostTpot: formatNative(cost, decimals), availableTpot: formatNative(available, decimals), pendingTransactions: poolNonce - stateNonce };
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
    const record = { schema: 'revivecheck.token-list.v1', network: 'testnet', chainId: NETWORK.chainId, contract: journal.contractAddress, registry: REGISTRY.address, curator, deployer: signer.address, sourceSha256: artifact.sourceSha256, sources: artifact.sources, compiler: artifact.compiler, optimizerRuns: artifact.optimizerRuns, runtimeBytes: (code.length - 2) / 2, deploy: journal.deploy, abi: artifact.abi };
    await mkdir('public/lifecycle', { recursive: true });
    await writeFile('public/lifecycle/token-list.json', `${JSON.stringify(record, null, 2)}\n`);
    // The client library carries the deployed address, as it does for the registry.
    const library = await readFile('lib/tokenlist.js', 'utf8');
    await writeFile('lib/tokenlist.js', library.replace("  address: null, // set by scripts/deploy-token-list.js once deployed\n  registry: REGISTRY.address,\n  deploy: null,", `  address: '${record.contract}',\n  registry: REGISTRY.address,\n  curator: '${curator}',\n  deploy: ${JSON.stringify(journal.deploy)},`));
    console.log(JSON.stringify({ status: 'deployed', contract: record.contract, deploy: record.deploy, runtimeBytes: record.runtimeBytes, feeTpot: formatNative(BigInt(journal.actualNativeFeesRaw || '0'), decimals) }, null, 2));
    if (stop) throw new Error(stop);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error.message).slice(0, 600), note: 'A journaled pending transaction is an unknown outcome.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
