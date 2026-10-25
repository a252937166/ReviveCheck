# Value experiment: a token-list maintainer's decision, measured fairly

Two experiments are recorded here. The current one (2026-10-25) answers assessment item A-06: it compares two implementations of the same five checks on identical inputs, separates installation from repeat decisions and network waiting from computation, records completion, incorrect enables, incorrect refusals, assistance and reconstructability, and reports the numbers whether or not they favour ReviveCheck. The earlier one (2026-10-24) is kept below as history with its numbers unchanged; it compared two scripts with different coverage and checkpoints and must not be read as a speed result.

Both experiments were run by the project author with scripts. No maintainer took part. A pilot with people is specified in `docs/PILOT_PROTOCOL.md` and has not been run.

## Summary of the 2026-10-25 run

- Both arms reached the predefined decision in every scenario: 5 of 5 deterministic scenarios and 3 of 3 live scenarios each. 0 false enables, 0 false refusals, 0 incomplete runs, 0 failures. The two scenarios that need a signed transaction to reproduce (superseded report, revoked approval) were run on captured inputs only.
- Live repeat decisions took 17.1 to 24.0 s per arm, and 99 % of that was waiting for the public nodes. ReviveCheck was faster in one pair (17.3 s against 19.1 s) and slower in the other (24.0 s against 17.1 s). No speed difference is established; both arms are bound by about 0.5 s per round trip to the public nodes.
- Setting up ReviveCheck for a catalog means `npm ci` (4.9 s with a warm npm cache, 14.4 s with an empty cache) plus 25 policy fields, 17 catalog fields and one six-argument binding command per approved revision. The baseline script encodes 19 constants and 10 facts about the chain and the contracts in 217 lines. Human reading and typing time was not measured.
- A second reviewer given only the output artifact could extract 6 of 6 required items from ReviveCheck's output and 5 of 6 from the baseline's; the baseline records no next action. ReviveCheck's artifact also carries an integrity hash, the trust basis, the policy identity and who controls each role; the baseline's carries none of these.
- Reads cost nothing on-chain in either arm. The lifecycle that produced the state under test spent 0.021 to 0.031 tPOT per registry or listing transaction, about 0.75 tPOT per stored report, and held 7.683 tPOT for the release record and 3.8415 tPOT for the reviewer's decision record.

Files: `examples/token-catalog/benchmark/run-fair-benchmark.mjs` (orchestrator), `benchmark/lib/baseline.mjs` (the baseline script), `benchmark/lib/instrument.mjs` (the network tap), `benchmark/reconstruct-decision.mjs` (the second-reviewer test), `benchmark/fixtures/12-reapprove-r2-unavailable.inputs.json`, `benchmark/install/measure-2026-10-25-*.json`, `benchmark/results-fair-2026-10-25.json` (every raw observation) and `benchmark/artifacts/fair-2026-10-25/<mode>/<scenario>.<arm>.json` (the sixteen output artifacts).

## Method

### The question and the two arms

May the pUSD entry `{ chainId 420420777, 0x00001e61...10000, "pUSD", "Portaldot USD (test)", 6 decimals, asset 7777 }` be enabled in the catalog right now? The catalog's policy is `examples/token-catalog/config/testnet-v2.json` (policy hash `ce1388f9...534fd`): trusted reviewer `0x95db300103ec8b45884b13ed85230fbf02114065`, release `pusd-catalog-v2` owned by `0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b`, consumer VerifiedTokenList v2 at `0xedaf8a25bb583ad164a94191b762414277198df9`, report age at most 7 days, runtime portaldot-v3/3002, stored report required.

