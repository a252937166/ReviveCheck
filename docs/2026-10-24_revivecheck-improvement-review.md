# ReviveCheck: issues, improvement plan, and evidence

Review date: October 24, 2026. This document describes the local v0.3 redesign snapshot, not a newly published release. Source line numbers are navigation aids for that snapshot; the reproduction results record hashes of their actual inputs.

## Executive assessment

ReviveCheck has a credible Portaldot-specific foundation: finalized native/EVM observations, report fingerprints, version-bound reviewer decisions, on-chain evidence storage, and a consumer contract. The redesigned landing, application dashboard, and integration documentation make that foundation easier to understand. The main remaining work is correctness, an independently runnable reference application, and synchronized public delivery. Several previously identified defects remain reproducible despite the existing test suite passing.

The internal assessment is **68/100**: Technical Feasibility 20/30, Innovation 23/30, Ecosystem Contribution 15/20, and Business Potential 10/20. The currently published artifacts received an approximate 50–55/100 delivery assessment because they lag behind the local implementation. These are subjective review scores using the [published judging weights](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail), not organizer scores or estimates of winning probability.

A self-built reference application is valid ecosystem work. An external customer is not a prerequisite for this plan. The reference application should demonstrate that a separate consumer can use ReviveCheck through its documented interfaces, and another developer should be able to reproduce that integration. Accounts controlled by this project may demonstrate separate roles; they do not establish independent adoption or independent audit.

## Scope and verification boundaries

- Reviewed implementation: `portaldot-hacker-house-2026-redesign`, branch `redesign/custody-record`, committed HEAD `aecc761677681433d37bbcf71064547f57343319`, plus substantial uncommitted and untracked v0.3 changes.
- Public repository snapshot: `main` at `aecc761677681433d37bbcf71064547f57343319`; `gh-pages` at `1352f6f1f27466481465d5b75fe1c5d1e8dd11fb`. Rechecked while preparing this document. These values can change after publication.
- Current document preparation includes source inspection and offline reproductions. Test/build and bytecode-readback observations below are explicitly attributed to the preceding same-day review.
- Browser automation timed out during that review. A fresh visual or interactive end-to-end walkthrough was not completed. Source inspection and a successful build are not substitutes for that walkthrough.
- No production source fixes, dependency installation, publication, submission update, real wallet operation, or real-chain transaction is part of this documentation task.
- Detailed diagnostic scope: [scope.md](../artifacts/review-2026-10-24/scope.md).

The registry records account opinions about exact hashes. A hash proves payload integrity; an account signature authenticates an account. Neither alone proves a report's truth, a reviewer's authority, independent review, or current business safety. Self-review is consistent with an open opinion registry; its use in a globally trusted catalog requires an explicit additional trust policy.

## Evidence inventory

