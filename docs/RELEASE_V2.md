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

## Real network evidence

Public asset 7777/pUSD was inspected on 2026-10-23 at finalized native block **157426**. The native asset and ERC-20 interface agreed on:

- Supply: `100000000000` base units.
- Owner balance: `99683035000` base units.
- Precision: `6` decimals.

The network identity, cross-interface checkpoint and native/ERC-20 parity checks passed (**3/3**). [The original report](../public/reports/15baa9e1d2e8746bdc94b873e314a3fd839fbd52ecc13dd99470bec8444ba544.json) has hash `15baa9e1d2e8746bdc94b873e314a3fd839fbd52ecc13dd99470bec8444ba544`. Its original JSON fingerprint was reverified locally while updating this document; a recipient must also verify it after loading.

This is an existing external public asset. It is not our asset, deployment, transaction, external user, or adoption result. Read-only parity does not establish transfer/approve semantics or contract safety.

## Own application execution

`ReleaseGate.sol` provides an application state transition to test beyond a counter: submit a report, review it, then resubmit to invalidate approval. The local compiler and `execute-release.js` helper are ready. The helper verifies an actual source report, journals transaction hashes before broadcasting, checks cumulative maximum deposits plus a conservative fee reserve against the estimate cap, waits for explicit successful finalized dispatch, and then uses the acceptance engine for dual-interface readback. Native fees are recorded separately from storage-deposit estimates. Actual fee changes cannot be strictly capped by the helper; missing fee evidence or an exceeded reserve stops subsequent submissions.

The actual compiled ReleaseGate bytecode has now executed in an in-memory EthereumJS EVM using Paris rules. [Three local EVM tests](../test/release-gate.test.js) passed: constructor → submit first hash → reviewer acceptance → submit second hash, with approval reset and revision increment; nonowner submissions revert; nonreviewer decisions revert. The tests read back storage and check events and rollback. They use local message calls without keys or network access. This validates local contract behavior, not native revive execution, public-chain transaction fees, or finality.

The funding check at **2026-10-23 08:01:20 UTC** still reports **0 tPOT**, so own deployment, state writes and final readback are pending. No transaction was signed in this iteration. The reference execution uses the isolated test account in both roles and cannot establish independent reviewer adoption.

## Validation and next evidence gate

Final v0.2 release QA on 2026-10-23 recorded:

| Check | Actual result | Scope |
| --- | --- | --- |
| `npm test` | **59/59 passed**, no failures | Includes bounded ABI/chain fixtures, 17 lifecycle regressions, 3 actual local EVM tests, execution dispatch, browser hash/fragment, aggregate/scope consistency and QR decoding |
| `npm run build` | Passed | Production bundle generation |
| Dependency audit | 0 reported vulnerabilities | Dependency database result, not a security audit of the product |
| `git diff --check` | Clean | No whitespace errors in the reviewed diff |
| Isolated HTTP lifecycle | Passed | Import → share-prepared → receipt import → release change → real asset recheck → archive/restore; original report unchanged and new run unreviewed |
| Browser reviewer | Desktop and 390 px mobile screenshots captured | Actual report/review rendering; no independent user implied |
| Browser workbench | Fresh desktop next-step state checked | Browser connection later timed out; latest mobile workbench and live public-browser checks were not completed |

Automated checks use deterministic clients/fixtures where appropriate. The local EVM tests execute actual compiled bytecode; the retained asset report is a separate real network observation. Neither a green suite nor bundle generation proves our own V3 deployment or independent adoption.

| Evidence | Established result | Remaining gate |
| --- | --- | --- |
| Sealed asset 7777 report | Live network/checkpoint and native/ERC-20 read parity | No user-owned deployment, state write or transfer semantics |
| Lifecycle regressions | History survives restart; exact-hash reviews and shares do not transfer; changed plan/runtime stays explicit | Independent builder and maintainer completing the task |
| HTTP lifecycle and browser transport/QR | Immutable history, receipt isolation, hash verification, fragment round-trip and QR decoding | Latest mobile workbench and deployed browser rendering remain unverified; anonymous HTTP report/hash readback passed |
| Local ReleaseGate EVM | State transitions, role restrictions and approval reset | Actual V3 deploy/write/finalized dual-interface readback |

The next adoption gate remains one external developer bringing a real project and a maintainer using the second report without the author explaining raw RPC logs. No saved hours, paying users, official endorsement or production security result is claimed.

## Published materials

The original 78-second Check-in video and six-page deck remain historical v0.1 materials; they do not demonstrate the v0.2 reviewer, asset profile or new lifecycle. The static reviewer and selected reference JSON are published. Anonymous HTTP checks at 2026-10-23 08:05:42 UTC returned 200 for the page, current JavaScript/CSS, original MP4 and report JSON. The downloaded public JSON passed its SHA-256 check; the published-report sharing path returned a short self-opening QR link. This verifies content delivery; it does not substitute for a fresh browser rendering check after publication. DoraHacks submission status remains separately recorded in [SUBMISSION.md](SUBMISSION.md); publishing source or a viewer does not change the organizer's review status.

A thread follow-up checks test-token funding every three hours, stays quiet while unchanged, and stops after completion or the stated cutoff. Funded execution uses a 100 tPOT cumulative estimate cap, records receipts before claiming success, and halts on uncertain transaction outcomes or runtime changes.

Publication receipts: implementation [6d3af3f](https://github.com/a252937166/ReviveCheck/commit/6d3af3f), static release [ada4e45](https://github.com/a252937166/ReviveCheck/commit/ada4e45e4291c5eb629401eb91742fce23506ee5). The final anonymous readback at **2026-10-23 08:11:57 UTC** confirmed the new bundle, verified report, self-opening QR target and original video. The non-sensitive [machine-readable delivery receipt](../artifacts/v0.2-public-readback.json) records the actual statuses and report hash.