| | Baseline: CI script + explorer + approval record | ReviveCheck |
| --- | --- | --- |
| What it is | a maintainer's Node script over raw reads: ethers for ABI encoding, `@polkadot/api` for native storage and blocks, hard-coded contract facts, and an "approval record" (the report hash and revision the trusted reviewer approved, and the `remark.store` extrinsic and block hash where the report bytes are, as the explorer shows them) | `evaluateBinding` from `lib/policy.js` and the catalog's entry comparison (`buildCatalog` in `examples/token-catalog/lib/catalog.js`, which applies `approvedEntry` and `compareEntry`) |
| Invocation | the script runs in-process in the benchmark; a maintainer would run it as one command | library calls in-process, the same calls `catalog.js acceptance` makes; the CLI was not spawned so both arms share one process and one timing tap. Live inputs come from `collectPolicyInputs` in `lib/service.js`, the function the CLI uses |
| Reads | `eth_call` at the EVM hash of the finalized block; polkadot-js storage and blocks at the native hash; one connection per run, sequential | every registry and consumer value through both the EVM RPC and `ReviveApi.call` at one finalized block, observation, registry and listing in parallel, then the stored report |
| Output artifact | `maintainer-ci-script.result.v1`: configuration echo, checkpoint, five checks with observed values, problem labels, decision, exit code | `catalog.json` and `evaluations/<token>.json` as the CLI writes them, bundled in one file |

### The five checks are the same

| Check | Baseline implementation | ReviveCheck implementation |
| --- | --- | --- |
| C1 entry vs chain, both interfaces | derives the precompile address from the asset id; reads native `Assets.metadata` and the ERC-20 `symbol()`, `name()`, `decimals()`; compares chainId, address, symbol, name and decimals | `approvedEntry` accepts only a passed report whose `token.listing` check confirmed those five fields through both interfaces at the report checkpoint; `compareEntry` requires the configured entry to equal that approved entry field by field; `target.subject` ties the report to the policy subject |
| C2 trusted approval of the current revision and exact report hash | `releaseOf`: owner, revision and report hash must equal the approval record; `decisionOf(trusted reviewer)` must be reviewed and approved | `registry.read`, `.provenance`, `.domain`, `.fresh`, `.interfaces`, `.release`, `.owner`, `.label`, `.revision` (exact hash and revision), `.approvals` (trusted set, threshold, no request for changes) |
| C3 listing entry matches release, report, reviewer | `isListed` true; `entryOf` names the release id, the recorded report hash and the trusted reviewer | `consumer.read`, `.provenance`, `.domain`, `.fresh`, `.identity`, `.registry`, `.version-known`, `.version`, `.interfaces`, `.listed`, `.entry` |
| C4 stored report retrieved and verifies | block is canonical and finalized, the extrinsic is `remark.store`, the bytes decode to a report whose canonical SHA-256 equals its `evidenceHash` and the recorded hash | `storage.read` (also checks the `Remark.Stored` event against publisher and content hash), `storage.report` |
| C5 report age and runtime | age at most 7 days; the report's runtime equals the allowed runtime and the runtime the chain runs now | `evidence.age`, `runtime.report`, `observation.present`, `.fresh`, `.network`, `runtime.current` |

ReviveCheck additionally checks evidence integrity (binding hash and report hash under this exact policy), evidence scope, the report's target network, the plan fingerprint, the report status, interface agreement for every registry and consumer read, the consumer's identity and version at the listing checkpoint, and observation freshness windows; it produces a documented reason vocabulary with the status each reason forces and a next action. The only check the baseline performs that ReviveCheck does not perform at evaluation time is the live re-read of the asset metadata in C1: ReviveCheck relies on the sealed report's `token.listing` check at the report checkpoint, bounded by `evidence.age`.

### Identical inputs in deterministic mode

Both arms consume the same captured inputs file (schema `revivecheck.token-catalog-inputs.v1`, written by `catalog.js record` during the live lifecycle). The baseline replays `registry.views.*.evm` and `listing.views.*.evm` as its `eth_call` results, the observation as its finalized checkpoint and runtime, and `evidence.run` as the report it would have decoded from the block. No separate asset read was captured, so the baseline's C1 chain values come from the stored report's raw `token.listing` evidence (the native field values and the raw ERC-20 return data, which the script decodes itself) at the report checkpoint, which is the same checkpoint ReviveCheck's `approvedEntry` relies on. Both arms evaluate at the capture's recorded time.

