# How ReviveCheck maps to the judging criteria

Reviewed 2026-10-24 against the published criteria for the Portaldot Hacker House 2026 (Technical Feasibility 30%, Innovation 30%, Ecosystem Contribution 20%, Business Potential 20%). Each section lists what exists, where a judge can verify it, and what is still missing. Nothing here claims adoption, revenue or an organizer decision.

## Technical Feasibility (30%)

Criteria: technical approach, system architecture, code completeness, actual delivery; core functions complete; genuine and sustained GitHub activity; deployed on the Portaldot testnet with verifiable on-chain interactions.

What exists:

- One implementation, `lib/service.js`, reached five ways: the browser (studio, reviewer, docs), the MCP server (`mcp/server.js`, thirteen tools), REST on the local workbench, the JavaScript module, and the CLI (`npm run rc`). Architecture diagram in the README.
- Three contracts in `contracts/`: `ReleaseRegistry`, the `ReviveCheckGuard` library, and `VerifiedTokenList` as the reference consumer. Evidence storage through the native Remark module (`lib/evidence.js`). A feed indexer that rebuilds `public/api/registry.json` from chain events (`scripts/index-registry.js`).
- 160 automated tests that run offline, including the compiled contracts executed in an in-memory EVM, the policy evaluator, the deployment tooling, the Token Catalog lifecycle on an in-memory chain, and the MCP server driven over an in-memory transport. CI (`.github/workflows/ci.yml`) runs the tests, the build and a records check on every push; `.github/workflows/token-catalog.yml` runs the catalog lifecycle, the acceptance command (pass and must-fail) and `scripts/release-status.js`.
- Verifiable on-chain delivery on the V3 testnet, every record linked from the site and from `docs/LIFECYCLE.md`: ReleaseRegistry deployed in block 162962; VerifiedTokenList in 164220; pUSD listed on an approved release in 164313; reports stored through `remark.store` in 164266 and 164335; a full run through the studio UI that signed submit (163485), approve (163489) and a review remark (163493); the earlier ReleaseGate revisions 1 and 2.

Gaps and the fix:

- Source and public artifacts must match the current release. The publication receipts of the 2026-10-24 release are in `docs/PUBLICATION_2026-10-24.md`; the hosted site, video and build describe that release until they are republished from a commit that carries the 2026-10-25 lifecycle. A local commit or build alone does not establish public delivery; `docs/RELEASE_STATUS.md` says so.
- Delivery history is concentrated in a short period. Future commits should correspond to actual improvements and evidence, rather than manufacturing activity for the judging criterion.
- Only the Polkadot-wallet route has a recorded end-to-end run; the EVM-wallet route is implemented and dry-run tested but not recorded.

## Innovation (30%)

Criteria: innovation in technical solution, product model and scenario; effective use of V3 features (WASM/EVM compatibility, modular architecture, multi-chain); real value beyond existing solutions.

What exists:

- EVM and native used together, not as alternatives. The same contract is reached as an EVM transaction (`eth_sendTransaction`) or a native `revive.call`, and every readback goes through both `eth_call` and `ReviveApi.call` at one finalized block; the two must agree before a result is shown. Account and block mapping go through `ReviveApi`.
- Modular architecture used as such. The evidence store is a runtime module (`remark.store`), not a contract; token parity checks read native Assets storage beside the ERC-20 precompile; the registry is a contract other contracts consume through a library. Modules in use: Revive, ReviveApi, Assets with its precompile, Remark.
- Multi-network. Promotion reads V3 Live itself (chain 780780777, runtime 3001) before any deployment there, and refuses the demo release because the asset does not exist on V3 Live. This is read-only; V3 has no XCM, and the project does not claim cross-chain messaging.
- Beyond existing solutions: the comparison on the site and in the README. Off-chain token lists, spreadsheets and chat approvals cannot be read by a contract, do not record what was approved, and carry no retrievable evidence. Explorer verification proves bytecode, not a release decision. ReviveCheck puts the decision, its exact subject (a report hash), its evidence and its verification on-chain.

Gaps:

- Gasless reviewer decisions through V3's MetaTx module are on the roadmap, not built.
- The 2026-10-23 demo's owner and reviewer are one test account. The 2026-10-25 v2 lifecycle uses a separate reviewer account, still controlled by the project: two parties on-chain, not independent review.

## Ecosystem Contribution (20%)

Criteria: contribution to infrastructure, developer tools, node ecosystem, application ecosystem, user growth; potential for sustained building; open-source value; long-term collaboration.

What exists:

