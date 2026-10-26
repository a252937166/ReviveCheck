# Release status

The authoritative record is `public/release-status.json`, generated offline from the published records by:

```sh
node scripts/release-status.js --out public/release-status.json   # exit 1 when any published record is inconsistent
```

It names the source commit, the network and genesis, the active consumer and version, the last observation, every completed transaction, and six levels that are easy to conflate. This page mirrors that record for readers; when the two disagree, the JSON wins. Snapshot: 2026-10-25, after the live v2 lifecycle.

## Levels

| Level | Established | Evidence | What it does not imply |
| --- | --- | --- | --- |
| Records intact | yes | 13 integrity checks pass: 14 sealed reports, the baseline, the v1 and v2 sources and records, the generated deployments module, the feed, every catalog binding, the recorded lifecycle's receipts, the published catalogs, English-only text | nothing about deployment, listing, evaluation or adoption |
| Deployed | yes | VerifiedTokenList v2 at `0xedaf8a25bb583ad164a94191b762414277198df9`, finalized at #177354, nine verification checks | no listing and no decision |
| Listed | yes | pUSD listed on v2 at #187124 (revision 1) and again at #187205 (revision 2), on the separate reviewer account's approval, read back through both interfaces | no current policy decision |
| Evaluated | yes | recorded policy evaluation `9dfc49fa…` at #187279: `valid`, 35 checks; the published entry equals the approved report `1faef921…` field by field | point in time; evaluate again before each use |
| Lifecycle complete | yes | 12 live steps recorded with 10 finalized receipts: submit, approve, list, revision 2 (un-lists), approve, explicit rebind, relist, revoke, re-approve; a wrong-decimals listing refused by the contract in dry-run; a wrong configured entry withheld by the catalog | two project-controlled signers show role separation, not independent review; expiry, unsupported runtime and node outage remain local simulations |
| Independently adopted | no | a second consumer (a DEX allow-list) is installed from the packed artifact in a separate repository, built and run by the author; the maintainer pilot (`docs/PILOT_PROTOCOL.md`) has no participant yet | no adoption, revenue or organizer decision |

## What is deployed and active

