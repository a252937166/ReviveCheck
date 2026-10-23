import QRCode from 'qrcode';

export const OFFICIAL_EXPLORER_ORIGIN = 'https://scanner-testnet-v3.portaldot.dev';
export const EXPLORER_NETWORK = Object.freeze({
  name: 'Portaldot V3 Testnet', chainId: '420420777',
  genesisHash: '0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd',
});

// Public deployed application, not HTTP-200 SPA fallbacks. The active chain is
// portaldot_v3_test; its root is a HashRouter and its native route tree enables
// /blocks/:id and /extrinsics/:id. The /tx/:id route is gated by modules.tx,
// which is absent in this testnet configuration. No H160 contract route exists.
// The JSON API resolved both the height-index and native hash of the same real
// extrinsic, and resolved block 157426 to the report's exact native block hash.
export const EXPLORER_ROUTE_VERIFICATION = Object.freeze({
  checkedOn: '2026-10-23',
  bundleUrl: `${OFFICIAL_EXPLORER_ORIGIN}/static/js/main.ccefe6b0.js`,
  bundleSha256: '8a280c5fc683276a4f7bd79acdceb6011a7f9f97b274404c6568858cfe07fa8e',
  router: 'hash', nativeBlock: true, nativeExtrinsic: true,
  h160Contract: false, evmTransaction: false,
  blockApiEvidence: 'https://scanner-testnet-v3-api.portaldot.dev/blocks/157426',
  extrinsicApiEvidence: 'https://scanner-testnet-v3-api.portaldot.dev/extrinsics/0x663b2523790bbafc59f733bc01953f08b441ca6acf2db528bf46ad52e7cdf380',
});

const H160 = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const lower = (value) => typeof value === 'string' ? value.toLowerCase() : '';
const present = (value) => value !== undefined && value !== null && value !== '';
function integer(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  if (!/^(?:0x[0-9a-fA-F]+|\d+)$/.test(String(value))) return null;
  try { return BigInt(value); } catch { return null; }
}
const sameId = (value) => integer(value) === BigInt(EXPLORER_NETWORK.chainId);
const passed = (run, id) => run.checks?.find((check) => check.id === id && check.status === 'passed');
const sameHash = (a, b) => HASH.test(a || '') && HASH.test(b || '') && lower(a) === lower(b);
const sameAddress = (a, b) => H160.test(a || '') && H160.test(b || '') && lower(a) === lower(b);
function assetPrecompile(assetId) {
  const id = integer(assetId);
  return /^\d+$/.test(String(assetId)) && id !== null && id >= 0n && id <= 0xffffffffn ? `0x${id.toString(16).padStart(8, '0')}${'0'.repeat(24)}00010000` : null;
}
function sameUnits(a, b) { const x = integer(a), y = integer(b); return x !== null && x >= 0n && x === y; }
function identityReason(run) {
  if (run?.mode !== 'live' || run?.scope !== 'portaldot-testnet-readonly') return 'Official testnet targets require a live Portaldot read-only report; rehearsal data has no explorer target.';
  if (!Array.isArray(run.checks) || new Set(run.checks.map((check) => check.id)).size !== run.checks.length) return 'Network checks are missing or ambiguous.';
  const network = run.network || {}, identity = passed(run, 'network.chain-id')?.evidence;
  if (!identity || !sameId(network.observedChainId) || !sameId(identity.evmChainIdHex) || !sameId(identity.nativeRuntimeChainId)) return 'The observed native and EVM identities have not both verified testnet chain ID 420420777.';
  const ids = [network.chainId, run.input?.expectedChainId, network.parameterSnapshot?.chainId, run.binding?.environment?.chainId].filter(present);
  if (!ids.every(sameId)) return 'The report contains conflicting chain IDs; official testnet links are withheld.';
  const hashes = [network.nativeGenesisHash, identity.nativeGenesisHash];
  if (!hashes.every((hash) => lower(hash) === EXPLORER_NETWORK.genesisHash)) return 'The observed native genesis does not match the pinned Portaldot V3 testnet.';
  if (![network.genesisHash, run.binding?.environment?.genesisHash].filter(present).every((hash) => lower(hash) === EXPLORER_NETWORK.genesisHash)) return 'The report contains conflicting genesis hashes; official testnet links are withheld.';
  return '';
}

