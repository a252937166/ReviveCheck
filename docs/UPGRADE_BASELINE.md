# Current baseline and read-only upgrade recheck

ReviveCheck retains one exact live report as a **current observed testnet baseline**. It is not a guaranteed pre-upgrade snapshot. A mainnet launch announcement does not establish that the V3 testnet changed, that test tokens arrived, or that competition requirements changed.

## Retained evidence

| Field | Recorded value |
| --- | --- |
| Baseline manifest | [current-2026-10-23.json](../public/baselines/current-2026-10-23.json) |
| Original report | [027267…dc0d5.json](../public/reports/0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5.json) |
| Report SHA-256 | `0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5` |
| Observed at | `2026-10-23T08:17:25.008Z` / Unix epoch **1792743445008 milliseconds** |
| Finalized height | **157790**, with distinct native/EVM hashes recorded in the report |
| Runtime | `portaldot-v3`, spec **3002**, transaction version **2**, state version **1** |
| Plan | Existing public native asset **7777/pUSD**, holder selected from the asset owner |
| Plan hash | `cea204c3baed44623d942252664b0617d7d07cd88dacb6a8bacd9a1b947f31e2` |
| Environment hash | `585d0c8da2b0137796aea6acd09e814d8d2b970f5ec3bba917f9a010fa2c48d0` |
| Result | **3/3 passed**: testnet identity, finalized cross-interface checkpoint, native/ERC-20 read parity |

The sealed report was verified and copied byte-for-byte from the retained local observation. No label, role, or baseline metadata was inserted into it. The separate manifest binds its report/plan/environment hashes, checkpoint, observation time, and intended static report/viewer URLs, with its own canonical fingerprint. It uses `chronology:"current-observed-baseline"`. The report index retains the older `15baa9…` reference and marks this separate entry `role:"upgrade-baseline"`.

The static paths are prepared publication artifacts; preparing them does not itself prove that a newly published copy can be fetched. Hash integrity detects changed content. It does not authenticate RPC truth, the observer, or ownership. This external asset is not our deployment, state write, customer, or independent adoption.

## Check for actual environment drift

From the repository root:

```sh
node scripts/check-upgrade.js
```

The default manifest is `public/baselines/current-2026-10-23.json`. The command verifies the manifest and original report before connecting to the pinned V3 **testnet**. It does not read a wallet or contact mainnet, Discord, GitHub publishing, or a local workspace server.

The lightweight observation reads only:

1. EVM chain ID plus the native genesis and runtime chain ID, checked against the existing pins.
2. The native finalized head/header and its corresponding Ethereum block through `ReviveApi.ethBlockHash`.
3. Runtime version at that native finalized hash, and constants from `api.at(finalizedHash)`.

The runtime version and constants must be available at the checkpoint; head metadata is not a fallback. A complete parameter snapshot is required. The environment hash is canonical SHA-256 over the same identity, spec/transaction/state versions and constants fingerprint used by saved reports. Block height/hashes and application bytecode are excluded: normal block progress or changed application code alone does not establish a runtime upgrade.

If the environment matches, the command returns one compact JSON status with `status:"unchanged"` and `quiet:true`, exits 0, and creates no acceptance run or artifact. It does not reread account balances, contracts, or the public asset. **Unchanged environment is not a fresh application-health or funding check.**

If a supported identity remains pinned but a spec/version/constants value changes, the command runs the original acceptance plan once, seals a new report, and calls the existing comparison mechanism. It retains the original report and plan, sets `previousRunId` to the baseline run, and starts the new report with no reviews or shares. Runtime differences carry a context caveat and receive no repair credit. A future unsupported asset adapter may remain blocked; the script does not claim upgrade acceptance merely because it created a report.

Both chain ID and genesis are identity boundaries. Unexpected values stop with `identity-mismatch` and require manual review; no acceptance call, automatic repinning, baseline replacement, or chain transaction follows. Missing evidence, mismatched checkpoints, timeouts, or drift that the full check cannot reconfirm also cannot be called unchanged or successful.

## Outputs for a follow-up runner

```sh
node scripts/check-upgrade.js \
  --baseline public/baselines/current-2026-10-23.json \
  --out-dir artifacts/local/upgrade-checks \
  --timeout-ms 45000
```

`--report <original-report.json>` optionally supplies the original report separately. The timeout must be 1,000–60,000 ms; the default whole workflow deadline is 45,000 ms, with a 25,000 ms lightweight connection/read limit. Local disconnect cleanup is additionally bounded.

| Status | Exit | Runner interpretation |
| --- | --- | --- |
| `unchanged` | 0 | Quiet; no domain acceptance run or file was created |
| `environment-changed` | 0 if the new report passed, otherwise 2 | Actual drift was reconfirmed; inspect the new report and comparison, not just the exit code |
| `recheck-incomplete` | 2 | Drift was seen but full acceptance could not complete/reconfirm it; manual review |
| `identity-mismatch` | 3 | Stop for manual network review; never change the pins automatically |
| `unavailable` / `error` | 1 | Readiness or local input was insufficient; no unchanged/success claim |

JSON includes `baselineReportHash`, baseline/observed environment hashes, `changes`, `quiet`, and explicit `signing:false`, `publishing:false`, `baselineReplaced:false`. When a new run exists, the summary also includes its hash, aggregate status, unreviewed state, comparison kind and caveat. Drift outcomes save local `.report.json`, `.comparison.json`, and `.result.json` files as available. Files use unique names and exclusive creation; original evidence is never overwritten. These files are not automatically imported into a workspace or published.

For a recurring follow-up, retain the last observed environment hash separately and suppress repeated notifications/rechecks for the same already-handled drift. The immutable baseline stays fixed. This one-shot CLI compares with that baseline each time; it does not secretly advance it or manage a scheduler. Choosing a new baseline is a separate explicit action. Funding observation and any authorized signed execution remain separate workflows.

Programmatic callers can import `observeEnvironment`, `observeEnvironmentWithClients`, `createBaseline`, `verifyBaseline`, and `checkUpgrade` from `lib/baseline.js`. `checkUpgrade(manifest, report, {observe, inspect, signal, now, newId})` allows fixture clients and returns the complete new report/comparison when needed. Review state is computed with empty receipt/share lists and cannot inherit a baseline approval.

## Validation boundary

```sh
node --test test/baseline.test.js
```

The nine focused tests passed with injected clients: exact retained report/manifest, finalized-only runtime/constants, unchanged-block progress, actual runtime/constants drift, manual identity stop, incomplete readiness, unconfirmed transient drift, bounded cancellation, and CLI argument handling. No live network call, real wallet, transaction, publication, or automation change was performed by these tests. The current report's live observations remain the retained evidence, rather than a claim that this fixture suite observed a later upgrade.

## Repeated observations

After a changed environment has a saved sealed recheck and comparison, pass its full `*.result.json` using `--previous-result`. The script verifies the same original baseline, plan, sealed report and comparison before returning `already-rechecked` without another run for that environment. Keep the original baseline manifest unchanged. An incomplete recheck stays incomplete and requires deliberate `--force` revalidation after the cause is addressed; a changed current checkpoint alone is not a reason to force. Invalid or modified prior results are rejected.