| ID | Evidence | Verification level and limits |
| --- | --- | --- |
| E-01 | [Offline reproduction script](../artifacts/review-2026-10-24/reproduce-findings.mjs) and [actual results](../artifacts/review-2026-10-24/reproduction-results.json) | Executes freshly compiled contracts in an in-memory EVM and replays a retained report with injected clients. No live-chain mutation. Results include source hashes. |
| E-02 | `contracts/ReviveCheckGuard.sol:25–30`; `contracts/VerifiedTokenList.sol:40–53`; `contracts/ReleaseRegistry.sol:32–50`; `lib/tokenlist.js:8–12` | Static evidence for counting, entry replacement, current-revision decisions, and the open-curator configuration. |
| E-03 | `lib/replay.js:26–68`; retained report [9dd04e…0645](../public/reports/9dd04e0685d06a1a9a0525b2b8d6ac4b259d1618184789f345a7be5e55ae0645.json) | Static replay coverage plus a real retained report; E-01 provides the offline behavioral reproduction. |
| E-04 | `src/Try.jsx:523–540`; `contracts/VerifiedTokenList.sol:43–44` | Static evidence for the developer/reviewer UI conflict. Not a newly executed two-wallet browser session. |
| E-05 | `src/records.js:17–35,85–105`; `src/Dashboard.jsx:197–225`; `src/Landing.jsx:89–98` | Static evidence for cached feed state, historical-event counts, fixed token labels, and overstated enforcement copy. |
| E-06 | `git status --short`, `git ls-remote origin HEAD refs/heads/main refs/heads/gh-pages`; public README and Pages tree inspected during the preceding review | The redesign and CI configuration are local; current public artifacts lag behind. Only old Pages deployment workflow runs were observed. |
| E-07 | `.github/workflows/ci.yml:19–26`; `test/mcp.test.js:4–15,45`; `mcp/tools.js:31–42` | Project quality CI configuration; in-memory MCP transport; a missing-report path can attempt a public HTTP fetch. Not evidence of a downstream acceptance Action or a stdio subprocess test. |
| E-08 | Preceding October 24 review: 115/115 existing tests passed, including an in-process run with `fetch` disabled; production build succeeded with ARM Node v24.19.0 | Passing existing tests does not cover E-01's counterexamples. Build used installed dependencies; a fresh clean installation was not verified. |
| E-09 | Preceding review: source/artifact/live runtime bytecode comparison; 12 sealed report checks; retained baseline byte hash | Contract sources matched the deployed v1 design. All 12 report fingerprints verified. These observations were not regenerated by the documentation task. |
| E-10 | `examples/` contains `probe.plan.json` and `public-asset.plan.json`; `src/Dashboard.jsx:197–225`; `README.md` roadmap and business hypothesis | Supports the reference-application and packaging gaps. It does not establish customer usage or measured savings. |
| E-11 | CJK scan of four known authored text files, repeated during document preparation | Remaining non-English text in `PARTICIPATION_RESEARCH.md`, `docs/OBSIDIAN_INPUTS.md`, `scripts/create-wallet.js:11,25`, and `test/share.test.js:9`. No private data was read. |

The retained immutable baseline remains report `0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5`. Its report file, `public/reports/0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5.json`, has byte SHA-256 `7abb6f04a014721c716045c460288aafae17b2066af1dea921cd6d91ce49b6b2`. The separate manifest file, `public/baselines/current-2026-10-23.json`, has byte SHA-256 `fe16fcc0683321832e41bf2828e35a97962cd6a61fa79313500f69af61c10475`. The report fingerprint, report-file byte hash, and manifest-file byte hash are different identifiers. Neither file was changed.

The saved diagnostic run completed at `2026-10-24T12:58:21.825Z`, with **3/3 findings reproduced**, zero network requests, and unchanged reviewed inputs. Result IDs `RC-01`, `RC-02`, and `RC-03` correspond to findings F-01, F-02, and F-03 below.

## Findings and remediation

Priority **P1** means a prerequisite for a reliable release or the core demonstration. **P2** means the next product, lifecycle, or delivery improvement. These are implementation priorities, not a formal vulnerability severity classification.

### F-01: duplicate reviewers can satisfy a multi-reviewer threshold

**Priority:** P1. **Status:** reproduced offline. **Evidence:** E-01, E-02; integration example in `docs/INTEGRATION.md:34–35`.

`ReviveCheckGuard.approvals` counts each array entry. An approved reviewer supplied twice contributes two votes. The integration example uses a threshold of two, so an integrator can unintentionally implement a one-reviewer gate. This is a library/integration defect; it is not evidence that the current deployed token list uses a quorum.

**Observed:** one approved reviewer repeated twice returns `2` in the in-memory EVM.

**Direction:** define an approved reviewer set and count unique identities. Either reject duplicate inputs or require a strictly ordered unique set; do not let caller-selected arbitrary identities define the trust policy. If a gate accepts an expected report hash, bind the quorum to that exact current report as well.

**Acceptance:** `[A, A]` cannot satisfy a two-reviewer policy; `[A, B]` can satisfy it only when both distinct authorized accounts approved the intended current revision. Unknown, revoked, and superseded decisions contribute no votes.

### F-02: the open catalog allows unrelated releases to replace existing entries

**Priority:** P1. **Status:** reproduced offline. **Evidence:** E-01, E-02.

`VerifiedTokenList.list` checks that the caller owns the supplied release, but does not require control of an existing token entry. The deployed configuration has `curator = address(0)`, so a lister can choose its own account as reviewer. Any user can create an unrelated release with an arbitrary nonzero report hash, approve it, and replace `entryOf[token]` when the claimed decimals match. Submitting another revision of that unrelated release can then make the replaced entry unavailable.

**Observed:** the reproduction replaces a legitimate token's release/reviewer with an unrelated user's self-approved release; `isListed` stays true immediately after replacement and becomes false when that user submits a new revision.

