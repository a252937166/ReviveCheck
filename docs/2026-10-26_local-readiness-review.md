# Local readiness review: October 26, 2026

Reviewed implementation: main `85845b0ffc082bc77848030899e6d2ad95b29c1b`; independent consumer `e0158dc`. This review inspected code, reran tests and production builds, exercised the three existing browser journeys, and reproduced additional boundary cases. It made no application-code changes, signed no transaction and performed no publication.

## Decision

The product-gap plan has substantial working implementations. The original own-plan dispatch error and stale passing-report fallback are repaired. Catalog generation, a separate reader, a packaged starter, policy extensions and evidence health are real features.

The release still needs a bounded correctness pass. Seven issue groups below prevent treating all local work as complete. Public delivery D-07 also remains unfinished. These findings concern the already agreed workflow; they do not require a broader product redesign, external human adoption or additional presentation work.

## Verification completed

| Check | Current result | Boundary |
| --- | --- | --- |
| Main tests | 232 passed, zero failed | Existing automated coverage |
| Consumer tests | 19 passed, zero failed | Existing automated coverage |
| Main and consumer production builds | Both passed with Node 22.23.1 | Bundle generation; size warnings remain nonblocking |
| Studio browser journey | Passed, 20 assertions | Legacy migration, report replacement, failed-check locks and reload |
| Projects browser journey | Passed, 14 assertions in this run | Two project configurations, existing recorded receipts, binding, live evaluation and consumer-config validation |
| Consumer browser journey | Passed, 11 assertions | Wrong entry, correction, live evaluation, release generation and separate readback |
| Release-status command | `ok`, 13 integrity checks, five of six recorded evidence levels | Recorded lifecycle integrity; not comprehensive product correctness or public hosting |
| Historical report compatibility | All 14 public hashed report JSONs intact and unchanged since `be2b944` | Original sealed evidence and baseline remain preserved |

The passing journeys do not cover the additional transitions below.

## R-01: align the consumer package with the fresh-subject policy

**Priority: P1.** Consumer `package.json:33` still installs `vendor/revivecheck-0.5.0.tgz`. Main 0.5.1 supports `evidence.requireFreshSubject`; the installed 0.5.0 normalizer silently drops it.

Reproduction used identical report and captured inputs, with `requireFreshSubject: true`:

| Case | Main 0.5.1 | Installed consumer 0.5.0 |
| --- | --- | --- |
| Normalized policy | Includes the requirement; fingerprint changes | Requirement absent; old fingerprint retained |
| Subject observation missing | `unknown`, `subject-unavailable` | `valid` |
| Current decimals 18, approved decimals 6 | `recheck-required`, `subject-changed` | `valid` |

This affects a new fresh-subject configuration passed to the older consumer. Historical policies without that requirement retain their earlier, narrower guarantees.

**Repair:** vendor 0.5.1, update dependency and lockfile, then verify a clean install. Conditionally include subject failures in retry diagnostics and subject observations in exported input records (`consumer/src/evaluate.js:12,108`). Future required capabilities must be rejected explicitly by implementations that cannot support them.

**Acceptance:** installed-package and main-source normalization produce the same policy fingerprint; missing or changed subject observations cannot pass the new policy; a consumer decision retains enough subject evidence to reconstruct with the matching implementation. Historical policies and bindings retain their fingerprints.

## R-02: update current release content when adopting a corrected report

**Priority: P1.** `src/studio-store.js:39-46` reuses an existing project without replacing its plan or release-artifact fingerprint. Project IDs use the acceptance-plan fingerprint, which deliberately stays stable across listing-content edits.

**Reproduction:** adopt an 18-decimal own plan, then adopt its corrected 6-decimal plan with the same project name/release line. The project ID remains the same, the active report says 6, but `project.plan` still says 18 and its artifact fingerprint remains the old one. `Try.jsx:84` checks that old plan again, and `entryFor(project)` exports the old entry.

**Repair:** update the current plan and its fingerprints during adoption. Preserve policy declarations, roles, historical reports and bindings, while making the active release content explicit. Earlier bindings remain history and require the normal explicit replacement process.

**Acceptance:** failed 18 -> corrected 6 -> adopt -> Studio check/recheck -> consumer export consistently uses 6. Historical evidence still records 18.

## R-03: preserve project identity through a fresh-browser bundle round trip

**Priority: P1.** `src/Projects.jsx:257-260` imports the sealed report but drops the exported submission/storage context. `src/projects.js:126-135` reconstructs the policy owner exclusively from the session submission.

**Reproduction:** export an established bound project, import through the actual browser-import logic into an empty session, and confirm reviewer trust. The reconstructed policy loses its owner. The original binding remains intact, but consumer export throws: `The latest binding was made under another policy; bind again under the current one.`

The existing round-trip test in `test/projects.test.js:134-135` reuses the original session, masking the failure.

**Repair:** retain validated declared registry identity, storage locator and binding references across import. Mark them as imported declarations and verify their chain state during evaluation. Reviewer confirmation must remain explicit; importing a receipt does not make it freshly verified.