/** Routing/format checks over a saved observation, not proof of RPC truth or ownership. */
export function reportExplorerEvidence(run) {
  const result = { eligible: false, reason: '', chainLabel: EXPLORER_NETWORK.name, items: [], pending: [] };
  result.reason = identityReason(run);
  if (result.reason) return result;
  result.eligible = true;
  result.reason = 'Pinned testnet identity verified in this live report. Links and QR codes locate saved observations; they do not establish ownership or current state.';
  const add = (kind, label, identifier, url, scope) => result.items.push({ kind, label, identifier, url, chainLabel: result.chainLabel, scope, qrValue: url || identifier, qrKind: url ? 'explorer' : 'identifier', routeStatus: url ? 'verified' : 'unsupported' });
  const pending = (kind, label, reason) => result.pending.push({ kind, label, reason });
  add('home', 'Official testnet explorer', EXPLORER_NETWORK.chainId, `${OFFICIAL_EXPLORER_ORIGIN}/#/`, 'Official Portaldot V3 testnet explorer home.');

  const network = run.network || {}, finalized = passed(run, 'network.finalized')?.evidence;
  const number = integer(network.finalizedBlockNumber), nativeHash = network.finalizedNativeBlockHash;
  const checkpointMatches = finalized && number !== null && number >= 0n
    && integer(finalized.nativeBlockNumber) === number
    && sameHash(nativeHash, finalized.nativeBlockHash)
    && sameHash(network.finalizedEvmBlockHash, finalized.evmBlockHash)
    && sameHash(finalized.evmBlockHash, finalized.runtimeEvmBlockHash);
  if (checkpointMatches) add('finalized-block', `Finalized native block ${number}`, lower(nativeHash), `${OFFICIAL_EXPLORER_ORIGIN}/#/blocks/${lower(nativeHash)}`, 'Native block hash from the cross-interface finalized checkpoint. Explorer indexing may lag.');
  else pending('finalized-block', 'Finalized block', 'A complete matching finalized native/EVM checkpoint was not observed.');

  const input = run.input || {}, contract = passed(run, 'contract.code')?.evidence;
  if (checkpointMatches && contract && sameAddress(input.contractAddress, contract.address) && HASH.test(contract.codeHash || '') && integer(contract.blockTag) === number) {
    add('contract', 'Observed contract — address only', lower(contract.address), null, 'Nonempty code observed at the saved checkpoint. This is the reported target; code observation does not prove project ownership. Plain H160 QR, not a payment request.');
    pending('contract', 'Contract explorer detail', 'The official explorer has no verified H160 contract detail route. Address only: the QR encodes the observed H160 as plain text.');
  } else if (input.contractAddress || input.profile !== 'native-asset') pending('contract', 'Contract target', 'No complete H160 with matching successful deployed-code evidence at this checkpoint; no address QR is generated.');

  const asset = passed(run, 'asset.native-erc20')?.evidence;
  if (checkpointMatches && asset && asset.nativeExists === true && H160.test(asset.precompileAddress || '')
    && String(input.nativeAsset?.assetId) === String(asset.assetId)
    && sameAddress(asset.precompileAddress, assetPrecompile(asset.assetId))
    && sameHash(asset.nativeBlockHash, nativeHash)
    && sameHash(asset.evmCheckpoint?.blockHash, network.finalizedEvmBlockHash)
    && asset.evmCheckpoint?.requireCanonical === true
    && sameUnits(asset.nativeSupply, asset.erc20Supply)
    && sameUnits(asset.nativeBalance, asset.erc20Balance)
    && sameUnits(asset.nativeDecimals, asset.erc20Decimals)) {
    add('native-asset-precompile', `Asset ${asset.assetId} — external public precompile — address only`, lower(asset.precompileAddress), null, 'External public system precompile observed by native/ERC-20 parity. It is not a project deployment or evidence of independent adoption. Plain H160 QR, not a payment request.');
    pending('native-asset-precompile', 'Precompile explorer detail', 'The official explorer has no verified H160 precompile detail route. Address only: the QR encodes the observed precompile H160 as plain text.');
  } else if (input.nativeAsset) pending('native-asset-precompile', 'Native asset precompile', 'A matching existing native asset and successful parity observation at this checkpoint are required; no precompile QR is generated.');

  const transaction = passed(run, 'transaction.finality')?.evidence;
  const transactionNumber = integer(transaction?.blockNumber);
  const transactionMatches = checkpointMatches && transaction && HASH.test(input.transactionHash || '')
    && sameHash(input.transactionHash, transaction.hash) && HASH.test(transaction.blockHash || '')
    && transaction.senderMatches === true && present(transaction.sender)
    && H160.test(input.contractAddress || '') && transactionNumber !== null && transactionNumber >= 0n && transactionNumber <= number;
  if (transactionMatches && transaction.kind === 'native-extrinsic' && sameHash(input.transactionBlockHash, transaction.blockHash)
    && Number.isSafeInteger(transaction.extrinsicIndex) && transaction.extrinsicIndex >= 0
    && transaction.events?.includes('system.ExtrinsicSuccess') && !transaction.events.includes('system.ExtrinsicFailed')) {
    add('native-extrinsic', 'Finalized native extrinsic', lower(transaction.hash), `${OFFICIAL_EXPLORER_ORIGIN}/#/extrinsics/${lower(transaction.hash)}`, 'Native extrinsic hash, not an EVM transaction hash. Saved successful finality observation; explorer indexing may lag.');
  } else if (transactionMatches && transaction.kind === 'evm-transaction' && !input.transactionBlockHash && integer(transaction.status) === 1n) {
    add('evm-transaction', 'Finalized EVM transaction — hash only', lower(transaction.hash), null, 'EVM receipt observed as successful and finalized. Plain transaction hash QR; this hash is not routed as a native extrinsic.');
    pending('evm-transaction', 'EVM transaction explorer detail', 'The official explorer testnet configuration does not enable its EVM transaction route. Hash only: the QR encodes the observed EVM transaction hash as plain text.');
  } else pending('transaction', 'Transaction target', input.profile === 'native-asset' && !input.transactionHash ? 'This external public asset report is read-only and contains no project deployment or write transaction.' : 'No complete successful finalized transaction evidence matching this report input; no transaction QR is generated.');
  return result;
}

export function isApprovedExplorerUrl(value) {
  if (typeof value !== 'string') return false;
  // Exact origin and hash-router grammar: no credentials, alternate host,
  // query string, encoded path segments, supplied RPC URL, or arbitrary route.
  return value === `${OFFICIAL_EXPLORER_ORIGIN}/#/`
    || new RegExp(`^${OFFICIAL_EXPLORER_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/#/(?:blocks|extrinsics)/0x[0-9a-f]{64}$`).test(value);
}

/** Only a vetted official route or raw H160/hash is encodable. Callers derive
 * the value from reportExplorerEvidence; this format guard alone is no evidence. */
export function explorerQrSvgDataUrl(value) {
  if (!(isApprovedExplorerUrl(value) || H160.test(value || '') || HASH.test(value || ''))) throw new Error('QR target is not an approved explorer route or complete plain identifier.');
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const margin = 4, size = qr.modules.size, dimension = size + margin * 2;
  const cells = [];
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) if (qr.modules.get(row, column)) cells.push(`M${column + margin} ${row + margin}h1v1h-1z`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" width="256" height="256" shape-rendering="crispEdges"><rect width="${dimension}" height="${dimension}" fill="#fff"/><path d="${cells.join('')}" fill="#18357f"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
