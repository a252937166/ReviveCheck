# ReviveCheck: score diagnosis and improvement plan

Assessed on October 25, 2026, against published source commit [`4dfb1e36000d09ff14a95855ee6bd8080c273542`](https://github.com/a252937166/ReviveCheck/commit/4dfb1e36000d09ff14a95855ee6bd8080c273542). This is an assessment and proposed work plan. Recommendations and acceptance criteria below describe work that remains to be implemented or demonstrated.

## Assessment

ReviveCheck is a credible technical project with a working release registry, retrievable evidence, a policy evaluator and a reference consumer. Its current weaknesses concern whether the final consumer decision is dependable, whether another builder can integrate it independently, and whether the decision solves a demonstrated maintainer problem. Public delivery is substantially improved: source, an independent HTTPS application, a public YouTube demonstration and the existing DoraHacks project page are available. Further improvement should concentrate on decision correctness, a complete live consequence, reusable distribution and user evidence. Additional interfaces or presentation assets alone would provide limited evidence for those claims.

The indicative score remains **75/100**. These are subjective assessments within the [official category weights](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail#evaluation-criteria), not organizer scores or a calculated probability of winning.

| Category | Assessment | Deduction | Main reason |
| --- | ---: | ---: | --- |
| Technical feasibility | 26/30 | 4 | Strong implementation and recorded delivery, with remaining consumer-binding issues and an unfinished live v2 lifecycle. |
| Innovation | 24/30 | 6 | Useful Portaldot-specific composition, but its advantage over an ordinary approval registry, CI and explorer workflow needs a clearer demonstrated consequence. |
| Ecosystem contribution | 14/20 | 6 | Reusable components and a reference application exist; clean external integration and actual independent use remain unverified. |
| Business potential | 11/20 | 9 | A plausible maintainer problem is described, but the recurring decision owner, measurable benefit and demand have not been validated. |

Ecosystem contribution and business potential account for **15 of the 25 deducted points** in this assessment. Engineering completion alone will not resolve most of that deficit. Actual revenue is not a prerequisite for a credible hackathon business case; an observed problem, a useful pilot and measured workflow outcomes would already improve its evidential basis.

### Current evidence boundary

- VerifiedTokenList v2 is deployed at `0xedaf8a25bb583ad164a94191b762414277198df9`, finalized deployment block 177354, with nine recorded verification checks passed.
- A fresh read on **October 25 at 04:28:59 EDT / 08:28:59 UTC**, finalized block **186536**, returned `isListed=false` and an empty pUSD entry through both EVM RPC and native ReviveApi. The [assessment observation](../artifacts/assessment-2026-10-25/v2-status.json) preserves that bounded result. The first v2 listing and live v2 Catalog acceptance remain pending.
- The complete 17-step revision, revocation, rebinding and renewal demonstration remains a local simulation. Historical v1 testnet transactions are preserved separately.
- The published source has recorded 160 passing tests and successful CI. The hosted release has recorded 17 passing public browser checks. Those checks establish their tested layers; they do not establish independent adoption or completion of pending chain operations.
- F-05 already has an invoked policy evaluator. F-07 already has an independently runnable reference application. F-10 has a documented scripted experiment, with its limitations disclosed. These findings should not be described as entirely unbuilt.

## Priority 1: make the consumer decision trustworthy

### A-01: bind the exact emitted Catalog entry to the approved evidence

**Evidence:** E-04. **Status:** code-inspection finding; no executable reproduction was performed in this assessment. The supplied configuration currently uses the correct 6 decimals.

**Root cause.** The Catalog accepts configured token metadata separately from its policy. Evaluation receives the policy, binding, approved report and chain reads, but not the complete configured output entry. Catalog generation then copies that metadata into the available entry. The sealed report binds its own listing, yet the consumer does not compare that listing with the metadata it emits.

**Why this lowers the score.** A maintainer needs assurance about the entry being published. An approval of a correct report is insufficient if a different entry can be emitted with the same valid verdict. The inspected dataflow permits changing configured output decimals from 6 to 18 without changing the approved report or the inputs to policy evaluation. This undermines the reference application's central product promise.

**Recommended method.** Define a canonical entry identity covering the network, token address, native asset ID and approved metadata. Prefer deriving the published entry from the verified approved report. If configuration supplies the entry, require an exact comparison with the approved artifact before enabling it. Explicitly separate any permitted display aliases from fields covered by acceptance. Apply the same invariant during binding and Catalog generation. Preserve original sealed reports; introduce versioned bindings or fingerprints where new semantics require them.

**Acceptance criteria:**

- A changed output decimals value cannot retain `available=true` under an unchanged approval.
- Each field claimed as verified has an explicit comparison; missing approved metadata blocks publication.
- An intact checksum never overrides an output/report mismatch.
- Canonical property order and address casing do not create false mismatches.
- The correct approved entry still passes the normal path; mismatches identify the field and required next action.

The v2 Solidity contract already reads `token.decimals()` and rejects an incorrect listing argument. This finding concerns the **off-chain Catalog output**, not a bypass of that contract check.

### A-02: bind persisted receipts to the actual operation

**Evidence:** E-05. **Status:** code-inspection finding; the relevant interface paths still recognize Consume completion using the release ID alone.

**Root cause.** Persisted Consume receipts omit the consumer contract/version and network identity. Completion checks do not require the entire operation identity to match the active context.

**Why this lowers the score.** A historical v1 transaction can appear to complete the active v2 workflow. A recorded transaction, a verified historical result and a currently eligible entry are different facts. A fresh domain avoids old-origin storage but does not correct the state model.

**Recommended method.** Persist the network/genesis, consumer address/version, token, release ID, exact report hash/revision and reviewer alongside the finalized receipt and readback checkpoint. Label mismatching old receipts Historical. Reconcile the selected operation through both interfaces. Present transaction completion separately from current policy eligibility.

**Acceptance criteria:**

- Switching v1 to v2 preserves the old receipt without marking v2 complete.
- Changing the token, network, reviewer, report or revision invalidates current completion.
- Finalized inclusion without successful matching readback does not show Listed.
- Reloading or importing a saved session preserves those distinctions.
- A later revision or revocation can change current eligibility without rewriting the historical receipt.

## Priority 2: record the complete live v2 consequence

### A-03: prove invalidation and recovery on the real testnet

**Evidence:** E-02, E-03. **Status:** deployment verified; remaining live lifecycle evidence incomplete.

**Root cause.** The strongest complete lifecycle evidence uses a local EVM and project-controlled fixtures. The real v2 contract has been deployed, but the reference token has no completed listing at the assessment checkpoint.

**Why this lowers the score.** A deployment demonstrates that code exists. The product claim concerns what a downstream application may do after approval and what happens when that approval no longer applies. Judges need to observe that consequence.

**Recommended method.** Use one coordinated signing session and a separate demonstration release label to preserve the historical revision-1 story. Run:

1. Check the entry, retain its exact report, submit it, approve it and list it on v2.
2. Record matching native/EVM readback and a valid live Catalog evaluation.
3. Perform the next acceptance check and retain its new report. Submit that exact hash as a new revision and show the old approval/binding no longer enables the entry.
4. Approve the hash actually submitted in that revision; demonstrate that approval alone does not update the old binding.
5. Explicitly rebind and relist; show restored availability through both interfaces and the Catalog.
6. Revoke and verify the loss of eligibility. Preserve every intermediate result.

Use separate owner/reviewer accounts to demonstrate role separation, while identifying their actual controller. Two project-controlled wallets do not establish independent review or adoption. Reconcile existing journals and chain state before every send; do not repeat the finalized deployment. A deliberate new release revision is not evidence of a runtime upgrade.

**Acceptance criteria.** Each transition has an actual finalized receipt where a write occurred, the matching contract/version and checkpoint, dual-interface readback, the exact report/binding and the resulting application decision. Old evidence remains inspectable. Expiry, unsupported runtime and node-outage fixtures remain explicitly simulated unless those conditions were actually observed on the testnet.

## Priority 3: make the lifecycle a product a maintainer can operate

### A-04: expose the business decision and its recovery path

**Evidence:** E-06, E-07. **Status:** policy mechanics and reference lifecycle exist; the Catalog operator experience remains mostly configuration and terminal driven.

**Root cause.** The architecture is clearer than the user's recurring job. The current narrative addresses issuers, launch teams, auditors, agents and CI. It does not give one accountable maintainer a single view of the entry, the decision and the action needed to restore eligibility.

**Recommended product focus.** Start with a **Portaldot wallet or DEX token-list maintainer**. The intended promise is:

> ReviveCheck helps a maintainer publish entries supported by the exact approved evidence, understand why an entry is no longer eligible, and restore eligibility through a new review and explicit binding.

Build one Catalog decision screen showing the emitted entry, approved report, consumer address/version, on-chain approval, listing status, application policy verdict, reason codes, evidence age, checkpoints and next action. Include comparison and append-only binding history. Use the existing evaluator across UI, CLI and consumer; avoid a separate UI decision engine.

**Acceptance criteria.** A reader can inspect a wrong-entry refusal, its correction, a revision-caused invalidation and explicit restoration without connecting a wallet. They can identify which fact enabled the entry, which event invalidated it and which action remains outstanding.

**Freshness boundary.** F-05 already checks report age, runtime observations, approvals and read provenance when invoked. It does not continuously reread arbitrary subject metadata or code. Keep on-chain approval separate from application permission. For a use case requiring current subject assurance, add a policy-required fresh subject check before publication/use: changed evidence requires recheck and approval, while unavailable or stale observations produce Unknown. Show evaluation time and freshness limits. A scheduler may request another evaluation; it must not silently approve or rebind a changed report.

## Priority 4: demonstrate reusable ecosystem value

### A-05: prove integration from a clean consumer environment

**Evidence:** E-07. **Status:** author-operated reuse demonstrated; independent integration and adoption unverified.

**Root cause.** The Catalog remains within the same repository. Its imports and downstream workflow assume the source-tree layout and root dependencies. The author controls the application, configuration and recorded roles.

**Recommended method.** Provide a minimal second consumer repository using a pinned public dependency or reproducible package artifact, documented exports, ABIs and versioned schemas. Give it a different subject or acceptance plan and its own explicit reviewer policy. Package distribution can use a release artifact; publishing to npm is optional. A clean consumer should not need private implementation imports, copied workspace state or a wallet for read-only acceptance.

Ask another builder to install and configure it from the instructions. Retain the consumer commit, dependency version, configuration, CI run, generated decision artifacts and every setup failure or instance of author assistance.

**Acceptance criteria.** A clean environment evaluates its own configured subject without author code edits. A correct case passes; incorrect metadata, superseded approval, revoked approval and unavailable verification refuse use. The downstream CI and artifacts are inspectable.

Keep the evidence levels separate:

| Evidence | What it establishes |
| --- | --- |
| A second self-built application | Portability and a second use of the documented interface. |
| Another builder running the supplied application | Independent execution and onboarding evidence. |
| Another builder configuring their own subject | Stronger integration and reuse evidence. |
| Repeated use in that builder's workflow | An adoption signal. |

The first level remains worthwhile if no external project is available. It must not be labelled external adoption.

## Priority 5: validate the need and measure the benefit fairly

### A-06: replace assumed efficiency with observed maintainer outcomes

**Evidence:** E-08. **Status:** F-10 remains open; the existing experiment is a useful scripted baseline, not a human productivity study.

**Root cause.** The current experiment compares author-written scripts with different coverage, checkpoints and connection setup. Twelve modelled operations versus two commands describes packaging. The recorded timings do not establish a speedup, fewer human errors or willingness to pay.

**Recommended method.** Identify the maintainer, reviewer and economic buyer separately. Document one existing listing process, its recurring trigger, decision owner, failure cost and the substitute they currently use. Test the value beyond a reasonable CI script plus explorer and approval record.

For a small exploratory study, aim for three to five relevant builders or maintainers. A single well-documented independent pilot is still useful if recruitment is limited; report its scope rather than generalizing.

- Predefine equivalent checks and expected decisions for both workflows.
- Use matching captured checkpoints for deterministic tasks, or document differences in live observations.
- Include a correct entry, incorrect decimals, superseded report, revoked approval and unavailable verification.
- Measure first-time installation/policy setup separately from repeat release decisions.
- Counterbalance comparable task sets to reduce learning effects.
- Record active human effort, network waiting, completion, false enables, false refusals, assistance and corrections.
- Give a second reviewer only the resulting artifact and test whether they can reconstruct the decision.

**Acceptance criteria.** Retain the protocol, versions, task inputs, anonymized observations and failures. Report the measured result even if execution is slower. Improved decision reconstruction or fewer incorrect enables may be more useful than raw speed. A small sample supports case-level findings, not population-wide claims.

For a plausible hosted service, investigate scheduled re-evaluation, retention and operational support with the pilot owner. Separate held deposits, spent fees, provider costs and operator labor. Testnet tPOT costs do not establish commercial unit economics. A concrete pilot commitment and repeated use support demand; encouraging feedback alone does not establish adoption or revenue.

## Priority 6: make the evidence path consistent

### A-07: remove contradictions across current materials

**Evidence:** E-09. **Status:** current website/video improved; several current setup and judging documents remain stale.

**Root cause.** Deployment records, landing copy, setup instructions and judging documentation have evolved separately. Published documents still describe v2 as awaiting funding and link to a missing `docs/RELEASE_V03.md`. The preserved Check-in deck reflects the earlier project.

**Recommended method.** Maintain one authoritative release-status record naming the source commit, network/genesis, consumer/version, observation time, checkpoints, completed transactions, pending work, site, video and current deck. Distinguish record integrity, deployment readiness, live consumer acceptance and lifecycle completion. Generate editable current guidance from it or link to it directly. Label historical snapshots without altering sealed evidence.

Update the final deck around one maintainer problem, one complete refusal/correction/review/rebinding example, the essential Portaldot modules, reusable integration evidence and measured value. Preserve the original Check-in deck and videos as history. The official detailed freeze is **November 5, 2026 at 23:00 EST in New York** (November 6, 04:00 UTC); final materials must reflect the evidence actually completed by that point.

**Acceptance criteria.** README, consumer setup, deployment record, explorer links, application, video and final deck agree. Every linked file exists. Every displayed decision identifies its checkpoint and evaluation time. A green integrity check never implies `catalogV2.ready=true` while listing/readback/evaluation evidence is missing.

## Execution order and scope

The implementation path is **A-01/A-02 correctness → A-03 live consequence → A-04 operator workflow**. In parallel, prepare **A-05 clean integration → A-06 pilot/value evidence**. Complete **A-07 final-material reconciliation** after the evidence is stable.

Meaningful score improvement should follow new evidence: the reference consumer cannot publish an entry different from the approved artifact; the real v2 lifecycle changes eligibility as claimed; another builder completes a clean integration; a maintainer can reconstruct and use the decision. Do not award additional points merely for transaction count, commit count, another interface or a new visual asset.

Keep additional AI integrations, new broad target markets, gasless review, mainnet deployment and an always-on monitoring platform outside this critical path unless the chosen pilot requires them. MCP remains a useful access interface to deterministic verification. An AI capability is not required to validate the release-eligibility product.

## Evidence register

This assessment uses the following Evidence → Finding → Improvement path. Published source references are pinned to commit `4dfb1e3`; live observations are dated and do not make claims about future state.

| ID | Evidence and source | Supports |
| --- | --- | --- |
| E-01 | [Official criteria and final requirements](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail), read October 25, 2026. | Score weights and final-material scope. |
| E-02 | [Published commit](https://github.com/a252937166/ReviveCheck/commit/4dfb1e36000d09ff14a95855ee6bd8080c273542), [CI](https://github.com/a252937166/ReviveCheck/actions/runs/40117064655), [Catalog acceptance CI](https://github.com/a252937166/ReviveCheck/actions/runs/40117064653), [publication provenance](https://github.com/a252937166/ReviveCheck/blob/4dfb1e36000d09ff14a95855ee6bd8080c273542/docs/PUBLICATION_2026-10-24.md). | A-03; separates verified delivery from remaining lifecycle evidence. |
| E-03 | [Read-only v2 observation](../artifacts/assessment-2026-10-25/v2-status.json), October 25, 08:28:59 UTC, finalized #186536. | A-03; v2 identity agrees, pUSD not listed through either interface. |
| E-04 | Published `examples/token-catalog/lib/catalog.js:23-31,45-54`, `catalog.js:55-68`, `lib/policy.js:93-99,198-203`, `lib/report.js:16-31`; `contracts/VerifiedTokenList.sol:55-64` bounds the contract claim. | A-01; static dataflow inference, not an executed exploit. |
| E-05 | Published `src/Try.jsx:525,550,625`. | A-02; completion and persistence use insufficient operation identity. |
| E-06 | Published `docs/POLICY.md:37-45,59-65`, `lib/service.js:137-151`, `contracts/VerifiedTokenList.sol:76-78`. | A-04; existing point-in-time policy and fresh-subject guarantee boundary. |
| E-07 | Published Catalog README, `catalog.js`, `acceptance.workflow.yml`, root `package.json`, and the browser source. | A-04/A-05; useful reference application, source-tree coupling and operator experience. |
| E-08 | Published [value experiment](https://github.com/a252937166/ReviveCheck/blob/4dfb1e36000d09ff14a95855ee6bd8080c273542/docs/VALUE_EXPERIMENT.md):3,16-41,63-68 and `docs/JUDGING_FIT.md:56-68`. | A-06; differing scripted coverage, unmeasured human benefit and business hypotheses. |
| E-09 | Published `docs/RELEASE_STATUS.md:23,34`, Catalog README:12,63, `docs/JUDGING_FIT.md:18,73,84,89-90`; original deck under `artifacts/`. | A-07; stale current guidance, missing release-document links and final-deck work. |

E-03 artifact SHA-256: `fddae98dd0d32ead2f873082f554efc570a2ecacff9adc88d65e7a3fbb171f21`.

The read-only chain observation can be repeated in a configured checkout with installed dependencies:

```sh
node scripts/revivecheck.js token_list_status --token 0x00001e6100000000000000000000000000010000
```

A later run will observe a later checkpoint. For example, source inspection can be repeated in a clone containing the reviewed commit using:

```sh
git show 4dfb1e36000d09ff14a95855ee6bd8080c273542:examples/token-catalog/lib/catalog.js
```

No benchmark, code test or chain transaction was executed to validate the proposed changes during this assessment.
