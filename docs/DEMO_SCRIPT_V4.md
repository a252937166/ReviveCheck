# Demo script, v0.4: one maintainer, one entry, the whole loop on the testnet

Prepared 2026-10-25 for the final submission video (under three minutes). It supersedes `docs/DEMO_SCRIPT_V3.md`, whose recording of 2026-10-24 predates the live v2 lifecycle; the v0.1, v0.2 and v0.3 videos stay as the historical record. Every scene names what the viewer is looking at: a recorded testnet transaction, a live read, or a simulation. Nothing is signed on camera.

Recording setup: the production build (`npm run build && npm start`, `http://127.0.0.1:4173`), a terminal at the repository root and one in the second consumer repository, 1920 × 1080, 30 fps, English captions.

| Time | Scene | On screen | Caption | Evidence class |
| --- | --- | --- | --- | --- |
| 0:00 to 0:15 | The problem | Landing hero with the live finalized head | "A token list is a file. Who approved this entry, for which exact evidence, and does that still hold? ReviveCheck answers on Portaldot V3, where contracts can read the answer." | live read of the head |
| 0:15 to 0:40 | The decision | App, Catalog decision (`#/app/catalog`): Available; Policy valid; Entry equals the approved report; Why; Next action; then Evaluate now and its result | "The maintainer's screen: the published entry, the on-chain approval, the listing and the policy decision, each with its checkpoint and time. Evaluate now runs the same evaluator the CLI uses, in the browser, with no wallet." | recorded records plus a live read |
| 0:40 to 1:00 | A wrong entry | The Wrong entry tab: Withheld, `entry-mismatch:decimals`, the field table; then step 4 of the recorded execution: `DecimalsMismatch` | "Change the configured decimals and nothing publishes, even though the approval is valid. The contract refused the wrong listing too, in a dry-run, before anything was signed." | recorded |
| 1:00 to 1:40 | Invalidation and recovery | Recorded execution table, steps 7 to 12, each explorer link clicked once | "A new revision un-lists the token on-chain and the policy says recheck required. Approval alone is not enough: the operator rebinds the exact new report, the owner relists, and the entry is available again. A revoked approval withholds it; a new approval restores it." | recorded testnet transactions |
| 1:40 to 1:55 | Two signers | Activity page: the funding transfer, the owner's submits, the reviewer's decisions; `docs/REVIEWER_WALLET_PUBLIC.json` | "Owner and reviewer are two accounts. Both are ours: this is role separation, not independent review, and the record says so." | recorded |
| 1:55 to 2:20 | Reuse | Second terminal: the DEX allow-list consumer, `npm run check`, `out/allowlist.json`; then `npm run rc -- evaluate_policy` | "Any project installs the package and writes its own policy. This allow-list did, from the packed artifact, and fetched the report from the chain itself." | live reads |
| 2:20 to 2:40 | Measured | `docs/VALUE_EXPERIMENT.md`, the scenario table and the time split | "Same five checks both ways at the same captured block. We report what was measured, including where ReviveCheck is slower, and what a maintainer pilot would still have to show." | recorded measurements |
| 2:40 to 3:00 | Status | `public/release-status.json` levels; README header | "Records intact, deployed, listed, evaluated, lifecycle complete. Not yet: independent adoption. ReviveCheck: evidence on-chain, approvals contracts can read, a decision a maintainer can inspect." | |

## Rules for the recording

- Say what is simulated. The local demo's `SIMULATED` label stays on screen whenever the 17-step local sequence appears; the testnet lifecycle is shown only from its recorded receipts and live reads.
- Say who the reviewer is. The reviewer-trust line of the policy is readable in the Catalog decision scene.
- Do not sign. Every write shown is a recorded transaction with its block link; the studio's write steps are not performed on camera.
- Keep earlier videos as they are. This script describes a new recording; it does not edit the published files.

## Checks before publishing a recording

```sh
npm test && npx vite build && node scripts/release-status.js --out public/release-status.json
node examples/token-catalog/catalog.js demo --strict
node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet-v2.json
```

Then record, verify the duration is under 180 seconds with `ffprobe`, and keep the captions in a separate `.srt` as before.
