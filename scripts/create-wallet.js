import { mnemonicGenerate, cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Create an isolated Portaldot V3 testnet wallet, or reuse the one already saved.
// The default is the project's development wallet. `--role reviewer` creates the
// separate reviewer account (2026-10-25) so the recorded lifecycle has distinct
// owner and reviewer signers; both are project-controlled, and every public record
// says so. Only the public address and public key are written into the repository.
//
//   node scripts/create-wallet.js                      # .private/wallet.json, docs/WALLET_PUBLIC.json
//   node scripts/create-wallet.js --role reviewer      # .private/reviewer-wallet.json, docs/REVIEWER_WALLET_PUBLIC.json
//   node scripts/create-wallet.js --role reviewer --private-dir /path/to/.private
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const role = option('--role', 'development');
if (!/^[a-z][a-z-]{0,30}$/.test(role)) throw new Error('--role is a short lower-case word, for example reviewer.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateDirectory = path.resolve(option('--private-dir', path.join(root, '.private')));
const walletPath = path.join(privateDirectory, role === 'development' ? 'wallet.json' : `${role}-wallet.json`);
const publicPath = path.join(root, 'docs', role === 'development' ? 'WALLET_PUBLIC.json' : `${role.toUpperCase().replace(/-/g, '_')}_WALLET_PUBLIC.json`);
const title = role === 'development' ? 'ReviveCheck testnet wallet (private)' : `ReviveCheck testnet ${role} wallet (private)`;
// The note written on 2026-10-23 carried an earlier, non-English name; point REVIVECHECK_OBSIDIAN_WALLET_NOTE at it to reuse it.
const noteTitle = role === 'development' ? 'ReviveCheck Testnet Wallet (Private)' : `ReviveCheck Testnet ${role.charAt(0).toUpperCase()}${role.slice(1)} Wallet (Private)`;
const notePath = process.env.REVIVECHECK_OBSIDIAN_WALLET_NOTE || path.join(homedir(), `Documents/Obsidian Vault/Hackathons/DoraHacks/portaldot-hacker-house-2026/${noteTitle}.md`);
await cryptoWaitReady();
await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
let wallet;
try { wallet = JSON.parse(await readFile(walletPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const mnemonic = mnemonicGenerate(24);
  const pair = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromUri(mnemonic);
  wallet = { name: role === 'development' ? 'ReviveCheck isolated V3 testnet development' : `ReviveCheck isolated V3 testnet ${role}`, role, network: 'portaldot-v3-testnet', type: 'sr25519', ss58Format: 42, ss58Address: pair.address, publicKey: `0x${Buffer.from(pair.publicKey).toString('hex')}`, mnemonic, createdAt: new Date().toISOString() };
  await writeFile(walletPath, JSON.stringify(wallet, null, 2), { mode: 0o600, flag: 'wx' });
}
await chmod(walletPath, 0o600);
await mkdir(path.dirname(notePath), { recursive: true });
const note = `---\ntitle: ${title}\nprivate: true\nnetwork: portaldot-v3-testnet\nrole: ${role}\ncreated: ${wallet.createdAt}\n---\n\n# ${title}\n\nAt the user's explicit request on 2026-10-23, complete wallets are kept in these notes in plain text. This one is for Portaldot V3 testnet development and test tokens only, never for mainnet or real assets. Do not copy it into a public repository, submission material or a support ticket.\n\n## Complete wallet\n\n- Wallet name: ${wallet.name}\n- Role: ${role}${role === 'reviewer' ? ' (signs registry decisions only; the development wallet owns releases and lists tokens; both are controlled by the project)' : ''}\n- Type: ${wallet.type}\n- SS58 format: ${wallet.ss58Format}\n- Native public address: \`${wallet.ss58Address}\`\n- Public key: \`${wallet.publicKey}\`\n- Created: ${wallet.createdAt}\n- Mnemonic (plain text; controls the account):\n\n\`\`\`text\n${wallet.mnemonic}\n\`\`\`\n\nThis native wallet has no separate Ethereum secp256k1 private key; the sr25519 key is derived from the mnemonic above. The mapped EVM address must be read from this chain's runtime, never inferred from a same-key Ethereum address.\n\n## Local use\n\n- Local wallet file: \`${walletPath}\` (mode 600, ignored by Git)\n- Private directory mode: 700\n- The repository keeps only the public address and public key; the UI never reads the mnemonic.\n\n## Status\n\n- Wallet: created and saved locally.\n- Testnet tokens: ${role === 'development' ? 'request through the Hacker House channel; update when received.' : 'funded by a transfer from the development wallet; see public/lifecycle/funding.json.'}\n- Native/EVM mapping: read live with accountOverview before the first signed call.\n\nA support ticket receives only the public native address, never the mnemonic or this note.\n`;
try { await writeFile(notePath, note, { mode: 0o600, flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await chmod(notePath, 0o600);
await mkdir(path.join(root, 'docs'), { recursive: true });
const { mnemonic, ...publicWallet } = wallet;
await writeFile(publicPath, `${JSON.stringify(publicWallet, null, 2)}\n`);
process.stdout.write(JSON.stringify({ role, address: wallet.ss58Address, publicKey: wallet.publicKey, walletFile: walletPath, publicRecord: path.relative(root, publicPath), obsidianNote: notePath }, null, 2) + '\n');
