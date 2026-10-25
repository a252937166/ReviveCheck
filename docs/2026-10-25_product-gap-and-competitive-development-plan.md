# ReviveCheck: product gaps, competitive comparison and development plan

Reviewed October 25, 2026. ReviveCheck source: `be2b944`; independent consumer: `5167c37`. Scope: product engineering, reusable integration and operational reliability. This plan prioritizes the application itself; media production is outside its scope.

## Executive decision

The principal weakness is **an incomplete maintainer job**, rather than a shortage of verification functions. ReviveCheck can check evidence, record exact-hash approval and evaluate a configured consumer. A new user still encounters inconsistent report transitions, example-specific defaults, a fixed consumer configuration and a business action that ends with an alert.

The next release should let a maintainer bring a supported token entry, check and review the exact release, define the application's policy, create a versioned catalog release and have another application consume that release under explicit freshness rules. The product must also guide invalidation, renewal and replacement while preserving history.

Prior deadline enforcement, known-version validation, custom native-asset intake, package distribution and portable decision evidence are implemented. They should be extended and connected, not rebuilt. Public read-only use remains open to everyone without login, invitation, visitor approval or wallet installation. Signed actions remain explicit actions of the appropriate account.

## 1. What the selected competing projects actually demonstrate

This is a focused comparison of three adjacent submissions in Modular Cloud & Middleware. It is not a ranking of all entrants. Source inspection, a readable deployment, retained transaction records and an independently executed transaction are different levels of evidence; this review did not execute competitor code or submit transactions.

### PortalKit: connect the tool to a completed application operation

