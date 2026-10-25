# ReviveCheck: final optimization plan

Assessment date: October 25, 2026. Implementation reviewed: `455cc60692980d1297285c496634e03dd4d9c3e2` in the `portaldot-hacker-house-2026-redesign` checkout; separate consumer: `6d4d3ca` in `revivecheck-consumer-example`. The modified recording script and consumer README describe pending work and are not evidence of an implemented frontend.

This document reorganizes the remaining work for the strongest defensible competition submission. It is an implementation and evidence plan, not a declaration that the proposed features are complete. It supersedes earlier action lists for prioritization while preserving their historical observations and all sealed reports and transaction records.

## Executive assessment

ReviveCheck already has substantial infrastructure and testnet evidence. Its main weakness is that the complete customer experience is less convincing than the underlying implementation. The highest-value next release should let anyone open a separate example application, inspect its exact evidence in the ReviveCheck App, return to the example, and observe its own fresh decision control a real application action.

Four narrower implementation gaps also remain: persisted listing receipts do not fully validate their attached readback; a failed Catalog refresh can retain a previous current-looking success; plan serialization drops token-list claims; and the installed MCP package advertises resources that are missing from its distribution. These deserve correction before stronger correctness or reuse claims.

The product should be presented as **release acceptance middleware that connects evidence, exact-report approval and application-owned decisions throughout a release lifecycle**. The App is the human inspection and operation surface. JavaScript, CLI and MCP are integration routes. Adding more routes or an AI label would contribute less than completing this workflow.

No visitor allow-list, invitation, login, application or administrator approval is part of the public experience. Read-only use requires no wallet. A token failing acceptance must not prevent a person from using the application or inspecting its evidence.

## 1. Optimize against the actual judging model

The official competition page was reread in a browser on October 25. Its four weighted categories are technical delivery, innovation, ecosystem contribution and business potential, at 30%, 30%, 20% and 20% respectively. The final package requires runnable public code/demo, a public real-product video of at most three minutes, and a PDF or public pitch deck. These requirements are summarized from the [official competition page](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail).

| Category | What already earns credibility | Highest-value remaining improvement |
| --- | --- | --- |
| Technical delivery, 30% | Contracts, dual-interface checks, stored evidence, verified v2 deployment and recorded lifecycle | Correct receipt/current-state presentation; complete and test the publicly usable consumer journey |
| Innovation, 30% | Finalized native/EVM observations, exact-report approval, consumer-owned policy and explicit rebinding | Demonstrate why these mechanisms change a real application decision; support a caller's own acceptance plan |
| Ecosystem contribution, 20% | Open source, documented interfaces, reference contracts, policy evaluator and author-run second consumer | Publish a reproducible integration with complete shipped documentation and passing public CI |
| Business potential, 20% | A clear maintainer problem and an honest auditability experiment | Show an operator correcting a consequential error, recovering eligibility and exporting an inspectable decision |

These improvements overlap across categories; their effects must not be added as invented guaranteed points. A score or winning probability cannot be established without the judges' decisions and comparable competitor evidence. The goal is a submission whose strongest claims survive reproduction.

The official freeze is **November 5, 2026, 23:00 EST in New York**, equivalent to November 6, 04:00 UTC. The rules also discourage delivering all final core modules in the last 24 hours. Complete and publish core functionality earlier, preserving genuine development history. The current page lists the Office Hour application deadline as **October 27, 08:00 EDT in New York**; applying is an optional opportunity, not a feature or an acceptance claim.

## 2. Credit completed work instead of repeating it

The following are supported by existing records and should not be recreated merely to make the video appear more active:

