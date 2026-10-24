import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import solc from 'solc';

// VerifiedTokenList and the ReviveCheckGuard library it inlines, with the same pinned
// settings as the registry so revive receives Paris-era EVM bytecode.
const SOURCES = ['ReviveCheckGuard.sol', 'VerifiedTokenList.sol'];
// Optimized for size: code is paid for in storage deposit on revive.
const RUNS = 1;
export async function compileTokenList({ extraSources = {} } = {}) {
  if (!solc.version().startsWith('0.8.24+')) throw new Error('Use pinned solc 0.8.24');
  const sources = {};
  for (const file of SOURCES) sources[file] = { content: await readFile(new URL(`../contracts/${file}`, import.meta.url), 'utf8') };
  Object.assign(sources, Object.fromEntries(Object.entries(extraSources).map(([file, content]) => [file, { content }])));
  const input = { language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: RUNS }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((error) => error.severity === 'error');
  if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
  const pick = (file, name) => { const contract = output.contracts[file][name]; return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`, deployedBytecode: `0x${contract.evm.deployedBytecode.object}` }; };
  const sourceSha256 = createHash('sha256').update(SOURCES.map((file) => sources[file].content).join('\n')).digest('hex');
  return { contractName: 'VerifiedTokenList', compiler: solc.version(), target: 'evm-paris', optimizerRuns: RUNS, sources: SOURCES, sourceSha256, ...pick('VerifiedTokenList.sol', 'VerifiedTokenList'), extra: Object.fromEntries(Object.keys(extraSources).map((file) => [file, output.contracts[file]])) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { extra, ...artifact } = await compileTokenList();
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/VerifiedTokenList.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ contract: artifact.contractName, compiler: artifact.compiler, initcodeBytes: (artifact.bytecode.length - 2) / 2, runtimeBytes: (artifact.deployedBytecode.length - 2) / 2, sourceSha256: artifact.sourceSha256 }, null, 2));
}
