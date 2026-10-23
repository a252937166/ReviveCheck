# Portaldot V3 technical findings

Verified during 2026-10-23 04:04–04:24 UTC (2026-10-23 00:04–00:24 America/New_York; 12:04–12:24 Asia/Shanghai). These are testnet findings, not mainnet configuration or deployment proof.

## Sources and runtime identity

- [Official V3 guide](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide): README updated October 16, with the `portaldot.dev` endpoints.
- [V3 FAQ](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide/blob/main/FAQ.md).
- [Native Solidity example](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide/blob/main/demo/04_solidity_demo.py).
- [Upstream dual VM documentation](https://docs.polkadot.com/smart-contracts/for-eth-devs/dual-vm-stack/) supplies context. Portaldot's deployed runtime is authoritative.

Live read-only queries confirmed:

| Property | Observed value |
| --- | --- |
| Native WebSocket | `wss://test-node-v3.portaldot.dev` |
| Ethereum JSON-RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| EVM chain ID | `420420777` / `0x190f1ca9` |
| Native genesis | `0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd` |
| Runtime | `portaldot-v3`, spec version `3002` |
| `system_properties` | `ss58Format=42`, `tokenDecimals=14`, `tokenSymbol=tPOT` |
| `Revive.allowEVMBytecode` | `true` |
| `Revive.nativeToEthRatio` | `10000` |
| `Revive.autoMap` | `true` |
| `Revive.gasScale` | `5` |
| `Revive.depositPerByte` | `6000000000000` native units / `0.06 tPOT` |
| `Revive.depositPerItem` | `15000000000000` native units / `0.15 tPOT` |
| `Balances.existentialDeposit` | `10000000000000` native units / `0.1 tPOT` |

The guide labels the token `tPOTv3`; the live native runtime reports `tPOT`. Reports preserve the chain-reported native symbol and decimals. Raw EVM balances are retained separately, together with the observed conversion ratio. The inspector does not silently apply native decimals to EVM quantities. Native available funding is conservatively reported as free balance minus the greater of its frozen balance or existential deposit, with a lower bound of zero. In the public guide example, native free balance was 500 tPOT and EVM RPC balance was 499.9 × 10^18 raw EVM units; the missing 0.1 matches the observed native existential deposit. A free-balance value alone is not treated as fully spendable.

## Account and checkpoint handling

`ReviveApi.account_id(H160)` resolves the native AccountId32, and `ReviveApi.address(AccountId32)` resolves the H160 address. The inspector checks the round trip. Deriving two addresses from the same mnemonic is not sufficient evidence that they represent the same chain account.

The current runtime's `map_account` metadata says it is a no-op with AutoMap enabled: new native accounts are mapped on creation. A newly funded native wallet should therefore be checked after funding. Deployment stops if its funded account does not round-trip; it does not send a speculative mapping transaction.

Native block hashes and EVM block hashes differ. Comparing them directly produces a false mismatch. The inspector:

1. Obtains a native finalized block and its height.
2. Reads native state at that exact native block hash.
3. Reads EVM state at the same numeric block height.
4. Uses `ReviveApi.ethBlockHash(height)` to obtain the corresponding EVM hash and compares it to the EVM RPC block.

This path was exercised live. Example native finalized height `155373` had native hash `0xc752313aa9889c974a5661d4d4d258a194cdc4746db47e2bea11fe239e0469c2`, while both EVM RPC and native ReviveApi reported EVM hash `0xb8490638c6bfa4935f8b79814b1ae2d4b108a8f9e8a63d592bbfa48dccf752b8`.

## Reproduced constructor failure and correction

The local probe compiles with pinned `solc 0.8.24`, optimization enabled, EVM `paris` target. Ordinary EVM bytecode is supported because the deployed runtime reports `allowEVMBytecode=true`; this is not inferred from the presence of an Ethereum RPC alone.

For native `ReviveApi.instantiate` / `Revive.instantiate_with_code`, an EVM constructor's ABI arguments must be appended to the initcode. The native `data` field must be empty. Putting the arguments into the native `data` field returns:

```
revive.EvmConstructorNonEmptyData
```

This is materially different from a PVM-style deployment that supplies constructor input separately. The deployment script handles the EVM case explicitly.

`artifacts/constructor-dryrun.json` records the real negative case and corrected successful simulation at `2026-10-23T04:19:35.569Z`, finalized native checkpoint `0x2a791e280f2692e9028bc7490a32fb031083549932fcccda6a98d90d515ee5ee`. The original probe had 620 bytes of initcode; appending the one-word argument produced 652 bytes. The successful dry-run reported a maximum storage deposit of **56.2635 tPOT**, excluding the extrinsic fee.

Reproduce without a wallet or transaction submission:

```sh
node scripts/probe-constructor-dryrun.js
```

The simulation uses the official guide's public example origin. This is not a ReviveCheck-controlled wallet. Its predicted contract address and returned runtime code are simulation outputs; they prove no persistent deployment. No signing, transfer, or extrinsic submission occurred during these checks.

## Deployment and evidence limits

The native deployment helper accepts the project's dedicated sr25519 testnet wallet. It pins both chain ID and native genesis, requires a positive test-token balance, derives weight and storage limits from a fresh dry-run, and defaults to simulation. Signing requires both `--broadcast` and an explicit `--max-cost-tpot` budget. The budget covers the storage-deposit limit plus the estimated extrinsic fee; storage deposits lock test tokens and are distinct from consumed fees. Fee estimates may change before inclusion.

```sh
node scripts/deploy-probe.js --wallet .private/wallet.json
# After test-token funding and review of the actual estimate:
node scripts/deploy-probe.js --wallet .private/wallet.json --broadcast --max-cost-tpot 100
```

`100` is an example test-token budget, not an instruction to execute or a promise of exact cost. The helper preserves an individual receipt file per finalized transaction and a latest deployment receipt. It never exposes the mnemonic to the server or UI.

The inspector requires the native extrinsic's signer or EVM transaction's sender to match the project account, and requires the transaction to target or deploy the configured contract. Native transactions additionally require the native block hash and successful extrinsic events. A transaction hash from an unrelated account or contract cannot pass.

Historical transaction evidence does not prove that this exact transaction caused the current value: the value assertion is a separate finalized checkpoint read. The UI must preserve this boundary. Missing account, funding, contract, or transaction evidence is blocked or unknown, never a passing live release.

Not assumed: ink! ↔ Solidity synchronous calls, ERC assets automatically appearing in native asset modules, or an available iBridge route. Those are outside this prototype's demonstrated scope.