- ReleaseRegistry is deployed and VerifiedTokenList v2 is deployed, verified and active.
- pUSD has been listed on v2 with finalized dual-interface readback.
- The October 25 lifecycle records twelve steps and ten finalized receipts, including a new revision invalidating the old binding, approval alone being insufficient, explicit rebinding, relisting, revocation and restoration.
- Owner and reviewer are distinct accounts. Both are project-controlled: this establishes role separation, not independent review.
- The independent consumer installs a packed artifact, retrieves a report from chain data and evaluates its own policy. It already implements real refusal logic and has a recorded live run.
- The custom-domain site has a publication record with byte verification and retained rollback releases.
- Evidence age, observation age and explicit rebinding already exist in the policy model. A missing continuous monitor is not a newly discovered defect in this point-in-time model.

See [release status](RELEASE_STATUS.md), [lifecycle](LIFECYCLE.md), [publication provenance](PUBLICATION_2026-10-25.md) and the [consumer README](../../revivecheck-consumer-example/README.md). This assessment inspected records and code; it did not submit transactions or make a new assertion about the latest chain head.

## 3. Priority map

P0 means correctness or the central public demonstration depends on it. P1 materially improves reusable value and the final package. P2 is a stretch item only after the complete demonstrated release is stable.

| ID | Priority | Work item | Main scoring benefit | New deployment required? |
| --- | --- | --- | --- | --- |
| O-01 | P0 | Bind receipt readback to the exact operation | Technical credibility | No |
| O-02 | P0 | Make current status truthful through refresh and failure | Technical credibility and usability | No |
| O-03 | P0 | Build the public consumer-to-App-to-consumer journey | Product completeness, innovation, business value | No new contract |
| O-04 | P1 | Preserve plans and accept an application's own supported input | General usefulness and innovation | No |
| O-05 | P1 | Make the installed package complete and reproducible | Ecosystem contribution | No |
| O-06 | P0 before final delivery | Complete freshness and evidence renewal operationally | Full lifecycle and delivery reliability | Reuse contracts; a new report/revision may require writes |
| O-07 | P1 | Export a portable decision and actionable recovery path | Auditability and product differentiation | No |
| O-08 | P1 | Publish the separate integration and complete its documentation | Reusable ecosystem value | No |
| O-09 | P1 | Make the commercial proposition specific and measurable | Business potential | No |
| O-10 | P0 for submission | Publish a synchronized video, deck and Build description | Judge-visible delivery | No |
| O-11 | P1 | Expose unambiguous hosting and evidence provenance | Trust and reproducibility | No |
| O-12 | P1 | Make open access resilient and usable in a clean browser | Accessibility and demonstration reliability | No |

### O-01: validate the attached readback, not just the receipt's selected context

**Evidence and current gap.** `src/receipts.js:34-51` compares the saved receipt with the selected network, consumer and operation, but the attached readback is accepted based only on `listed` and `interfacesAgree`. An offline reproduction returned `current`, `finalized` and `listed: true` for a readback naming a different operation and an older checkpoint. A failed transaction can also coexist with `listed: true` in this helper's result. The production signing path already rejects unsuccessful sends; this finding concerns helper and persisted-state validation, not proof that recorded chain transactions are false.

**Required change.** Validate readback provenance against network/genesis, consumer address/version, token, release, exact report and reviewer. Use a matching registry observation for revision identity where the listing interface does not carry it. Require a finalized readback checkpoint at or after the recorded transaction. Keep successful historical completion separate from permission to use the entry now. Missing provenance must not imply a match.

**Acceptance criteria.** Add focused regressions for wrong consumer, token, release, report, reviewer, network, an older checkpoint, absent identity and an unsuccessful transaction. None may complete the selected operation successfully. A fully matching successful case must still work. Preserve mismatching receipts as history rather than deleting or rewriting them.

### O-02: present one authoritative current evaluation

**Evidence and current gap.** `src/Catalog.jsx:106-117,130-168` renders the published snapshot and the fresh evaluation separately. The large headline comes from the snapshot. A thrown refresh only reports an error and can leave the previous result visible as "Available now". This failure path was identified by code inspection; it was not reproduced in a browser during this assessment.

