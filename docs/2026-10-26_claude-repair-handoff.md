# Claude repair handoff: seven remaining correctness issues

Prepared October 26, 2026. Scope: complete the existing ReviveCheck workflow and its independent consumer. This is an implementation specification based on the [local readiness review](2026-10-26_local-readiness-review.md); it is not a claim that the repairs below have been implemented.

## Start from the reviewed implementation

| Component | Working directory | Reviewed commit |
| --- | --- | --- |
| Main project | `/Users/ouyangduning/Documents/project/interesting/dorahacks/portaldot-hacker-house-2026-redesign` | `85845b0ffc082bc77848030899e6d2ad95b29c1b` |
| Independent consumer | `/Users/ouyangduning/Documents/project/interesting/dorahacks/revivecheck-consumer-example` | `e0158dcf3671567ad5bd38a4fbaa18bb9a0b7a53` |

Check current HEADs and working-tree changes first. The older checkout at `/Users/ouyangduning/Documents/project/interesting/dorahacks/portaldot-hacker-house-2026` contains older implementation and unrelated dirty work; do not use it as the implementation base or reset it.

Prior verification at the reviewed commits passed 232 main tests, 19 consumer tests, both production builds and all three existing browser journeys. The seven findings below concern additional transitions those tests missed. The previous own-plan dispatch error and stale passing-report fallback are already repaired; preserve those fixes.

Priorities P1 and P2 express repair order and product impact, not a claim of a demonstrated on-chain exploit.

## Shared constraints

- Use English for all project-authored content, filenames, UI copy, comments and documentation.
- Preserve original sealed reports, report fingerprints, transaction hashes, deployment records and binding history. In particular, retain `public/baselines/current-2026-10-23.json` and its original report `0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5` without rewriting or selecting a different baseline.
- Keep historical policies without the new fresh-subject option hash-compatible. A stronger requirement creates a different policy; it must never be silently removed or silently added to historical approvals.
- Maintain open read-only access without visitor accounts, invitations, a wallet requirement or a visitor allowlist. Explicit reviewer trust and signing roles remain part of policy and transaction behavior.
- Keep imported declarations, historical receipts, freshly verified state and current permission distinct.
- These repairs can be developed and tested without new signed transactions. Use deterministic fixtures, deferred promises, browser clocks and read-only live checks. Do not use wallet secrets to demonstrate these bugs.
- Pending or uncertain transaction state is a stop condition. Never resend a transaction merely because its result could not be established.
- A self-built independent consumer is an accepted integration demonstration. An outside human pilot is additional evidence, not a prerequisite for completing these repairs.
- Keep this batch focused on product correctness. Public delivery remains a separate completion gate; video work is outside this handoff.

## R-01: prevent an installed consumer from dropping fresh-subject assurance

**Priority: P1.** Evidence: consumer `package.json:33`, `src/evaluate.js:12,108`; main `lib/policy.js`, `lib/service.js`, `lib/subject.js`, `lib/current.js` and `lib/decision.js`.

### Cause and reproduction

Main package 0.5.1 understands `evidence.requireFreshSubject`. The separate consumer still depends on `file:vendor/revivecheck-0.5.0.tgz`. That installed version normalizes the unknown option away, computes the older policy fingerprint and performs no subject read.

Use the existing v2 report and captured reads, changing only `policy.evidence.requireFreshSubject` to `true`. Compare the source implementation with the consumer's actually installed package:

| Input | Main 0.5.1 | Installed 0.5.0 |
| --- | --- | --- |
| Normalized fresh-subject policy | Retains the option; different fingerprint | Drops the option; original fingerprint |
| No subject observation | `unknown`, `subject-unavailable` | `valid` |
| Current decimals 18 versus approved 6 | `recheck-required`, `subject-changed` | `valid` |

The default historical consumer policy does not request fresh-subject verification. Its narrower documented guarantee remains valid; the defect appears when a new requirement is supplied to the older implementation.

### Repair

1. Pack the corrected main implementation under a coherent package version, at least 0.5.1. If subsequent library repairs change the package, use one final corrected artifact rather than shipping different bytes under the same artifact identity.
2. Update the consumer's vendored tarball, dependency declaration and lockfile. Verify the actual installed module and browser bundle, not just the package.json text. Remove the obsolete active dependency reference while retaining historical verification records.
3. When the policy requires subject observations, include `subject` in read-failure reporting and retry handling. A subject error may trigger a read retry, but must never remove the requirement or fall back to historical metadata.
4. Include required subject observations, provenance and checkpoints in the consumer's exported input/evidence records. They must participate in permission deadlines and decision reconstruction.
5. Add a compatibility check at the configuration or integration boundary so an implementation unable to support a required capability rejects it explicitly. A free-standing version string is weaker than demonstrating the capability. Preserve compatibility for legacy configurations without this option.

