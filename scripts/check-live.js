import { readFile } from 'node:fs/promises';
import { inspectChain } from '../lib/chain.js';

const args = process.argv.slice(2);
const option = (name, fallback = '') => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
let account = option('--account');
if (!account && args.includes('--wallet')) {
  // Only the public address enters the inspection and report.
  const wallet = JSON.parse(await readFile(option('--wallet'), 'utf8'));
  account = wallet.ss58Address;
}
const input = {
  account,
  contractAddress: option('--contract'),
  expectedValue: option('--expected-value', '42'),
  expectedChainId: 420420777,
  transactionHash: option('--transaction'),
  transactionBlockHash: option('--block'),
};
const report = await inspectChain(input);
console.log(JSON.stringify({ scope: 'portaldot-testnet-readonly', checkedAt: new Date().toISOString(), input, ...report }, null, 2));
if (report.checks.some((check) => check.status !== 'passed')) process.exitCode = 2;
