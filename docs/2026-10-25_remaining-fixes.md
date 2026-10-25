# Remaining issues and repair specification

Reviewed implementation: ReviveCheck `74dd1e0`, separate consumer `b96eedd`. The relevant source files were reread before preparing this specification. Publication observations below refer to the preceding live review; recheck remote and hosting state before releasing anything.

The main workflow is implemented: the consumer has a browser interface, performs real read-only evaluation, opens the exact report in ReviveCheck, exports decision evidence and derives selectable tokens from its own evaluator output. The remaining work consists of two validation gaps and public-delivery tasks. These fixes do not require a new contract deployment.

## 1. P1: current permission outlives its supporting evidence

### Affected code and impact

- `lib/current.js:65-73`: `ageDecision` ages only `evaluation.evaluatedAt`; `canAct` trusts the resulting stale flag.
- `src/Catalog.jsx:144-147`: the Catalog invokes this helper every fifteen seconds and when visibility changes.
- Consumer `web/App.jsx:95-98` and `src/selector.js:11-24`: the same packaged helper controls token availability.

The remaining lifetime of a report or observation can be much shorter than the policy's full freshness interval. Treating a new evaluation as the beginning of another complete interval extends permission incorrectly.

The preceding offline review used the real fixture's report and policy with synthetic clock/observation timestamps:

| Scenario | Initial result | Two seconds later |
| --- | --- | --- |
| Evaluate one second before report expiry | Valid; action allowed | `ageDecision` still permits the action, but `evaluateBinding` returns expired |
| Evaluate required observations already 899 seconds old under a 900-second limit | Valid; action allowed | `ageDecision` still permits the action, but `evaluateBinding` returns unknown with stale-observation reasons |

The practical extension can approach another 900 seconds. Increasing the timer frequency does not correct the wrong deadline.

### Required implementation

Derive the deadline from the original report and observations under the normalized policy:

```text
reportDeadline      = report.completedAt + maxAgeSeconds
networkDeadline     = observation.observedAt + maxObservationAgeSeconds
registryDeadline    = registry.observedAt + maxObservationAgeSeconds
listingDeadline     = listing.observedAt + maxObservationAgeSeconds

validUntil = minimum of all required deadlines
```

Include the listing deadline when the policy requires a listed consumer entry. Network and registry timestamps are required by the current evaluator. Missing or invalid required timestamps must remove permission rather than defaulting to the evaluation time.

Store the derived deadline beside the current decision with the relevant report, policy and retained inputs. Do not append fields to an existing hashed evaluation or rewrite a sealed report. Alternatively, rerun the deterministic evaluator against retained inputs and the current clock; distinguish this from obtaining fresh chain reads.

Enforce validity in both presentation and the action path. The selector and the `Continue` handler must check the current clock before proceeding; a timer-updated boolean alone is insufficient. Recheck after tab suspension or visibility changes. Preserve the last verified result as historical information without allowing it to authorize the current action.

Match the evaluator's existing boundary: an age equal to its limit is accepted; an age beyond it is rejected. Test the exact deadline and one millisecond afterward. The sixty-second tolerance for future timestamps is not an additional expiry grace period.

Keep report expiry and stale observations distinguishable in explanations. Do not imply that this deadline check detects a new on-chain revocation immediately: chain-state changes still require fresh reads.

### Acceptance tests

1. A valid result evaluated one second before report expiry stops authorizing immediately after the report's deadline.
2. An observation already 899 seconds old has only one second of remaining validity under a 900-second policy.
3. Differently dated network, registry and required listing observations use the earliest deadline.
4. Invalid or absent required timestamps never produce current permission.
5. Exact-deadline behavior agrees with `evaluateBinding`; deadline plus one millisecond is denied.
6. A background tab and an action occurring between UI timer ticks cannot use expired permission.
7. Existing request fencing, selection changes, refresh failures and historical-result separation continue to work.

### Distribution follow-through

The consumer imports a vendored package, not the live source checkout. After fixing the library, create a new immutable package artifact/version, verify it, update the consumer's dependency and checksum, regenerate its lockfile and reinstall it. Preserve the original 0.4.0 artifact and verification record as history. Run both test suites and browser production builds against the corrected artifact.

## 2. P2: missing consumer version is accepted as a matching identity

### Affected code and impact

`src/receipts.js:49-53` rejects a differing `identity.version` only when the field is present. `null` or `undefined` skips version comparison and can leave the readback classified as matching v2.

The preceding offline reproduction started with a valid listing fixture and a matching synthetic successful receipt. Both `identity.version = null` and an omitted version returned `matched: true`.

This is a narrower persisted-state validation gap. The previous wrong-operation and failed-transaction issues were corrected; it is not evidence that recorded on-chain transactions are false.

### Required implementation