A minimal guard for this specific requirement compares the requested value with the normalized result: if the input requests `requireFreshSubject: true` and normalization does not retain `true`, reject the configuration before binding or evaluation. Test this guard against an adapter that simulates the older normalizer.

### Acceptance criteria

- **R01-A:** the corrected source and clean-installed consumer normalize the same policies to identical fingerprints.
- **R01-B:** absent and explicit-false options preserve the historical policy fingerprint; true changes it.
- **R01-C:** unchanged, supported, fresh subject observations can pass; missing, stale, disagreeing or wrong-target observations never pass.
- **R01-D:** changed asserted metadata yields the same refusal status and reasons in the source API, installed consumer and release gate.
- **R01-E:** exported evidence retains the subject read and reconstructs with the corrected package; the subject observation can be the earliest permission deadline.
- **R01-F:** browser and command-line builds resolve the same corrected artifact after a clean install. Tests must not import the main source tree as a substitute for testing the installed dependency.

## R-02: carry corrected release content into the existing project

**Priority: P1.** Evidence: `src/studio-store.js:37-46`, `src/projects.js:53-57,161-162`, `src/Try.jsx:83-85`.

### Cause and reproduction

An own-project ID includes the acceptance-plan fingerprint. That fingerprint deliberately remains stable when the listing content changes. Adopting a corrected report finds the existing project, but the existing-record branch updates only its timestamp. Its current `plan` and `releaseArtifactHash` remain old.

Adopt a failed 18-decimal plan, then adopt the corrected 6-decimal plan with the same project name and release line. The reproduced result is:

```text
sameProject: true
storedProjectDecimals: 18
activeReportDecimals: 6
storedArtifactStillOld: true
```

Studio subsequently rechecks the old plan; the consumer configuration exports the old entry.

### Repair

1. Treat report adoption as a current-release transition. Update the existing project's normalized plan, acceptance-plan fingerprint and release-artifact fingerprint from the adopted input.
2. Preserve stable project identity, declared reviewer trust, role descriptions, explicit release label, report references and binding history. Generate a new project only for a deliberate new-project action or a genuinely different project identity.
3. Validate that the adopted report describes the supplied plan and release artifact. Reject an inconsistent pair rather than making the project look internally coherent by relabelling evidence.
4. Archive earlier active report-bound state through the existing lifecycle model. Do not rewrite a historical binding to name the new report or transfer its approval to the new release.
5. Audit every downstream default: Studio check/recheck, submission label, entry derivation, bundle export and consumer-config export must resolve from the updated active project.

Do not require literal equality between the report's `projectId` and the browser-local project ID: the checker and browser project creation currently use different identity schemes. Validate the plan/report relationship using the relevant semantic identities.

### Acceptance criteria

- **R02-A:** 18 -> 6 -> adopt keeps the same project and makes its current plan, artifact fingerprint and active report consistently describe 6.
- **R02-B:** the next check/recheck receives the corrected plan. Use a checker spy or equivalent bounded observation, not only a UI label assertion.
- **R02-C:** exports contain the corrected entry; a valid export still requires a matching explicit binding and the normal review/evidence workflow.
- **R02-D:** original reports and bindings remain unchanged and inspectable as history. The corrected report inherits no approval, listing receipt or prepared transaction.
- **R02-E:** adopt the same report twice without duplicating its history; reload and continue with the corrected plan.
- **R02-F:** cover another release-content field, such as symbol, and reject a mismatched plan/report pair.

## R-03: make a project bundle usable in a fresh browser

**Priority: P1.** Evidence: `src/Projects.jsx:251-260`, `src/projects.js:123-138,170-202,211-241`; current round-trip test at `test/projects.test.js:134-135`.

### Cause and reproduction

The export carries submission, storage and policy information. The browser import restores the sealed report into a new session but discards the context needed to reconstruct that policy. `policyFor` derives the registry owner exclusively from a session submission. With no submission in the new session, the owner disappears and the policy fingerprint changes.

Export a fully bound project, clear both project/session stores or use a fresh browser context, import through the UI's real path, and confirm reviewer trust. Consumer export then throws:

```text
The latest binding was made under another policy; bind again under the current one.
```

The existing pure round-trip test reuses the original session, so it cannot detect this loss.

### Repair

