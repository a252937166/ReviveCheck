// The two official Portaldot V3 networks, as configured in the official explorer
// bundles and observed read-only on 2026-10-23. No Polkadot.js import, so the
// public page can link and label without loading the chain client.
export const NETWORKS = Object.freeze({
  testnet: Object.freeze({
    key: 'testnet', name: 'Portaldot V3 Testnet', shortName: 'V3 Testnet', chainName: 'PortaldotV3 Test',
    chainId: 420420777, genesisHash: '0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd',
    substrateRpcUrl: 'wss://test-node-v3.portaldot.dev', evmRpcUrl: 'https://test-evm-rpc-v3.portaldot.dev',
    explorer: 'https://scanner-testnet-v3.portaldot.dev', explorerApi: 'https://scanner-testnet-v3-api.portaldot.dev',
    symbol: 'tPOT', decimals: 14, scope: 'portaldot-testnet-readonly',
  }),
  live: Object.freeze({
    key: 'live', name: 'Portaldot V3 Live', shortName: 'V3 Live', chainName: 'PortaldotV3 Live',
    chainId: 780780777, genesisHash: '0x6e7f1f24628d2fa3a1ac81a8b45157c63b1037fee4123a7664aae2c55cdbbc36',
    // The official explorer configuration lists only this native node; no EVM endpoint is published there.
    substrateRpcUrl: 'wss://live-v3-node.portaldot.dev', evmRpcUrl: null,
    explorer: 'https://scanner-live-v3.portaldot.dev', explorerApi: 'https://scanner-live-v3-api.portaldot.dev',
    symbol: 'POT', decimals: 14, scope: 'portaldot-live-readonly',
  }),
});

// First block of each runtime, found by bisecting state_getRuntimeVersion on 2026-10-23.
export const RUNTIME_HISTORY = Object.freeze({
  testnet: [
    { spec: 3000, from: 0, hash: '0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd' },
    { spec: 3001, from: 50000, hash: '0xcad07ddff0ca7d0f647b1438243082f4ac266cbfec6a03a7daae51af643be494' },
    { spec: 3002, from: 57052, hash: '0x2f72b0eb30b9046271b12d05f188a6a50e11a8e60f7d86010d1c0b11b50980c5' },
  ],
  live: [
    { spec: 3000, from: 0, hash: '0x6e7f1f24628d2fa3a1ac81a8b45157c63b1037fee4123a7664aae2c55cdbbc36' },
    { spec: 3001, from: 660453, hash: '0xd1f3a302074a2eef290af27995783d9a3ff2abe36e91a15e45df6263e4f5aa2d' },
  ],
});

const HASH = /^0x[0-9a-fA-F]{64}$/;
export const networkForScope = (scope) => Object.values(NETWORKS).find((network) => network.scope === scope) || null;
export function blockUrl(network, hash) {
  if (!HASH.test(hash || '')) return null;
  return `${network.explorer}/#/blocks/${hash.toLowerCase()}`;
}
export function extrinsicUrl(network, hash) {
  if (!HASH.test(hash || '')) return null;
  return `${network.explorer}/#/extrinsics/${hash.toLowerCase()}`;
}
