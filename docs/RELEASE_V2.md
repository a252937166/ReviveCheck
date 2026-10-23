# ReviveCheck v0.2 delivery record

This iteration turns a local preflight into a release plan and reviewer handoff. The implemented loop is **plan → live check → correct/rerun → share an immutable report → exact-report review → version-aware recheck**, with archive/restore preserving history. Verification, sharing, reviewer opinion and freshness are separate states. The product is developer acceptance tooling; it does not grant an official release approval.

## Implemented scope

- Spec-scoped polkadot.js asset-fee decoding. The real finalized block 156435 previously failed to decode with `Option<MultiLocation>`; spec 3002 uses `Option<NativeOrWithId>`. The offline regression includes the source metadata and its fingerprint, tests the failure and corrected decoding, and does not silently apply this assumption to future runtimes.
- Up to eight ABI scalar view assertions, each with a stable ID, up to four parameters and an expected result. Supported types are `uint256`, `address`, `bool`, `string` and `bytes32`. Native revive and Ethereum calls use one finalized checkpoint. Legacy `value()` plans remain compatible.
- Native asset acceptance compares native existence, supply, holder balance and decimals with the configured ERC-20 precompile. Unknown asset IDs cannot pass by returning zero. The current address adapter is scoped to the verified runtime.
- Comparisons distinguish deployment versions, changed plans, changed runtime and changed synthetic scenarios. The source/deployment/plan/checkpoint binding makes the scope visible. An observed improvement does not establish what caused it.
- A static reviewer validates the original JSON fingerprint using Web Crypto, opens compressed share fragments or selected published reference reports, and generates exact-report review receipts. Long QR links fall back to an explicit viewer-plus-JSON handoff.
- Review receipts are append-only, self-declared opinions. Importing them validates content integrity and the referenced report, not the reviewer's real identity or authority. New runs start without inherited approval.
- The local workbench tracks plan/release/target changes and runtime differences found in later saved observations. It offers a fresh check rather than changing historical reports. This is not continuous remote monitoring.
- Live evidence includes verified official native block/extrinsic explorer routes and machine-readable target QR codes. Matching deployed-code or native-asset parity evidence is required before exposing an H160 target. The current explorer has no verified H160 detail route and its EVM transaction route is disabled: those QR codes contain the actual plain address/hash, labeled **Address only** or **Hash only**, without a fabricated detail link or payment URI. Missing own contract/transaction evidence stays pending. HTML exports contain the same scoped references and scannable SVG QR codes.

## Real network evidence

Public asset 7777/pUSD was inspected on 2026-10-23 at finalized native block **157426**. The native asset and ERC-20 interface agreed on:

- Supply: `100000000000` base units.
- Owner balance: `99683035000` base units.
- Precision: `6` decimals.

The network identity, cross-interface checkpoint and native/ERC-20 parity checks passed (**3/3**). [The original report](../public/reports/15baa9e1d2e8746bdc94b873e314a3fd839fbd52ecc13dd99470bec8444ba544.json) has hash `15baa9e1d2e8746bdc94b873e314a3fd839fbd52ecc13dd99470bec8444ba544`. Its original JSON fingerprint was reverified locally while updating this document; a recipient must also verify it after loading.

This is an existing external public asset. It is not our asset, deployment, transaction, external user, or adoption result. Read-only parity does not establish transfer/approve semantics or contract safety.

### Current retained baseline and unchanged-environment observation