1. Define durable project declarations for registry identity, declared owner, release identity, stored-report locator and binding references. Reconstruct them consistently after reload and import without depending on an unrelated browser session.
2. Validate the imported plan, fingerprints, policy, bindings and cross-field consistency. Preserve the declared semantics used by the existing binding's policy hash.
3. Keep imported reviewer trust unconfirmed until the visitor explicitly accepts it. Keep imported chain references marked as declarations or historical evidence until independently verified by reads.
4. Do not fabricate finalized transaction receipts, synthesize an approval or mark a storage operation freshly verified merely to satisfy current UI code.
5. Re-evaluate the imported binding against actual registry, listing, network, storage and required subject observations before granting permission. Missing or changed live state must withhold use.
6. If a bundle lacks information required to reconstruct its policy, show the exact missing field and a read-only recovery path. Never silently omit an owner restriction or create a weaker replacement policy.

### Acceptance criteria

- **R03-A:** export -> completely empty browser -> import -> reviewer confirmation preserves the effective policy fingerprint and intact existing binding.
- **R03-B:** configuration export works without the original local session, source edits, resubmission or new signatures.
- **R03-C:** the exported configuration passes the corrected consumer's loader and release-gate loader, and fresh evaluation reaches the correct current decision.
- **R03-D:** before reviewer confirmation, evaluation remains blocked with a clear trust-confirmation reason.
- **R03-E:** corrupted hashes and inconsistent owner/release/storage declarations fail explicitly. Even a structurally valid declaration cannot bypass missing or contradicting live chain evidence.
- **R03-F:** a stale or revoked imported release remains inspectable but unavailable. Importing into a browser with an existing same-ID project preserves that project and keeps the imported copy separate.
- **R03-G:** reload after import preserves these semantics. The browser regression must not seed the old submission session to make the test pass.
- **R03-H:** a references-only bundle without an embedded report preserves its declared references and exposes the missing evidence. It must never fabricate a report, stored payload or approval to complete the import.

## R-04: retain immutable catalog releases under repeat and concurrent execution

**Priority: P1.** Evidence: `scripts/catalog-release.js:31,75-96`; version selection in `lib/catalog-release.js`.

### Cause and reproduction

The release builder creates version 1 when no predecessor is supplied. The CLI writes `catalog-release-1.json` using ordinary `writeFile`, which truncates an existing file. Run two permitted preparations one minute apart with the same output directory and no `--previous`: both exit zero, and the second replaces the first release with different bytes and no predecessor.

Fixed-name `outcome.json` and `decision-evidence.json` introduce a related concurrency problem: guarding only the catalog file still lets the losing process overwrite the winning process's outcome or evidence.

### Repair

1. Choose a bounded publication rule: require an explicit verified predecessor for an existing release line, or use immutable hash-addressed files with an explicit version manifest. Clearly document the CLI behavior.
2. Publish complete release files atomically without replacing an existing destination. A plain existence check followed by a write has a race. `writeFile` with `wx` prevents replacement but may expose a partially written final file; ordinary rename is atomic but can replace the destination. One suitable local-filesystem approach is a fully written and closed same-filesystem temporary file published through an exclusive no-replace operation.
3. Validate a predecessor's full document integrity and embedded evidence before extending its version/hash. Reject a corrupt or incompatible predecessor and duplicate version claims.
4. Associate outcome, decision evidence and release with the same run identity and immutable references. Use per-run records or an explicitly coordinated manifest; mutable convenience files must not misrepresent another process's output.
5. Claim `permitted` publication success only after the artifact is retained and verified. An I/O failure, collision or interrupted publication returns a documented nonzero outcome without changing earlier release bytes.
6. If identical repeats are supported idempotently, report reuse of the exact existing artifact explicitly. A different hash at an occupied version is always a conflict.

Lineage checks must permit legitimate catalog updates, including changed entries, policies and reviewers. A predecessor's intact hash establishes linkage and document integrity; it does not independently establish publisher authority.

### Acceptance criteria

- **R04-A:** repeated preparation into one directory never changes any earlier release's bytes or hash.
- **R04-B:** explicit version 2 names version 1's exact hash; both remain separately readable and comparable.
- **R04-C:** duplicate use of the same predecessor either reuses an identical artifact explicitly or refuses the conflicting version.
- **R04-D:** two concurrent preparations targeting one version cannot replace each other or publish a partial JSON document. Their outcomes and evidence remain attributable to their respective runs.
- **R04-E:** simulate publication failure after evaluation; no newly successful outcome points to a missing or different release.
- **R04-F:** a policy refusal or unavailable read writes its refusal evidence without producing a newly eligible release or making an older release appear to belong to the failed run.

Use disposable output directories for all collision tests. Preserve retained historical artifacts.

## R-05: fence asynchronous work by project, request and report context

