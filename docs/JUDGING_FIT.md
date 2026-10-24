# How ReviveCheck maps to the judging criteria

Reviewed 2026-10-24 against the published criteria for the Portaldot Hacker House 2026 (Technical Feasibility 30%, Innovation 30%, Ecosystem Contribution 20%, Business Potential 20%). Each section lists what exists, where a judge can verify it, and what is still missing. Nothing here claims adoption, revenue or an organizer decision.

## Technical Feasibility (30%)

Criteria: technical approach, system architecture, code completeness, actual delivery; core functions complete; genuine and sustained GitHub activity; deployed on the Portaldot testnet with verifiable on-chain interactions.

What exists:

- One implementation, `lib/service.js`, reached five ways: the browser (studio, reviewer, docs), the MCP server (`mcp/server.js`, twelve tools), REST on the local workbench, the JavaScript module, and the CLI (`npm run rc`). Architecture diagram in the README.
- Three contracts in `contracts/`: `ReleaseRegistry`, the `ReviveCheckGuard` library, and `VerifiedTokenList` as the reference consumer. Evidence storage through the native Remark module (`lib/evidence.js`). A feed indexer that rebuilds `public/api/registry.json` from chain events (`scripts/index-registry.js`).
- 115 automated tests that run offline, including the compiled contracts executed in an in-memory EVM and the MCP server driven over stdio. CI (`.github/workflows/ci.yml`) runs the tests, the build and a records check on every push.
- Verifiable on-chain delivery on the V3 testnet, every record linked from the site and from `docs/LIFECYCLE.md`: ReleaseRegistry deployed in block 162962; VerifiedTokenList in 164220; pUSD listed on an approved release in 164313; reports stored through `remark.store` in 164266 and 164335; a full run through the studio UI that signed submit (163485), approve (163489) and a review remark (163493); the earlier ReleaseGate revisions 1 and 2.

Gaps and the fix:

- Commit history. All commits so far carry one date, and the middleware pivot is uncommitted in a worktree. The fix is procedural: commit the pivot in logical units, push, and keep committing daily until the final deadline so the history shows sustained work, with CI green on each push.
- The public site must be published from the pivoted branch, so the links in the submission show the current product.
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
- The demo's owner and reviewer are one test account; a second independent reviewer account would show the mechanism with two parties.

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

- Site: the landing with the recorded run and block links, the app (registry dashboard with live lookups, the lifecycle run, the reviewer), the docs. Published from the current branch once approved.
- Explorer: <https://scanner-testnet-v3.portaldot.dev>, every extrinsic hash in `docs/LIFECYCLE.md`.
- Repository: `npm test` offline, CI on GitHub, `contracts/`, `lib/`, `mcp/`, `scripts/`.

## 2026-10-24 review: findings and remediation

An independent same-day review ([2026-10-24_revivecheck-improvement-review.md](2026-10-24_revivecheck-improvement-review.md), with an offline reproduction script under `artifacts/review-2026-10-24/`) rated the project 68/100 on the judging weights and listed eleven findings. Status after remediation:

| Finding | Status |
| --- | --- |
| F-01 duplicate reviewers inflate a quorum | Fixed in `contracts/ReviveCheckGuard.sol` (distinct reviewers; an overload bound to the exact report hash); regression tests. |
| F-02 any release owner can replace a token entry | Fixed in `contracts/VerifiedTokenList.sol` v2 (entry ownership, `delist`, curator override); regression tests. The v1 testnet deployment is immutable and still described as v1 on the site; v2 awaits deployment. |
| F-03 replay over-claims for contract reports | Fixed in `lib/replay.js`: `partial` with `coverage.unsupported`; tests in `test/replay-coverage.test.js`. |
| F-04 the studio could not consume another reviewer's approval | Fixed: the Consume step takes a reviewer address (own address by default). |
| F-05 approval freshness is not continuous | Open by design; documented in the Watch step and the integration doc. |
| F-06 counts and copy exceed the evidence | Fixed: unique listed tokens, token symbols from the feed, the rules band names which rule is the service's; a v1 note on the band. |
| F-07 no independently runnable reference application | Open; roadmap. |
| F-08 public artifacts lag the local work | Open until the branch is pushed and the site published. |
| F-09 CI and test claims | Fixed: the workflow describes the in-memory MCP transport; the public-site lookup is opt-in (`REVIVECHECK_PUBLIC_FALLBACK=1`), so tests stay offline. |
| F-10 unvalidated business hypothesis | Open; stated as a hypothesis in the README. |
| F-11 non-English text | Fixed: the research and Obsidian notes, the wallet note template and the share-test fixture are in English; vault note titles stay as identifiers; recovery material unchanged. |

