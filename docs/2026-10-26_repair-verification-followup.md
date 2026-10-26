# Follow-up verification of the seven repairs

Reviewed October 26, 2026. Main implementation: `9f68e07`. Consumer: working-tree repairs based on `e0158dc`, installing artifact 0.5.2. This is a read-only product review; only this follow-up document was added. Existing Claude processes, files and browser sessions were left untouched.

## Result

Four issue groups are repaired locally. Three are partially repaired with bounded remaining defects. The separate consumer's complete browser acceptance and final records are not yet finished.

| Issue | Result | Current evidence |
| --- | --- | --- |
| R-01 package capability parity | Closed locally | Installed 0.5.2 preserves fresh-subject policy requirements; missing/changed reads deny; exported subject evidence reconstructs |
| R-02 corrected-plan adoption | Closed locally | Current plan/artifact update together, history survives; corrected-plan browser journey passed |
| R-03 fresh-browser import | Closed for the reported blocker | Imported declarations preserve policy identity; fresh-context browser journey passed |
| R-04 immutable publication | Partial | Overwriting and partial-file exposure repaired; local predecessor consistency still missing |
| R-05 asynchronous isolation | Partial | In-mount project switching repaired; full Studio unmount/remount can revive an older read |
| R-06 imported-reader expiry | Closed locally | Document/clock derivation repaired; independent browser probe confirmed eligible -> expired after clock jump and visibility event |
| R-07 renewal evidence | Partial | Original domain/freshness failures mostly repaired; missing decision, consumer identity and network-read cases still permit incorrect stage/readiness claims |

The main suite was rerun: **249 passed, zero failed**. The consumer suite was rerun: **24 passed, zero failed**. Builds were not rerun during this review because another session was actively using served build files for browser acceptance.

The 0.5.2 verification artifact and vendored tarball have identical SHA-256:

```text
86608c21093e4857f9d5bbacd615fc821f9d39f63ceb3248dd654fd8caf68dcb
```

The verification record reports 55 files, 204 installed packages, successful starter permitted/refused/read cases and no findings. This establishes package verification, not closure of all application transitions.

## Remaining R-04: match the supplied predecessor to the retained local line

Evidence: `scripts/catalog-release.js:114-118,143-147`.

The no-predecessor path checks existing output, but the explicit-predecessor path checks only the supplied document's integrity. A valid document from another output line can silently fork the directory's retained versions.

Verified reproduction in temporary directories:

1. Prepare `A/catalog-release-1.json`.
2. Prepare a different valid `B/catalog-release-1.json` with the same configuration and another generation time.
3. Prepare into A using B's version 1 as `--previous`.

All commands exit zero. A's version 2 references B's hash, while A's own version 1 has another hash. `compareCatalogReleases(A_v1, A_v2).chained` is false. Each file remains intact; the original overwrite vulnerability is repaired.

**Repair:** when the output directory already retains the supplied predecessor's version, require the local verified hash to equal the supplied predecessor hash. Reject conflicts and ambiguous gaps, or provide an explicit, documented cross-directory continuation mode that preserves coherent lineage. Continue permitting legitimate changes to entries, reviewers and policies.

**Acceptance:** the reproduction refuses publication and leaves all retained bytes unchanged; A/v1 -> A/v2 links correctly; identical retries remain explicit and idempotent; a concurrent conflict cannot bypass the local-line check.

## Remaining R-05: invalidate old read ownership across Studio remounts

Evidence: `src/Try.jsx:47-58`; `src/Dashboard.jsx:295-298`.

Request generations live in a `useRef` owned by one Studio mount. Navigating to My projects unmounts Studio. Reopening creates a new fence, while the old callback retains its original fence and still considers its token current. Its route writes directly to persistent storage even after unmount.

Using the actual fence/store functions, a bounded two-mount reproduction recorded a newer report, then allowed the old token to overwrite it. The existing race journey switches projects inside one Studio mount and does not cover this case.

**Repair:** invalidate outstanding read tokens on unmount, or retain request ownership above the Studio mount and check it at settlement. Preserve the separate handling of finalized writes and transaction-specific readbacks: cancelling old reads must not discard a real receipt or cause a resend.

**Acceptance:** defer A -> leave Studio -> reopen -> complete newer B -> resolve A. B remains current in UI and persistent storage after reload. Repeat after resetting the new mount; the cleared session stays cleared. A finalized write arriving after navigation still belongs to its origin and is retained once.

## Remaining R-07: complete the renewal planner's unknown-state gates

Evidence: `lib/health.js:196-197,215,217,220-224`; `test/health.test.js:107`.

Three deterministic cases remain:

| Input | Current planner result | Required behavior |
| --- | --- | --- |
| Missing trusted reviewer decisions, `decisions: {}` | Approval pending; next action approve; no stop | Unknown approval state; distinguish unavailable evidence from verified lack of a decision |
| `listing.identity: null` | Listing done | Missing consumer identity cannot establish current listing validity |
| Wrong-network or unavailable observation | Read is labelled wrong-target/unavailable, but next action submit and no stop | Required current network uncertainty blocks actionable continuation |

The final eligibility evaluator retains stronger checks. These findings concern renewal advice and its readiness claims, not a demonstrated broadcast or contract bypass.

**Repair:** apply the relevant evaluator predicates to trusted reviewer evidence, consumer registry/version/checkpoint identity and required network observations. Include required observation readiness in the continuation stop calculation. Remove the test's exception that skips planner assertions for network observation failures.

**Acceptance:** each case produces explicit unknown/incorrect-target state and a stopped continuation, without suggesting duplicate submission or approval. A verified unreviewed decision remains distinguishable and may correctly identify approval as the next unperformed step. Historical finalized receipts remain visible even when current state is unknown.

## Browser acceptance is stalled, not merely waiting for testnet data

The existing consumer reader-expiry job had been running for approximately half an hour at observation. It was stopped inside the CLI command containing `page.clock.pauseAt`, `setSystemTime` and visibility-event dispatch (`test/browser/reader-expiry-journey.mjs:61`). Its earlier sequential assertions had passed to reach that point. The following release journey had not started because the two commands were sequenced.

The helper at line 28 uses `spawnSync` without a timeout. An unresolved CLI command therefore bypasses the surrounding polling timeout and prevents a final result file from being written.

An independent browser session on the existing served build successfully used one clock installation, file import, `setSystemTime` beyond expiry and a visibility event. The reader changed from `selectable` to `not selectable`, with a lapsed reason, while retaining its deadline-only disclosure. This supports the R-06 product repair; it is not a pass for the full author-run journey.

**Harness repair:** give CLI subprocesses a bounded timeout, write partial observations on failure and isolate clock scenarios in fresh contexts. Avoid depending on an indefinitely pending clock-pause operation. Recover only the owning test session; unrelated sessions must remain untouched.

**Closure:** rerun consumer expiry and release journeys to actual success/failure completion, then write onboarding/validation notes, the completion matrix and final commits. Record unfinished tests honestly instead of deriving success from the packed artifact. Public delivery remains a separate gate.
