# Value experiment: a token-list maintainer's decision, two scripted paths

Internal exploratory run by the project author on 2026-10-24 against the public Portaldot V3 testnet nodes (review finding F-10). Both paths were executed as code. One models the raw operations a maintainer might otherwise assemble; the other invokes ReviveCheck's documented commands. The run records their outputs and script timings. It does not measure a person's work, saved time, error rate, external adoption or willingness to pay.

Script and original results: `examples/token-catalog/benchmark/run-benchmark.mjs`, `examples/token-catalog/benchmark/results-2026-10-24.json`. The original JSON is retained unchanged, including its historical `manual`, `operatorSteps`, `interventions` and `recordOfDecision` labels. Here, those labels describe the author's task model, not observed human behavior. The raw baseline outputs and its computed decision are present in that JSON.

## The task

A maintainer of a Portaldot V3 token list decides whether pUSD, native asset 7777, may be enabled in the catalog with the entry `{ chainId 420420777, 0x00001e61...10000, "pUSD", "Portaldot USD (test)", 6 decimals }`. The entry may be enabled only if the chain agrees with it through both interfaces, the `pusd-token-list` release holding the sealed report is approved by the reviewer the maintainer trusts, the VerifiedTokenList lists the token on that approval, the report is stored on-chain and still verifies, and the report is recent and taken on the current runtime.

## Setup

| | |
| --- | --- |
| Network | V3 testnet, `wss://test-node-v3.portaldot.dev` and `https://test-evm-rpc-v3.portaldot.dev`, runtime portaldot-v3/3002 |
| Checkpoint | finalized block #176665 for the raw-read baseline; the ReviveCheck commands pinned #176667 and #176662 |
| Roles | owner, reviewer and operator are the project's isolated test account; the trusted reviewer in the policy is that account |
| Raw-read baseline (`manual` in the original JSON) | a programmed sequence of JSON-RPC and polkadot-js reads, derivations and comparisons using one reused node connection; its 12 task steps are annotated with the knowledge the author expects a maintainer would need |
| ReviveCheck path | `npm run rc -- check_release --release v1.0.1`, then `node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet.json`; separate processes open their own node connections |

The paths do not perform identical verification. The raw-read baseline assembles selected asset, registry, listing and stored-report reads. The ReviveCheck path also applies its report and policy verification, producing an acceptance evaluation with 24 checks. They run at different checkpoints and have different connection setup. Their timings are observations of these scripts, not a controlled performance comparison.

## Results

| | Scripted raw-read baseline | ReviveCheck commands |
| --- | --- | --- |
| Task packaging | 12 modeled operations in one script | 2 command invocations |
| Human intervention or effort | not measured; 12 annotations identify modeled knowledge requirements | not measured; the script requires no interactive input after its configuration is prepared |
| Sum of timed steps | 9.95 s; the initial shared node connection is outside this total | 36.19 s: 17.59 s check and 18.60 s acceptance; each process includes its own node connection |
| Computed decision | enable | enable (`valid`) |
| Decision output | intermediate results and the computed decision in the original benchmark JSON | `acceptance.json` and `catalog.json` with 24 checks, reasons, checkpoints and reviewer-trust basis |
| Additional report | no new sealed report | sealed report `408bb51f...` at #176667; the catalog's approved binding remains the existing `cbd78faa...` report |
| Retained evidence | raw-read results and decision in the original benchmark JSON | sealed report, acceptance evaluation hash and captured inputs (`examples/token-catalog/fixtures/testnet-2026-10-24.inputs.json`) |

The baseline's timed operations were: chain ID 2,180 ms; finalized head and EVM hash mapping 1,933 ms; native asset metadata 969 ms; derive the precompile address 0 ms; three ERC-20 calls 1,466 ms; compare entry fields 0 ms; compute the release ID 3 ms; registry reads 974 ms; token-list reads 967 ms; fetch and verify the stored report 1,460 ms; age and runtime 0 ms; decide 0 ms. A zero-millisecond operation is a local computation rounded to milliseconds. It provides no measurement of how long a person would take.

