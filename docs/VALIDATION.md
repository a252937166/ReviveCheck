# ReviveCheck validation record

Validation date: 2026-10-23, America/New_York. Scope: the local prototype at implementation revision `a07a912` and its local Check-in materials. The interactive app remains local. Public video and source are available; formal Check-in was submitted and is Under Review; see [SUBMISSION.md](SUBMISSION.md).


## Manual checks of 2026-10-25

The sections below this one are the manual acceptance record of the first release (2026-10-22 and 2026-10-23) and are kept as history; their balance, deployment and support-ticket statements describe that time. The current status record is `public/release-status.json` (mirrored by [RELEASE_STATUS.md](RELEASE_STATUS.md)).

Performed by the author on the production build served locally, in headless Chromium at 1360 by 900, without a wallet:

- Catalog decision page, v2 catalog (`#/app/catalog/testnet-v2`): renders **Available**, "Policy: Valid", "Entry equals the approved report", the reasons, the next action, the recorded evaluation (35 checks), the three fact cards, the published-entry table, the recorded checks, the 12-step recorded execution with explorer links and the binding history including the superseded-policy binding. Screenshot: `artifacts/assessment-2026-10-25/catalog-decision-v2.png`. No console errors.
- Evaluate now on that page: the in-browser evaluator read the registry, the token list, the stored report and the finalized head and returned **Available now**, `valid`, checkpoints #187,343 on portaldot-v3/3002, with an evaluation hash. Screenshot: `artifacts/assessment-2026-10-25/catalog-decision-v2-evaluate-now.png`.
- Wrong-entry catalog (`#/app/catalog/testnet-v2-wrong-entry`): renders **Withheld**, "Policy: Valid", "Entry differs: decimals", the `entry-mismatch:decimals` reason with its text, and the next action telling the maintainer not to publish. Screenshot: `artifacts/assessment-2026-10-25/catalog-decision-wrong-entry.png`.
- Offline: `npm test` 168 passing; `npx vite build` passes; `node scripts/release-status.js` reports `ok` with all 13 integrity checks passed and five of six levels established (independent adoption not established).

No independent user, saved human time, revenue, security audit or organizer decision is established by these checks.

## Commands run for this record

Environment: Node.js `v22.23.1`, npm `10.9.8`.

| Command | Actual result | Meaning |
| --- | --- | --- |
| `npm test` | Exit 0; **26 tests passed, 0 failed, 0 skipped** | Deterministic chain-inspector, Probe compilation, persistence, comparison, scope, and evidence-integrity regressions passed |
| `npm run build` | Exit 0; Vite `7.3.7`, 1,574 modules transformed | The production frontend bundle built successfully |
| `ffprobe -v error -show_entries format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate -of json video/check-in.mp4` | Exit 0; H.264 video, **1920×1080, 30 fps, 78.000 seconds**, one video stream and no audio stream | The local video has the intended format and is below the three-minute limit |

The build emitted `dist/index.html`, a 27.54 kB CSS asset, and a 254.64 kB JavaScript asset (78.46 kB gzip). Bundle generation does not establish that every browser interaction passed. These command results were obtained after the comparison/rehearsal regressions and both H160 reverse-mapping regressions were added.

## Automated behavior covered

- Missing live account, deployment, or transaction evidence cannot pass acceptance.
- Wrong expected network, mismatched cross-interface checkpoints, failed account round trips, empty code, mismatched values, and failed or unrelated transactions remain failures or blocked checks as appropriate.
- Transaction evidence from a different sender cannot establish provenance for the configured project account.
- Token-unit conversion remains exact; native funding availability respects both frozen funds and the existential deposit.
- The included Probe compiles with the pinned compiler and exposes the expected owned state-changing function. Compilation is not deployment.
- Earlier run inputs survive project edits, restart, comparison, and archive/restore; concurrent store writes preserve both objects.
- Changed saved evidence fails JSON integrity verification; mixed live/rehearsal scopes cannot be compared as the same proof.
- Changing the account, contract, or expected value cannot be counted as repairing the same acceptance target. Correcting the expected chain carries a configuration-correction caveat.
- Rehearsal respects the saved chain expectation. Its synthetic success remains distinct from live execution.

Tests use deterministic clients and fixtures where appropriate. They do not establish live deployment, real write/readback, independent adoption, or production safety.

## Manual browser acceptance

The following actions were exercised in Chrome against the local app. A production-server restart preserved both saved projects and all seven reports.

