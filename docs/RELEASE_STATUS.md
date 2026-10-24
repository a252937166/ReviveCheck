# Release status

Snapshot written 2026-10-24 on the `redesign/custody-record` branch, after review findings F-01 to F-07, F-09 and F-11 were addressed and F-10 was measured. The machine-readable version, with the exact commit and every check, is produced by:

```sh
node scripts/release-status.js            # exit 1 when any published record is inconsistent
```

## What is deployed and active

| Component | Where | Status |
| --- | --- | --- |
| ReleaseRegistry | `0xe949b200edf070b9d425b206ed24dc8fe5b7d339`, V3 testnet #162962 | active, reused by every token-list version |
| VerifiedTokenList v1 | `0xd0bd833b4b8658b1230a0e9a99640935b3c65819`, #164220 | active; known issue F-02 recorded in `lib/tokenlist.deployments.js`, the README and the site |
| pUSD listing | #164313 on release `0xe3f6ab77…f808`, report `cbd78faa…`, reviewer `0x48b9…a71b` | listed; evaluated `valid` by the Token Catalog on 2026-10-24 at #176662 |
| Stored reports | `remark.store` at #164266 and #164335 | retrievable and verified |
| Verification service | 13 tools over MCP, REST, JavaScript and the CLI, including `evaluate_policy` | offline tests: 149 passing |

## What is complete locally and pending on the testnet

| Item | Complete | Pending | Why |
| --- | --- | --- | --- |
| VerifiedTokenList v2 (entry ownership, `delist`, curator override) | sources, in-memory EVM tests, manifest, estimate, deploy and activation tooling, generated-module activation | deployment, activation, a v2 listing and a v2 revision on the testnet | the deployment commits 226.37 tPOT (225.738 held, 0.316 fee); the project wallet holds 78.79 tPOT, a shortfall of 147.58 |
| Token Catalog on v2 | the full lifecycle on the local stand-in chain, 17 steps checked in CI | the same lifecycle signed on the testnet | the v2 deployment above, then about 20 tPOT of held deposits and under 0.2 tPOT of fees for a listing, a revision and a rebind |
| Policy evaluation | `evaluate_policy`, the catalog, 15 policy tests, a live `valid` evaluation recorded | nothing | |
| Value experiment | one internal run recorded | an external maintainer running the same task | no external user yet |

## Evidence preserved unchanged

Twelve sealed reports under `public/reports/` verify against their file names; the baseline manifest `public/baselines/current-2026-10-23.json` binds report `0272674216c3…`; the v1 sources under `contracts/deployed/v1` and `artifacts/VerifiedTokenList.json` hash to the v1 record; `public/lifecycle/token-list.json`, the ReleaseGate records and the studio run are unchanged. The original 78-second Check-in video, its deck and `docs/DEMO_SCRIPT.md` remain the historical v0.1 materials; the updated script is `docs/DEMO_SCRIPT_V3.md`.

## Not done, by decision

- Nothing is pushed to the public repository and the site is not republished from this branch; both are the user's call.
- No DoraHacks or Discord message was sent. The submission record in `docs/SUBMISSION.md` is unchanged.
- The ReleaseGate v0.2 fixture and the v1 token list stay as recorded demonstrations; neither is redeployed or edited.

## Reproducible build

```sh
npm ci
npm test                          # 149 tests, offline
npx vite build                    # the static site into dist/
node scripts/release-status.js    # every record intact and consistent; pending items listed
node examples/token-catalog/catalog.js demo --strict
```

CI runs the first two in `.github/workflows/ci.yml` and the rest in `.github/workflows/token-catalog.yml`; the acceptance job also proves that an unavailable verification fails.