### Failure detection

The run executed one negative scenario through ReviveCheck: the entry with the Ethereum default of 18 decimals (release v1.0.0). In 25.16 s, `check_release` returned a failed check: `token.listing: decimals: listed 18, chain 6`, with the remediation `Publish a release whose entry uses the chain's decimals (6), then recheck`.

The negative scenario was not run through the raw-read baseline, so this experiment does not establish comparative detection or error rates. The baseline code includes a decimals comparison and would add a mismatch if its programmed input disagreed. No observed person missed a comparison in this experiment.

### Costs

Deployment deposits, recurring fees and estimates are listed separately. Deposits remain held until eligible code or storage is removed; a refund is conditional. The current contracts have live code references and no ordinary teardown interface, so full deployment-deposit recovery has not been demonstrated. Fees are spent; estimates can change before inclusion. See `docs/DEPLOYMENT.md` for the recovery conditions and deployment procedure.

| Kind | Item | tPOT |
| --- | --- | --- |
| Deposit (one-time, held) | ReleaseRegistry deployment, #162962 | 125.196 |
| Deposit (one-time, held) | VerifiedTokenList v1 deployment, #164220 | 178.158 |
| Deposit (per listing, held) | pUSD listing, #164313 | 11.525 |
| Deposit (per release, held) | first registry submit of a release | about 7.7 |
| Fee (recurring, spent) | registry submit, review, token-list listing | 0.018 to 0.031 each |
| Fee (recurring, spent) | storing a 7,404-byte report with `remark.store` | 0.752 |
| Fee (recurring, spent) | deployments | 0.160 (registry), 0.253 (v1 list) |
| Estimate (pending) | VerifiedTokenList v2 deployment | 225.738 deposit plus a twice-fee reserve of about 0.632; about 147.578 more tPOT than currently available |
| On-chain read fee | `check_release`, `read_registry`, `token_list_status`, `evaluate_policy`, catalog `build` and `acceptance` | 0 |

Neither read-only path pays an on-chain transaction fee. This says nothing about a provider's hosting charges or an operator's labor. A release's submit, review and listing cost about 0.07 tPOT in transaction fees plus held deposits in the recorded examples; storing a report adds about 0.75 tPOT. An acceptance read does not itself perform or pay for those writes.

## What this run supports

- **Documented task packaging.** The author modeled 12 raw operations and exposed the application task through two configured commands. This is an interface description, not a measured reduction from 12 observed human interventions to zero.
- **Inspectable decision artifacts.** Both scripted paths retain results. ReviveCheck additionally emits its standard sealed report and policy acceptance artifacts, including reasons and captured inputs that a second person can inspect.
- **An executed refusal case.** ReviveCheck rejected the incorrect decimals and returned the observed value and remediation. A comparative usability or reliability benefit still needs paired tests with equivalent checks and actual maintainers.
- **No speedup claim.** The 9.95 s and 36.19 s totals use different coverage, connection setup and checkpoints. They establish neither a tool speedup nor a human-time saving. Reducing a connection handshake would require a separate measurement before reporting an improvement.

Limitations: one task, one run, the project author, one test account in all roles, different verification coverage and public-node latency. No human baseline or paid-customer test was conducted. The first external validation remains a maintainer who did not build ReviveCheck bringing their own token and reviewer. Saved time, adoption and paying demand remain hypotheses; F-10 is not fully closed by this scripted run.

## Reproduce

Use a unique output name so the original result is preserved:

```sh
node examples/token-catalog/benchmark/run-benchmark.mjs --out examples/token-catalog/benchmark/results-$(date -u +%Y%m%dT%H%M%SZ).json
```

The script performs read-only chain calls, loads no wallet and signs nothing. It writes new local benchmark outputs and the reports produced by the invoked commands. Retain the original `results-2026-10-24.json` as the dated experiment; a rerun does not change what the original run proved.
