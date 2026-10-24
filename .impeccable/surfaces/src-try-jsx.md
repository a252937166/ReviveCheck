---
version: 1
slug: "src-try-jsx"
primary_target: "src/Try.jsx"
related_targets: ["src/wallet.js","src/engine.js"]
---

# "Run the lifecycle" studio, inside the app

Scope: `#/app/run` (the old `#/try` redirects), inside the app shell, mode **Operate**. It inherits the landing's world and the app brief (`src/Dashboard.jsx`); this brief keeps only the studio's own strategy.

Audience and task: a judge or V3 developer who opened the app and chose "Run the lifecycle" runs the whole release lifecycle on the real V3 testnet:
1. Check a release: v1.0.0 fails, or edit the listing.
2. Fix and recheck, with a comparison.
3. Replay at the pinned block.
4. Connect a Polkadot or EVM wallet.
5. Submit the report hash to the shared ReleaseRegistry.
6. Approve it.
7. Optionally attest with a remark and verify it.
8. Ask V3 Live about promotion.
9. Watch the runtime.

Every result carries explorer links and a dual-interface readback.

Composition:
- Under the intro, a three-cell strip states what a run needs: a wallet (with the connected one once there is one), tPOT (fees, held deposits, where testnet tPOT comes from), time.
- A left lifecycle rail uses the landing's node vocabulary, with a status per step; write steps carry a "wallet" tag.
- The center holds the active step's panel. Its header is the same for every step: the step's title as a verb phrase, then a meta row (Step n of 8, product, "Your wallet signs" plus the cost or "Read-only · no wallet · no gas", network), then "What happens" beside a tinted "Why it matters". Then inputs, a dry-run preview before any signature, the action with a signer line beside it (this browser for a read; the connected wallet, or "none connected yet", for a write), the live progress, and the result. The panel ends with a "Related API" disclosure: for a read the tool; for a write the chain prepare_transaction → on-chain call → readback tool; inside, the same request in MCP, REST, JavaScript and CLI, drawn from the docs content, and a link to that step's docs.
- A right "Session" ledger lists every report and transaction with links.
- A completion card states the final on-chain outcome.
- Inside the app frame the step rail and the session ledger share the left column; below 1024px they stack above and below the panel.

States:
- Steps: locked (shows what unlocks it), ready, running, done, failed with Retry, and skipped.
- Wallet: none, connecting, connected (Polkadot or EVM), wrong network, and insufficient tPOT (shows the required deposit).
- Transactions: dry-run, awaiting signature, submitted, in block, finalized, then readback.

Constraints:
- Nothing signs without the visitor's explicit click in their own wallet, and every fee and deposit comes from the visitor's own tPOT: the site holds no key and sponsors nothing.
- Every step says who performs it and what it costs before the action, and names its API tool; a visitor must never wonder whether a step spends anything.
- A step that cannot reach the RPC is a retry, never a result.
- The session persists in this browser so a reload keeps its links.

## Direction contract

Inherited from the landing brief (`src/Landing.jsx`). The studio is the signature interaction at full size: the same pipeline track advances with the visitor's real transactions. seed:ed10de7f55b3d561.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