| Journey | Current result | Evidence boundary |
| --- | --- | --- |
| Create a named project | Passed in browser | A user-owned local project is created; it is not a public account or hosted workspace |
| Edit and save its acceptance configuration | Passed in browser | Current configuration can change while prior run inputs remain separate |
| Wrong-network rehearsal → corrected rehearsal | Passed in browser | Synthetic fixtures exercise failure and rerun; no local EVM or signed testnet transaction is executed |
| Compare saved runs | Passed in browser | Same-target evidence is compared; configuration correction is distinct from an application code fix |
| Live read-only run with incomplete inputs | Passed in browser | Actual network checks run; missing mapping, funds, contract, value, and transaction evidence stay blocked |
| Archive and restore through the UI | Passed | Archived project remained searchable, its five reports stayed visible, editing/runs were disabled, and restore re-enabled the plan |
| Narrow/mobile viewport | Passed at 390×844 | Configuration, report, comparison, and history remained readable; document width matched viewport (375 CSS px with scrollbar); temporary viewport override reset |
| JSON/HTML HTTP exports | Passed | Both returned attachment headers and expected content. Exported JSON passed `verify-report.js`; HTML names the companion JSON integrity boundary. Native Chrome download completion was not confirmed |

The local service binds to `127.0.0.1`. A hosted public demo has not been published. The current server is a local single-developer workspace, not a multi-user service.

## Real network evidence

[The saved read-only diagnostic](../artifacts/live-readonly.json) contains the actual V3 chain ID `420420777` and a shared finalized native/EVM checkpoint at height `155464`.

| Check in that diagnostic | Recorded result |
| --- | --- |
| `network.chain-id` | Passed |
| `network.finalized` | Passed |
| `account.mapping` | Blocked |
| `account.balance` | Blocked |
| `contract.code` | Blocked |
| `contract.value` | Blocked |
| `transaction.finality` | Blocked |

This diagnostic is a raw inspector snapshot, not a sealed workspace report with an evidence fingerprint. Its two successful network checks cannot be described as a passing live release or proof of our own deployment.

[The constructor dry-run artifact](../artifacts/constructor-dryrun.json) records a real unsigned runtime simulation: putting EVM constructor arguments in the native data field fails with `revive.EvmConstructorNonEmptyData`; appending the ABI argument to EVM initcode succeeds in the corrected simulation. It uses the public guide's example origin. It does not demonstrate control of that account, persistent deployment, a signed transaction, or a subsequent state-changing write.

See [CHAIN_FINDINGS.md](CHAIN_FINDINGS.md) for the exact runtime observations, conversion rules, constructor case, and historical-transaction versus current-state boundary.

## Video and material review

Local artifact: [check-in.mp4](../video/check-in.mp4). This is a **78-second silent walkthrough assembled from actual application screenshots with English captions**, not a continuous interaction recording. It shows a synthetic failure and rerun, comparable evidence, live blocked checks, export, and the remaining signed-deployment milestone.

The video workstream recorded successful HyperFrames checks, zero lint/runtime/layout/motion errors, 15/15 contrast checks, and decoded-frame inspection. Its retained `film_silent` warning matches the intentional caption-only brief. These checks and visual limits are documented in [video/REVIEW.md](../video/REVIEW.md); the format was independently confirmed with ffprobe for this record. The unchanged MP4 is publicly hosted on GitHub Pages and Releases; anonymous size/hash/format verification is recorded in [video/PUBLISHED.md](../video/PUBLISHED.md).

The delivered sequence is documented in [DEMO_SCRIPT.md](DEMO_SCRIPT.md), [video/README.md](../video/README.md), and [video/captions.srt](../video/captions.srt).

## Operational and submission states

- Registration completed with platform readback showing “Unregister” and “Congratulations.”
- An isolated test wallet was created and stored as requested. No private wallet content is included in the product, repository, or this record.
- Discord ticket `1295` was created. After the temporary timeout expired, a further attempt was removed again and triggered another approximately five-minute timeout. **Funding-request delivery is not confirmed.** Automated retries stopped; the user must contact support manually. No reason for the moderation action was established.
- The latest reported balance is **0 tPOT**. Our Probe is **not deployed**, and signed write/readback is **not completed**.
- Public repository and public video playback are verified. A six-page PDF Deck is prepared for the required form field. Formal Check-in submission is confirmed; organizer acceptance remains pending.

No independent user, saved development time, revenue, security audit, or general EVM compatibility claim is established by these checks.

## Final completion gates