**Direction:** choose a clear catalog model: a curated catalog with controlled writes, or separately namespaced catalogs with explicit controllers. Protect updates to existing entries. Bind the attested subject to at least chain identity, consumer/registry domain, token address, report hash, and policy version. Establish who validates that binding. Adding fields alone does not prove the report passed or that its observations are true. A fixed curator is useful but does not by itself solve target binding and update ownership.

**Acceptance:** an unrelated owner cannot overwrite or disable an existing managed entry; a report about another token is rejected; authorized updates, review revocation, and revision invalidation behave as documented. Open self-review may remain available in the opinion registry, with its scope clearly labeled.

### F-03: generic contract replay can report complete reproduction without replaying contract checks

**Priority:** P1. **Status:** reproduced offline. **Evidence:** E-01, E-03.

The implementation recognizes asset-parity and token-listing observations. A generic contract report containing neither receives only three checkpoint comparisons. If those match, replay returns `reproduced` without re-reading the contract code, ABI assertions, account mapping, funding observations, or transaction evidence.

**Observed:** the integrity-valid retained seven-check ReleaseGate report returns `reproduced` with only `checkpoint.native`, `checkpoint.finalized`, and `checkpoint.evm`, and zero contract/EVM state calls.

**Direction:** enumerate the report's required replay items, dispatch supported checks to version-scoped adapters, and expose coverage independently from value agreement. Unsupported observations should produce an explicit incomplete/unsupported result. A historical transaction-provenance check remains distinct from a current-state assertion and must use the appropriate historical registry and checkpoint.

**Acceptance:** a checkpoint-only replay cannot claim complete reproduction of a contract report; a changed ABI result or code observation is detected; unavailable archival state and unknown adapters remain incomplete; supported asset reports continue to reproduce their full declared scope.

### F-04: the Studio cannot complete the normal developer A / reviewer B / consumer A flow

**Priority:** P1. **Status:** confirmed by source inspection. **Evidence:** E-04.

Consume derives its reviewer from the currently connected wallet. The consumer contract requires that same caller to own the release. Owner A therefore checks A's review instead of B's; switching to B conflicts with the ownership requirement. The contract accepts a reviewer argument, but the UI does not let the owner select B.

**Direction:** keep the transaction sender, release owner, and selected reviewer as separate fields. Retain the chosen reviewer per release/report, validate that decision through both interfaces, and clear prepared transactions when any relevant input changes. Re-read the current revision/hash before signing and after finalization.

**Acceptance:** A submits, B approves the exact hash, and A consumes B's approval. Wallet switching must not silently replace the selected reviewer. A rejection or stale report blocks consumption. Using two project-controlled accounts proves role separation only.

### F-05: approval freshness and runtime drift are not enforced continuously

**Priority:** P2. **Status:** documented design limitation. **Evidence:** E-02, E-04; `docs/INTEGRATION.md:198–206`.

The consumer checks the registry's revision, exact hash, and reviewer decision. It does not re-evaluate token state, code, runtime, or evidence age. Watch is a manual/browser/CI entry point, not a durable monitoring service. An observed environment change therefore does not automatically revoke a consumed approval.

**Direction:** define a policy envelope covering supported network/runtime, target/code identity where available, plan fingerprint, and evidence age. Define how fresh environment evidence is supplied and who is trusted to supply it. Use explicit expiry and a documented recheck/reapproval process where appropriate; Solidity fields alone cannot discover an off-chain runtime change.

**Acceptance:** a controlled drift test marks evidence as requiring recheck and prevents a fresh-valid claim under the chosen policy. New evidence starts without inherited review. Label controlled drift tests separately from a real testnet upgrade; a new block alone is not an upgrade. Preserve earlier evidence.

### F-06: dashboard counts and enforcement copy exceed the evidence they display

**Priority:** P1 for inaccurate claims; P2 for richer indexing. **Status:** confirmed by source inspection. **Evidence:** E-05.

`useRecords` loads a static feed once per page and caches it. The listed-token count uses historical listing-event length, while token rows and activity labels hardcode `pUSD`. Archived approvals can be shown beside a live block head. The landing says four rules are written into Registry/Guard, including dual-interface agreement, although that comparison is an off-chain service check.