**Required change.** Use explicit current states: not checked, checking, valid, recheck required, expired and unknown. On refresh, remove current action permission until a fresh acceptable result exists. An earlier success may remain under "Last verified", with its checkpoint and time. Keep published evidence under "Recorded snapshot". Prevent a slower response for an old selection from replacing the latest selected token or policy result.

**Acceptance criteria.** Exercise recorded-valid to fresh-revoked, fresh-expired, timeout, thrown error, unsupported runtime and selection changes during refresh. No failed or stale refresh may leave a green state presented as current or enable the consumer's business action. Historical receipts and recorded snapshots remain inspectable.

### O-03: build the public Token eligibility demo

**Evidence and current gap.** The separate repository contains a Node evaluator, configuration, refusal tests and output artifacts, but no frontend or public remote. The public App already supports exact-report inspection and replay. The missing component is the application experience joining those capabilities to a real downstream action.

**Minimum useful interface.** Show the token entry, its configured metadata, the consumer's own policy, its current eligibility, reasons, evidence age and a token selector. Provide **Check token**, **Inspect evidence** and **Refresh status**. Use the installed package's actual evaluator through a browser-compatible bundle or a narrow read-only adapter. Do not expose the local Workbench and its mutable workspace as a public service.

**Required journey:**

1. Open the consumer URL directly, with no login, wallet, invitation or administrator action.
2. Evaluate its entry claiming eighteen decimals and show the actual mismatch denial.
3. Click **Inspect evidence** to open the exact bound report in the ReviveCheck App. Inspect the six-decimal observation and actually execute pinned replay.
4. Return to the consumer, correct its entry to six decimals, and run a fresh evaluation under its own policy.
5. Make the token selectable only when that evaluation enables it and the entry equals the approved report. The selection must read the resulting eligible-entry output, not a decorative success flag.
6. Replay captured supersession and revocation through the same consumer logic, with a persistent recorded label, to show why the token becomes unavailable and what restores it.