1. Manually confirm the support request reaches staff, then independently confirm test-token receipt.
2. Perform and record our own V3 deployment and a separate write/readback when funded; keep it distinct from constructor simulation.
3. Record the organizer decision and later execution evidence against the already submitted Check-in.
4. Record the platform receipt and organizer decision separately from preparing the local artifacts.

## Reproducible exported example

[example-live-report.json](../artifacts/example-live-report.json) is an actual sealed workspace export. `node scripts/verify-report.js artifacts/example-live-report.json` verifies its payload fingerprint. It records a blocked run with two successful network checks, not a passing release.

## Manual checks, 2026-10-25 (afternoon)

Performed in a Playwright-driven Chromium against a production build served locally (`node server/index.js` on port 4183 for the site; `vite preview` on port 4191 for the consumer demo), with empty browser storage, no wallet and no login.

- Catalog decision page (`#/app/catalog`): initial headline "Not checked yet" with "Current: Not checked"; after "Evaluate now" the headline became "Available now" with "Current: Valid" and "Entry equals the approved report", checkpoints registry, listing and observation all at #189,501, the "Last verified in this browser" line filled in, the recorded snapshot shown separately; the button changed to "Refresh status". No console errors.
- Token eligibility demo (consumer): opened with the deliberately wrong entry (18 decimals); "Check token" returned "Withheld: the entry differs from the approved report" with policy status Valid and the reason `entry-mismatch:decimals` at #189,591; the pUSD option stayed disabled. After "Correct to the approved values" the headline reset to "Not checked yet"; a second check returned "Available now" at #189,595; the pUSD option became selectable and "Continue" enabled with it chosen. Replaying the recorded revocation showed "RECORDED · Approval revoked · captured 25 Oct 2026, 09:40:16 UTC" with `approval-revoked`, `consumer-not-listed`, while the live decision and the selector were unchanged. Changing the decimals back to 18 reset the headline to "Not checked yet". At 390 px wide nothing overflowed the viewport. No storage was written; no console errors.
- Consumer command line, live: `npm run check` returned ALLOWED at #189,599 (evaluated 2026-10-25T13:36:28.849Z), wrote `out/decision-evidence.json`, and `node src/reconstruct.js out/decision-evidence.json` re-derived the decision consistently. The outputs are committed under `out/`.
- Packed artifact: `node scripts/verify-artifact.mjs` packed version 0.4.0 (44 files, 119,138 bytes, SHA-256 `aa48acdd…fcf35`, packed from the committed tree), installed it into an empty project (204 packages, 170.6 MB, 23.7 s), resolved 17 export specifiers, listed 13 tools from the CLI and the MCP server, and read both MCP resources equal to the checkout's files (`artifacts/package-verification-2026-10-25.json`).

## Manual checks, 2026-10-25 (evening): the remaining fixes

Performed in a Playwright-driven Chromium against production builds served locally (`node server/index.js` on port 4183 for the site at commit `2e1673d`; `vite preview` on port 4191 for the consumer demo on the 0.4.1 artifact), with empty browser storage, no wallet and no login. Where a deadline had to pass, the page's clock was replaced after the live result arrived (`page.clock.install`, then a jump of sixteen minutes); the network reads themselves were real.

