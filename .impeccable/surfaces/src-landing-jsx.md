---
version: 1
slug: "src-landing-jsx"
primary_target: "src/Landing.jsx"
related_targets: ["src/App.jsx","src/site.jsx","src/styles.css","src/motion.js","src/records.js"]
---

# Public landing: release approvals as a product

Scope: the public root (`#/`, plus the section routes `#/products`, `#/product-middleware`, `#/product-storage`, `#/product-api`, `#/rules`, `#/lifecycle`, `#/activity`, `#/audience`), mode **Persuade**. The app (`#/app`, Operate), docs (`#/docs`, Read) and reviewer (`#/review`, Operate) share this world.

Audience: Hacker House judges, Portaldot reviewers and V3 Solidity developers, arriving from DoraHacks or GitHub on a laptop in daylight. Their job is to grasp within seconds what ReviveCheck does on Portaldot V3, believe it because the chain says so, then open the app or wire it into their agent or CI.

Proof: real finalized blocks on the V3 testnet and V3 Live, sealed report hashes, the ReleaseRegistry at #162,962, the studio run (submit #163,485, approve #163,489), the VerifiedTokenList at #164,220, pUSD listed at #164,313, reports stored at #164,266 and #164,335, and explorer links on every record. Claims are limited to "Built on Portaldot V3"; no invented adoption, customers or endorsements.

Demo subject (user-confirmed): the pUSD token-list release. v1.0.0 claims 18 decimals and fails; v1.0.1 passes. Owner and reviewer are one isolated test account: the mechanism, not independent review.

Co-brand: the official purple→blue Portaldot mark, unaltered.

History:
- 2026-10-23: the user took the category-standard path, named Vercel as the craft bar; the page became a commercial product homepage; then the track pivot made the offer three components (middleware, storage, API).
- 2026-10-24, morning: pill indigo buttons, live chip, trust row, stats band after the user compared the page with the Arc Microgrants winners.
- 2026-10-24, later: the user said the page "still lacks a professional, business-oriented look", named https://www.arcurrent.site/ as the reference ("too few animations… missing elements like a dashboard or an 'open app' interaction"), showed a Developers mega-menu with icon tiles and one-line descriptions, and asked for "a radical rethink and a complete redesign, specifically tailored for a version focused on permissions". Read as: the product is an approval layer whose permissions contracts enforce; the site opens into an app.

## Direction contract

THESIS: ReviveCheck sells on-chain release approvals as permissions a contract enforces, presented like a commercial infrastructure product: a marketing site that opens into a live dashboard. It refuses the single long article page with one diagram, the printed-form metaphor and the dark-neon web3 default.

OWN-WORLD: A cool paper ground (#f5f6f8) carrying white cards with 1px hairlines and soft two-layer shadows; near-black ink and four grays; Geist for text, Geist Mono for chain data; an indigo #4353ff pill primary (48px, arrow) beside a white hairline pill secondary; live chips with a breathing green dot; one dark ink band (#0b0b0d) that holds the rules; the Portaldot violet→azure gradient only as soft hero glows behind a faint masked grid, in the co-brand and on live progress; every chain number set as a rolling odometer; cards that rise 14px as they enter.

STORY: A visitor reads "Release approvals your contracts enforce" while the approval card beside it steps from Submitted to Verified with real block numbers; they press "Open the app" or scroll; four counters roll from the public feed; a dark band names the four permissions the registry enforces, each with its live value; three product rows show the components; a lifecycle tabber walks the eight stages on the recorded run; a live activity ledger lists the registry's own events and the stored reports; three audiences, four doors, a closing band into the app.

FIRST VIEWPORT: A 64px sticky header: mark and wordmark; Product and Developers triggers that open icon-tile mega-menus; Docs; Proof; on the right the live network chip, GitHub, and "Open app →" as an indigo pill. The hero splits: left, a live chip ("Live on the V3 testnet · #block"), a three-line ~64px headline, a two-line subhead, "Open the app →" beside "How it is enforced", and an "Open source · github.com/…" line. Right, the release approval card: "pusd-token-list · Revision 1" with an Approved badge, the approval block as a large odometer ("#163,489"), a read-back line, three facts (owner, report, listed), and beneath it a transaction-status card whose four steps (Submitted #163,485, Approved #163,489, Listed #164,313, Verified through both interfaces) check off in sequence on load; a "Listed · pUSD" toast overlaps the card's top-right corner. A faint masked grid and violet/azure glows sit behind.

FORM: Category standard, a fintech infrastructure product site with a dashboard, executed at arcurrent.site's craft level. The user took the standing exit again on 2026-10-24, naming arcurrent.site and the Arc Microgrants winners; seed:ed10de7f55b3d561 (the canon round's reference; no new roll on the canon path).
- Signature interaction: the approval card's transaction status steps on load while its block numbers roll in; the lifecycle tabber auto-advances under a progress rule and the dark panel's block number rolls with it; the stats odometers roll as the band enters.
- Motion grammar: one fast-out settle ease; 14px rise on entry, capped stagger inside a list; odometer 1.1s; mega-menu 180ms scale and fade; everything removed under prefers-reduced-motion with the final state rendered.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- V3 Live has no EVM endpoint listed in the official explorer configuration, so live-network EVM reads are reported as blocked.
- The public RPC nodes are intermittently slow, so every live step offers Retry and the header falls back to the explorer index.
- An EVM wallet signs registry calls through the official EVM RPC, but that route has no end-to-end signed test here.
- The studio E2E run (2026-10-23) signed three testnet transactions with the project test wallet: submit #163,485, approve #163,489, remark #163,493. Scripts recorded the rest with the same wallet: VerifiedTokenList deployed #164,220, reports stored #164,266 and #164,335, pUSD listed #164,313.
