# ReviveCheck: comparison with public Portaldot submissions

Research snapshot: October 24, 2026, approximately 13:33–13:39 UTC / 09:33–09:39 EDT.

## Assessment

Several competitors have substantive public implementations, verified CI, or independently readable testnet transactions. ReviveCheck's most immediate gaps are public delivery, precise verification semantics, a reproducible consumer integration, and a business outcome that a judge can understand quickly. Adding more interfaces does not address those gaps.

ReviveCheck should retain its focus on acceptance at a shared finalized native/EVM checkpoint, exact-report review, and downstream release eligibility. This comparison does not establish that these capabilities are unique. It also does not establish a complete ranking or a probability of winning.

## Scope and evidence limits

- Earlier on October 24, the DoraHacks event list displayed 28 builds, including six in Modular Cloud & Middleware. This research pass could not refresh that count: DoraHacks web retrieval returned 405 and the Chrome connection timed out.
- SEAM and PortalOps repository links were read from their DoraHacks pages earlier in this chat. The Pindex, Verigate, AgentTab, Portova, and Vestry repositories were matched using public names, Portaldot network configuration, track, and application descriptions; their DoraHacks-to-repository links were not reverified in this pass. The unrelated student-portfolio repository `RiyuT2/Portova` was excluded.
- Competitor repositories, source, workflow records, and selected receipts were inspected read-only. No competitor code was installed or executed; no accounts were created, webhooks sent, wallets connected, or transactions broadcast.
- A source implementation is stronger evidence than a marketing description, but is not independent end-to-end validation. An HTTP 200 does not prove an interactive wallet flow. A green workflow proves only the jobs it actually runs. Indexed events do not demonstrate independent customers.
- ReviveCheck received a deeper local correctness review than the competitors. A defect not found in this limited competitor review must not be treated as absent.
- ReviveCheck public `main` remained `aecc761677681433d37bbcf71064547f57343319`; Pages remained `1352f6f1f27466481465d5b75fe1c5d1e8dd11fb`. Local v0.3 capabilities and published capabilities must be compared separately.

## Same-track comparison

| Project and public source snapshot | What is supported by inspected evidence | Relative gap for ReviveCheck | Confirmed limits |
| --- | --- | --- | --- |
| **SEAM** — `rishu4436/seam-portaldot`, `a958d95139a3fbc8d24ab47ecb61599e92cf44c7` | Compiler, policy, chain and SDK packages; independent consumer example; package tarball smoke test; successful quality CI and disposable-local-chain E2E; two hosted-V3 transactions independently read as successful/finalized | Stronger public packaging, reusable-consumer evidence, and explicit incomplete/unknown verification semantics | No independent adoption/business validation established; local E2E is not hosted-V3 E2E; no hosted RuntimeGuard monitoring; unsupported Revive effects remain unknown |
| **PortalOps** — `nofazechris/portalops`, `f5b7dddb1f8902a495bb1565ea24f3bfa48c41f8` | Event ingester, transactional cursor, HMAC webhook delivery, leases, retries, stored-event replay, SDK/MCP and examples; public health/status returned 200; selected deployment/event receipts succeeded | Stronger running-service delivery, onboarding, and operational recovery implementation | Recent five Actions runs failed; cause not established; native runtime event adapter absent; single-instance/throughput limits; finality updates do not automatically trigger a second webhook; some stale docs |
| **Verigate PortalDot** — `rudimentall1/verigate-portaldot`, `305fba606331951c7992d5bff88b58c81cde400a` | Policy/signature/payment gate; EIP-712 domain/action binding, nonce/deadline, allowlist, caps, authority separation; negative tests in source and successful public CI | Stronger explicit authorization boundary, negative-case coverage, and public release consistency | Chain trusts an EVM authority after off-chain Ed25519 verification; only constrains guard-controlled funds; independent users not established; old/new video evidence is mixed and disclosed |
| **AgentTab on Portaldot** — `zwang1111/agenttab-portaldot`, `f2afad741753b23fade3718e2e220fe9d9329400` | Deposit → cumulative vouchers → HTTP 402/200 gateway → batch settlement → expiry/refund; SDK workspace, gateway and Solidity; successful Node CI | Clearer single-sentence value and business lifecycle; visible consumer/service example | SDK package is private workspace code, not a published npm package; Node CI does not run Forge tests; default gateway storage is memory; recorded payer/provider are the same key; prior Celo reuse is disclosed |
| **Pindex / PortalIndex** — `youthisguy/portalIndex`, `097d86e191e243171d282069ee297eba7cc7a1f3` | Metadata-driven finalized ingestion, transactional cursor, gap recovery, derived Postgres state, REST/GraphQL exposure and deployment configuration | More immediately recognizable reusable data service and integration benefit | No Actions runs observed; `npm test` is a failing placeholder; SQL fixtures are not an automated assertion suite; ABI decoding, runtime-schema migrations and checkpoints remain planned; hosted availability not verified |