The later [current baseline report](https://a252937166.github.io/ReviveCheck/reports/0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5.json), observed at **2026-10-23 08:17:25.008 UTC**, passed **3/3** at finalized native block **157790**, runtime **3002**. The report hash is `0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5`. Its [immutable baseline manifest](../public/baselines/current-2026-10-23.json) binds the report, assertion plan, environment and native/EVM checkpoint; manifest hash `8ba98add262983bd22ceb9a33aab15ec19d8a863aedcfea6020ecc30cd1f1fc1`, environment hash `585d0c8da2b0137796aea6acd09e814d8d2b970f5ec3bba917f9a010fa2c48d0`. The original #157426 report remains unchanged.

A minimal real observation at **04:49 EDT / 08:49 UTC**, finalized block **158114**, found the same environment. This proves an unchanged-environment check, not an upgrade or a completed revalidation after one. A real environment change must first occur before that live branch can be demonstrated; the baseline is not automatically replaced or given inherited approval.

Anonymous public browser checks opened [the current baseline reviewer](https://a252937166.github.io/ReviveCheck/?report=0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5#/review) and the correct [official native block #157790](https://scanner-testnet-v3.portaldot.dev/#/blocks/0x421a987d96acf7f7b644aaf8e951817bbbb96ea5e13452df45f28a617f4dc8b2). Native block and extrinsic routes were checked against the deployed explorer router and actual JSON API records, rather than inferred from a SPA HTTP 200. The pUSD QR is explicitly an **external public precompile** address, not our deployed contract.

## Own application execution

`ReleaseGate.sol` provides an application state transition to test beyond a counter: submit a report, review it, then resubmit to invalidate approval. The local compiler and `execute-release.js` helper are ready. The helper verifies an actual source report, journals transaction hashes before broadcasting, checks cumulative maximum deposits plus a conservative fee reserve against the estimate cap, waits for explicit successful finalized dispatch, and then uses the acceptance engine for dual-interface readback. Native fees are recorded separately from storage-deposit estimates. Actual fee changes cannot be strictly capped by the helper; missing fee evidence or an exceeded reserve stops subsequent submissions.

The actual compiled ReleaseGate bytecode has now executed in an in-memory EthereumJS EVM using Paris rules. [Three local EVM tests](../test/release-gate.test.js) passed: constructor → submit first hash → reviewer acceptance → submit second hash, with approval reset and revision increment; nonowner submissions revert; nonreviewer decisions revert. The tests read back storage and check events and rollback. They use local message calls without keys or network access. This validates local contract behavior, not native revive execution, public-chain transaction fees, or finality.

The latest retained funding check at **2026-10-23 09:00:19.771 UTC / 05:00 EDT** reports **0 tPOT**, so own deployment, state writes and finalized readback are pending. No deployment or write was signed or broadcast. Account funding and environment observations remain separate evidence. The reference execution uses the isolated test account in both roles and cannot establish independent reviewer adoption.

## Validation and next evidence gate

The latest v0.2 QA on 2026-10-23 recorded:

| Check | Actual result | Scope |
| --- | --- | --- |
| `npm test` | **85/85 passed**, no failures | Includes bounded ABI/chain fixtures, lifecycle regressions, 3 actual local EVM tests, execution dispatch, baseline/environment observation, browser hash/fragment, aggregate/scope consistency, explorer routing and actual QR decoding |
| `npm run build` | Passed | Production bundle generation |
| Dependency audit | 0 reported vulnerabilities | Dependency database result, not a security audit of the product |
| `git diff --check` | Clean | No whitespace errors in the reviewed diff |
| Isolated HTTP lifecycle | Passed | Import → share-prepared → receipt import → release change → real asset recheck → archive/restore; original report unchanged and new run unreviewed |
| Anonymous public browser | Current baseline and official native block #157790 rendered correctly | Verified deployed rendering, beyond anonymous HTTP delivery; no independent user implied |
| Browser review handoff | Receipt created, downloaded and imported into an isolated demo workspace | Actual internal workflow; identity/opinion remains self-declared and does not establish independent adoption |
| v0.2 walkthrough | 120 seconds, 1080p/30 fps, silent English captions; local render/QA and both video QR decodes passed; anonymous public bytes matched SHA-256 and browser player loaded 120 seconds at 1920×1080 | Actual current UI screenshot walkthrough; own chain execution and revalidation after actual environment drift remain pending |

Automated checks use deterministic clients/fixtures where appropriate. The local EVM tests execute actual compiled bytecode; the retained asset report is a separate real network observation. Neither a green suite nor bundle generation proves our own V3 deployment or independent adoption.

| Evidence | Established result | Remaining gate |
| --- | --- | --- |
| Sealed asset 7777 report | Live network/checkpoint and native/ERC-20 read parity | No user-owned deployment, state write or transfer semantics |
| Lifecycle regressions | History survives restart; exact-hash reviews and shares do not transfer; changed plan/runtime stays explicit | Independent builder and maintainer completing the task |
| HTTP lifecycle and browser transport/QR | Immutable history, receipt isolation, hash verification, fragment round-trip and QR decoding; actual public baseline/official block rendering and internal receipt download/import | Independent reviewer and external builder adoption remain unverified |
| Minimal live environment observation | Later block #158114 has the same environment as baseline #157790 | No actual runtime change or live revalidation after one has occurred |
| Local ReleaseGate EVM | State transitions, role restrictions and approval reset | Actual V3 deploy/write/finalized dual-interface readback |

The next adoption gate remains one external developer bringing a real project and a maintainer using the second report without the author explaining raw RPC logs. No saved hours, paying users, official endorsement or production security result is claimed.

## Published materials

The new [120-second v0.2 lifecycle walkthrough](https://a252937166.github.io/ReviveCheck/lifecycle-demo-v0.2.mp4) uses actual current UI screenshots with silent English captions. Local rendering and QA passed, including decoding the two QR codes visible in the actual video. **Public delivery is verified:** the anonymous complete download at **2026-10-23 09:04:44.779 UTC** contained **2,074,264 bytes**, with SHA-256 `1a088f929bdbfa3a77609923916a174735d825ea5920865423a44424dcfbaf04` matching the local video. Pages revision `3ee7847b7d190b8014e0376182c33cab0fbc62e0` built successfully; the media, manifest/QA, baseline/HTML and current bundle returned HTTP 200 with the recorded byte checks. At **09:05:53.734 UTC**, the anonymous public browser player loaded **120 seconds, 1920×1080, readyState 4**. See [the scene/evidence/QA record](DEMO_V2.md) and [machine-readable publication receipt](../artifacts/v0.2-lifecycle-public-readback.json). The video shows current read-only progress and internal handoff; own deployment/write/readback and a recheck after an actual environment change remain pending.

The original [78-second Check-in video](https://a252937166.github.io/ReviveCheck/check-in.mp4) and six-page deck remain unchanged historical v0.1 materials. The organizer form has not been edited for this follow-up. The static reviewer and selected reference JSON are published; the explorer/baseline implementation was pushed as `5273acf` and Pages revision `58f58d2`, with the actual public-browser checks recorded above. DoraHacks submission status remains separately recorded in [SUBMISSION.md](SUBMISSION.md); publishing source, a viewer or a supplementary video does not change the organizer's review status.

Earlier delivery snapshot: anonymous HTTP checks at **2026-10-23 08:05:42 UTC** returned 200 for the page, then-current JavaScript/CSS, original MP4 and #157426 report JSON. The downloaded public JSON passed its SHA-256 check; the published-report sharing path returned a short self-opening QR link. Those checks established content delivery at that time; the later browser checks above establish the current recorded rendering evidence.

A thread follow-up independently checks actual environment identity/runtime/constants and test-token funding every three hours, stays quiet while unchanged, and stops after completion or the stated cutoff. An environment observation is not a funding check. Funded execution uses a 100 tPOT cumulative estimate cap, records receipts before claiming success, and halts on uncertain transaction outcomes or runtime changes.

Earlier publication receipts: implementation [6d3af3f](https://github.com/a252937166/ReviveCheck/commit/6d3af3f), static release [ada4e45](https://github.com/a252937166/ReviveCheck/commit/ada4e45e4291c5eb629401eb91742fce23506ee5). That release's anonymous readback at **2026-10-23 08:11:57 UTC** confirmed its bundle, verified report, self-opening QR target and original video. The non-sensitive [earlier machine-readable delivery receipt](../artifacts/v0.2-public-readback.json) preserves those statuses separately from the new lifecycle-video receipt.