- Developer tools: the MCP server for agents (one command adds it to Claude Code), the CLI for CI, the REST route, the JavaScript module, and a docs site with a request example for every capability in each route.
- A library other builders drop into their contracts (`ReviveCheckGuard`, three lines to gate any function), with a worked reference consumer.
- A public, reproducible feed of registry state built from chain events, usable by wallets and indexers.
- MIT license, offline test suite, CI, and a roadmap in the README.
- Findings that help other V3 builders, recorded in `docs/CHAIN_FINDINGS.md`: the constructor-encoding trap for native Solidity deployment, asset-paid fee decoding with spec-scoped types, explorer route gaps.

Gaps:

- No external user yet. The next product test named in the README is an external builder bringing their own contract.
- No npm package and no GitHub Action yet (roadmap).
- The node ecosystem is out of scope for this project.

## Business Potential (20%)

Criteria: real market need, clear users and use cases, feasible model and growth path, team capability to keep delivering.

What exists:

- Users and use cases named on the site and in the README: token issuers and listing teams (the pUSD release is the worked example), protocol teams gating launches and upgrades, and reviewers, auditors, agents and CI.
- A model stated as a hypothesis: open-source contracts, library and API; paid hosted verification and indexing, curated reviewer registries operated for an ecosystem, and CI integrations with report retention.
- Growth path: the guard library makes every consumer contract a reason for its reviewers to use the registry; the MCP server puts the checks inside agent workflows without a UI.

Gaps:

- No validation with a paying customer, and no usage beyond the author's test account. The submission should say so and name the first target customer type.
- Team capability is best shown by the commit cadence between now and the final deadline and by the roadmap items that ship.

## Where a judge verifies

- Site: the landing with the recorded run and block links, the app (registry dashboard with live lookups, the Catalog decision page, the lifecycle run, the reviewer), the docs. Publication evidence of the 2026-10-24 release is in `docs/PUBLICATION_2026-10-24.md`; the current status record is `public/release-status.json`.
- Explorer: <https://scanner-testnet-v3.portaldot.dev>, every extrinsic hash in `docs/LIFECYCLE.md`.
- Repository: `npm test` offline, CI on GitHub, `contracts/`, `lib/`, `mcp/`, `scripts/`.

## 2026-10-24 review: findings and remediation

An independent same-day review ([2026-10-24_revivecheck-improvement-review.md](2026-10-24_revivecheck-improvement-review.md), with an offline reproduction script under `artifacts/review-2026-10-24/`) rated the project 68/100 on the judging weights and listed eleven findings. Status after remediation:

