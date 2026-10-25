# Deploying and activating contract versions

Updated 2026-10-24. This file covers the VerifiedTokenList v2 deployment tooling (review finding F-02's deployment half) and the status of every deployment. The ReleaseRegistry is deployed once and reused; it has no versions.

## Status

| Contract | Version | Address | Block | Status |
| --- | --- | --- | --- | --- |
| ReleaseRegistry | 1 | `0xe949b200edf070b9d425b206ed24dc8fe5b7d339` | #162962 | deployed, active, reused by every token-list version |
| VerifiedTokenList | 1 | `0xd0bd833b4b8658b1230a0e9a99640935b3c65819` | #164220 | historical; known issue F-02 (any release owner can replace any entry); the application and the shared script helper refuse new writes to it; its pUSD listing at #164313 is preserved |
| VerifiedTokenList | 2 | `0xedaf8a25bb583ad164a94191b762414277198df9` | #177354 | **deployed, verified and active** (extrinsic `0xb0264f2b…abab`, 2026-10-24 17:05 UTC; nine verification checks; activated after re-verification at #177362); pUSD listed at #187124 and #187205 on release `pusd-catalog-v2` (`public/lifecycle/token-list-v2.json`) |

The deployment followed the estimate below after the wallet was funded. The estimate of 2026-10-24 (`deployments/token-list-v2.estimate-2026-10-24.json`, produced from the public deployer address without reading any wallet) is kept as the record of what was committed before signing:

| | tPOT |
| --- | --- |
| Maximum storage deposit (held; recovery conditions below) | 225.738 |
| Fee (spent), with a two-times reserve | 0.316 (reserve 0.632) |
| Total committed | 226.370 |
| Available in the project wallet | 78.793 |
| Shortfall | 147.578 |
| Manifest budget cap | 250 |

At the time of that estimate the deployer could not pay the deposit, so the chain refused even the dry-run from that account. The estimate therefore simulated the instantiation from the official guide's public example account, which does not change the deposit or the weight, and read the balance and nonce of the real deployer. The result is labelled with that basis. No wallet file was read.

## Why a manifest

Earlier tooling deployed from hard-coded defaults, overwrote `public/lifecycle/token-list.json`, and patched `lib/tokenlist.js` by text replacement. That is gone. A deployment is now described by a validated manifest, `deployments/token-list-v2.manifest.json`:

- which sources (in compile order) and their SHA-256, which compiler settings;
- the constructor arguments: the ReleaseRegistry to reuse and the curator (zero for an open list);
- the deployer's public SS58 and mapped EVM address (a manifest refuses any key that looks like a secret);
- the budget cap, the network, runtime and genesis the deployment is verified for;
- where its journal and its public record go. A manifest cannot point at a v1 path: `public/lifecycle/token-list.json`, `artifacts/local/token-list-deploy.json`, `artifacts/VerifiedTokenList.json` and `contracts/deployed/v1` are protected.

`lib/deployment.js` validates the manifest, checks the compiled artifact against it, builds the initcode, compares deployed runtime code with the artifact (immutable words masked), verifies the identity readback, writes the record and renders the generated module. `test/deployment.test.js` exercises all of it against an in-memory EVM.

## Records

| Record | Purpose | Written by |
| --- | --- | --- |
| `contracts/deployed/v1/` | the exact v1 sources; `test/verified-token-list.test.js` checks they hash to the v1 record | kept, never changed |
| `artifacts/VerifiedTokenList.json` | the v1 compiled artifact | kept; `node scripts/compile-token-list.js` writes `artifacts/VerifiedTokenList.v2.json` beside it |
| `public/lifecycle/token-list.json` | the v1 deployment and listings | kept |
| `public/lifecycle/token-list-v2.json` | the v2 deployment, once verified | `scripts/deploy-token-list.js --broadcast` |
| `artifacts/local/token-list-v2-deploy.json` | the v2 journal (local, ignored by Git): estimate, pending hash, receipt, verification | `scripts/deploy-token-list.js` |
| `lib/tokenlist.deployments.js` | the generated module naming every verified deployment and the active one | `scripts/activate-token-list.js --write` |

`lib/tokenlist.js` reads the active entry from the generated module; the site, the tools and `scripts/list-token.js` follow it. `scripts/release-status.js` fails when the module differs from a fresh render of the records.

## Procedure

```sh
# 1. Estimate from the public deployer address. No wallet is read; exit 2 means pending funding.
node scripts/deploy-token-list.js --manifest deployments/token-list-v2.manifest.json
node scripts/deploy-token-list.js --from 5…                      # estimate for another public address

# 2. Fund 5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt with testnet tPOT, then re-estimate until it reports estimate-ready.

# 3. Sign with the isolated test wallet, behind an explicit cap within the manifest budget.
node scripts/deploy-token-list.js --manifest deployments/token-list-v2.manifest.json --broadcast --max-cost-tpot 240 --wallet .private/wallet.json

# 4. Verify from the chain again and activate.
node scripts/activate-token-list.js --manifest deployments/token-list-v2.manifest.json          # verify only
node scripts/activate-token-list.js --manifest deployments/token-list-v2.manifest.json --write  # regenerate lib/tokenlist.deployments.js with v2 active

# 5. Rebuild, test, re-index the feed.
npm test && npx vite build && node scripts/index-registry.js && node scripts/release-status.js
```

What the broadcast step enforces, in order: the wallet is the manifest deployer; the node has the pinned genesis, chain ID and runtime; the deployer maps to the manifest's EVM address; the registry to reuse has code; the account has no pending transactions (`accountNextIndex == nonce`); the cap is within the manifest budget and the estimate within the cap and the balance; the transaction hash is journaled before it is sent; a finalization timeout or a missing `Instantiated` event leaves a pending journal and nothing else. After finality it reads the runtime code and `version()`, `registry()` and `curator()` through both the EVM RPC and ReviveApi at one finalized block. Only when every check passes is the public record written; the record is created with `wx`, so it cannot overwrite an earlier one. The journal keeps the verification either way.

Activation re-reads the chain rather than trusting the record, then regenerates the module. Activation never deletes v1: the generated module lists both versions, and `TOKEN_LIST_VERSIONS` exposes them.

## Costs recorded so far

| Transaction | Block | Deposit held (tPOT) | Fee spent (tPOT) |
| --- | --- | --- | --- |
| ReleaseRegistry deployment | #162962 | 125.196 | 0.160 |
| VerifiedTokenList v1 deployment | #164220 | 178.158 (code 131.160, contract record 46.998) | 0.253 |
| pUSD listing in the v1 list | #164313 | 11.525 | 0.031 |
| ReleaseGate revision 2 submit and review | #161790, #161839 | 3.842 (review) | 0.036 |
| Report stored with `remark.store`, 7,404 bytes | #164266, #164335 | none | 0.752 each |
| VerifiedTokenList v2 deployment | #177354 | 225.738 (maximum; the record carries the held amount) | 0.316 |
| Reviewer account funded with 12 tPOT (transfer) | #187050 | none | 0.015 |
| Reports stored with `remark.store`, 7,369 and 7,404 bytes | #187058, #187145 | none | 0.748, 0.752 |
| `pusd-catalog-v2` submit, revisions 1 and 2 | #187069, #187165 | release storage per dry-run | 0.022, 0.021 |
| Reviewer decisions on `pusd-catalog-v2` (approve, approve, changes, approve) | #187095, #187181, #187230, #187271 | up to 3.8415 (decision storage, reused) | 0.025, 0.024, 0.024, 0.024 |
| pUSD listings in the v2 list, revisions 1 and 2 | #187124, #187205 | entry storage per dry-run | 0.031, 0.031 |

Deposits are held for code and contract storage; fees are spent. A held deposit is not automatically available again. Recovering a code deposit requires the uploader to remove the code after its instance reference count reaches zero. The deployed contracts have live instances and no ordinary teardown interface, so their full code and instance deposits have no demonstrated recovery path. Deleting a supported storage entry may release its own deposit, subject to the runtime's accounting, but that does not remove the contract or recover its code deposit. This release does not attempt recovery, and its deployment budget assumes existing deposits remain held.

Estimates can change before inclusion. Recorded deployment and listing figures come from finalized `TransactionFeePaid` and hold events in the local journals and the explorer; pending estimates are labelled separately.