| Component | Where | Status |
| --- | --- | --- |
| ReleaseRegistry | `0xe949b200edf070b9d425b206ed24dc8fe5b7d339`, V3 testnet #162962 | active, reused by every token-list version |
| VerifiedTokenList v2 | `0xedaf8a25bb583ad164a94191b762414277198df9`, #177354 | active; pUSD listed on release `pusd-catalog-v2` revision 2, report `1faef921…`, reviewer `0x95db300103ec8b45884b13ed85230fbf02114065` |
| VerifiedTokenList v1 | `0xd0bd833b4b8658b1230a0e9a99640935b3c65819`, #164220 | historical; known issue F-02 recorded; the application and the shared script helper refuse new writes to it; its pUSD listing at #164313 is preserved |
| Accounts | owner `5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt` (EVM `0x48b9…a71b`), reviewer `5DtqFzALznihBAE5wWmWJ1owZcFbiUX6hYKcvAZyt3sSUDjZ` (EVM `0x95db…4065`, funded with 12 tPOT at #187050) | both project-controlled; public records in `docs/WALLET_PUBLIC.json` and `docs/REVIEWER_WALLET_PUBLIC.json` |
| Stored reports | `remark.store` at #164266, #164335, #187058, #187145 | retrievable and verified |
| Verification service | 13 tools over MCP, REST, JavaScript and the CLI; the `revivecheck-catalog` release gate and reader; the packed artifact (`npm pack`, version 0.5.2) verified from a clean install by `scripts/verify-artifact.mjs`, which now also runs the shipped release gate starter from the installed copy (`artifacts/package-verification-2026-10-25-r3.json`; the 0.4.0, 0.4.1 and 0.5.2 records are kept beside it) | offline tests pass; production build passes |

## The live v2 lifecycle (2026-10-25)

Recorded step by step in `examples/token-catalog/data/testnet-v2/lifecycle.json` and shown on the Catalog decision page of the app (`#/app/catalog`). Each receipt is also in `public/lifecycle/registry-writes.json`, `public/lifecycle/token-list-v2.json`, `public/lifecycle/evidence.json` or `public/lifecycle/funding.json`.

| # | Step | Signer | Block | Policy after the step | Entry |
| --- | --- | --- | --- | --- | --- |
| 1 | check pUSD v1.0.1 live, publish report `eb960cc7…`, store it on-chain | owner | #187058 | unbound | withheld |
| 2 | submit it as revision 1 of `pusd-catalog-v2`; the operator binds it | owner | #187069 | recheck-required: approval missing, not listed | withheld |
| 3 | approve revision 1 | reviewer | #187095 | recheck-required: not listed | withheld |
| 4 | dry-run `list` with 18 decimals: the contract reverts with `DecimalsMismatch` | owner (no transaction) | read at #187113 | unchanged | withheld |
| 5 | list pUSD on v2, 6 decimals | owner | #187124 | valid | **available** |
| 6 | recheck live, publish report `1faef921…`, store it on-chain | owner | #187145 | valid | available |
| 7 | submit it as revision 2: the approval clears and v2 stops listing pUSD | owner | #187165 | recheck-required: revision superseded, approval missing, not listed | withheld |
| 8 | approve revision 2; the catalog still holds the revision-1 binding | reviewer | #187181 | recheck-required: revision superseded, not listed | withheld |
| 9 | bind the revision-2 report explicitly | operator (no transaction) | read at #187194 | recheck-required: not listed | withheld |
| 10 | list pUSD again on revision 2 | owner | #187205 | valid | **available** |
| 11 | request changes on revision 2: the contract un-lists pUSD | reviewer | #187230 | recheck-required: approval revoked, not listed | withheld |
| 12 | approve revision 2 again | reviewer | #187271 | valid | **available** |

A thirteenth case needs no transaction: the same policy and bindings under a configuration that claims 18 decimals (`examples/token-catalog/config/testnet-v2-wrong-entry.json`) evaluate `valid` and still withhold the entry with `entry-mismatch:decimals`, on the inputs captured at step 10 and in CI.

Fees spent on 2026-10-25: two submits (0.0216 and 0.0209 tPOT), four reviewer decisions (0.0248, 0.0241, 0.0241, 0.0241 tPOT), two listings (0.0313 and 0.0306 tPOT), two stored reports (0.748 and 0.752 tPOT), one transfer (0.015 tPOT). Held deposits: up to 3.8415 tPOT for the reviewer's decision storage, and the listing and release deposits the dry-runs showed before each send. Deposits are held, not spent; see `docs/DEPLOYMENT.md` for recovery conditions.

## Evidence preserved unchanged

Fourteen sealed reports under `public/reports/` verify against their file names; the baseline manifest `public/baselines/current-2026-10-23.json` binds report `0272674216c3…`; the v1 sources under `contracts/deployed/v1` and `artifacts/VerifiedTokenList.json` hash to the v1 record; `public/lifecycle/token-list.json`, the ReleaseGate records and the studio run are unchanged. The first v2 policy (hash `2314f14b…`) and its binding of the v1 report are kept as history under `supersededPolicies`. The original Check-in video, deck and `docs/DEMO_SCRIPT.md` remain the historical v0.1 materials; `docs/DEMO_SCRIPT_V3.md` and the v0.3 video remain the 2026-10-24 materials; the current script is `docs/DEMO_SCRIPT_V4.md` and the current deck outline is `docs/FINAL_DECK.md`.

## Publication and remaining boundaries

- The hosted site (<https://revivecheck.axiqo.xyz/>) was republished on 2026-10-25 (`docs/PUBLICATION_2026-10-25.md`: releases r1 from commit `8aee632` and r2 from `e7044d1`, 99 files verified byte for byte on the server and over HTTPS, earlier releases kept for rollback). Which build the site serves is stated by its hosting manifest (`/hosting.json`, written by the publishing procedure in `docs/DEPLOYMENT.md`), not by this record. The YouTube video and the DoraHacks build still describe the 2026-10-24 release (`docs/PUBLICATION_2026-10-24.md`); the video predates the live lifecycle and labels the catalog sequence as simulated, which was true when it was recorded.
- The bound report `1faef921…` is acceptable under the seven-day policy until 2026-11-01T09:29:17.646Z; `docs/RENEWAL.md` is the renewal runbook (new check, stored report, new revision, exact-hash approval, explicit binding, relisting, readback). No renewal transaction has been sent.
- No builder outside the project has installed or configured ReviveCheck. The second consumer (`revivecheck-consumer-example`: a command line and the browser Token eligibility demo, installed from the packed 0.5.2 artifact, with a decision-evidence export its own `reconstruct` command re-derives, a current permission that ends at the deadline its own evidence sets, and a business action that prepares a versioned catalog release another process reads: release 1 at #192716 from the browser and #192724 from the command on 2026-10-25), the fair benchmark and the measured maintainer task (`docs/VALUE_EXPERIMENT.md`) were run by the author; `docs/PILOT_PROTOCOL.md` describes the study that would change that.
- The App now holds one explicit active report per browser-local project (`#/app/run`, `#/app/projects`), exports the consumer configuration the gate and the demo read, and states the evidence health and the planned renewal gap (`#/app/health`): between the expiry at 2026-11-01T09:29:17.646Z and the renewal planned for November 3 or 4, every evaluation of the published catalog is `expired` and the entry is withheld. The renewal is prepared read-only by `scripts/renewal-prepare.js`; no renewal transaction has been sent.
- No Discord message or new hackathon registration is part of this release. Updating the existing Build is not an organizer acceptance decision.
- The official freeze is November 5, 2026, 23:00 EST (November 6, 04:00 UTC). Final materials must reflect the evidence completed by then.

## Reproducible build

```sh
npm ci
npm test                                                   # offline
npx vite build                                             # the static site into dist/
node scripts/release-status.js --out public/release-status.json
node examples/token-catalog/catalog.js demo --strict
node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet-v2.json --fixture examples/token-catalog/data/testnet-v2/captures/12-reapprove-r2.inputs.json
```

CI runs the first three in `.github/workflows/ci.yml` and the catalog cases in `.github/workflows/token-catalog.yml`, including the must-fail cases (a wrong configured entry, a revoked approval, an unreachable node).