### Live mode and timing

Each arm opens its own node connection and reads a fresh finalized checkpoint; the checkpoints are recorded per arm and differed by three blocks in each pair. Every network round trip of both arms is timed at the two transports they share: the global `fetch` (JSON-RPC over HTTPS) and `WsProvider.send`/`connect` of `@polkadot/api`, wrapped in the benchmark process. `wallMs` is the arm's wall clock including the handshake and teardown; `networkWaitMs` is the union of intervals during which at least one call was in flight; `computeMs = wallMs - networkWaitMs`; `networkCallSumMs` sums individual call durations and exceeds the wait when calls overlap. Every call is in `callLog`. Arm order alternated per scenario (scripts do not learn; the alternation only balances connection warm-up and node load). The unavailable-verification scenario was run live by rejecting every connection and request at that layer for both arms alike; no node was touched in that mode.

### Scenarios and expected decisions

| # | Scenario | Captured state (deterministic inputs) | Binding under test | Expected |
| --- | --- | --- | --- | --- |
| 1 | correct entry | lifecycle step 12 (reapprove-r2), finalized #187279 | `cfff0845...`, revision 2, report `1faef921...` | enable |
| 2 | incorrect decimals | the same capture; configuration `testnet-v2-wrong-entry.json` with 18 decimals | the same | refuse |
| 3 | superseded report | step 7 (submit-r2), #187171: the registry holds revision 2 | `4896a5a5...`, revision 1, report `eb960cc7...` | refuse |
| 4 | revoked approval | step 11 (revoke-r2), #187248 | `cfff0845...`, revision 2 | refuse |
| 5 | unavailable verification | a copy of the step-12 capture whose four reads are errors (`benchmark/fixtures/`) | `cfff0845...`, revision 2 | refuse |

Inputs are retained with their SHA-256 in `results-fair-2026-10-25.json` under `runs[].scenarios[].inputs`: configuration, bindings file, binding, report and capture.

## Results

### Decisions

| Scenario | Expected | Baseline, deterministic | ReviveCheck, deterministic | Baseline, live | ReviveCheck, live |
| --- | --- | --- | --- | --- | --- |
| correct entry | enable | enable (5 of 5 checks pass) | enable (`valid`, 35 checks pass, entry equals the approved report) | enable at #187702 | enable (`valid`) at #187705 |
| incorrect decimals | refuse | refuse: `C1:decimals` (entry 18, native 6, EVM 6) | refuse: `entry-mismatch:decimals` (policy `valid`, entry withheld) | refuse: `C1:decimals` at #187711 | refuse: `entry-mismatch:decimals` at #187708 |
| superseded report | refuse | refuse: `C2:report-superseded+revision+not-reviewed`, `C3:not-listed` | refuse: `revision-superseded`, `approval-missing`, `consumer-not-listed` (`recheck-required`) | not reproducible read-only | not reproducible read-only |
| revoked approval | refuse | refuse: `C2:changes-requested`, `C3:not-listed` | refuse: `approval-revoked`, `consumer-not-listed` (`recheck-required`) | not reproducible read-only | not reproducible read-only |
| unavailable verification | refuse | refuse: all five checks unavailable | refuse: `observation-missing`, `registry-unavailable`, `consumer-unavailable`, `storage-unverified` (`unknown`) | refuse (connection refused by the injected outage) | refuse (`unknown`) |

Completion 16 of 16 arm runs; false enables 0; false refusals 0; the two arms agreed in every scenario. The baseline's labels are the script author's; ReviveCheck's are the documented codes of `lib/policy.js` and the catalog.

### Time, split

**Installation, once** (`benchmark/install/`): a local `git clone` of commit `4dfb1e3` took 0.6 s; `npm ci` took 4.9 s with a warm npm cache and 14.4 s with an empty cache (260 packages, 425 MB). The baseline needs the same packages (`ethers`, `@polkadot/api`) and in this repository the same install. No person read documentation or typed during these measurements, so human setup time is unknown.