The existing exact-report entry point is [the revision-2 report in the App](https://revivecheck.axiqo.xyz/?report=1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51#/review). The App's reference Catalog and the consumer's own policy are different; a green reference Catalog result is never the consumer's authority.

**Acceptance criteria.** A clean browser completes this journey with the same report hash visible on both sides. Wrong entry, unknown verification, expiry and revoked approval make the selector unavailable. Correcting a field must cause an actual new evaluation. Opening and inspecting the application remains available even when the token fails.

This is a separately built, project-controlled integration. Reusing pUSD is sufficient to demonstrate a second application's use of the interface. A second asset, outside operator or full DEX is not necessary for this recording and must not be implied.

### O-04: support a real application's own acceptance input

**Evidence and current gap.** Public Studio fixes the sample to pUSD/asset 7777 and permits limited metadata editing (`src/Try.jsx:22,57-78`). Local Workbench imports plans, but `serializePlan` selects only default keys (`src/PlanEditor.jsx:6-24`). Offline execution confirmed that it drops `listing` even when the imported form retains it.

**Required change.** First preserve supported fields through validated schema serialization. Then add an explicit public plan import or a small "Check my token" form for the existing supported native-asset profile. Collect project/release identity, asset ID, expected network and exact listing claims. Reuse normalization and verification rather than adding a second checking engine. Show the effective plan before running it and provide a plan download.

**Acceptance criteria.** Import, edit, save, export and reload preserve every supported claim and the normalized fingerprint when the semantic plan is unchanged. An imported eighteen-decimal claim reaches the checker and fails against a six-decimal asset. Unsupported inputs, runtime adapters or networks fail clearly; fields must not disappear silently. Changes to the plan produce a new report and do not inherit approval.

This is high-value for the strongest release, but it is not a blocker for the shorter existing-approved-report consumer walkthrough. Do not advertise arbitrary-application intake until it works.

### O-05: test the distributed artifact as a product

**Evidence and current gap.** `mcp/server.js:14-15,34-36` advertises two resources loaded from `public/lifecycle/`, while the `package.json` file list omits those resources. In the independently installed package, both resource reads returned MCP `-32603` with `ENOENT`. The documented JavaScript imports do work; the entire package should not be described as unusable.

**Required change.** Include the specific non-sensitive resource files required by the server or stop advertising unavailable resources. Verify resource contents against the intended public records. Run smoke checks from a packed tarball installed outside the source tree. Document cache/feed/report lookup behavior when the source checkout is absent.

**Acceptance criteria.** From a clean artifact install, resolve every documented JavaScript export, run CLI help, start MCP, list tools/resources and successfully read every advertised resource. Ensure no wallet, private directory, local workspace or secret is packed. A public release artifact with a checksum is sufficient; npm publication is useful but not mandatory.

After correctness, reduce unnecessary runtime dependencies where practical. The consumer's recorded install pulled web/build dependencies it does not use. Measure the resulting package and install footprint rather than claiming a saving before it is observed.

### O-06: operate the full freshness and renewal lifecycle

**Evidence and current gap.** The bound report completed at `2026-10-25T09:29:17.646Z`. The policy permits a report age of 604800 seconds and an observation age of 900 seconds. Its report expiry is **November 1, 2026, 04:29:17.646 EST in New York** (`2026-11-01T09:29:17.646Z`), before the competition freeze.

**Required change.** Display evidence expiry and observation freshness separately. Re-evaluate before a consequential consumer action; when supporting observations exceed their limit, remove action permission or obtain fresh inputs. A new current registry read does not reset the sealed report's age. Provide an explicit renewal checklist: new check, retained report, storage where required, new revision submission, exact-hash reviewer approval, explicit binding, and any required relisting/readback.

Keep role-specific actions clear: an operator can prepare a recheck; the owner submits; a trusted reviewer approves; the consumer operator explicitly binds. Never silently approve, migrate a binding or broaden runtime support.

**Acceptance criteria.** Test the boundary immediately before and at expiry, stale observations, revoked approval, superseded revision and unavailable reads. Renewal preserves the old report, decisions and binding history. A fresh report stays unapproved until its own exact hash is approved. Use one coordinated signing session, reconcile journals and chain state, and stop on uncertain transactions; this plan itself authorizes no new broadcast.

**Optional deeper assurance.** If a consumer claims that current subject metadata or bytecode still matches the approved report, require a fresh subject observation within that policy's scope. Current network/approval/listing reads alone must not imply arbitrary application state was rechecked. Add this only for explicit supported checks; a continuously running monitor is not required.

### O-07: turn decision artifacts into an inspectable product feature

**Evidence and current gap.** Reports, evaluations and bindings already contain much of the required machine-readable evidence. The consumer has not yet turned these into a usable handoff from its own interface.

**Required change.** Provide **Download decision evidence** and a concise human-readable rendering. Include the canonical entry, policy identity, exact report, release/revision, binding identity, reviewer trust basis, storage locator, evaluation time, finalized checkpoints, outcome, reasons and next action. Use versioned schemas and recomputable hashes. Reuse verified report links and QR generation.

Every refusal should answer what failed, which observed value caused it, who can act, and what must happen next. A revoked decision calls for reviewer resolution; supersession calls for a new approved binding; an unavailable node calls for another read, not another approval.

**Acceptance criteria.** A separate process reconstructs the decision from exported inputs and verifies its fingerprints. A QR opens the intended exact report or official explorer record. Historical exports remain historical; integrity is not proof of current eligibility, authenticated reviewer identity or an independent security audit. A self-declared review receipt or signed remark must not be presented as Registry approval.

### O-08: make reuse publicly reproducible without author assistance

**Evidence and current gap.** The second consumer is local and has no remote. Its CI workflow exists but has no public run. Its onboarding log records source-code assistance for undocumented signatures, return shapes and limits.

**Required change.** Publish the consumer with a pinned artifact/checksum, lockfile, licence, actual clone/install commands, supported configuration and refusal scenarios. Document `retrieveEvidence`, `createBinding`, `collectPolicyInputs` and `evaluateBinding`, including parameters, outputs, limits, errors, retries and lifecycle responsibilities. Clearly separate the local REST Workbench from the public browser and installable library.

Provide a short integration guide that builds a useful consumer from the distributed artifact alone. Keep an offline deterministic CI job for success/refusal cases and a separate opt-in live-read job. Network unavailability must be recorded as unavailable, never passed or hidden by a fixture fallback.

**Acceptance criteria.** A clean checkout outside ReviveCheck's source tree installs and runs using only shipped documentation. Public CI retains artifacts for valid, wrong-entry, superseded, revoked, expired and unavailable cases. The author can run this cold-start exercise now; disclose author or agent control. An independently operated trial remains optional additional evidence, not a prerequisite for recording.

### O-09: make the business proposition specific and supportable

**Primary customer.** Start with the maintainer responsible for a Portaldot wallet or token catalog, who must decide whether an entry can be published or selected. Name the recurring triggers: metadata correction, new release, review change, evidence expiry and environment incompatibility.

**Concrete value.** The implemented mechanism can prevent a configured entry from being published under evidence that checked different values and can make invalidation/recovery inspectable. It provides reconstructable decisions rather than forcing a maintainer to reconcile unrelated screenshots, hashes and approvals manually. The demo should show that result directly.

**Commercial hypothesis.** Keep the core library/contracts open source. A potential hosted offer could manage scheduled checks, evidence retention, indexing, status history and team notifications. Document who would operate or pay for it and what self-hosting requires. Present pricing or operating-cost models as assumptions until measured; do not add billing or a marketplace just to imply a business.

**Acceptance criteria.** Publish a one-page customer/problem/workflow/value/model brief with a feature-to-benefit mapping. Reuse the fair experiment's actual outcomes and preserve its caveats: it does not establish superior speed, human time savings, demand, revenue or willingness to pay. Distinguish spent fees, held deposits, estimates and hosting costs. A cold-start integration test may measure documentation and setup effort without pretending to be a human customer study.

### O-10: make the final public package demonstrate this release

**Evidence and current gap.** The publication record states that the YouTube video and DoraHacks description still describe the October 24 release. `docs/FINAL_DECK.md` is an outline, not a rendered final deck. The updated v4 recording script is a plan, not footage.

**Required change.** Finish the core journey before recording. Follow [the v4 script](DEMO_SCRIPT_V4.md): begin in the independent application, spend most of the video using the App and returning to a real consumer consequence, and use recorded chain transactions to explain invalidation/recovery. Keep terminal footage short and supportive.

Create a new real-product video targeting 172 seconds, verify it is under 180 seconds, and retain source reels, captions and provenance. Publish it to YouTube and verify logged-out playback. Render a PDF or public deck covering the problem, why Portaldot matters, functional evidence, reusable integration and continued-building plan. Update the existing DoraHacks Build and current website links only with verified public artifacts. Preserve previous recordings and historical reports.

**Acceptance criteria.** Source commit, hosted interface, recording, deck and Build description agree on capabilities and evidence. The core operation can be repeated by a judge from public instructions. No new claim is illustrated only with old footage. QR and explorer links resolve. Claim labels distinguish live reads, recorded finalized transactions, local reproduction, fixture replay and planned work.

### O-11: separate hosting metadata from evidence status

**Evidence and current gap.** Publication provenance records actual hosting release `20261025-e7044d1-public-r2`, while the public status record names the earlier r1 release/source. The publication document explains this; it is not evidence that r2 failed to deploy.

**Required change.** Expose a small hosting manifest containing the source commit, release ID, build time and manifest/payload hashes. Generate deployment metadata after the build rather than repeatedly rebuilding a commit that tries to describe its own deployment. Keep immutable evidence status and current hosting provenance distinct.

Refresh current overview prose and links without changing historical reports. Replace stale current test-count, contract-version and publication statements with verified summaries or explicit dated context. Avoid hardcoded counts unless generated from a reproducible check.

**Acceptance criteria.** One public path identifies the actual hosted build. The code repository, package artifact and site can be traced to their sources without contradictory current-release labels. A status snapshot remains dated and does not claim a fresh chain observation.

### O-12: make open access dependable

**Required experience.** Anyone opening the public URL can perform supported read-only actions without account creation, invitation, wallet installation or visitor approval. Provide clear entry points for inspecting an existing report and checking a supported token. Failed token acceptance leaves all inspection features available.

Handle slow RPCs with progress, bounded waits, retry controls and explicit unknown results. Returning to the tab or changing a token must not revive a stale permission. Preserve the last verified artifact separately for audit. Offer a clearly labelled recorded-example path when the node is unavailable, without silently replacing a live check.

Keep the minimum workflow readable at desktop and mobile widths, with keyboard-accessible inputs, visible focus, copyable complete identities, readable reasons and usable QR codes. Mobile users should be able to open the full evidence link without scanning their own screen.

**Acceptance criteria.** A logged-out browser with empty local storage completes the read-only journey. Exercise timeout, disconnect, retry, stale tab, changed input and invalid import. No secret or privileged write endpoint is exposed. Wallet connection appears only for an explicitly chosen signed action.

## 4. Explain the innovation through the application consequence

Use one mechanism consistently:

> A consumer admits an exact entry only when its own policy accepts evidence for that entry and the exact-report approval still applies; changes create an inspectable need for review and explicit rebinding.

Connect each Portaldot capability to evidence or behavior:

| Platform capability used | What it contributes | Demonstration |
| --- | --- | --- |
| Native Assets and the ERC-20 precompile | Compare the native asset and EVM-facing entry at one finalized height | Eighteen-versus-six decimal mismatch with both observations |
| ReviveApi account and block mapping | Resolve native/H160 identity and map the native and EVM block references | Report checkpoint and dual-interface readback |
| Revive contracts and the registry guard | Expose exact-report approval for another contract to consume | A revision or revocation changes listing eligibility |
| Remark evidence storage | Retain and retrieve the sealed report from chain data | Consumer retrieval verifies the stored evidence and report hash |
| Consumer-owned off-chain policy | Express trust, evidence age, observation age and supported runtime | Token selector withholds an entry even when a simpler approval badge would look acceptable |

Two interfaces are complementary observations of the runtime, not independent validators proving RPC honesty. Do not claim implemented WASM execution, cross-chain messaging or AI verification without corresponding code and evidence. The present track remains Modular Cloud & Middleware.

## 5. Execution order and evidence gates

1. **Correctness gate:** complete O-01 and O-02 with focused regressions. Fix plan serialization and package omissions in parallel where ownership is clear. One session owns any future signer.
2. **Product gate:** complete O-03 and O-12. Prove the clean-browser consumer-to-App-to-consumer journey and real selection consequence. This is the minimum recording gate.
3. **Reuse and innovation gate:** finish O-04, O-05, O-07 and O-08. Publicly reproduce installation, supported custom input, evidence export and refusal behavior.
4. **Freshness gate:** complete O-06 before the bound evidence expires and before recording/final verification. Schedule the minimum necessary coordinated renewal; do not repeat the already completed lifecycle for cosmetic footage.
5. **Public delivery gate:** publish the verified source and site, complete O-09 to O-11, and check every final link. Target core completion before the last 24 hours, leaving time for recording and verification.

The first three gates can proceed without new testnet spending. A future renewal uses the existing contracts and must retain actual receipts and readback. No transaction, public publication or contest form change was performed by writing this plan.

## 6. Stretch work only after the core release passes

- An independently controlled reviewer or outside maintainer installation, if someone is available. This would improve evidence quality; absence does not block the self-built demonstration.
- A small second supported subject or acceptance plan to demonstrate generality after custom intake is correct. A separate application using the same asset already proves a narrower valid integration claim.
- Current-subject checks required by an explicit consumer policy, where an action truly needs them.
- MetaTx reviewer convenience only after supported runtime behavior, replay protection and real execution can be verified. Do not add it as an untested differentiator.

Do not spend the remaining schedule building a full exchange, AMM, swap engine, wallet, reviewer marketplace, payment system or AI decision-maker. Do not manufacture adoption, commit activity, speed advantages or customer numbers. Do not widen expiry/runtime constraints to keep a green state or rewrite the October 23 baseline. These changes would weaken a focused, auditable submission.

## 7. Final definition of done

The release is ready for its strongest submission when a judge can open the public consumer, use the ReviveCheck App to inspect the exact evidence, return to a fresh policy decision and observe the token selector obey it; repeat both acceptance and refusal; reproduce the integration from public source; and trace the demonstrated release to its deployment, reports, decisions and lifecycle records.

The public evidence must support every stated accomplishment. Project-controlled reuse and role separation receive credit as such. Independent adoption, independent review, commercial demand and award outcomes remain separate, unproven claims until their own evidence exists.

## Evidence index

| Evidence | Observation and source | Work items supported |
| --- | --- | --- |
| E-01 | Official rules read in the browser on October 25; scoring weights, final materials and current freeze date | Judging model, O-10 |
| E-02 | `src/receipts.js:34-51`; offline wrong-readback and failed-transaction helper reproduction | O-01 |
| E-03 | `src/Catalog.jsx:106-117,130-168`; snapshot/current rendering and refresh-error handling inspected | O-02 |
| E-04 | Consumer `package.json`, `src/check.js:68-114`, `src/allowlist.js:87-141`, README and empty remote configuration | O-03, O-08, O-12 |
| E-05 | `src/Try.jsx:22,57-78`; `src/PlanEditor.jsx:6-24`; listing-loss reproduction | O-04 |
| E-06 | `mcp/server.js:14-15,34-36`; package file list; installed MCP SDK resource read failures | O-05 |
| E-07 | Report `1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51`; `examples/token-catalog/config/testnet-v2.json:17`; independently recomputed expiry | O-06 |
| E-08 | `docs/RELEASE_STATUS.md`, `docs/LIFECYCLE.md`, `public/catalog/testnet-v2/lifecycle.json` | Completed work, O-06, O-10 |
| E-09 | Consumer onboarding log; `docs/INTEGRATION.md`; `docs/API.md`; `lib/policy.js` and `lib/service.js` | O-07, O-08 |
| E-10 | `docs/VALUE_EXPERIMENT.md`, `docs/PILOT_PROTOCOL.md`; no completed human pilot claimed | O-09 |
| E-11 | `docs/PUBLICATION_2026-10-25.md`, public HTTPS status read, `docs/FINAL_DECK.md`, `docs/DEMO_SCRIPT_V4.md` | O-10, O-11 |

Offline reproductions establish the specific helper/packaging issues above. Static inspection is identified where no browser execution was performed. Existing chain records establish historical finalized events, not permanent eligibility. This distinction is part of the product's value and must remain visible in the submission.

### Reproduce the offline findings

The [diagnostic script](../artifacts/assessment-2026-10-25-readiness/offline-reproduction.mjs) and its [retained result](../artifacts/assessment-2026-10-25-readiness/offline-results.json) cover E-02, E-05 and E-06. The result records the observation time and hashes of the relevant source files. It uses synthetic receipt identities and invokes no network-facing tool. The installed MCP resource check requires the existing sibling consumer and its installed dependency.

Run from the reviewed ReviveCheck checkout, with its dependencies already installed:

```sh
node artifacts/assessment-2026-10-25-readiness/offline-reproduction.mjs
```

At the reviewed version, the mismatched readback yields `listed: true`, a failed transaction still yields `listed: true`, the serialized plan has no `listing`, and both advertised installed MCP resources fail with a missing-file error. After remediation, these observations should change; preserve this original result rather than overwriting it with a new run.

Retained result SHA-256: `a6e241ddc8d22091cb44dc4e66b93a8d9081844384770be62ce46dcb0bff3fa3`.