**Direction:** distinguish recorded events, indexed snapshots, current chain decisions, and current policy validity. Show the indexed height and last successful read. Count unique tokens that remain valid at a stated checkpoint, or label the value as historical events. Resolve metadata per token. Describe on-chain conditions separately from off-chain verification behavior.

**Acceptance:** repeated listing events do not inflate a unique-current-token count; revocation/new revision changes the current view after a successful refresh; RPC failure produces a visible unknown/stale state; a live header cannot imply every row is current; all enforcement claims identify the implementing component correctly.

### F-07: the reference consumer has not become an independently runnable business demo

**Priority:** P1 for competition delivery. **Status:** product gap. **Evidence:** E-10.

The current token page is a registry table and live lookup. It does not yet provide the standalone Token Catalog integration discussed in the product plan. The recorded Studio run signed submit, approve, and a remark; storage and listing were recorded through separate helpers. That proves real components, but not one newly recorded end-to-end business flow.

**Direction:** create a small Token Catalog example with its own entry point, configuration, and README, using documented service/Guard interfaces. A separate example folder is sufficient; a new repository or unrelated protocol is not required. Make the business action visibly depend on the selected release policy.

**Acceptance path:** unapproved release is unavailable → corrected report is produced → reviewer B approves → owner A enables the catalog entry → a new revision invalidates the old binding → the new exact report is approved and explicitly rebound → availability returns. Revocation also disables it. Someone else can reproduce this from the written instructions. No external adoption claim is required.

### F-08: public source, site, video, and submission describe different releases

**Priority:** P1. **Status:** delivery gap at the recorded snapshot. **Evidence:** E-06; `docs/CHECKIN_2026-10-24.md`; `docs/SUBMISSION.md`.

The redesigned contracts, interfaces, pages, tests, and CI remain largely uncommitted. The public README and submission still describe the earlier funding/deployment gap; the public Pages tree lacks the new lifecycle/API directories. Existing videos describe historical versions. The updated Check-in text is explicitly a draft.

**Direction:** after correctness fixes, commit real logical changes, publish the intended release, and verify the actual CI run, anonymous site access, report retrieval, video, and submission fields against that release. Preserve historical videos and reports with their version labels. Retain genuine development history rather than manufacturing daily commits or changing dates.

**Acceptance:** a public release identifies its exact source commit, registry/consumer versions, report hashes, video, and known limitations; a fresh clone can follow the documented path; the public site shows the same release; saved submission fields are read back. Keep platform submission, organizer acceptance, and mentor access as separate statuses.

The published Check-in deadline used in this review was October 24, 12:00 UTC (08:00 EDT). It had passed before this document was prepared. The existing submission record remains evidence of the earlier submission; whether newer material may be added requires checking the organizer's current update channel. This document performs no submission update.

### F-09: CI configuration and test claims need a more precise delivery contract

**Priority:** P2. **Status:** confirmed by source inspection. **Evidence:** E-07, E-08.

The new workflow tests and builds this repository and parses four JSON files. It is not a reusable release-acceptance workflow for other projects, and parsing JSON does not verify its provenance or semantics. MCP tests use `InMemoryTransport`, despite documentation describing stdio testing. A missing-report test can attempt the public-site fallback, despite a strict offline claim. No successful run of this new untracked workflow was observed publicly.

**Direction:** make unit tests explicitly offline with injected/denied network access. Add a separate stdio process smoke test if that transport is claimed. Validate report hashes and reference consistency in CI. Ship a small downstream acceptance workflow with a user-owned plan, nonzero failure/incomplete exits, and report artifacts. Validate it on the reference application.

**Acceptance:** unit tests pass with outbound access denied; stdio claims have a real subprocess test; malformed or mismatched reports fail CI; a downstream failed assertion fails its job; unknown/incomplete results cannot be green release approvals; a public workflow run links to the intended source commit.

### F-10: the first buyer and measurable benefit are still hypotheses

**Priority:** P2. **Status:** unvalidated product hypothesis. **Evidence:** E-10; business-model section in `README.md`.

The product names token issuers, listing teams, protocol teams, reviewers, agents, and CI. Hosted verification, indexing, curated reviewers, and retention are possible revenue models, not validated demand. Interface and transaction counts do not establish customer benefit.

