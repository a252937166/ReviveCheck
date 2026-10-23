import { mkdir, writeFile } from 'node:fs/promises';
import { connectNative, assertTestnet, evmRpc, NETWORK, formatNative } from '../lib/chain.js';
import { compileProbe } from './compile-probe.js';

// The origin is the public example in the official guide, used only in simulation.
// This script never loads a wallet, signs, or submits an extrinsic.
const exampleH160 = '0xf7eC65d11e35375A250e474059a917B537804142';
let api;
try {
  api = await connectNative({ signal: AbortSignal.timeout(25_000) });
  assertTestnet(api, await evmRpc('eth_chainId'));
  const artifact = await compileProbe();
  const origin = await api.call.reviveApi.accountId(exampleH160);
  const checkpoint = await api.rpc.chain.getFinalizedHead();
  const at = await api.at(checkpoint);
  const constructorData = `0x${42n.toString(16).padStart(64, '0')}`;
  const negative = await at.call.reviveApi.instantiate(origin, 0, null, null, { Upload: artifact.bytecode }, constructorData, null);
  const fixed = await at.call.reviveApi.instantiate(origin, 0, null, null, { Upload: artifact.bytecode + constructorData.slice(2) }, '0x', null);
  const error = negative.result.isErr && negative.result.asErr.isModule ? api.registry.findMetaError(negative.result.asErr.asModule) : null;
  const charge = fixed.maxStorageDeposit.isCharge ? fixed.maxStorageDeposit.asCharge.toString() : '0';
  const evidence = {
    capturedAt: new Date().toISOString(), network: NETWORK,
    scope: 'read-only-runtime-simulation', checkpoint: checkpoint.toHex(),
    origin: { evmAddress: exampleH160, nativeAccount: origin.toString(), provenance: 'Public example from the official guide; not a ReviveCheck-owned wallet.' },
    source: 'contracts/ReviveProbe.sol', sourceSha256: artifact.sourceSha256, compiler: artifact.compiler, target: artifact.target,
    negative: { codeBytes: (artifact.bytecode.length - 2) / 2, constructorArgsPlacement: 'native data field', rawResult: negative.toJSON(), decodedError: error ? { section: error.section, name: error.name, docs: error.docs } : null },
    corrected: { codeBytes: (artifact.bytecode.length - 2) / 2 + 32, constructorArgsPlacement: 'appended to EVM initcode; native data = 0x', rawResult: fixed.toJSON(), maxStorageDepositRaw: charge, maxStorageDepositTpot: formatNative(charge, api.registry.chainDecimals[0]) },
    assertions: { negativeRejected: negative.result.isErr, expectedError: error?.name === 'EvmConstructorNonEmptyData', correctedSucceeded: fixed.result.isOk },
    limitations: ['No wallet was loaded and no transaction was signed, broadcast, or persisted.', 'The simulated address is not proof of deployment. The public example origin is not controlled by this project.'],
  };
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/constructor-dryrun.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence.assertions, scope: evidence.scope, checkpoint: evidence.checkpoint, maxStorageDepositTpot: evidence.corrected.maxStorageDepositTpot, artifact: 'artifacts/constructor-dryrun.json' }, null, 2));
  if (!evidence.assertions.expectedError || !evidence.assertions.correctedSucceeded) process.exitCode = 2;
} finally { if (api) await api.disconnect(); }
