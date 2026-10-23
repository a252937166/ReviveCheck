import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';
import { connectNative, evmRpc, assertTestnet, NETWORK, formatNative, parseTokenAmount, availableNativeBalance } from '../lib/chain.js';
import { compileProbe } from './compile-probe.js';

const args = process.argv.slice(2);
const option = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const broadcast = args.includes('--broadcast');
const initialValue = option('--initial-value', '42');
const budgetText = option('--max-cost-tpot');
if (!/^\d+$/.test(initialValue) || BigInt(initialValue) >= 2n ** 256n) throw new Error('--initial-value must be a uint256');
if (broadcast && !budgetText) throw new Error('Broadcast requires an explicit --max-cost-tpot budget for test-token fees plus storage deposits');

function dispatchError(api, error) {
  if (error?.isModule) {
    const meta = api.registry.findMetaError(error.asModule);
    return `${meta.section}.${meta.name}: ${meta.docs.join(' ')}`;
  }
  return error?.toString?.() || 'Unknown dispatch error';
}

function successfulDryRun(api, result) {
  if (!result.result.isOk) throw new Error(`Deployment dry-run failed: ${dispatchError(api, result.result.asErr)}`);
  const output = result.result.asOk;
  const flags = output.result.flags.toJSON();
  if ((BigInt(flags.bits ?? flags) & 1n) !== 0n) throw new Error('Deployment constructor reverted in the dry-run');
  return output;
}

async function sendFinalized(api, tx, signer) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let completed = false;
    let publicHash;
    let announced = false;
    const finish = (error, result) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      unsubscribe?.();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error(`Finalization timeout: outcome is unknown. Inspect extrinsic ${publicHash || tx.hash.toHex()} before retrying.`)), 120_000);
    tx.signAndSend(signer, (result) => {
      publicHash = result.txHash?.toHex?.() || tx.hash.toHex();
      if (!announced) {
        announced = true;
        console.log(JSON.stringify({ step: 'signed-testnet-transaction-submitted', transactionHash: publicHash }));
      }
      if (result.dispatchError) return finish(new Error(`Extrinsic ${publicHash} failed: ${dispatchError(api, result.dispatchError)}`));
      if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped) return finish(new Error(`Extrinsic status ${result.status.type}; inspect chain state before retrying`));
      if (result.status.isFinalized) finish(null, {
        transactionHash: publicHash,
        transactionBlockHash: result.status.asFinalized.toHex(),
        events: result.events.map(({ event }) => ({ section: event.section, method: event.method, data: event.data.toJSON() })),
      });
    }).then((unsub) => { unsubscribe = unsub; if (completed) unsub(); }).catch((error) => finish(error));
  });
}

