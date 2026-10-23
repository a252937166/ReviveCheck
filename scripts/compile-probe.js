import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import solc from 'solc';

export async function compileProbe() {
  const source = await readFile(new URL('../contracts/ReviveProbe.sol', import.meta.url), 'utf8');
  if (!solc.version().startsWith('0.8.24+')) throw new Error('Use pinned solc 0.8.24 for this probe');
  const input = { language: 'Solidity', sources: { 'ReviveProbe.sol': { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((error) => error.severity === 'error');
  if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
  const contract = output.contracts['ReviveProbe.sol'].ReviveProbe;
  return { contractName: 'ReviveProbe', compiler: solc.version(), target: 'evm-paris', optimizerRuns: 200, sourceSha256: createHash('sha256').update(source).digest('hex'), abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`, deployedBytecodeTemplate: `0x${contract.evm.deployedBytecode.object}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifact = await compileProbe();
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/ReviveProbe.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ contract: artifact.contractName, compiler: artifact.compiler, target: artifact.target, bytecodeBytes: (artifact.bytecode.length - 2) / 2, artifact: 'artifacts/ReviveProbe.json', note: 'Local compilation is not testnet deployment.' }, null, 2));
}
