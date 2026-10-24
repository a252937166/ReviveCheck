// The lifecycle walkthrough's subject: a token-list release we authored for this
// demonstration. The entries are ours; every check reads the real chain.
export const DEMO_ASSET_ID = '7777';
export const DEMO_PRECOMPILE = '0x00001E6100000000000000000000000000010000';

export const DEMO_PROJECT = Object.freeze({
  name: 'pUSD token list',
  profile: 'native-asset',
  logicalContractId: 'token-list:portaldot-v3:pusd',
  expectedChainId: 420420777,
  nativeAsset: { assetId: DEMO_ASSET_ID, holder: '' },
});

const entry = (decimals) => ({ chainId: 420420777, address: DEMO_PRECOMPILE, symbol: 'pUSD', name: 'Portaldot USD (test)', decimals });

// v1.0.0 carries the Ethereum default of 18 decimals; v1.0.1 corrects it.
export const DEMO_RELEASES = Object.freeze({
  'v1.0.0': Object.freeze({ release: 'v1.0.0', sourceRevision: 'pusd-token-list@1.0.0', listing: entry(18), note: 'Copied the Ethereum default of 18 decimals.' }),
  'v1.0.1': Object.freeze({ release: 'v1.0.1', sourceRevision: 'pusd-token-list@1.0.1', listing: entry(6), note: 'Uses the precision the chain reports.' }),
});

export function demoPlan(version) {
  const release = DEMO_RELEASES[version];
  if (!release) throw new Error(`Unknown demo release ${version}`);
  return { ...DEMO_PROJECT, nativeAsset: { ...DEMO_PROJECT.nativeAsset }, release: release.release, sourceRevision: release.sourceRevision, listing: { ...release.listing } };
}

/** The release artifact as a standard token list document (Uniswap token-list schema). */
export function tokenListDocument(version) {
  const release = DEMO_RELEASES[version];
  const [major, minor, patch] = release.release.slice(1).split('.').map(Number);
  return { name: 'ReviveCheck demo · pUSD', version: { major, minor, patch }, tokens: [{ ...release.listing, extensions: { nativeAssetId: DEMO_ASSET_ID } }] };
}
