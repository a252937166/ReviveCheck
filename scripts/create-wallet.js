import { mnemonicGenerate, cryptoWaitReady } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateDirectory = path.join(root, '.private');
const walletPath = path.join(privateDirectory, 'wallet.json');
const notePath = process.env.REVIVECHECK_OBSIDIAN_WALLET_NOTE || path.join(homedir(), 'Documents/Obsidian Vault/Hackathons/DoraHacks/portaldot-hacker-house-2026/ReviveCheck 测试网钱包（私密）.md');
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
const note = `---\ntitle: ReviveCheck 测试网钱包（私密）\nprivate: true\nnetwork: portaldot-v3-testnet\ncreated: ${wallet.createdAt}\n---\n\n# ReviveCheck 测试网钱包（私密）\n\n按用户 2026-10-23 的明确要求，完整钱包信息在本笔记明文保存。仅用于本次 Portaldot V3 测试网开发与测试代币；不用于主网或真实资产。请勿复制到公开仓库、提交材料或工单。\n\n## 完整钱包信息\n\n- 钱包名称：${wallet.name}\n- 类型：${wallet.type}\n- SS58 format：${wallet.ss58Format}\n- 原生公开地址：\`${wallet.ss58Address}\`\n- 公钥：\`${wallet.publicKey}\`\n- 创建时间：${wallet.createdAt}\n- 助记词（明文，拥有账户控制权）：\n\n\`\`\`text\n${wallet.mnemonic}\n\`\`\`\n\n该原生钱包不具有单独的 Ethereum secp256k1 私钥；由上述助记词派生 sr25519 密钥。EVM映射地址须通过本链runtime核验，不从同私钥Ethereum地址推断。\n\n## 本地使用\n\n- 本地钱包文件：\`${walletPath}\`（权限600，已被Git忽略）\n- 私密目录权限：700\n- 代码仓库仅保留公开地址和公钥；UI不会读取助记词。\n\n## 当前状态\n\n- 钱包：已创建并本地保存。\n- 领币：尚未提交/待工单实证更新。\n- 测试币到账：尚未验证。\n- 原生/EVM映射：待实时核验。\n- 部署：尚未完成。\n\n工单仅提供公开原生地址及比赛要求的报名截图，绝不提供助记词或本笔记。\n`;
try { await writeFile(notePath, note, { mode: 0o600, flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await chmod(notePath, 0o600);
await mkdir(path.join(root, 'docs'), { recursive: true });
const { mnemonic, ...publicWallet } = wallet;
await writeFile(path.join(root, 'docs/WALLET_PUBLIC.json'), JSON.stringify(publicWallet, null, 2));
process.stdout.write(JSON.stringify({ address: wallet.ss58Address, publicKey: wallet.publicKey, walletFile: walletPath, obsidianNote: notePath }, null, 2) + '\n');
