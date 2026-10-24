# Value experiment: a token-list maintainer's decision, two ways

Internal validation, run by the project author on 2026-10-24 against the public Portaldot V3 testnet nodes (review finding F-10). It measures one task done manually and done through ReviveCheck, with actual steps, elapsed time, interventions, detected failures and the decision each path produced. It does not measure external adoption or willingness to pay; both remain unverified.

Script and raw results: `examples/token-catalog/benchmark/run-benchmark.mjs`, `examples/token-catalog/benchmark/results-2026-10-24.json`.

## The task

A maintainer of a Portaldot V3 token list decides whether pUSD, native asset 7777, may be enabled in the catalog with the entry `{ chainId 420420777, 0x00001e61…10000, "pUSD", "Portaldot USD (test)", 6 decimals }`. The entry may be enabled only if the chain agrees with it through both interfaces, the `pusd-token-list` release holding the sealed report is approved by the reviewer the maintainer trusts, the VerifiedTokenList lists the token on that approval, the report is stored on-chain and still verifies, and the report is recent and taken on the current runtime.

## Setup

| | |
| --- | --- |
| Network | V3 testnet, `wss://test-node-v3.portaldot.dev` and `https://test-evm-rpc-v3.portaldot.dev`, runtime portaldot-v3/3002 |
| Checkpoint | finalized block #176665 for the manual path; the ReviveCheck commands pinned #176667 and #176662 |
| Roles | owner, reviewer and operator are the project's isolated test account; the trusted reviewer in the policy is that account |
| Manual path | the raw reads a maintainer makes by hand, executed as code so the timings are reproducible: JSON-RPC to the EVM endpoint and polkadot-js reads of native storage, one node connection reused. Each step is marked as an intervention where a person must derive, encode, decode or compare something themselves |
| ReviveCheck path | `npm run rc -- check_release --release v1.0.1`, then `node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet.json`. Each command is a separate process that opens its own node connection |

## Results

| | Manual | ReviveCheck |
| --- | --- | --- |
| Operator steps | 12 | 2 commands |
| Interventions (derive, encode, decode or compare by hand) | 12 | 0 |
| Elapsed, wall-clock | 9.95 s (one reused connection) | 36.19 s (17.59 s check, 18.60 s acceptance; each includes a node handshake) |
| Decision | enable | enable (`valid`) |
| Record of the decision | none; the maintainer would write it down | `acceptance.json` and `catalog.json` with 24 checks, every reason, the checkpoints read and the reviewer-trust basis; a new sealed report `408bb51f…` at #176667 |
| Evidence retained | none | the sealed report, the evaluation hash, the captured inputs (`examples/token-catalog/fixtures/testnet-2026-10-24.inputs.json`) |

Manual steps and timings: chain ID 2,180 ms; finalized head and EVM hash mapping 1,933 ms; native asset metadata 969 ms; derive the precompile address 0 ms; three ERC-20 calls 1,466 ms; compare five fields 0 ms; compute the release ID 3 ms; registry reads 974 ms; token-list reads 967 ms; fetch and verify the stored report 1,460 ms; age and runtime 0 ms; decide 0 ms. The zero-millisecond rows are the ones a person actually spends time on: they are pure interventions (address scheme, ABI decoding, canonical hashing, comparisons) and the script does them instantly.

### Failure detection

The same entry with the Ethereum default of 18 decimals (release v1.0.0):

| | Manual | ReviveCheck |
| --- | --- | --- |
| Detection | only if the maintainer compares the decimals at step 6; nothing stops the process otherwise | `check_release --release v1.0.0` fails: `token.listing: decimals: listed 18, chain 6`, with the remediation `Publish a release whose entry uses the chain's decimals (6), then recheck` |
| Elapsed | same as above | 25.16 s |

### Costs

Deployment deposits, recurring fees and estimates are different kinds of money and are listed separately. Deposits are held and returned when the storage is freed; fees are spent; estimates can change before inclusion.

| Kind | Item | tPOT |
| --- | --- | --- |
| Deposit (one-time, held) | ReleaseRegistry deployment, #162962 | 125.196 |
| Deposit (one-time, held) | VerifiedTokenList v1 deployment, #164220 | 178.158 |
| Deposit (per listing, held) | pUSD listing, #164313 | 11.525 |
| Deposit (per release, held) | first registry submit of a release | about 7.7 |
| Fee (recurring, spent) | registry submit, review, token-list listing | 0.018 to 0.031 each |
| Fee (recurring, spent) | storing a 7,404-byte report with `remark.store` | 0.752 |
| Fee (recurring, spent) | deployments | 0.160 (registry), 0.253 (v1 list) |
| Estimate (pending) | VerifiedTokenList v2 deployment | 225.738 deposit plus 0.316 fee; the project wallet is 147.578 short |
| Free | every read: `check_release`, `read_registry`, `token_list_status`, `evaluate_policy`, the catalog `build` and `acceptance` | 0 |

The maintainer's recurring cost per decision is zero in both paths; the maintainer's recurring cost per release is one submit, one review and one listing (about 0.07 tPOT in fees plus held deposits), and 0.75 tPOT if the report is stored on-chain.

## What the measurement shows, and what it does not

- **Fewer steps and no hand work.** Twelve hand steps with twelve interventions became two commands with none. The interventions are where a maintainer makes mistakes: the precompile address scheme, native-to-EVM block mapping, ABI decoding of strings, computing a release ID, canonical hashing of a stored report.
- **A recorded, checkable decision.** The manual path ends with a judgment in the maintainer's head. The ReviveCheck path ends with a sealed report, an evaluation listing 24 checks and the reasons for any refusal, and captured inputs that replay offline. That is the artifact a second person can audit.
- **Wall-clock did not improve in this measurement.** Both paths are dominated by the public nodes' response time, and each ReviveCheck command paid its own 10 to 15 second handshake, so the two commands took 36 s against 10 s for a script that reused one connection. A person performing the twelve manual steps at a terminal and an explorer would take far longer than 10 s, but that was not measured and is not claimed. Running the two commands in one process, as `lib/service.js` does inside the catalog, removes one handshake.
- **Failure detection is the stronger difference.** The wrong entry fails a check with the observed and expected values and a remediation; manually it depends on one careful comparison.

Limitations: one task, one run, one operator who built the tool, a test account in every role, and public nodes whose latency varied between 1 and 18 seconds during the run. This is internal validation. The first external test remains a maintainer who did not build ReviveCheck bringing their own token and reviewer; until then, saved time, adoption and paying demand are hypotheses.

## Reproduce

```sh
node examples/token-catalog/benchmark/run-benchmark.mjs --out examples/token-catalog/benchmark/results-$(date -u +%F).json
```

The script performs read-only calls only, loads no wallet and signs nothing. The committed results file is from 2026-10-24; a rerun produces a new dated file beside it.