- Catalog decision page: "Evaluate now" returned "Available now" with the line "Permission ends Oct 25, 16:19 UTC (the network read; 895 s left at Oct 25, 16:04 UTC)", the per-limit deadlines (report Nov 1, 09:29 UTC; observation, registry and listing Oct 25, 16:19 UTC) and "Last verified … permitted until Oct 25, 16:19 UTC", checkpoints at #191,072. After the sixteen-minute jump and a visibility change the headline became "Lapsed: the reads are older than the observation limit", the detail named the deadline that ended it, and the lapsed answer was shown as history. No console errors.
- Token eligibility demo (consumer, 0.4.1): the wrong entry was withheld with `entry-mismatch:decimals`; "Correct to the approved values" reset the decision; the refresh returned "Available now" with "Permission ends 25 Oct 2026, 16:23:54 UTC (the network read; 895 s left at 16:08:59 UTC)"; pUSD became selectable and "Continue" reported "Permission verified at 2026-10-25T16:08:59.534Z, valid until 2026-10-25T16:23:54.998Z". After the sixteen-minute jump **without any timer tick** the screen still said "Available now" with "Continue" enabled; pressing it was refused by the handler's own clock check ("Not continued. Refused at 16:24:59 UTC: Lapsed: the permission of the last result ended at 2026-10-25T16:23:54.998Z (the network read)"), no second alert appeared, and the page then re-read the clock: "Lapsed", "Continue" disabled, the pUSD option "not selectable". No console errors.
- Check my token (`#/app/check`): "Fill with the pUSD example" showed the plan fingerprint `ce76c98f…2222191` (the plan hash of the bound v2 report) and the derived precompile address; "Run the check" sealed a passed report (4 of 4 checks at #191,049, `portaldot-v3/3002`); changing decimals to 18 showed the "form has changed since this report was sealed" notice, reverting removed it; importing an export whose `planHash` had been edited was refused ("does not match the plan … altered after export"); a bare plan imported into the form; "Continue in the studio" opened the Replay step, and the Check step offered a fourth release choice "Your token · pUSD token list · v1.0.1" selected, with the report in place.
- Hosting verifier: `node scripts/verify-hosting.mjs --site https://revivecheck.axiqo.xyz/ --commit 455cc60` reported `ok manifest.fetch HTTP 200`, `FAILED manifest.content-type text/html`, `NOT verified`: the live site predates the manifest, as the review observed. The unit tests cover the fallback, another commit or release, a changed index and the consumer schema.
- Packed artifact 0.4.1: `node scripts/verify-artifact.mjs` packed 44 files, 122,445 bytes, SHA-256 `5a0003ae…a868b` from the committed tree at `2e1673d`, installed it into an empty project (204 packages, 170.6 MB, 17.6 s), resolved every export, listed the tools from the CLI and the MCP server and read both resources (`artifacts/package-verification-2026-10-25-r2.json`). The consumer vendors the same bytes (`vendor/CHECKSUMS.txt`).
- Consumer command line, live, against 0.4.1: `npm run check` returned ALLOWED at #191,199 (evaluated 2026-10-25T16:17:15.820Z) and printed "permission ends: 2026-10-25T16:32:11.269Z (observation)"; `node src/reconstruct.js out/decision-evidence.json` re-derived the decision and its deadline consistently. The outputs are committed under `out/` there.
- Test suites after the fixes: 207 in this repository (`npm test`), 17 in the consumer; both production builds pass.

## Manual checks, 2026-10-25 (night): the product plan D-01 to D-08

Performed by the author's agent on the built site served by the production preview (`node server/index.js`, port 4183) and the consumer's `vite preview` (port 4191), in fresh Chromium profiles with playwright-cli, against the public Portaldot V3 testnet nodes. Each journey script prints its observations and exits nonzero on any failed assertion.

- **Studio lifecycle integrity** (`npm run journey:studio`, 2026-10-25T18:31:35Z, 20 of 20): an earlier flat session with report A (`cbd78faa…`, the recorded 2026-10-23 recheck) stored, submitted and approved migrated with A active, "Approved" and the completion banner; Check my token sealed report B (`8d44879c…`) live and "Use this report in my project" created the project `own-pusd-token-list-ce76c98f` with B active, Submit "Wallet", Approve "After Submit", no completion and no history; switching back to the demonstration project showed A approved again; a new v1.0.0 check (`1f907b…`, failed) replaced A, locked Store, Submit and Approve ("did not pass, and no earlier report is used in its place"), removed the completion and listed A's receipts as one history entry; a reload preserved it; two projects, two sessions, no console errors.
- **Browser-local projects** (`npm run journey:projects`, 2026-10-25T18:32Z, 15 of 15): projects Alpha and Beta on asset 7777; Alpha's session carrying the recorded revision-2 receipts showed the candidate as report `1faef921…` on revision 2 stored in `0x80d4…92feb3`, "Bind the candidate explicitly" recorded one current binding, the exported consumer configuration passed the separate consumer's `loadConfig` and named the bound report, revision 2, label `pusd-catalog-v2`, owner `0x48b9…a71b` and reviewer `0x95db…4065`; "Evaluate now" read the chain and answered "Available now" with the deadline 18:47 UTC (the network read; report Nov 1 09:29 UTC); Beta showed no candidate, an incomplete policy naming `policy.reviewers.trusted`, and no binding.
- **Consumer release operation** (consumer `node test/browser/release-journey.mjs`, 2026-10-25T18:50:00Z, 11 of 11): the wrong entry withheld with `entry-mismatch:decimals` and the release button disabled; corrected, "Available now" with a stated deadline; "Prepare catalog release" produced release 1 (`1353c61d…`, generated 18:49:46Z, evaluation `32fa7450…` at #192716, permission until 19:04:31Z), verified in Node, read by `revivecheck-catalog read` in another process, shown "usable now" on the page and loaded back through "Load a release file" ("At least one entry may be used now"); no console errors.
- **Live release gate from the consumer** (`npm run release`, 2026-10-25T18:50:21Z): PERMITTED, release 1 `329a8dbb…` at #192724, permission until 19:05:17Z, written with `outcome.json` and `decision-evidence.json` under `out/releases`.
- **Artifact 0.5.0 from an empty install** (`scripts/verify-artifact.mjs`): 53 files, 143,423 bytes, SHA-256 `d818494389e86ffad0d8005f0c6ca5a1d15babcd169f6b002938e979e5f594ef` (packed from commit `e105dfe`), 204 packages, 170.7 MB; 18 documented export specifiers; the starter from the installed copy wrote release 1 on captured reads, refused the revoked case without a release and read the release in a separate process.
- **Renewal preparation, read-only** (`node scripts/renewal-prepare.js --planned 2026-11-03T12:00:00.000Z`, 2026-10-25T19:01:09Z): report acceptable until 2026-11-01T09:29:17.646Z (158.5 h left), every read fresh, approval standing (1 of 1 on revision 2), binding current, listed on the bound report, no successor, next revision 3, next role "consumer: evaluate", warnings `gap-before-freeze` and `planned-gap` (2.1 days); owner nonce 25 = next index 25, reviewer nonce 4 = next index 4 (no pending send). Offline at a clock after expiry: `evidence-expired`, next role "release owner: check the release again".
- **Evidence health page** (`#/app/health`): the recorded last step rendered with the stated gap; "Read the chain now" produced the live health and the renewal stages with `check` next; no console errors.
- **The measured task** (`node examples/token-catalog/benchmark/run-task.mjs --live`, 2026-10-25T19:06Z): 10 steps, 0 failed; see `docs/VALUE_EXPERIMENT.md`.
- **Unit tests**: 232 (ReviveCheck) and 19 (consumer) pass offline; `npm run build` and the consumer's `npm run web:build` pass.


## Manual checks, 2026-10-26: the repair handoff R-01 to R-07 and its follow-up

Performed by the author's agent for `docs/2026-10-26_claude-repair-handoff.md` (implemented in commit `9f68e07`) and the reviewer's `docs/2026-10-26_repair-verification-followup.md` (closed in commit `b5ea9b4`); the records follow in the commit that adds this section. Browser journeys ran in fresh Chromium profiles with playwright-cli against the public Portaldot V3 testnet nodes: at `9f68e07` on the production preview (port 4183), at `b5ea9b4` on a build of that commit served from a scratch directory (`vite preview`, port 4184) so that another session's use of port 4183 stayed untouched. Every journey's result file is a list of named observations; a failed assertion ends the journey with the observations so far. The completion matrix is `docs/2026-10-26_repair-completion.md`.

- **Unit tests**: 249 of 249 at `9f68e07`; 255 of 255 at `b5ea9b4` (`test/health.test.js` R07-F, `test/catalog-publication.test.js` R04-G and the four cases of `test/studio-requests.test.js` added). The policy, token-catalog and decision suites, which hold recorded evaluation hashes, pass unchanged after the evaluator's consumer-identity checks moved onto the shared `evidencePredicates.consumerIdentity`. The consumer's `npm test`: 24 of 24 on the installed 0.5.3.
- **Builds**: `vite build` passes at both commits (the follow-up build into the scratch directory, 2.2 s); the consumer's `npm run web:build` passes and its bundle carries `requireFreshSubject`.
- **Browser journeys at `9f68e07`** (06:42 to 07:07 UTC): `journey:studio` 20 of 20; `journey:projects` 14 of 14; `journey:adopt` 16 of 16 (project `own-my-pusd-list-ce76c98f`; the failed 18-decimal report `e949440d…`, the corrected 6-decimal report `834eb474…` adopted into the same project, the studio recheck on the corrected plan); `journey:import` 17 of 17 (a bundle exported from one browser context imported into a fresh one evaluates "Available now" on fresh reads under policy `1439caa0…`, with the owner, release and storage shown as declared, not as receipts); `journey:race` 11 of 11 (answers `bb1a6e7b…` first, `f88275e1…` latest).
- **Browser journeys at `b5ea9b4`** (10:11 to 10:33 UTC): `journey:remount` 11 of 11 (check A started 10:31:04Z with its first EVM RPC answer held 25 s, the visitor left for My projects and reopened the studio, check B started 10:31:24Z in the new mount; the page's console reported request 1 discarded and request 2 applied, the store and the screen held B, a reload kept it; after the reload a check started, the studio left and reopened and the session cleared there, and the answer arriving afterwards was discarded, the cleared session surviving a reload); `journey:race` 11 of 11; `journey:studio` 20 of 20; `journey:adopt` 16 of 16; `journey:import` 17 of 17; `journey:projects` 14 of 14. No console errors in any of them. The first remount run of the day (10:11Z) had exposed the journey's own weakness, not the product's: check A had finished before the remount, so both answers were applied, which is correct; the journey now holds the first answer and fails explicitly when the race was not exercised.
- **Evidence health page** (`#/app/health` on the `b5ea9b4` build, 10:29Z): the recorded panel shows the lifecycle record's observation as `undated` (the record carries no chain identity) and therefore the approval and the listing as `unknown`, naming the observation; "Read the chain now" answered in 9 s with the observation, registry and listing `fresh`, the approval `approved` (1 of 1 on revision 2), `listed-on-bound-report`, every renewal stage `pending`, `check` next, no stop, no console errors.
- **Renewal preparation, offline** (`node scripts/renewal-prepare.js --capture examples/token-catalog/data/testnet-v2/captures/12-reapprove-r2.inputs.json --now 2026-10-25T09:43:18.329Z`): every read fresh, approval standing, binding current, listed on the bound report, subject not required, next role consumer (evaluate), plan next stage `check`; earlier in the round the same capture read after the expiry turned every read stale, the approval unknown and the next role operator (read). Nothing signed or sent.
- **Packed artifact 0.5.3** (`scripts/verify-artifact.mjs` at `b5ea9b4`, `artifacts/package-verification-2026-10-26-r2.json`): 55 files, 167,689 bytes, SHA-256 `2ac5f3bd55a28506904df3bc1af16f455c5f12ea943c79bfdeca9526bb48d89b`, installed into an empty project (204 packages, 170.8 MB, 17.9 s), every documented export resolved, the shipped release gate starter run from the installed copy, no findings. The 0.5.2 artifact packed earlier in the round from `9f68e07` (`86608c21…fdcb`, 164,835 bytes; `artifacts/package-verification-2026-10-26.json`) was superseded before the consumer committed it.
- **Consumer on the installed 0.5.3** (`revivecheck-consumer-example`): `vendor/CHECKSUMS.txt` verifies (0.4.0, 0.4.1, 0.5.0, 0.5.3); the lockfile names `file:vendor/revivecheck-0.5.3.tgz` with the regenerated integrity; `node_modules/revivecheck` is 0.5.3; `npm test` 24 of 24; `npm run web:build` passes; the reader journey 15 of 15 (10:36 to 10:38Z, offline, three fresh contexts under a clock one minute before the retained release's deadline: the entry selectable and `deadline-only` with the note that the chain was not read; after two clock minutes the verdict and every row not selectable (`lapsed`) with no re-import; a tab resumed after the deadline through `setSystemTime` and the visibility event alone shows nothing eligible; a tampered file says "Verification failed" before the deadline; a malformed file clears the presentation with the error; an expired document re-imported grants nothing; the live decision control stays "Not checked yet"; no console errors); the release journey 11 of 11 (10:38 to 10:39Z, live: the wrong entry withheld with `entry-mismatch:decimals` and the release button disabled; corrected, "Available now" with a stated deadline; "Prepare catalog release" produced release 1 `68c3c491…` at #202168, generated 10:39:03Z, permission until 10:53:49Z, verified in Node, read by `revivecheck-catalog read` in another process, shown usable and verified on the page and loaded back into the reader; no console errors). The consumer's commit is `52ca088` on top of `e0158dc`.
- **Sealed evidence untouched**: `git diff --stat 85845b0..HEAD -- public/reports public/baselines examples/token-catalog/data public/lifecycle public/catalog` is empty and the working tree has no change under those paths; SHA-256 of `public/baselines/current-2026-10-23.json` `fe16fcc0…c10475`, of report `0272674216…` `7abb6f04…9b6b2`, of the bound report `1faef921…` `0c40cc9b…09d7`, of `examples/token-catalog/data/testnet-v2/bindings.json` `e2307a69…32e9`.
- **Not done here**: nothing was pushed or republished; the consumer repository still has no remote; no renewal transaction was prepared or sent.