let api;
try {
  const wallet = JSON.parse(await readFile(option('--wallet', '.private/wallet.json'), 'utf8'));
  if (wallet.network !== 'portaldot-v3-testnet' || !wallet.mnemonic || !wallet.ss58Address) throw new Error('Expected a dedicated native Portaldot V3 testnet wallet file');
  await cryptoWaitReady();
  let signer;
  try { signer = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromUri(wallet.mnemonic); }
  catch { throw new Error('Could not load the native sr25519 testnet wallet'); }
  if (!Buffer.from(decodeAddress(signer.address)).equals(Buffer.from(decodeAddress(wallet.ss58Address)))) throw new Error('Wallet public address does not match its native sr25519 mnemonic');
  api = await connectNative({ signal: AbortSignal.timeout(30_000) });
  assertTestnet(api, await evmRpc('eth_chainId', [], { signal: AbortSignal.timeout(15_000) }));
  if (!api.consts.revive.allowEVMBytecode.isTrue) throw new Error('This runtime does not permit ordinary EVM bytecode');
  const decimals = api.registry.chainDecimals[0];
  const budget = budgetText ? parseTokenAmount(budgetText, decimals) : null;
  const balance = await api.query.system.account(signer.address);
  const available = availableNativeBalance(balance, api.consts.balances.existentialDeposit);
  if (available <= 0n) {
    console.log(JSON.stringify({ status: 'blocked', mode: broadcast ? 'broadcast-requested' : 'dry-run', nativeAccount: signer.address, network: NETWORK, reason: 'No available test tokens. Request tPOT for this native address through the official Discord support flow. No transaction was signed.' }, null, 2));
    process.exitCode = 2;
  } else {
    const artifact = await compileProbe();
    // EVM constructor arguments are part of the code blob. Native data must be empty.
    const initCode = artifact.bytecode + BigInt(initialValue).toString(16).padStart(64, '0');
    const h160 = (await api.call.reviveApi.address(signer.address)).toHex();
    const roundTrip = await api.call.reviveApi.accountId(h160);
    const needsMapping = !Buffer.from(decodeAddress(roundTrip.toString())).equals(Buffer.from(decodeAddress(signer.address)));
    // The pinned runtime enables AutoMap: creation/funding of a new native account
    // establishes its mapping. Its map_account extrinsic is explicitly a no-op.
    if (needsMapping) throw new Error('The funded native account does not round-trip through ReviveApi. Stop and resolve mapping with the organizer; map_account is a no-op while AutoMap is enabled.');
    const dryRun = await api.call.reviveApi.instantiate(signer.address, '0', null, null, { Upload: initCode }, '0x', null);
    const result = successfulDryRun(api, dryRun);
    const charge = dryRun.maxStorageDeposit.isCharge ? BigInt(dryRun.maxStorageDeposit.asCharge.toString()) : 0n;
    const weight = dryRun.weightRequired.toJSON();
    const deployTx = api.tx.revive.instantiateWithCode('0', weight, charge.toString(), initCode, '0x', null);
    const deployFee = BigInt((await deployTx.paymentInfo(signer)).partialFee.toString());
    const estimatedTotal = charge + deployFee;
    const summary = {
      mode: broadcast ? 'broadcast-requested' : 'dry-run',
      network: NETWORK,
      nativeAccount: signer.address,
      evmAccount: h160,
      accountMappingNeeded: needsMapping,
      compiler: artifact.compiler,
      predictedContractAddress: result.addr.toHex(),
      initialValue,
      weightRequired: weight,
      maxStorageDepositRaw: charge.toString(),
      deploymentFeeEstimateRaw: deployFee.toString(),
      estimatedTotalRaw: estimatedTotal.toString(),
      estimatedTotalTpot: formatNative(estimatedTotal, decimals),
      explicitBudgetTpot: budgetText || null,
      limitations: ['Dry-run simulation does not deploy a contract.', 'Fee estimates can change before inclusion. Storage deposits lock test tokens and are distinct from consumed fees.'],
    };
    if (!broadcast) {
      console.log(JSON.stringify({ status: 'dry-run-complete', ...summary, next: 'After reviewing this estimate, pass --broadcast and an explicit --max-cost-tpot budget to sign and submit on this pinned testnet.' }, null, 2));
    } else {
      if (estimatedTotal > budget) throw new Error(`Estimated fees plus storage deposit exceed --max-cost-tpot (${formatNative(estimatedTotal, decimals)} tPOT estimated)`);
      const fresh = await api.query.system.account(signer.address);
      const freshAvailable = availableNativeBalance(fresh, api.consts.balances.existentialDeposit);
      if (charge + deployFee >= freshAvailable) throw new Error('Insufficient available test tokens for deposit and deployment fee while preserving the account');
      const receipt = await sendFinalized(api, deployTx, signer);
      const deployed = receipt.events.find((event) => event.section === 'revive' && event.method === 'Instantiated');
      if (!deployed) throw new Error(`Finalized transaction ${receipt.transactionHash} has no Instantiated event; inspect it before retrying`);
      const evidence = { status: 'finalized', ...summary, contractAddress: deployed.data[1], ...receipt, completedAt: new Date().toISOString(), scope: 'portaldot-v3-testnet-deployment' };
      await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
      await writeFile(new URL(`../artifacts/deployment-${receipt.transactionHash.slice(2)}.json`, import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
      await writeFile(new URL('../artifacts/deployment.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(JSON.stringify(evidence, null, 2));
    }
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', message: String(error?.message || error).slice(0, 500), note: 'Do not automatically retry an uncertain submitted transaction; inspect its public receipt first.' }, null, 2));
  process.exitCode = 1;
} finally { if (api) await api.disconnect(); }