| Finding | Status |
| --- | --- |
| F-01 duplicate reviewers inflate a quorum | Fixed in `contracts/ReviveCheckGuard.sol` (distinct reviewers; an overload bound to the exact report hash); regression tests. |
| F-02 any release owner can replace a token entry | Fixed in `contracts/VerifiedTokenList.sol` v2 (entry ownership, `delist`, curator override); regression tests. Deployment tooling rebuilt around a validated manifest (`deployments/token-list-v2.manifest.json`, `lib/deployment.js`, `docs/DEPLOYMENT.md`): public-address estimation without wallet secrets, versioned records beside the preserved v1 ones, code and dual-interface identity verified before activation. v2 was deployed on 2026-10-24 (#177354, nine verification checks) and activated; pUSD is listed on it (#187124, #187205). The v1 deployment is immutable and historical; writes to it are refused. |
| F-03 replay over-claims for contract reports | Fixed in `lib/replay.js`: `partial` with `coverage.unsupported`; tests in `test/replay-coverage.test.js`. |
| F-04 the studio could not consume another reviewer's approval | Fixed: the Consume step takes a reviewer address (own address by default). |
| F-05 approval freshness is not continuous | Fixed as a policy envelope (`lib/policy.js`, `evaluate_policy`, `docs/POLICY.md`): acceptance bound to network and genesis, subject (asset or contract code identity), plan fingerprint, supported runtimes, evidence age and an explicit trusted reviewer set, evaluated against fresh finalized reads; `valid`, `recheck-required`, `expired` or `unknown`, and only `valid` enables. New reports need new approval and an explicit rebinding; history is kept. Expiry is a policy clock, drift is detected only from the observation supplied; nothing watches continuously. Provenance, consumer identity and report-binding regressions are included. |
| F-06 counts and copy exceed the evidence | Fixed: unique listed tokens, token symbols from the feed, the rules band names which rule is the service's; a v1 note on the band. |
| F-07 no independently runnable reference application | Fixed: `examples/token-catalog/` with its own entry point, two configurations, README and acceptance workflow, built only on the documented interfaces. The local lifecycle (A submits, B approves, A lists, revision invalidates, recheck, reapproval, explicit rebinding, plus revocation, expiry, wrong-target, runtime change, node outage, a stranger's replacement attempt) runs on an in-memory chain with VerifiedTokenList v2 and is checked step by step in CI. The testnet configuration evaluated the recorded pUSD release `valid` live on 2026-10-24. On 2026-10-25 the v2 configuration recorded the lifecycle live with a distinct reviewer account (`examples/token-catalog/data/testnet-v2/lifecycle.json`); roles and simulated evidence are labelled. |
| F-08 public artifacts lag the local work | The v0.3 release was published on 2026-10-24 (`docs/PUBLICATION_2026-10-24.md`: source, site, video). The 2026-10-25 work is committed but not yet republished; `docs/RELEASE_STATUS.md` lists that as pending. |
| F-09 CI and test claims | Fixed: the workflow describes the in-memory MCP transport; the public-site lookup is opt-in (`REVIVECHECK_PUBLIC_FALLBACK=1`), so tests stay offline. |
| F-10 unvalidated business hypothesis | A scripted internal experiment is recorded in `docs/VALUE_EXPERIMENT.md`: 12 modeled raw operations and two configured commands, both retaining outputs. Timing coverage differs; no human-time saving, observed intervention reduction or comparative error-rate improvement is established. ReviveCheck emits standard report and policy-decision artifacts and executed one wrong-decimals refusal case. External adoption, maintainer usability and paying demand remain unverified. |
| F-11 non-English text | Fixed: the research and Obsidian notes, the wallet note template and the share-test fixture are in English; vault note titles stay as identifiers; recovery material unchanged. |

## 2026-10-25 assessment: findings and remediation

A second assessment ([2026-10-25_score-improvement-report.md](2026-10-25_score-improvement-report.md)) rated the published 2026-10-24 release 75/100 and set seven items. Status after the work of 2026-10-25:

| Item | Status |
| --- | --- |
| A-01 bind the emitted catalog entry to the approved evidence | Done: the catalog derives the published fields from the approved report (`approvedEntry`, `compareEntry` in `examples/token-catalog/lib/catalog.js`); `bind` refuses a differing configured entry; `build` withholds it with `entry-mismatch:<field>` even under a `valid` evaluation; canonical casing and key order; a report without a complete entry publishes nothing; a broken seal approves nothing. Proven in `test/token-catalog.test.js`, in CI on the live step-12 inputs (`config/testnet-v2-wrong-entry.json` must fail) and on the Catalog decision page. |
| A-02 bind persisted receipts to the operation | Done: `src/receipts.js` binds a studio listing receipt to network and genesis, consumer address and version, token, release, exact report and revision, and reviewer; a mismatching or pre-identity receipt is shown as Historical and never completes the current operation; a superseded revision marks it history without rewriting it; Listed requires a matching dual-interface readback. Tests in `test/receipts.test.js`. |
| A-03 prove invalidation and recovery on the testnet | Done on 2026-10-25 with a separate project-controlled reviewer account: twelve recorded steps and ten finalized receipts on release `pusd-catalog-v2` and VerifiedTokenList v2 (listing #187124; revision 2 at #187165 un-lists; approval #187181 alone insufficient; explicit rebind; relist #187205; revoke #187230; re-approve #187271), each with the policy decision at that moment (`docs/LIFECYCLE.md`, `docs/RELEASE_STATUS.md`). Two project-controlled signers show role separation, not independent review. Expiry, unsupported runtime and node outage remain simulated. |
| A-04 expose the business decision and its recovery path | Done: the Catalog decision page (`#/app/catalog`) shows the published entry against the approved report, the on-chain approval, the listing, the policy verdict with reason codes, evidence age against the policy clock, observation freshness, checkpoints, the next action, the recorded execution with explorer links and the append-only binding history; "Evaluate now" runs the same evaluator in the browser. Three catalogs: v2 current, the wrong-entry demonstration, v1 historical. No wallet is needed. |
| A-05 prove integration from a clean consumer environment | Partly: the package now has `exports`, a `files` whitelist and `bin`; a second consumer (a DEX allow-list) is installed from the packed artifact in a separate repository with its own policy, refusal cases, CI workflow and onboarding log. It was built and run by the author, so it shows portability, not independent execution or adoption. |
| A-06 replace assumed efficiency with observed outcomes | Partly: `docs/VALUE_EXPERIMENT.md` now compares equivalent checks at identical captured checkpoints across five scenarios, splits installation, active effort and network waiting, and tests decision reconstruction; `docs/PILOT_PROTOCOL.md` defines the maintainer study. No human participant has run it; no speed, adoption or willingness-to-pay claim is made. |
| A-07 remove contradictions across materials | Done for the repository: one authoritative record (`public/release-status.json`, mirrored by `docs/RELEASE_STATUS.md`) with six levels and every transaction; README, deployment, catalog, policy, integration, product and design documents and the landing copy agree with it; the missing `docs/RELEASE_V03.md` links are gone. Pending: republishing the site, the video and the build from this source, and recording the final video (`docs/DEMO_SCRIPT_V4.md`, `docs/FINAL_DECK.md`). |