**Priority: P2.** Evidence: `src/Try.jsx:39-56,216-220` and related asynchronous step callbacks; persistence helpers in `src/studio-store.js`.

### Cause and reproduction

`useStudio.apply` receives a late result and applies it to `current.session` and `current.project`. Those are the project selected when the promise resolves, not necessarily the project that initiated it. The selector stays enabled during a check.

Start A's check, switch to B, then resolve A. The current code can install A's report into B and note it under B. A bounded reducer reproduction produced a Beta session whose active report identity named the demo project.

### Repair

1. Capture origin project ID, request generation, plan/artifact identity and applicable report/release context before starting asynchronous work.
2. On settlement, update only the origin session if the request is still relevant. For read operations, either keep a properly scoped result or cancel/ignore a superseded result. A project switch alone must never redirect it to the new project.
3. Fence out-of-order requests within one project as well. A latest-started request cannot be replaced by an older request settling later.
4. Ensure persistence targets the origin project, including when it is inactive. Do not rely solely on the React component's current state or closure identity.
5. Preserve finalized write receipts under their original project and exact report context even after navigation, reset or unmount. A verified historical write must not be discarded merely because its UI request became obsolete. Unknown sends retain their pending state and are never automatically resent.
6. Revalidate prepared operations at the action boundary if their project, report, signer, release or revision context changed. Stale callbacks must not make them current again.

### Acceptance criteria

- **R05-A:** deferred A check -> switch to B -> resolve A leaves B's report, project record, badges and exports unchanged.
- **R05-B:** A request 1 -> A request 2 -> resolve 2 -> resolve 1 retains request 2 as active.
- **R05-C:** project switch, reset and component unmount cannot restore a superseded active result on reload.
- **R05-D:** a finalized receipt arriving after navigation is retained exactly once under its origin and cannot approve the current report in another project.
- **R05-E:** test with controllable promises, not network timing or sleeps. Cover persisted stores as well as reducer output.
- **R05-F:** a delayed readback for transaction 1 remains attached to transaction 1 when a later submission is active. Navigation, transport timeout and reconciliation never increase the send count for an uncertain transaction.

## R-06: age imported catalog decisions with the current clock

**Priority: P2.** Evidence: consumer `web/App.jsx:114-121,239-240,316`.

### Cause and reproduction

`loadRelease` computes `readCatalogRelease` once and stores the resulting `read`. `LoadedRelease` renders that cached object forever. Parent clock ticks and visibility changes do not recompute it.

The browser reproduction loaded an eligible retained release before its `2026-10-25T19:05:17.293Z` deadline, then advanced the clock beyond 19:11 UTC. The loaded-reader panel still said `At least one entry may be used now` and marked pUSD `selectable`. The main current-decision control is separately guarded; this finding concerns the imported-reader display.

### Repair

1. Store the imported release document and filename. Derive its current read from that document and the current clock rather than treating a cached decision as authoritative.
2. Pass `now` into `LoadedRelease`, or implement equivalent clock-aware derivation. Verification may be cached by release identity, but eligibility must age independently.
3. Recompute on expiry, visibility restoration and subsequent renders. Use the shared library's deadline semantics consistently.
4. Keep `deadline-only` versus `fresh-reads` visible. Updating the clock is not a new chain read and does not detect an unobserved revocation.
5. An expired immutable release remains historical. Do not silently extend its embedded deadline. Rechecking current state and preparing a new release remain explicit operations.

### Acceptance criteria

- **R06-A:** import a valid document before expiry: the reader shows the expected eligible entries.
- **R06-B:** advance beyond its earliest applicable deadline: verdict and every affected selector row become unavailable without re-import.
- Preserve the library's existing inclusive boundary at exactly `validUntil`; immediately afterward the entry is unavailable.
- **R06-C:** suspend the tab before expiry, resume after it and dispatch the normal visibility event: no stale eligible state remains.
- **R06-D:** reloading or re-importing expired, malformed or hash-invalid documents grants no permission.
- **R06-E:** clock-only updates continue to disclose the absence of fresh chain verification. Controlled-clock tests require no signed transaction.
- **R06-F:** replacing a loaded file immediately replaces its decision; invalid input clears or explicitly invalidates the old presentation. Expiry in this reader cannot grant permission in the separate live decision or release-preparation control.

## R-07: distinguish verified renewal progress from incomplete or wrong-target evidence

**Priority: P2.** Evidence: `lib/health.js:23-29,38-49,100-125`; `scripts/renewal-prepare.js`; `src/Health.jsx`.

### Cause and reproduction

