import { mnemonicGenerate, cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateDirectory = path.join(root, '.private');
const walletPath = path.join(privateDirectory, 'wallet.json');
// The note written on 2026-10-23 carried an earlier, non-English name; point REVIVECHECK_OBSIDIAN_WALLET_NOTE at it to reuse it.
const notePath = process.env.REVIVECHECK_OBSIDIAN_WALLET_NOTE || path.join(homedir(), 'Documents/Obsidian Vault/Hackathons/DoraHacks/portaldot-hacker-house-2026/ReviveCheck testnet wallet (private).md');
await cryptoWaitReady();
await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
let wallet;
try { wallet = JSON.parse(await readFile(walletPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const mnemonic = mnemonicGenerate(24);
  const pair = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromUri(mnemonic);
  wallet = { name: 'ReviveCheck isolated V3 testnet development', network: 'portaldot-v3-testnet', type: 'sr25519', ss58Format: 42, ss58Address: pair.address, publicKey: `0x${Buffer.from(pair.publicKey).toString('hex')}`, mnemonic, createdAt: new Date().toISOString() };
  await writeFile(walletPath, JSON.stringify(wallet, null, 2), { mode: 0o600, flag: 'wx' });
}
await chmod(walletPath, 0o600);
await mkdir(path.dirname(notePath), { recursive: true });
const note = `---\ntitle: ReviveCheck testnet wallet (private)\nprivate: true\nnetwork: portaldot-v3-testnet\ncreated: ${wallet.createdAt}\n---\n\n# ReviveCheck testnet wallet (private)\n\nAt the user's explicit request on 2026-10-23, the complete wallet is kept in this note in plain text. It is for Portaldot V3 testnet development and test tokens only, never for mainnet or real assets. Do not copy it into a public repository, submission material or a support ticket.\n\n## Complete wallet\n\n- Wallet name: ${wallet.name}\n- Type: ${wallet.type}\n- SS58 format: ${wallet.ss58Format}\n- Native public address: \`${wallet.ss58Address}\`\n- Public key: \`${wallet.publicKey}\`\n- Created: ${wallet.createdAt}\n- Mnemonic (plain text; controls the account):\n\n\`\`\`text\n${wallet.mnemonic}\n\`\`\`\n\nThis native wallet has no separate Ethereum secp256k1 private key; the sr25519 key is derived from the mnemonic above. The mapped EVM address must be read from this chain's runtime, never inferred from a same-key Ethereum address.\n\n## Local use\n\n- Local wallet file: \`${walletPath}\` (mode 600, ignored by Git)\n- Private directory mode: 700\n- The repository keeps only the public address and public key; the UI never reads the mnemonic.\n\n## Status\n\n- Wallet: created and saved locally.\n- Token request: not submitted; update when the ticket is filed.\n- Testnet tokens received: not verified.\n- Native/EVM mapping: to be verified live.\n- Deployment: not done.\n\nA support ticket receives only the public native address and the registration screenshot the contest asks for, never the mnemonic or this note.\n`;
try { await writeFile(notePath, note, { mode: 0o600, flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await chmod(notePath, 0o600);
await mkdir(path.join(root, 'docs'), { recursive: true });
const { mnemonic, ...publicWallet } = wallet;
await writeFile(path.join(root, 'docs/WALLET_PUBLIC.json'), JSON.stringify(publicWallet, null, 2));
process.stdout.write(JSON.stringify({ address: wallet.ss58Address, publicKey: wallet.publicKey, walletFile: walletPath, obsidianNote: notePath }, null, 2) + '\n');
