# Release status

Release preparation snapshot, 2026-10-24, after the policy, reference-application and deployment-tooling changes. F-10 has a scripted internal experiment; external adoption and commercial value remain unvalidated. The machine-readable version, with the exact commit and every check, is produced by:

```sh
node scripts/release-status.js            # exit 1 when any published record is inconsistent
```

## What is deployed and active

| Component | Where | Status |
| --- | --- | --- |
| ReleaseRegistry | `0xe949b200edf070b9d425b206ed24dc8fe5b7d339`, V3 testnet #162962 | active, reused by every token-list version |
| VerifiedTokenList v1 | `0xd0bd833b4b8658b1230a0e9a99640935b3c65819`, #164220 | historical active read target; known issue F-02 recorded; new listing writes refused by the application and shared script helper |
| pUSD listing | #164313 on release `0xe3f6ab77…f808`, report `cbd78faa…`, reviewer `0x48b9…a71b` | listed; stricter policy evaluated `valid` on 2026-10-24 with the listing identity verified at #177177 |
| Stored reports | `remark.store` at #164266 and #164335 | retrievable and verified |
| Verification service | 13 tools over MCP, REST, JavaScript and the CLI, including `evaluate_policy` | offline tests: 160 passing; production build passed |

## What is complete locally and pending on the testnet

| Item | Complete | Pending | Why |
| --- | --- | --- | --- |
| VerifiedTokenList v2 (entry ownership, `delist`, curator override) | sources, in-memory EVM tests, manifest, estimate, deploy and activation tooling, generated-module activation | deployment, activation, a v2 listing and a v2 revision on the testnet | the deployment commits 226.37 tPOT (225.738 held, 0.316 fee); the project wallet holds 78.79 tPOT, a shortfall of 147.58 |
| Token Catalog on v2 | the full lifecycle on the local stand-in chain, 17 steps checked in CI | the same lifecycle signed on the testnet | the v2 deployment above, then about 20 tPOT of held deposits and under 0.2 tPOT of fees for a listing, a revision and a rebind |
| Policy evaluation | `evaluate_policy`, the catalog, provenance/version/freshness refusal cases, a new captured live `valid` evaluation | continuous monitoring and external trust are not implemented | policy evaluates dated observations when invoked; the historical testnet roles use one project account |
| Value experiment | one scripted internal run recorded | an external maintainer running the same task | no external user or measured human-effort benefit yet |

## Evidence preserved unchanged

Twelve sealed reports under `public/reports/` verify against their file names; the baseline manifest `public/baselines/current-2026-10-23.json` binds report `0272674216c3…`; the v1 sources under `contracts/deployed/v1` and `artifacts/VerifiedTokenList.json` hash to the v1 record; `public/lifecycle/token-list.json`, the ReleaseGate records and the studio run are unchanged. The original 78-second Check-in video, its deck and `docs/DEMO_SCRIPT.md` remain the historical v0.1 materials; the updated script is `docs/DEMO_SCRIPT_V3.md`.

## Publication and remaining boundaries

- Source, site, video and existing DoraHacks project-page publication are tracked in `docs/RELEASE_V03.md`; only verified receipts there establish delivery.
- No Discord message or new hackathon registration is part of this release. Updating the existing Build is not an organizer acceptance decision.
- The ReleaseGate v0.2 fixture and the v1 token list stay as recorded demonstrations; neither is redeployed or edited.

## Reproducible build

```sh
npm ci
npm test                          # 160 tests, offline
npx vite build                    # the static site into dist/
node scripts/release-status.js    # every record intact and consistent; pending items listed
node examples/token-catalog/catalog.js demo --strict
```

CI runs the first two in `.github/workflows/ci.yml` and the rest in `.github/workflows/token-catalog.yml`; the acceptance job also proves that an unavailable verification fails.