Require an explicitly known version that matches the receipt's expected consumer version. Normalize only supported representations: a positive safe integer or a canonical decimal string such as `2` or `"2"`. Reject missing, null, empty, boolean, nonnumeric, fractional, nonpositive and unsafe values. Avoid permissive `Number()` coercion as the only validation.

Keep consumer address, version, interface agreement and checkpoint provenance as separate required checks. Missing version evidence must return a clear mismatch reason and must not yield a verified Listed completion. Retain the original receipt as historical evidence.

If a legacy v1 path establishes identity explicitly through verified code, keep that path separately identified. Do not use missing v2 version data to infer v2 identity or broaden compatibility.

### Acceptance tests

- Expected version `2` accepts the supported representations `2` and `"2"`.
- Missing, null, empty, boolean, malformed, fractional, nonpositive and unsafe values fail.
- A known different version fails.
- Existing wrong-address, wrong-token, wrong-report, failed-transaction and checkpoint regressions stay green.
- Unknown identity never shows the current operation as successfully verified Listed.

## 3. P1: local completion has not reached the public release

### Observed publication gap

At the preceding live review:

- Local ReviveCheck was `74dd1e0`, while GitHub main and the development branch were still at `455cc60`.
- The public website still served the older release.
- `/hosting.json` returned the SPA HTML with HTTP 200 rather than a JSON hosting manifest.
- The independent consumer had no remote or public URL; its Source links named an unpublished destination.
- The current YouTube video and DoraHacks Build description still represented the earlier release.

The new twelve-page PDF deck exists locally. Its presence does not establish that the deck is publicly available or connected to the submission.

### Required release procedure

1. Finish the two validation fixes and run the relevant tests/builds.
2. Publish the reviewed source commits and the separate consumer repository. Replace placeholder clone instructions and ensure every Source/CI link names an existing public destination.
3. Deploy the main application and consumer through the existing custom-domain and DogYun infrastructure. The new GitHub Pages workflow is not the intended production destination under the user's deployment preference.
4. Build each site from its recorded source commit, retain hashes and a hosting manifest, verify the uploaded bytes, and activate the release with the existing rollback procedure.
5. Serve `/hosting.json` as an actual JSON document identifying the hosted build. Verify its parsed schema, source commit and release ID; HTTP 200 alone is insufficient because the SPA fallback can return HTML.
6. Open both sites in a clean logged-out browser. Complete the wrong-entry refusal, exact-report inspection, corrected-entry refresh and token selection without login, visitor approval or wallet connection.
7. Publish the new video and deck, update the existing DoraHacks Build and current links, and verify anonymous access and playback.

Keep evidence status distinct from hosting provenance. Preserve historical releases, reports, videos and transaction receipts. Release execution must reconcile the actual current remote/server state; the observations above are not a reason to overwrite newer work.

### Acceptance criteria

The public source, hosted main application, hosted consumer, manifest, video, deck and Build description all identify the demonstrated release. Both applications are directly usable by anyone opening the URL. Correctness tests run on public CI, and the integration can be reproduced without the author's private checkout.

## 4. Final-delivery evidence renewal

The current bound report expires under the existing seven-day policy at `2026-11-01T09:29:17.646Z`, or **November 1, 2026, 04:29:17.646 EST in New York**. The renewal runbook exists, but that does not establish a completed renewal.

If fresh final-delivery evidence is needed, use one coordinated signer session and the existing contracts: check, retain/store the new report where required, submit its exact hash as a new revision, obtain the trusted review, explicitly rebind, and perform required relisting and dual-interface readback. Preserve the previous lifecycle. A fresh registry read does not renew the sealed report, and a new report never inherits an old approval.

Do not widen the policy's lifetime merely to keep a green result. Retain actual receipts and readback for any writes, and reconcile journals before sending. No renewal or new transaction was performed in preparing this specification.

## 5. Useful improvement remaining outside the immediate bug fixes

A public generic **Check my token** or acceptance-plan import is still incomplete. Preserving `listing` in local form serialization fixes the data-loss bug, but it does not create a public custom-input workflow.

For stronger general-purpose value, expose a small form or validated JSON import for the currently supported native-asset profile, show the effective plan, preserve its fingerprint through export/import, and pass it to the existing checker. Keep runtime and adapter limits explicit. Changed inputs produce a new report and require their own approval when used in a bound release.

This is a useful product enhancement, not a reason to describe the existing pUSD consumer interface as unimplemented. The agreed reference integration is sufficient for its focused recording once correctness and public delivery are complete.

## Recommended order

Fix time-based authorization, tighten version validation, repack and update the consumer, verify both applications, publish source and custom-domain deployments, then record and synchronize the final materials. Add the generic supported-input workflow if the remaining schedule permits a complete implementation and verification.

The last completed review passed 190 main-project tests and 15 consumer tests; both builds passed with the installed arm64 Node 22 runtime. These counts describe that reviewed version and do not replace the new boundary regressions required above.
