> Current final deck, 2026-10-27: [six-page PDF](https://revivecheck.axiqo.xyz/revivecheck-final-deck.pdf), [English source](final-deck.md). The earlier outline below remains historical preparation.

# Final deck outline (v0.4)

The current counterpart of the historical Check-in deck (`artifacts/ReviveCheck-Check-in-Deck.pdf`, kept unchanged). Twelve slides built around one maintainer problem, one complete refusal, correction, review and rebinding example, the Portaldot modules that make it possible, reusable integration evidence and measured value. Every number on a slide must trace to `public/release-status.json`, `docs/LIFECYCLE.md` or `docs/VALUE_EXPERIMENT.md`; the slide notes below say which. Prepared 2026-10-25. The slide source is `docs/deck/final-deck.html` (12 slides, 1920 × 1080, self-contained); `node scripts/render-deck.mjs` fills the source commit into slide 12 and renders the PDF. `artifacts/ReviveCheck-Final-Deck-2026-10-25.pdf` is the rendering for commit `6b7402f`; it is re-rendered whenever the cited source changes, so the deck never claims more than the published source.

| # | Slide | Content | Source of every claim |
| --- | --- | --- | --- |
| 1 | ReviveCheck | Release attestation middleware for Portaldot V3: approvals contracts enforce, evidence on-chain, a decision a maintainer can inspect. Track: Modular Cloud and Middleware. | README |
| 2 | The maintainer's problem | A Portaldot wallet or DEX token-list maintainer publishes entries. Today the approval is a chat message, the evidence is a screenshot, and nothing tells them when it stopped holding. | `docs/PRODUCT.md` |
| 3 | The promise | Publish entries supported by the exact approved evidence; understand why an entry is no longer eligible; restore eligibility through a new review and explicit binding. | `docs/POLICY.md` |
| 4 | Refusal | Release v1.0.0 claims 18 decimals: the live check fails on both interfaces. A catalog configured with 18 decimals is withheld even under a valid approval (`entry-mismatch:decimals`). The contract refuses the wrong listing in dry-run (`DecimalsMismatch`). | reports `7f01ed85…`, `public/catalog/testnet-v2-wrong-entry`, lifecycle step 4 |
| 5 | Correction, review, listing | Report `eb960cc7…` checked live, stored on-chain (#187058), submitted as `pusd-catalog-v2` revision 1 (#187069), approved by the reviewer account (#187095), listed on v2 (#187124): valid, available. | `docs/LIFECYCLE.md` |
| 6 | Invalidation | Revision 2 (#187165) clears the approval and un-lists pUSD on-chain; the policy says recheck required. Approval of revision 2 (#187181) alone changes nothing for the old binding. | lifecycle steps 7 and 8 |
| 7 | Recovery and revocation | Explicit rebinding, relisting (#187205): valid again. Changes requested (#187230): withheld. Approved again (#187271): available. Every step with its receipt and its policy decision. | lifecycle steps 9 to 12 |
| 8 | The decision screen | The Catalog decision page: published entry versus approved report, on-chain approval, listing, policy verdict with reasons, evidence age against the policy clock, next action, binding history; Evaluate now in the browser without a wallet. | `src/Catalog.jsx`, `#/app/catalog` |
| 9 | Portaldot modules | Revive runs the contracts; ReviveApi maps accounts and finalized blocks so every read is checked through both interfaces; Assets and its ERC-20 precompile give two views of the token; Remark stores the report bytes on-chain. | `docs/INTEGRATION.md`, `docs/CHAIN_FINDINGS.md` |
| 10 | Reuse | One implementation behind the browser, MCP, REST, JavaScript and the CLI; package exports and a packed artifact; a second consumer (a DEX allow-list) installed from it in a separate repository with its own policy and CI. Author-run: portability, not adoption. | `package.json`, the second consumer's README and onboarding log |
| 11 | Measured value | Equivalent checks both ways at identical captured checkpoints, five scenarios, installation separated from repeat decisions, network waiting separated from compute, decision reconstruction by a second reader. Reported as measured, including where ReviveCheck is slower. The maintainer pilot is defined and not yet run. | `docs/VALUE_EXPERIMENT.md`, `docs/PILOT_PROTOCOL.md` |
| 12 | Status and boundaries | Levels: records intact, deployed, listed, evaluated, lifecycle complete: established. Independently adopted: not established. Two project-controlled signers; expiry, runtime change and node outage simulated. Links: site, source, explorer, status record. | `public/release-status.json` |

## Rendering rules

- Light theme, the site's typography, one claim per slide, every block number linked in the notes.
- No slide says "adopted", "audited" or "independent review".
- The deck is rendered after `node scripts/release-status.js` reports `ok` on the commit the deck cites, and the commit hash goes on slide 12.