**Direction:** focus the first story on a V3 token-list or allow-list maintainer. Compare the same acceptance/review task using manual RPC/log/chat work and ReviveCheck. Record actual steps, elapsed time, intervention, recurring fees/deposits, and the final decision. A self-built example can support this experiment; external usage would add stronger evidence later.

**Acceptance:** a reproducible case states who uses the tool, what decision it changes, its measured cost and effort, and its limitations. Do not infer saved hours without a like-for-like measurement. Publish the integration kit and V3 regression findings as public goods even before adoption exists.

### F-11: finish English-only cleanup without changing historical evidence

**Priority:** P2. **Status:** confirmed text scan. **Evidence:** E-11.

Four known authored files still contain non-English text. `scripts/create-wallet.js` also contains a non-English private-note name/content template. A future run could reintroduce non-English project material.

**Direction:** translate active prose and generated presentation templates, preserve exact identifiers/recovery material, and use English authored filenames. Review fixtures deliberately rather than rewriting sealed reports or transaction records.

**Acceptance:** the known active prose/templates comply with project language instructions; new generated filenames/content are English; sealed report hashes, transaction records, wallet recovery data, and retained baseline bytes are unchanged. The text scan does not claim that every image, dependency, or private vault file has been inspected.

## Recommended implementation sequence

| Order | Deliverable | Exit evidence |
| --- | --- | --- |
| 1 | Correct unique-reviewer counting, catalog update/trust policy, and replay coverage | Regression cases for F-01–F-03; old demonstrations stop reproducing the defects; new expected behavior is tested. |
| 2 | Separate owner/reviewer in the UI and finish the reference Token Catalog | Full A → B → A lifecycle, revision invalidation, explicit rebind, revocation, and finalized readback. |
| 3 | Align dashboard state and policy/freshness language | Tests for repeated events, stale/unknown reads, dynamic metadata, and accurate on-chain/off-chain labels. |
| 4 | Publish the integration kit and coherent release | Fresh-clone instructions, downstream acceptance CI, public successful workflow, synchronized site/video/submission readback. |
| 5 | Record value and operating costs | Same-task measurement, clear first user, fees versus refundable deposits, and accurate adoption labels. |

Do not overwrite old deployments or evidence to imply that a new implementation was historically active. The deployed contracts have immutable configuration and no general upgrade interface. A corrected deployment, if required, needs its own version, cost estimate, receipts, and readback; no such deployment is performed by this review. Preserve the existing contracts as historical demo evidence. Additional MetaTx features, more MCP tools, or another consumer should follow the correctness and reference-application gates.

## Reproducing the diagnostic evidence

From the redesign project root, with its existing dependencies and a compatible Node.js version:

```sh
node artifacts/review-2026-10-24/reproduce-findings.mjs
```

The script executes no real transactions. It writes `artifacts/review-2026-10-24/reproduction-results.json` and records the hashes of the source files it used. That diagnostic output is replaced on a rerun: preserve a dated copy before rerunning after fixes. A changed result is expected after remediation. This script does not modify the sealed reports, baseline manifest, or production source.

The preceding review's ordinary verification commands were:

```sh
npm test
npm run build
```

The production build succeeded with installed ARM dependencies and ARM Node v24.19.0. The default shell's x64 Node encountered a Rollup architecture mismatch. A portable handoff should specify a matching Node/dependency installation; no dependency installation was performed for this report.

## Evidence-to-finding execution paths

| Path | Steps | Evidence and finding |
| --- | --- | --- |
| P-01: quorum overcount | Approve once → pass the same reviewer twice → observe count 2 | E-01 + E-02 → F-01 |
| P-02: catalog replacement | Create legitimate entry → unrelated owner creates and self-approves another release → replace the token entry → submit a new unrelated revision → observe invalidation | E-01 + E-02 → F-02 |
| P-03: replay overclaim | Verify the retained report fingerprint → supply only canonical/finalized checkpoint clients → perform zero contract reads → observe `reproduced` | E-01 + E-03 → F-03 |
| P-04: proposed business acceptance | A submits → B approves → A consumes → new revision blocks use → new exact report is approved and rebound | Required future evidence → F-04 + F-07 acceptance; not claimed complete |

Historical report integrity, a successful build, reviewer approval, fresh environment evidence, and independent adoption are separate claims. Each completed improvement should include the evidence for the specific claim it establishes.