### SEAM: the most useful direct engineering benchmark

The strongest comparable evidence is its self-built consumer using public package imports, plus tarball installation into a temporary empty directory. This demonstrates reuse without pretending to have an external customer. Its receipt model separates digest integrity from chain verification and refuses complete verification when effect coverage is unknown. ReviveCheck's current checkpoint-only generic replay success falls short of that standard.

For the exact inspected commit, GitHub job logs showed lint, format, build, tests and `smoke:pack` succeeding. The five workspaces reported 1,572 passing and 13 skipped tests; this is a workflow-log observation, not a local rerun or a quality ranking by test count. A separate three-case E2E run used a disposable local chain.

Two transactions were independently read from the official V3 index as successful and finalized:

- Atomic Assets/NFT batch at #102671: `0x6be1232e17cee41f0376d91b5638ae3f2f9909f4d0f2d15cd633422a339cf355`.
- Asset transfer at #121390: `0xadced4b5e13e638ff3d967d4343dbfd9ea103eb62ff05a5ec3c3784e41aa11a1`.

Sources: [consumer](https://github.com/rishu4436/seam-portaldot/blob/a958d95139a3fbc8d24ab47ecb61599e92cf44c7/examples/consumer/index.mjs), [package smoke test](https://github.com/rishu4436/seam-portaldot/blob/a958d95139a3fbc8d24ab47ecb61599e92cf44c7/scripts/pack-smoke.sh), [verification semantics](https://github.com/rishu4436/seam-portaldot/blob/a958d95139a3fbc8d24ab47ecb61599e92cf44c7/packages/sdk/src/verify-live.ts), [quality CI](https://github.com/rishu4436/seam-portaldot/actions/runs/39540810432), [local-chain E2E](https://github.com/rishu4436/seam-portaldot/actions/runs/39540809760), [official batch receipt](https://scanner-testnet-v3-api.portaldot.dev/extrinsics/0x6be1232e17cee41f0376d91b5638ae3f2f9909f4d0f2d15cd633422a339cf355).

### PortalOps: the most useful service-delivery benchmark

At 13:36:56 UTC, `/api/v1/health` returned HTTP 200 with `ok:true`; `/api/v1/public/status` returned HTTP 200 with connected head 175280 and 553 indexed events. Those are point-in-time service responses; 553 is not a user or customer count. The full webhook failure/retry/replay path was not independently exercised in this review.

The official EVM RPC returned successful receipts for Quest deployment `0xe2590bb80b8d81067a1af092a76e5ee9ea22d9c277b0bf2da752813fc21f8a4d` at #145098 and Ping `0x2e603ac3d0b6219098060152af1b5253e38b86bd2bcd654f49d3cfc36ef30cfb` at #152082. Actual examples and an available public read path make its product easier to inspect than ReviveCheck's unpublished redesign.

Sources: [health](https://portalops.onrender.com/api/v1/health), [public status](https://portalops.onrender.com/api/v1/public/status), [ingester](https://github.com/nofazechris/portalops/blob/f5b7dddb1f8902a495bb1565ea24f3bfa48c41f8/apps/worker/ingest.ts), [delivery engine](https://github.com/nofazechris/portalops/blob/f5b7dddb1f8902a495bb1565ea24f3bfa48c41f8/packages/webhook-engine/runner.ts), [operating limits](https://github.com/nofazechris/portalops/blob/f5b7dddb1f8902a495bb1565ea24f3bfa48c41f8/docs/operations/live-deploy.md), [failed workflow snapshot](https://github.com/nofazechris/portalops/actions/runs/39969691540).

### Other middleware evidence

- Verigate: [Guard V2](https://github.com/rudimentall1/verigate-portaldot/blob/305fba606331951c7992d5bff88b58c81cde400a/contracts/PortalDotAgentGuardV2.sol), [positive/negative tests](https://github.com/rudimentall1/verigate-portaldot/blob/305fba606331951c7992d5bff88b58c81cde400a/test/PortalDotAgentGuardV2.test.js), [successful CI](https://github.com/rudimentall1/verigate-portaldot/actions/runs/40098648985). Its public live-transfer JSON was read; that transaction was not independently reread in this pass.
- AgentTab: [contract](https://github.com/zwang1111/agenttab-portaldot/blob/f2afad741753b23fade3718e2e220fe9d9329400/src/AgentTab.sol), [gateway](https://github.com/zwang1111/agenttab-portaldot/blob/f2afad741753b23fade3718e2e220fe9d9329400/gateway/src/app.ts), [successful Node CI](https://github.com/zwang1111/agenttab-portaldot/actions/runs/39831591647), [same-account live record](https://github.com/zwang1111/agenttab-portaldot/blob/f2afad741753b23fade3718e2e220fe9d9329400/runs/gateway-sdk-live-20261023.json). Live open/settle hashes were read from project records, not independently reread on-chain.
- Pindex: [ingester](https://github.com/youthisguy/portalIndex/blob/097d86e191e243171d282069ee297eba7cc7a1f3/src/ingest.ts), [test command](https://github.com/youthisguy/portalIndex/blob/097d86e191e243171d282069ee297eba7cc7a1f3/package.json), [SQL fixtures](https://github.com/youthisguy/portalIndex/blob/097d86e191e243171d282069ee297eba7cc7a1f3/sql/test_derived.sql).

## Cross-track benchmarks for an overall prize

### Vestry: review causes an enforceable financial outcome

Public source snapshot: `nftkingiii/vestry`, `1c09ff369d53155487f3dd84d97ee6fd53a94902`.

Its grant flow connects escrow, evidence submission, authorized-reviewer quorum, change-request reset, optional contract-usage gating, native vesting payout, claim, and deadline reclaim. Source rejects duplicate reviewer configuration and repeated approvals. This makes the consequence of review easier to explain than an approval that only appears on a dashboard.

At approximately 13:38 UTC, the public landing returned HTTP 200 with title `Vestry`. The official EVM RPC returned status `0x1` for `vest()` transaction `0x4147764f9e1d87ba944c9c2ef7abb67359106d58401118a4d1aeb416d006f946`, block 135631, targeting `0x0000000000000000000000000000000009020000`. The repository's native before/after lock values were read as project evidence, not independently reconstructed in this pass.

Limits are explicit: the full testnet flow was script-driven, not a complete browser wallet rehearsal; the asset-denominated flow and external funder pilot remain pending. Nine contract tests are described and present, but were not run here. The Actions results inspected included dependency-update jobs and must not be described as verified application quality CI.

Sources: [contract](https://github.com/nftkingiii/vestry/blob/1c09ff369d53155487f3dd84d97ee6fd53a94902/contracts/Vestry.sol), [recorded lifecycle](https://github.com/nftkingiii/vestry/blob/1c09ff369d53155487f3dd84d97ee6fd53a94902/README.md), [vesting evidence](https://github.com/nftkingiii/vestry/blob/1c09ff369d53155487f3dd84d97ee6fd53a94902/evidence/vest-claim.json), [public app](https://vestry-grants.vercel.app).

### Portova: a clearer everyday user journey and receipt recovery

Public source snapshot: `siyaind/portova`, `c298e06ef49d6572d43fc6db7c8edc4e5062308c`.

Its user-facing flow covers native token creation, NFTs, pools, liquidity, swaps, and reviewed treasury withdrawals. The actual implementation uses native pallets, not a project-deployed Solidity contract. Current public CI runs installation, tests, type checking, and build successfully. The QA record distinguishes fake-adapter tests, browser checks, old transaction recovery, and unexecuted human-wallet actions.

At approximately 13:38 UTC, the public landing returned HTTP 200 with the Portova title. The official index independently returned successful/finalized for historical swap `0xf60fcae4e346fc06e0e4164ffa37c0ea0494baa73c10b72c9a491b2dbeb86095`, block 159687, extrinsic 1. This is evidence of that swap, not a new treasury-withdrawal execution.

Limits: NFT trading remains disabled by runtime capabilities; the recent treasury update has no new human-wallet transfer proof; mobile verification was explicitly incomplete. This is a product/onboarding benchmark, not a reason for ReviveCheck to implement a DEX.

Sources: [README](https://github.com/siyaind/portova/blob/c298e06ef49d6572d43fc6db7c8edc4e5062308c/README.md), [QA boundaries](https://github.com/siyaind/portova/blob/c298e06ef49d6572d43fc6db7c8edc4e5062308c/docs/submission/QA.md), [successful CI](https://github.com/siyaind/portova/actions/runs/40098474894), [official swap receipt](https://scanner-testnet-v3-api.portaldot.dev/extrinsics/0xf60fcae4e346fc06e0e4164ffa37c0ea0494baa73c10b72c9a491b2dbeb86095), [public app](https://portova.vercel.app).

## Highest-return changes for ReviveCheck

| Priority | Competitive lesson | Required ReviveCheck result |
| --- | --- | --- |
| 1 | SEAM's unknown/incomplete semantics; Verigate's negative-case boundaries | Correct generic replay coverage, unique-reviewer counting, catalog authorization/subject binding, and owner/reviewer separation. A missing proof must not become a complete green verdict. |
| 2 | SEAM's independently installed consumer | A self-built Token Catalog with its own config and instructions, using documented interfaces. A clean consumer install/smoke test demonstrates reuse without claiming external adoption. |
| 3 | Vestry/AgentTab's explicit business consequences | Unapproved means unavailable; approval enables use; a new revision disables the old binding; approval of the new exact report plus rebind restores use. Include revocation and readback. |
| 4 | PortalOps's public running product and setup path | Publish the corrected source/site/docs/video, prove the actual CI run, and provide a short read-only path judges can use without a funded wallet. |
| 5 | Pindex/PortalOps's reusable service interfaces | Ship a user-owned acceptance-plan template and downstream CI example. Label static feeds as snapshots; provide explicit refresh, freshness, and unknown-state behavior. |
| 6 | Portova's evidence boundaries and recovery | Preserve transaction/report history across reloads; distinguish old receipts from new operations; show exact sender, reviewer, target, fees/deposits, finality, and scope. |

Keep the detailed local findings and their diagnostic evidence in [the improvement review](2026-10-24_revivecheck-improvement-review.md). Existing controlled examples and wallets are sufficient for the next reference demo. No independent-adoption claim, external customer, or additional unrelated feature is needed to establish that narrower result.

## Competitive conclusion

SEAM is ahead on publicly reproducible engineering and strict proof states; PortalOps is ahead on available service delivery and onboarding; Verigate is ahead on explicit authorization boundaries and negative-case evidence. AgentTab and Vestry communicate a more immediate business outcome. Pindex and Portova show that service usefulness and a direct user journey can be persuasive even with narrower verification coverage.

ReviveCheck can compete by making its specific release-eligibility promise reliable and demonstrable. The next milestone is a corrected, publicly reproducible Token Catalog lifecycle, with accurate proof/freshness states and synchronized judge-facing materials. This assessment does not claim that any competitor is secure, finalist-approved, commercially validated, or certain to win.
