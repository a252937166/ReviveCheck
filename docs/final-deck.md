# ReviveCheck final pitch deck

Prepared 2026-10-27 for Portaldot Hacker House 2026, Modular Cloud and Middleware. Six pages. This current deck supplements the historical decks, which remain unchanged. The matching public artifact is `public/revivecheck-final-deck.pdf`.

## 1. A release approval needs evidence that still holds

**ReviveCheck: inspect the evidence; enforce the exact approval.**

A token list says pUSD has 18 decimals; Portaldot's native asset storage and ERC-20 precompile both say 6. Trusting the list displays one pUSD as a trillionth. A badge alone does not say what was checked, who approved it, or when the evidence stopped qualifying.

ReviveCheck links a finalized check, a sealed report, an on-chain approval and an application's current token-admission decision. The intended users are wallet, DEX and token-list maintainers.

- App: https://revivecheck.axiqo.xyz/
- Reference consumer: https://demo.revivecheck.axiqo.xyz/
- Public read-only access requires no login, invitation or wallet. Writing requires an explicitly chosen wallet signature.

## 2. A complete lifecycle, not a permanent badge

1. **Check:** compare the acceptance plan against native and EVM observations at one finalized checkpoint. A wrong-decimals release fails and names the field; a corrected plan must be checked again.
2. **Seal and submit:** retain the SHA-256 report and its retrievable on-chain bytes; submit the exact fingerprint and revision to ReleaseRegistry.
3. **Review:** an authorized reviewer approves that exact report and revision. An earlier approval never transfers to a new report.
4. **Consume:** the listing contract checks approval. The application's own policy also checks the exact published entry, network, runtime, reviewer and evidence age.
5. **Recheck and recover:** a new revision invalidates the old approval and binding. A new approved report needs explicit rebinding and relisting. Revoked, expired, mismatched or unavailable evidence withholds admission; history stays inspectable.

The current bound report has a seven-day policy lifetime ending 2026-11-01T09:29:17.646Z. Current observations also have a 15-minute freshness limit. Refreshing reads does not extend the report's lifetime. Renewal is an operational follow-up; it has not been sent.

## 3. Portaldot is in the verification path

- **Revive:** ReleaseRegistry and VerifiedTokenList v2 make exact-hash approval and token listing readable by contracts.
- **ReviveApi:** native/EVM account mapping and finalized block correspondence pin both interfaces to the same chain checkpoint.
- **Assets + ERC-20 precompile:** compare two views of the same token, including decimals, supply and holder balance.
- **Remark:** `remark.store` retains report bytes on-chain. Retrieval reconstructs and verifies the SHA-256 report fingerprint.

The tested adapter is scoped to Portaldot V3 testnet runtime 3002, EVM chain ID 420420777. Unknown network/runtime or incomplete evidence fails closed; a future upgrade requires explicit revalidation.

Deployed ReleaseRegistry: `0xe949b200edf070b9d425b206ed24dc8fe5b7d339`.

Deployed VerifiedTokenList v2: `0xedaf8a25bb583ad164a94191b762414277198df9`.

## 4. Working proof, with public checkpoints

The recorded 2026-10-25 lifecycle contains twelve steps with ten finalized transaction receipts: submission, approval, listing, revision invalidation, reapproval, explicit rebinding, relisting, revocation and restoration. A current browser evaluation is a separate read, not a replay of the old green state.

One revision's public checkpoints:

- Report bytes stored: block 187145.
- Revision 2 submitted: block 187165.
- Exact revision approved: block 187181.
- Explicitly rebound and relisted: block 187205.

The browser verifies the sealed report fingerprint and reproduced 13 of 13 observations at that report's original block. The local repair validation records 255 main-project tests and 24 consumer tests passing; public hosting manifests identify the deployed builds.

The owner and reviewer are separate project-controlled test accounts. These receipts demonstrate role separation, not independent review. Expiry, runtime change and node outage are labelled local simulations; they are not additional testnet transactions.

Evidence: `docs/LIFECYCLE.md`, `public/lifecycle/token-list-v2.json`, `public/release-status.json`, `docs/2026-10-26_repair-completion.md`, `docs/PUBLICATION_2026-10-26.md` and the official explorer https://scanner-testnet-v3.portaldot.dev/.

## 5. A separate app owns the decision

Open the public Token eligibility demo. Check its 18-decimal entry: it is withheld with `entry-mismatch:decimals`. Inspect the exact bound report in ReviveCheck. Correct the entry to 6 decimals and refresh under the consumer's own policy. Only a fresh valid result makes the token selectable and allows preparation of a versioned catalog release.

The consumer installs the verified packed 0.5.3 artifact, retrieves report evidence and approval, owns its policy, exports a portable decision document and prepares an immutable catalog release for a separate reader. It does not copy the App's green badge. A failed or expired evaluation does not retain permission.

The same deterministic verification service is available through JavaScript, REST, MCP and CLI. MCP is an integration interface, not an AI verifier. `ReviveCheckGuard` exposes the on-chain approval check; freshness and other application policy conditions are evaluated by the application.

Consumer source: https://github.com/a252937166/revivecheck-consumer-example.

This integration was built and run by the ReviveCheck author. It demonstrates reuse and a real admission consequence, not third-party adoption or a working exchange.

## 6. Continue from a usable public foundation

**Delivered:** public App and consumer, MIT source, deployed v2 contracts, retrievable reports, a recorded complete lifecycle, package 0.5.3 and reproducible validation.

**Next operational priority:** renew evidence through a fresh check, exact-hash submission and review, explicit binding, relisting and readback. Keep old reports and approvals as history. Preserve the original upgrade baseline and compare only an actual finalized environment change.

**Next ecosystem priority:** use the documented maintainer pilot with an outside builder, measure whether they can integrate and interpret refusals, and feed the findings into onboarding. npm publication and independently operated adoption remain future work; neither is claimed here.

**Continued support plan:** maintain the public deployment and verified package, keep CI and reproducible consumer examples current, review supported runtime adapters after upgrades, and publish evidence-backed changes with clear trust and lifecycle boundaries. This is the project's support plan, not a claim that external funding or production operations are secured.

Boundaries: testnet only; no security audit, revenue, production readiness, independent adoption or competition selection is claimed. Contract checks do not continuously discover expiry or outages.

- App: https://revivecheck.axiqo.xyz/
- Consumer: https://demo.revivecheck.axiqo.xyz/
- Main source: https://github.com/a252937166/ReviveCheck
- Source snapshot reviewed for this deck: `83a209b8b90a069b3ece8573327c34181ab68a4d` (the publication code and historical evidence; this new deck is additional material).

## Reproduction and QA

The PDF was generated with ReportLab using the English source above and the renderer at `scratchpad/final-deck-public/build_deck.py`. Page size: 960 x 540 points, 16:9. Fonts are built-in Helvetica/Courier; public destinations are clickable. Six rendered pages were inspected for clipping, overlap, legibility and truthful boundaries. The QA record and page renders are kept under `scratchpad/final-deck-public/`.