**Writing the policy, once per catalog** (counted, not timed): 25 policy leaf fields (network, runtime, subject, plan hash, evidence limits, reviewers and their basis, registry, consumer), 17 catalog fields outside the policy (name, mode, three role statements, the token entry, the superseded-policy note, data and report directories), and one `catalog.js bind` command with six arguments per approved revision (token, report hash, release id, revision, storage extrinsic, storage block), all copied from receipts rather than derived. The baseline script hard-codes 19 constants (entry, contracts, reviewer, approval record, limits, endpoints) and encodes 10 facts a maintainer must know to write it (the precompile address scheme, the native-to-EVM block hash mapping, the spec-3002 types bundle, both ABIs and the release id scheme, where the stored report is, the canonical JSON form behind the report hash, the report's date and runtime fields, how to decode ERC-20 metadata, and which reviewer counts); it is 217 non-comment lines. The field counts are listed in the results file; how long a person needs for them was not measured.

**Repeat decision, live** (one run per scenario; the public nodes answered in 0.47 to 0.55 s per round trip, the metadata exchange in 3.5 to 4.0 s, the first HTTPS request in 2.2 s):

| Scenario, arm (order) | Wall | Network wait | Compute | Handshake | Round trips (native / EVM) | Sum of call durations | Checkpoint |
| --- | --- | --- | --- | --- | --- | --- | --- |
| correct entry, baseline (first) | 19.08 s | 18.95 s | 0.13 s | 2.19 s | 35 (27 / 8) | 21.87 s | #187702 |
| correct entry, ReviveCheck (second) | 17.26 s | 17.10 s | 0.15 s | 2.16 s | 46 (37 / 9) | 28.05 s | #187705 |
| incorrect decimals, ReviveCheck (first) | 24.02 s | 23.82 s | 0.20 s | 2.26 s | 56 (47 / 9) | 37.45 s | #187708 |
| incorrect decimals, baseline (second) | 17.14 s | 17.01 s | 0.13 s | 2.21 s | 37 (29 / 8) | 20.85 s | #187711 |
| unavailable, baseline | 0.8 ms | 0 | 0.8 ms | refused | 1 refused | 0 | none |
| unavailable, ReviveCheck | 1.8 ms | 0 | 1.8 ms | refused | 2 refused | 0 | none |

ReviveCheck makes more round trips because it reads every registry and consumer value through both interfaces and verifies the consumer's identity (`version()`, `registry()`, `curator()`, `eth_getCode`); its parallel reads recover part of that. The baseline reads fewer values, sequentially. With one run per scenario and per-call latency that varied by a factor of eight across the same run, neither arm is shown to be faster: ReviveCheck was 1.8 s faster in one pair and 6.9 s slower in the other. A trial run 16 minutes earlier gave the same pattern (baseline 19.0 s and 18.8 s, ReviveCheck 17.6 s and 23.8 s); its files were not retained. The injected outage rejects immediately, so the sub-millisecond unavailable rows measure the arms' handling of a refused connection, not a real timeout, which would cost the configured limits (50 s per connection in `lib/service.js`, 150 s in the benchmark's baseline).

**Repeat decision, deterministic:** both arms decide in 0.3 to 3.3 ms on captured inputs. The decision logic is negligible; in live mode everything is the network.

### Operator actions and assistance

Once set up, each arm is one command per decision with no value derived by hand (`operatorActions` 1 and 1). Assistance requests and corrections were 0 and 0 because both arms are scripts run by the benchmark; no person performed a step, so none could be observed. This is a statement about the measurement, not about maintainers.

### Can a second reviewer reconstruct the decision from the artifact alone?

`reconstruct-decision.mjs` reads one artifact and nothing else, extracts six required items and four extras, scores each present or absent, and re-derives the decision from the recorded checks. All sixteen artifacts re-derived consistently.

| Item | Baseline artifact | ReviveCheck artifact |
| --- | --- | --- |
| decision | present (decision and exit code) | present (`available`, policy status, entry match) |
| exact report hash | present (approval record; the registry read is in C2) | present (`evaluation.reportHash`, equal to the binding's) |
| reviewer relied on | present (a hard-coded address; nothing says why it counts) | present (trusted set and threshold) |
| checkpoint(s) | present when a read succeeded; absent in the unavailable scenario | present when a read succeeded; absent in the unavailable scenario |
| reason codes | present as the author's labels, undocumented | present, each with documented meaning and the status it forces |
| next action | absent | present |
| extra: artifact integrity hash | absent | present (`evaluationHash` recomputes) |
| extra: trust basis | absent | present (`reviewerTrust`) |
| extra: policy identity | absent | present (policy hash and name) |
| extra: role control | absent | present (who controls owner, reviewer, operator) |
| score | 5 of 6 (4 of 6 unavailable); extras 0 of 4 | 6 of 6 (5 of 6 unavailable); extras 4 of 4 |

The baseline artifact is one the author designed to echo its configuration and observed values; a real maintainer's script might record less (a log line and an exit code) or more. What holds regardless of that design: the baseline has no next action, no documented meaning behind its labels, no hash a reader can recompute, and no statement of why the reviewer is trusted or who controls the accounts. Whether these differences change a maintainer's or an auditor's work is the question for the pilot.

### Costs

Deposits, fees and estimates are separate kinds of cost. Deposits are held and are refunded only under conditions; the deployed contracts have live code and no ordinary teardown interface, so full recovery of their deposits has not been demonstrated (see `docs/DEPLOYMENT.md`). Fees are spent. Estimates can change before inclusion. Receipts below are the live ones behind the state under test (`examples/token-catalog/data/testnet-v2/lifecycle.json` for the step receipts; amounts from `public/lifecycle/registry-writes.json`, `public/lifecycle/token-list-v2.json`, `public/lifecycle/evidence.json` and `public/lifecycle/funding.json`).

| Kind | Item | tPOT |
| --- | --- | --- |
| Deposit (held, one-time) | ReleaseRegistry deployment, #162962 | 125.196 |
| Deposit (held, one-time) | VerifiedTokenList v1 deployment, #164220 | 178.158 |
| Deposit (held, one-time) | VerifiedTokenList v2 deployment, #177354 | 225.738 (fee 0.316) |
| Deposit (held, per release) | registry submit of revision 1 of `pusd-catalog-v2`, #187069 | 7.683 maximum storage deposit |
| Deposit (held, per reviewer decision) | the reviewer's first review of that release, #187095 | 3.8415 maximum storage deposit |
| Fee (spent) | registry submit, #187069 and #187165 | 0.0216 and 0.0209 |
| Fee (spent) | review: approve #187095, approve #187181, request changes #187230, approve #187271 | 0.0248, 0.0241, 0.0241, 0.0241 (no new deposit once the decision record exists) |
| Fee (spent) | list pUSD on v2 on revision 2, #187205 | 0.0306 (the receipt records the fee; the listing deposit was not captured in it; the v1 listing of 2026-10-23 held 11.525) |
| Fee (spent) | storing the 7,369-byte and 7,404-byte reports with `remark.store`, #187058 and #187145 | 0.748 and 0.752 |
| Fee (spent) | funding the reviewer account with 12 tPOT, #187050 | 0.015 |
| On-chain read fee | every read in both arms | 0 |

Neither arm pays anything to decide. The lifecycle that makes a decision possible costs fees of a few hundredths of a tPOT per transaction plus held deposits, in testnet tokens; none of this establishes commercial unit economics, hosting cost or operator labour.

### Failures and deviations

- No arm failed and no network call failed in the retained run (10:25:35 to 10:26:53 UTC). One run earlier (10:13 UTC) completed all sixteen artifacts and the results file in 81 s, but the Node process did not exit afterwards: the node client kept the event loop alive after `disconnect()`, and the process was still resident after ten minutes and was killed. The orchestrator now exits explicitly once the results are flushed and bounds every live arm with a deadline; the run was repeated with that script and the repeat is the retained one. The earlier results were overwritten; their decisions and timings matched the retained run within the variation described above.
- In the trial run, a keep-alive `system_health` call still in flight when an arm closed its connection was counted as a failed call; the tap now reports such calls as unfinished, separately from failures.
- Scenarios 3 and 4 were not run live: reproducing them needs a signed registry transaction and nothing is signed here.
- The install was measured at commit `4dfb1e3`; the benchmark ran at commit `f08140f` with uncommitted changes in the tree (another contributor was editing concurrently). Versions: Node v22.23.1, ethers 6.17.0, `@polkadot/api` 16.5.6, `@noble/hashes` 2.4.0, recorded in `protocol.versions`.

## What this run supports, and what it does not

- Two independent implementations of the five checks agree on all five scenarios at identical checkpoints, including the three refusals and the unavailable case. This is evidence that ReviveCheck's decision matches a careful script's on these cases, not that it catches anything the script would miss: in this benchmark the script was written to perform the same checks.
- ReviveCheck's artifact lets a reader reconstruct one more required item (the next action) and four more supporting items than the baseline's. Whether that matters was not tested with people.
- No speed claim. N = 1 per scenario, author-run scripts, public-node latency dominating, and a slower ReviveCheck result in one of two live pairs.
- No human effort, error rate, assistance or correction was measured, because no human took part. The zeros above are properties of a scripted run.
- No adoption, no external maintainer, no willingness-to-pay evidence. Owner, reviewer and operator are project-controlled accounts on a testnet.
- The deterministic C1 comparison takes the asset's chain values from the stored report's raw evidence for both arms, because no separate asset read was captured; the live baseline re-reads them and ReviveCheck does not.
- The baseline is the author's model of a maintainer's script. A pilot participant's actual process is the real baseline; see `docs/PILOT_PROTOCOL.md`.

## Reproduce the 2026-10-25 comparison

```sh
# Deterministic: both arms on the captured inputs, no network, writes new result and artifact files
node examples/token-catalog/benchmark/run-fair-benchmark.mjs --mode deterministic \
  --out examples/token-catalog/benchmark/results-fair-$(date -u +%Y%m%dT%H%M%SZ).json \
  --artifacts examples/token-catalog/benchmark/artifacts/fair-$(date -u +%Y%m%dT%H%M%SZ)

# Live as well (about 20 to 60 s per arm on the public nodes); the unavailable scenario injects an outage
node examples/token-catalog/benchmark/run-fair-benchmark.mjs --mode both \
  --out examples/token-catalog/benchmark/results-fair-$(date -u +%Y%m%dT%H%M%SZ).json \
  --artifacts examples/token-catalog/benchmark/artifacts/fair-$(date -u +%Y%m%dT%H%M%SZ)

# The second-reviewer test on one artifact
node examples/token-catalog/benchmark/reconstruct-decision.mjs examples/token-catalog/benchmark/artifacts/fair-2026-10-25/live/correct-entry.revivecheck.json
```

The scripts load no wallet and sign nothing. Use new output names so the retained 2026-10-25 files stay as the dated record.

---

## Historical: the 2026-10-24 scripted run (numbers unchanged)

Internal exploratory run by the project author on 2026-10-24 against the public Portaldot V3 testnet nodes (review finding F-10). Both paths were executed as code. One models the raw operations a maintainer might otherwise assemble; the other invokes ReviveCheck's documented commands. The run records their outputs and script timings. It does not measure a person's work, saved time, error rate, external adoption or willingness to pay. The paths did not perform identical verification and ran at different checkpoints, which is what the 2026-10-25 comparison above corrects.

Script and original results: `examples/token-catalog/benchmark/run-benchmark.mjs`, `examples/token-catalog/benchmark/results-2026-10-24.json`. The original JSON is retained unchanged, including its historical `manual`, `operatorSteps`, `interventions` and `recordOfDecision` labels. Those labels describe the author's task model, not observed human behavior. The raw baseline outputs and its computed decision are present in that JSON.

### The task

A maintainer of a Portaldot V3 token list decides whether pUSD, native asset 7777, may be enabled in the catalog with the entry `{ chainId 420420777, 0x00001e61...10000, "pUSD", "Portaldot USD (test)", 6 decimals }`. The entry may be enabled only if the chain agrees with it through both interfaces, the `pusd-token-list` release holding the sealed report is approved by the reviewer the maintainer trusts, the VerifiedTokenList lists the token on that approval, the report is stored on-chain and still verifies, and the report is recent and taken on the current runtime.

### Setup

| | |
| --- | --- |
| Network | V3 testnet, `wss://test-node-v3.portaldot.dev` and `https://test-evm-rpc-v3.portaldot.dev`, runtime portaldot-v3/3002 |
| Checkpoint | finalized block #176665 for the raw-read baseline; the ReviveCheck commands pinned #176667 and #176662 |
| Roles | owner, reviewer and operator are the project's isolated test account; the trusted reviewer in the policy is that account |
| Raw-read baseline (`manual` in the original JSON) | a programmed sequence of JSON-RPC and polkadot-js reads, derivations and comparisons using one reused node connection; its 12 task steps are annotated with the knowledge the author expects a maintainer would need |
| ReviveCheck path | `npm run rc -- check_release --release v1.0.1`, then `node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet.json`; separate processes open their own node connections |

The paths do not perform identical verification. The raw-read baseline assembles selected asset, registry, listing and stored-report reads. The ReviveCheck path also applies its report and policy verification, producing an acceptance evaluation with 24 checks. They run at different checkpoints and have different connection setup. Their timings are observations of these scripts, not a controlled performance comparison.

### Results

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

### Costs recorded on 2026-10-24

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
| Estimate (pending at the time) | VerifiedTokenList v2 deployment | 225.738 deposit plus a twice-fee reserve of about 0.632; about 147.578 more tPOT than then available (the deployment has since been made at #177354) |
| On-chain read fee | `check_release`, `read_registry`, `token_list_status`, `evaluate_policy`, catalog `build` and `acceptance` | 0 |

Neither read-only path pays an on-chain transaction fee. This says nothing about a provider's hosting charges or an operator's labor. A release's submit, review and listing cost about 0.07 tPOT in transaction fees plus held deposits in the recorded examples; storing a report adds about 0.75 tPOT. An acceptance read does not itself perform or pay for those writes.

### What the 2026-10-24 run supports

- **Documented task packaging.** The author modeled 12 raw operations and exposed the application task through two configured commands. This is an interface description, not a measured reduction from 12 observed human interventions to zero.
- **Inspectable decision artifacts.** Both scripted paths retain results. ReviveCheck additionally emits its standard sealed report and policy acceptance artifacts, including reasons and captured inputs that a second person can inspect.
- **An executed refusal case.** ReviveCheck rejected the incorrect decimals and returned the observed value and remediation. A comparative usability or reliability benefit still needs paired tests with equivalent checks and actual maintainers.
- **No speedup claim.** The 9.95 s and 36.19 s totals use different coverage, connection setup and checkpoints. They establish neither a tool speedup nor a human-time saving. Reducing a connection handshake would require a separate measurement before reporting an improvement.

Limitations: one task, one run, the project author, one test account in all roles, different verification coverage and public-node latency. No human baseline or paid-customer test was conducted. The first external validation remains a maintainer who did not build ReviveCheck bringing their own token and reviewer. Saved time, adoption and paying demand remain hypotheses; F-10 is not fully closed by this scripted run.

### Reproduce the 2026-10-24 run

Use a unique output name so the original result is preserved:

```sh
node examples/token-catalog/benchmark/run-benchmark.mjs --out examples/token-catalog/benchmark/results-$(date -u +%Y%m%dT%H%M%SZ).json
```

The script performs read-only chain calls, loads no wallet and signs nothing. It writes new local benchmark outputs and the reports produced by the invoked commands. Retain the original `results-2026-10-24.json` as the dated experiment; a rerun does not change what the original run proved.