**Acceptance:** export -> empty-browser import -> reviewer confirmation preserves the policy hash and existing binding, permits configuration export and proceeds to fresh evaluation without resubmitting or signing.

## R-04: prevent catalog release files from being overwritten

**Priority: P1.** `scripts/catalog-release.js:31,95-96` writes release files with ordinary `writeFile`. Without `--previous`, each successful preparation creates version 1.

**Reproduction:** two permitted preparations one minute apart, using the same output directory and no predecessor, both exit zero and write `catalog-release-1.json`. The second changes the release hash, overwrites the first file and retains no predecessor.

**Repair:** use exclusive creation for immutable release files; refuse collisions or require a verified predecessor. Hash-named immutable artifacts are another valid approach. Keep mutable outcome snapshots separate and ensure a collision cannot produce an outcome claiming that a new artifact was successfully retained.

**Acceptance:** repeated preparation, repeated predecessor use and concurrent writers cannot modify an existing release. The next explicit version references the previous hash and both versions remain readable.

## R-05: scope asynchronous results to their originating project and request

**Priority: P2.** `src/Try.jsx:44-55` applies a resolved callback to whichever project is current. The project selector remains usable during a check. `CheckStep.start` invokes that callback after awaiting the result (`src/Try.jsx:216-220`).

**Confirmed flow:** start A's check -> switch to B -> A resolves -> A's result replaces B's active report and is noted under B. A bounded reducer reproduction yielded a Beta session whose active report still named the demo project. The new reducer fixes report replacement within a session but does not provide this project/request boundary.

**Repair:** capture project identity and request generation. Route a result to its originating session or ignore a superseded read. Finalized write receipts must remain attached to their originating project even if the user navigates elsewhere.

**Acceptance:** A resolving after switching to B cannot change B. Two checks resolving in reverse order cannot make an older request the active result.

## R-06: recompute imported catalog eligibility as time advances

**Priority: P2.** Consumer `web/App.jsx:239-240` calculates a catalog read once during file import. `LoadedRelease` at line 114 consumes that cached result; the call at line 316 passes no current clock.

**Browser reproduction:** load the retained release before its `2026-10-25T19:05:17.293Z` deadline under a controlled browser clock. Advance to after 19:11 UTC. The reader still says `At least one entry may be used now` and marks pUSD `selectable`, despite the parent clock interval having run. This is incorrect current eligibility in the imported-reader UI; no chain write was demonstrated.

**Repair:** retain the file and derive `readCatalogRelease(loaded.release, { now })` during rendering. Include deadline and visibility changes in the loaded-reader lifecycle.

**Acceptance:** import just before expiry, cross the deadline and restore a suspended tab. Every case updates the imported entry to unavailable without another import.

## R-07: make renewal status reflect verified policy evidence

**Priority: P2.** `lib/health.js:104-113` derives completed renewal stages mainly from report/revision tuples. A reproduction marked submit, approve, bind and list done with stale observations, disagreeing interfaces and incorrect registry/list/token/release domains. The actual eligibility evaluator still refuses those inputs; this issue concerns renewal advice and resumability claims.

`successorReports` at line 27 also admits a same-plan/same-address report from another network or scope. `evidenceHealth` at lines 38-49 omits subject evidence, so a required but unavailable subject observation is not represented in its health warnings.

**Repair:** validate successor network, scope, runtime, subject, age and semantics. Reuse the appropriate domain, identity, freshness and interface predicates before marking a stage complete. Propagate optional required subject observations through health, CLI and UI. Unverified state remains unknown/pending.

**Acceptance:** wrong-target, stale, disagreeing or missing evidence never completes a renewal stage; a wrong-network successor is rejected; fresh-subject policies expose subject availability and expiry. Actual writes retain the existing explicit signature, budget and pending-send guards.

## Public delivery and operating schedule

Read-only verification found both remote main and the remote redesign branch still at `455cc60692980d1297285c496634e03dd4d9c3e2`. The consumer has no remote. The public site's `hosting.json` returns HTTP 200 with `text/html` and the SPA shell, not a hosting manifest; its release-status document remains the earlier record. D-07 is therefore prepared, not delivered.

After the correctness repairs, publish and deploy verified increments through the existing custom-domain/DogYun process, then run the same journeys against public URLs. This review grants no new publication or signing action.

The November 1, 2026, 04:29 EST report expiry is now disclosed. A November 3/4 renewal still implies an intentional denial period. Renew before expiry if continuous public availability is the chosen operating goal; disclosure alone does not remove the gap.

## Smallest next implementation batch

1. Repair R-01 to R-04 and add their boundary regressions.
2. Repair project/request fencing, loaded-reader expiry and renewal evidence checks.
3. Rerun tests, clean-installed package conformance, builds and expanded browser journeys.
4. Deliver the verified applications and source publicly with parsed manifests and public readback.

The remaining work is closure of existing promises: correct your release, carry the exact identity across projects and processes, retain immutable outputs, and grant permission only while the required evidence supports it.