Reviewed public source: [`05539d6948501b8ffba680642784cd538eb3b3cc`](https://github.com/cris-the-dev/portaldot-hackathon/commit/05539d6948501b8ffba680642784cd538eb3b3cc). [Competition entry](https://dorahacks.io/build/50085).

The inspected code includes a configurable application generator, a network diagnostic command, an ABI/bytecode deployment interface and an ERC-4626 reference application. Its generator writes a new project's files and configuration. The vault interface prepares approval, deposit, redemption and withdrawal operations and waits for receipts. The dashboard and vault URLs were reachable during the source reviewer’s check; the recorded business transactions were not independently reread from chain.

Sources: [application generator](https://github.com/cris-the-dev/portaldot-hackathon/blob/05539d6948501b8ffba680642784cd538eb3b3cc/packages/cli/src/create.ts), [vault transaction interface](https://github.com/cris-the-dev/portaldot-hackathon/blob/05539d6948501b8ffba680642784cd538eb3b3cc/apps/vault/src/components/trade.tsx), [transaction runner](https://github.com/cris-the-dev/portaldot-hackathon/blob/05539d6948501b8ffba680642784cd538eb3b3cc/apps/vault/src/lib/vault.ts).

**Lesson:** an integration is more persuasive when it produces an application or completes a useful operation. ReviveCheck's selector proves a narrow enforcement mechanism, but its `Continue` alert is a weaker completed user task. Develop a small catalog-release operation rather than copying an exchange or vault.

### PalletDock: make downstream consumption and failure semantics concrete

Reviewed public source: [`23d939dae0cd501744d654dda658bebfc33c290f`](https://github.com/zkzora/palletdock/commit/23d939dae0cd501744d654dda658bebfc33c290f). [Competition entry](https://dorahacks.io/build/50251).

Its API and consumer code implement bounded reads, snapshot reconciliation, event identity, source coverage and freshness. The [public consumer](https://palletdock.vercel.app/consumer) was exercised with a read-only refresh in this review. It displayed value 46, two event records and current indexer coverage, while explicitly reporting finality as unknown. This confirms an accessible consumer path, not every historical indexing or transaction claim.

Sources: [consumer core](https://github.com/zkzora/palletdock/blob/23d939dae0cd501744d654dda658bebfc33c290f/apps/web/lib/consumer/core.ts), [scoped read API](https://github.com/zkzora/palletdock/blob/23d939dae0cd501744d654dda658bebfc33c290f/apps/api/src/v1.ts), [public consumer route](https://github.com/zkzora/palletdock/blob/23d939dae0cd501744d654dda658bebfc33c290f/apps/web/app/consumer/state/route.ts). Its [hosted recovery record](https://github.com/zkzora/palletdock/blob/23d939dae0cd501744d654dda658bebfc33c290f/docs/evidence/2026-10-24-hosted-missed-log/README.md) documents both mitigation and an unrecovered historical gap.

**Lesson:** a consumer should load a real output, retain its provenance and respond coherently to stale or unavailable data. ReviveCheck should make policy, report, binding and release-generation identity equally explicit. PalletDock's owner authentication is not a reason to add a visitor gate to ReviveCheck.

### Plumbline: turn diagnostics into actionable developer output

Reviewed public source: [`cbd7cb533ed59606ea9021c0ceb086f2f08a97fb`](https://github.com/edycutjong/portaldot-hackathon-2026-plumbline-edycu/commit/cbd7cb533ed59606ea9021c0ceb086f2f08a97fb). [Competition entry](https://dorahacks.io/build/50127).

The inspected CLI accepts a dApp directory and target profile, scans supported source/artifact patterns and emits file/line findings with deterministic exit status. Its proof vocabulary distinguishes metadata presence from execution evidence; three V3 canary receipts are retained. Exit zero means no recognized blocking finding, not that every operation was executed or proven compatible.

Sources: [CLI contract](https://github.com/edycutjong/portaldot-hackathon-2026-plumbline-edycu/blob/cbd7cb533ed59606ea9021c0ceb086f2f08a97fb/plumbline/cli.py#L281), [scanner](https://github.com/edycutjong/portaldot-hackathon-2026-plumbline-edycu/blob/cbd7cb533ed59606ea9021c0ceb086f2f08a97fb/plumbline/check.py#L529), [verdict definitions](https://github.com/edycutjong/portaldot-hackathon-2026-plumbline-edycu/blob/cbd7cb533ed59606ea9021c0ceb086f2f08a97fb/plumbline/verdicts.py).

**Lesson:** make a failed release directly repairable and usable in CI. ReviveCheck should identify the exact field, observed value, expected value, responsible role and required next step. Broad source scanning is outside the focused product opportunity.

### The comparative conclusion

| Dimension | Competitive pressure | ReviveCheck's useful response |
| --- | --- | --- |
| Completed task | PortalKit connects tooling to generated applications and operational business code | Deliver an actual versioned catalog release and a reader of it |
| Application consumption | PalletDock exposes a working public consumer with explicit source-state semantics | Make consumer configuration portable and decisions enforceable beyond one hardcoded example |
| Repair and CI | Plumbline provides localized findings and an explicit CLI outcome | Provide field-level remediation and a reusable release gate |
| Acceptance lifecycle | The inspected components have different primary jobs | Retain the relationship between exact report, approval, consumer policy, invalidation and explicit recovery as the core distinction |

ReviveCheck's complementary native/EVM observations, stored sealed reports and contract-readable approval are meaningful. They do not independently prove RPC honesty or establish market demand. More interfaces, test counts or module names alone will not resolve the product gaps below.

## 2. Main scoring weaknesses and their causes

| Priority | Weakness | Why it loses credibility or value | Required outcome |
| --- | --- | --- | --- |
| P0 | Report-bound state can leak across releases | The UI can imply that a new report is already approved | Every visible status and prepared operation refers to the explicit active report/release/revision |
| P0 | A visitor's own token works at intake but not through the entire workflow | Generic input creates an expectation the Studio and consumer do not yet satisfy | One supported user-owned configuration works through repeated checks, review, binding and consumption |
| P1 | The business action ends in an alert | The integration is still closer to an enforcement demonstration than a completed maintainer task | Generate, retain and consume a real catalog release |
| P1 | Consumer policy and binding setup remain author-specific | Another builder must edit source/configuration and understand undocumented workflow assumptions | A validated portable project bundle and a complete starter |
| P1 | Current approval can be confused with current subject correctness | A historical metadata/code check is weaker than a claim about what is publishable now | Explicit optional fresh-subject requirements with bounded support and correct failure behavior |
| P1 | Renewal is a manual runbook with an availability gap | Recurring operation depends on the author noticing and coordinating every step | Evidence health, role-specific renewal preparation and verified resumability |
| P1 | The latest product is not publicly reproducible yet | New local capabilities cannot be used or assessed by another builder | Public source, custom-domain application and consumer, working links and verified build provenance |
| P2 | Value and documentation are inconsistent | Old defect statements and overstated assurance weaken a trustworthy product | Current capability documentation and reproducible task-level evidence |

## 3. D-01: introduce one active-report lifecycle model

**Type:** correctness repair; first implementation gate.

Three related failures share the same root cause:

- `src/CheckToken.jsx:26` clears `review`, but leaves actual `approve`, `remark` and `verified` state when handing a different report to Studio.
- `src/Try.jsx:29` merges stage updates without consistently invalidating dependent stages.
- `src/Try.jsx:56` chooses any passing old recheck before the current check. Executing the actual helper with a new failed check and old passing recheck selected the old report.

Approval badges and completion currently rely on receipt presence in places such as `src/Try.jsx:651,682`. This is a UI/session defect; it is not evidence that the on-chain exact-hash guard was bypassed.

**Implementation:**

1. Add a pure Studio state-transition module with an explicit active project, plan fingerprint and report hash. Use the active report even when its result is failed or unknown.
2. Define transitions for new check, recheck, imported report, project switch, submission, review, binding and listing. Each transition invalidates dependent active state consistently.
3. Archive prior report-bound receipts, attestations and results under their original context. Preserve them as history rather than deleting or relabelling them.
4. Clear prepared transaction payloads and signer-specific estimates when their context changes. An asynchronous response for an earlier context cannot complete the new operation.
5. Derive stage badges, reviewer defaults and completion from matching report, release, revision, network and consumer identity. Keep review receipts, signed remarks and Registry approval distinct.
6. Apply the same transition logic on reload and migration of existing browser sessions. Incomplete legacy identity becomes historical or unverified.

**Acceptance:** report A approved, then report B checked/imported/submitted, never makes B approved from A's state. A new failing check cannot fall back to an old passing report. Reload, project switching and pending asynchronous answers preserve those distinctions. Include a browser journey test; isolated helper tests alone missed this composition failure.

## 4. D-02: finish the visitor-owned project workflow

**Type:** correctness repair plus product completion.

`Check my token` is implemented, but `src/Try.jsx:178` sends `choice === 'own'` to `checkDemoRelease`. Executing the actual dispatch produced `Unknown demo release own`. Submission and consumption also retain pUSD-specific defaults (`src/Try.jsx:333,523-524`). The generic intake is therefore not yet a complete generic lifecycle.

**Implementation:**

- Send both custom and own plans through the general checker. Preserve the visitor's project identity instead of passing the fixed demo identity.
- Derive token address, asset ID, decimals and suggested release label from the active plan/report. Never substitute pUSD because a field is missing.
- Add **Use this report in my project** to create or select a browser-local project with its own policy draft, reviewer trust declaration, release identity, storage locator and binding candidate.
- Reuse `normalizePolicy`, `createBinding`, evidence retrieval and existing registry reads. Make the exact candidate hash visible before it is bound. A candidate is not an approval.
- Export/import a versioned project bundle containing supported plan, policy, exact report reference, release/revision, storage locator, consumer identity and binding history. Recompute its fingerprints and verify chain evidence when evaluating.
- Persist public project data locally and support a portable file. Keep read-only use open. Publishing globally shared mutable workspaces or introducing account infrastructure is unnecessary for this scope.
- Treat imported reviewer trust as an explicit policy choice. A checksum does not make a reviewer trustworthy or prove project ownership.

**Acceptance:** a clean browser creates two separately named supported projects, checks each again, prepares the correct submission, inspects matching review state, binds explicitly and exports usable consumer configuration. They may share an existing asset; do not claim this proves two independent adopters. Switching projects cannot mix policies, subjects or approvals. A generic failure never silently switches to the demo.

## 5. D-03: replace the terminal alert with a catalog-release operation

**Type:** highest-value business-function addition.

The consumer's action checks permission correctly but ends in an alert (`web/App.jsx:162-166`). Extend this into one concrete maintainer job: **prepare a versioned token-catalog release from eligible entries**.

**Minimum operation:**

1. Load a validated project bundle and inspect the requested entry and policy.
2. Collect fresh policy inputs for release preparation; enforce current-clock permission again at the commit action.
3. Derive the output entry from the approved report and require equality with the requested entry.
4. Generate an immutable catalog release and decision-evidence sidecar. Include project/release version, canonical entries, network, report/policy/binding identities, evaluation hashes, checkpoints, validity deadline, previous release hash and a recomputable release hash.
5. Save the release locally and export it. Label a local export accurately; it is not proof of hosting or delivery.
6. Add an independently runnable reader that imports that generated file, reconstructs its evidence and uses its entries in its token selector or catalog view.
7. Retain earlier catalog versions and show an entry/evidence diff. An expired artifact remains historical evidence, not current action permission.

The reader must apply the declared policy and freshness requirements before use. A hash-valid exported file does not establish that its approval still stands. Current reads showing revocation, supersession or missing evidence must withhold the entry. This is a point-in-time decision, not an atomic guarantee against all future state changes.

**Acceptance:** the maintainer can produce a useful output file and another process can consume it without importing ReviveCheck's private workspace. Wrong metadata, an observed revoked approval, superseded binding, expired evidence or unknown verification prevents an eligible release entry. Two releases can be compared and the decision behind each entry can be reconstructed.

This provides a real business output without building an AMM, exchange or payment service.

## 6. D-04: provide fresh subject assurance where the action needs it

**Type:** focused product innovation; explicit assurance upgrade.

`lib/service.js:137-151` refreshes network, Registry, listing and stored evidence. `lib/policy.js:198` validates subject identity against the historical report. `VerifiedTokenList.isListed` checks standing approval; it does not reread the entire current token metadata. The current behavior is documented and should receive credit as a bounded point-in-time policy.

For a maintainer about to publish metadata, add a policy option that explicitly requires a current subject observation:

Implement the native-asset publishing profile first. Additional contract assertions are a separately scoped extension when a concrete supported workflow requires them.

- For the supported native-asset profile, compare the release-critical symbol, name, decimals and address mapping through the supported native/EVM interfaces at a finalized checkpoint.
- Compare the fresh observation with the approved report and requested catalog entry. Changed asserted fields require recheck and review; absent, unsupported, stale or disagreeing observations are unknown.
- Include the subject observation's timestamp in the decision's earliest validity deadline and its checkpoint in the exported evidence.
- For supported contract profiles, verify declared code identity/assertions only. A proxy's unchanged bytecode does not prove its implementation or arbitrary storage state is unchanged.
- Do not invalidate metadata releases for ordinary supply or balance changes unless the acceptance plan explicitly requires those values.
- Introduce the additional policy field and canonicalization with explicit schema compatibility. Do not silently change existing policy fingerprints or claim that old policies gained stronger guarantees.

**Acceptance:** unchanged current subject data remains usable; a changed asserted field with an otherwise standing old approval is withheld; missing subject reads do not pass; disabled optional checks do not imply current subject verification. No continuously running monitor or new contract deployment is required to implement these reads.

## 7. D-05: package an enforceable release gate and integration starter

**Type:** ecosystem contribution with a measurable developer outcome.

The package, CLI, consumer tests and evidence reconstruction exist. Assemble them into one supported recipe a maintainer can use from a clean directory:

- A small starter containing project configuration, policy declaration, binding locator, entry configuration, a release-generation command and an example reader.
- One documented command that validates configuration, retrieves evidence, evaluates current inputs, verifies entry equality and writes the catalog release only when permitted.
- A CI workflow that uses the same implementation, retains decision evidence and prevents production of the release artifact on a refused/unknown result.
- Stable machine-readable outcomes and documented nonzero exit behavior. Keep an unavailable node distinguishable from a known policy refusal in the artifact, even if both block publication.
- Field-level diagnostics: JSON pointer, configured/approved/observed values, evidence/checkpoint, responsible role and next action. Reuse existing reason codes.
- Separate deterministic offline regression tests from optional network-dependent acceptance. A live check must never silently become a fixture-backed success.

**Acceptance:** a clean directory with only the installed artifact and shipped documentation can configure its own project and generate/consume a release. No source-tree lookup or private file is needed. Known refusal cases block artifact generation. Public CI proves the packed package path and retains reviewable outputs. Label author/agent-operated runs accurately; an outside human trial is useful additional evidence, not a prerequisite.

## 8. D-06: make evidence health and renewal a product workflow

**Type:** recurring lifecycle and operational continuity.

The current report expires November 1, 2026, 04:29:17.646 EST in New York. `docs/RENEWAL.md:42` recommends November 3/4. That can produce evidence for the final review, but it leaves a period of expected denial. A public product should either renew before the first expiry or explicitly expose the planned gap.

**Implementation:**

- Add an evidence-health view showing report expiry, observation deadlines, current approval, bound revision, available successor report and next responsible role.
- Prepare a renewal task with distinct owner check/store/submit, reviewer decision, operator binding and listing/readback stages.
- Derive the next revision from verified current state rather than assuming revision 3. Generate a successor consumer configuration and a human-readable diff.
- Make preparation read-only. Preserve explicit signatures, current budget guards, one coordinated signer and pending-transaction journals for actual writes.
- Resume only after each prior stage has a known verified result. A pending or uncertain send is a stop condition, not a retry instruction.
- Keep old reports, decisions and bindings append-only. A newly approved report never silently migrates a consumer's binding.

**Acceptance:** an operator can prepare renewal before expiry, see incomplete steps, resume a verified partial run and activate the explicit replacement without duplicate sends or manual source edits. Old and new bindings remain inspectable. Continued public usability is checked across the intended review period using the actual policy lifetime.

## 9. D-07: deliver the usable product on the chosen public infrastructure

**Type:** product availability and reproducibility.

The current local source is ahead of public main: this review again read `455cc60` on GitHub while the local implementation is `be2b944`. The consumer has no public remote. New product features need a public executable destination and valid source links.

Publish the reviewed source and deploy both applications through the existing custom-domain/DogYun setup, using the established release/rollback procedure. Generate and parse a real hosting manifest; an HTTP 200 SPA fallback is not a manifest. Keep local-workspace mutation endpoints private while browser-based public reads remain open.

Deliver verified increments after the correctness gate and each subsequent feature gate. Public availability should advance alongside development rather than wait for every enhancement in this plan.

**Acceptance:** a logged-out browser with empty local storage can create/import a supported project, inspect evidence, evaluate and generate/consume a catalog release from the public product. Public source instructions reproduce the same version. Timeout, invalid import, stale tab and unavailable node produce explicit states and preserve historical evidence without granting current permission.

This is application delivery work, independent of presentation materials.

## 10. D-08: make the value claim measurable and documentation current

The fair benchmark supports reconstructable decisions, not demonstrated speed or customer demand. Measure a complete product task after D-01 to D-05: cold start, configure a project, detect wrong metadata, inspect exact evidence, correct and review the release, generate a catalog artifact, consume it, invalidate it and explicitly restore it.

Record actual setup steps, documentation/source assistance, refusal outcomes, recovery actions and retained artifacts. Separate network waiting from computation. Compare equivalent tasks and checks if retaining a baseline. An author/agent-operated task is acceptable when identified; it does not become independent adoption or willingness to pay.

Update `docs/BUSINESS_BRIEF.md` and current overviews: old MCP-resource and refresh defects are fixed; expiry evidence is still simulated unless observed; the contract checks token decimals at listing time, while the consumer establishes entry-to-report equality. Keep those assurance layers accurate.

**Acceptance:** a reader can reconstruct a generated release and its refusal/recovery history from public outputs. Current documentation agrees with current code and explicitly separates observed parity, approval, eligibility and completed application output.

## 11. Recommended execution sequence

| Stage | Scope | Exit gate |
| --- | --- | --- |
| A: lifecycle correctness | D-01 and the own-plan checker routing/defaults in D-02 | No cross-report state leakage; own input can be checked again; failed checks cannot select old passing evidence |
| B: customer configuration | Remaining D-02 | Browser-local projects and portable policy/binding configuration work without source edits |
| C: useful application output | D-03 and the smallest reader | The generated catalog is actually consumed; refusal prevents release eligibility |
| D: current assurance and reuse | D-04 and D-05 | Explicit fresh-subject policy and clean-install release gate work with meaningful failure cases |
| E: maintained public product | D-06 to D-08 | Renewal, public application availability, reproducibility and task evidence are verified |

D-07 is also a delivery lane across Stages A to D: publish each verified increment through the existing release process. Stage E verifies the complete maintained product; it is not the first publication opportunity.

D-01 to D-05 can largely be developed and tested without new testnet spending. Reuse existing contracts. If a real renewal or a different release needs signed operations, use the existing guarded workflow and retain actual receipts/readback. This document itself performs no publication or transaction.

Prioritize one coherent end-to-end path over additional unrelated surfaces. The complete release should answer one customer question:

> Can I publish this exact entry under my policy, show why that decision holds, and explicitly recover when its evidence or approval stops applying?

## Local evidence index

| Evidence | Source | Supports |
| --- | --- | --- |
| L-01 | `src/CheckToken.jsx:23-28`, `src/Try.jsx:29,56,651,682`; offline execution of actual handoff/report-selection helpers | D-01 |
| L-02 | `src/Try.jsx:178,333,523-524`; offline own-plan dispatch returning `Unknown demo release own` | D-02 |
| L-03 | `src/Catalog.jsx:24-47`; consumer `config/allowlist.json` | D-02 |
| L-04 | Consumer `web/App.jsx:162-166`, `src/selector.js` | D-03 |
| L-05 | `lib/service.js:137-151`, `lib/policy.js:198`, `contracts/VerifiedTokenList.sol:61,76`, `docs/POLICY.md` | D-04 |
| L-06 | Installed package/artifact verification records, `docs/LIBRARY.md`, consumer workflows | D-05 |
| L-07 | `docs/RENEWAL.md:3,42`, current report and policy, consumer configuration | D-06 |
| L-08 | Current git identities and read-only `git ls-remote` observation; publication records and consumer README | D-07 |
| L-09 | `docs/VALUE_EXPERIMENT.md`, `docs/BUSINESS_BRIEF.md:17,35,38-39` | D-08 |

The previous complete test/build review passed 207 main-project and 17 consumer tests at the same implementation revisions. The new composition defects above explain why passing existing tests does not establish the missing end-to-end product behavior. Add the specified regressions rather than treating the test count as a completion metric.
