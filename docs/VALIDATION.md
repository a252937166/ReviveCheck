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
