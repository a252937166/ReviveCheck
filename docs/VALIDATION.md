# ReviveCheck validation record

Validation date: 2026-10-23, America/New_York. Scope: the local prototype at implementation revision `a07a912` and its local Check-in materials. The interactive app remains local. Public video and source are available; formal Check-in submission is still pending.

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
- Public repository and public video playback are verified. A six-page PDF Deck is prepared for the required form field. Formal Check-in submission and organizer acceptance remain pending.

No independent user, saved development time, revenue, security audit, or general EVM compatibility claim is established by these checks.

## Final completion gates

1. Manually confirm the support request reaches staff, then independently confirm test-token receipt.
2. Perform and record our own V3 deployment and a separate write/readback when funded; keep it distinct from constructor simulation.
3. Complete formal Check-in submission with the published links and outstanding deployment evidence disclosed.
4. Record the platform receipt and organizer decision separately from preparing the local artifacts.

## Reproducible exported example

[example-live-report.json](../artifacts/example-live-report.json) is an actual sealed workspace export. `node scripts/verify-report.js artifacts/example-live-report.json` verifies its payload fingerprint. It records a blocked run with two successful network checks, not a passing release.
