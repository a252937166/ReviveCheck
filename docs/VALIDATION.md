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