Renewal stages are derived mostly from hash/revision tuples. Relevant domain, target, interface agreement and freshness checks are missing. A reproduced input marked submit, approve, bind and list done despite stale observations, `interfacesAgree: false` and incorrect registry/list/token/release domains.

Successor selection accepts a passed same-plan/same-address report from another network or evidence scope. Health also omits the required subject observation entirely when `requireFreshSubject` is enabled. The actual eligibility evaluator remains stricter; these defects concern renewal guidance and the claim that a stage is verified.

### Repair

1. Share stage-appropriate evidence predicates with the evaluator: chain ID/genesis, registry/consumer addresses, release ID, subject, report hash, revision, reviewer identity, interface agreement and read provenance. Do not require the entire final policy to pass before an earlier renewal stage can be recognized.
2. Validate successor integrity and semantics, network, scope, supported runtime, subject and age. Preserve the requirement for explicit new approval and binding. A passed unrelated report is not a successor.
3. Separate historical completion evidence from current resumability. An old but verified finalized receipt can establish that a transaction happened. A stale or unavailable current observation cannot establish that its approval/listing still stands or authorize the next write.

Immutable storage receipts do not need an artificial 900-second lifetime. Validate their exact hash, chain and recorded extrinsic/block relationship; apply freshness limits to the current observations that require them. Offline captures can establish replayed behavior but cannot establish present signing readiness.
4. Distinguish `pending/not performed` from `unknown/unverified`. Unknown evidence must not automatically become an instruction to send again. Preserve existing pending-send and uncertain-result stops.
5. Under a fresh-subject policy, carry subject evidence through service -> health module -> CLI/UI. Display availability, provenance, freshness and the next responsible action. Under a legacy policy, label it not required without implying it was checked.
6. Align health labels, renewal-plan stages and generated successor configuration. Every claimed completed stage should identify the evidence and validation predicates that justify it.

### Acceptance criteria

- **R07-A:** a same-hash/revision read from a wrong chain, registry, consumer, token or release cannot satisfy that stage's current-state proof.
- **R07-B:** stale, undated, missing or disagreeing required reads produce explicit unknown/stale states and no unsafe continuation.
- **R07-C:** a passed successor from another network/scope, an unsupported runtime, wrong subject, expired report or invalid report cannot complete the successor-check stage.
- **R07-D:** an old verified finalized receipt remains historical completion evidence; unavailable current reads stop current continuation without suggesting duplicate submission.
- **R07-E:** a required subject read that is absent, stale, changed or disagreeing appears in health and renewal guidance. A legacy policy keeps its old fingerprint and accurately labels the check as not required.
- **R07-F:** any pending or unknown transaction result stops sends regardless of otherwise healthy evidence. Preparing health and renewal plans signs nothing.

## Execution order and verification

Repair shared state and policy helpers first, then consumers of those helpers. Package the final corrected library before the last consumer clean-install verification. R-01 cannot be closed by updating a version string while the consumer still executes old bytes.

Use the established native Node 22 runtime on this machine:

```sh
export PATH="/Users/ouyangduning/.nvm/versions/node/v22.23.1/bin:$PATH"
```

From the main working directory, rerun the relevant existing tests plus new regressions, then the full suite and build:

```sh
node --test test/studio-state.test.js test/projects.test.js test/subject.test.js test/catalog-release.test.js test/catalog-gate.test.js test/health.test.js
npm test
npm run build
node scripts/verify-artifact.mjs --out artifacts/local/repair-package-verification.json
```

From the independent consumer working directory, test the corrected installed dependency and browser build:

```sh
npm test
npm run web:build
```

Extend the existing `test/browser/studio-journey.mjs`, `test/browser/projects-journey.mjs` and consumer `test/browser/release-journey.mjs` or add focused adjacent journeys. Run them against served production builds. Preserve separate sessions and disposable test stores. Expand coverage to corrected-plan adoption, fresh-context import, project/request races and loaded-reader expiry; merely rerunning the old journeys is insufficient.

Do not alter sealed reports to create passing fixtures. Construct separately labelled synthetic cases or clone captured inputs and identify the changed fields. Keep offline deterministic checks distinct from read-only live observations.

## Completion evidence to return

Return a seven-row repair matrix with issue ID, actual fix location, new regression, observed result and remaining limitation. Include both final commits, packed artifact version/hash, installed consumer package identity and actual test/build/journey results.

Also demonstrate that original sealed reports, baseline and historical bindings remain unchanged. Explain any browser-store migration and show that old sessions preserve history without inheriting current approval.

Keep local completion separate from public delivery. Hosting manifests, public source and deployed application readback remain their own verification gate. Report exactly which steps were performed; a local pass does not establish a pushed commit, deployed site or organizer outcome.
