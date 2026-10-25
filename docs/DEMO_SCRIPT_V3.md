# Demo script, v0.3: release attestation middleware with a policy and a consumer

> Historical: the script of the 2026-10-24 recording, which predates the live v2 lifecycle. The current script is [DEMO_SCRIPT_V4.md](DEMO_SCRIPT_V4.md).

Prepared 2026-10-24 for the final submission video (under three minutes). It replaces the structure of the v0.1 walkthrough for the next recording; `docs/DEMO_SCRIPT.md` and the published Check-in video stay as the historical record. Every scene names what the viewer is looking at: a recorded testnet transaction, a live read, or a simulation.

Recording setup: the production build (`npm run build && npm start`, `http://127.0.0.1:4173`), a terminal at the repository root, 1920 × 1080, 30 fps, English captions. No wallet signs anything during the recording; the writes shown are the recorded ones with their block links.

| Time | Scene | On screen | Caption | Evidence class |
| --- | --- | --- | --- | --- |
| 0:00 to 0:20 | The problem | Landing hero: the approval card stepping through check, approve, consume, with the live finalized head | "A token list is a file nobody can verify. ReviveCheck puts the approval of an exact report on Portaldot V3, where contracts read it." | live read of the head |
| 0:20 to 0:45 | The registry | App overview (`#/app`): the ReleaseRegistry, one release, one standing approval, one listing, two stored reports, each row linked to its block | "One registry contract. A release owner submits a report hash; a reviewer approves that hash; a new revision clears every decision." | recorded testnet transactions |
| 0:45 to 1:15 | Check and recheck | Studio (`#/app/run/check`): v1.0.0 fails on decimals through both interfaces; recheck v1.0.1 passes; the comparison shows one improvement | "Every check reads the native runtime and the EVM RPC at one finalized block. The wrong entry fails with the chain's value; the fix gets a report of its own." | live reads |
| 1:15 to 1:40 | Consume | Token list page: pUSD listed at #164313 on the approval at #163489; `token_list_status` read live | "The VerifiedTokenList lists a token only while the approval of that exact report stands. A new revision un-lists it." | recorded transaction plus live read |
| 1:40 to 2:10 | The catalog, simulated | Terminal: `node examples/token-catalog/catalog.js demo --strict`, the 17-step table scrolling; pause on `revision-2`, `node-unavailable`, `expire`, `renew` | "A consumer built only on the public interfaces. A submits, B approves, A lists: available. A new revision: unavailable until B approves again and the operator rebinds. No node: unknown. Seven days: expired." | simulation, labelled on screen |
| 2:10 to 2:35 | The policy, live | Terminal: `node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet.json`; `AVAILABLE valid`, 24 checks, the reviewer-trust line | "The same policy on the testnet: registry, listing, stored report, runtime and age, read now. Valid enables; anything else blocks, including a node that does not answer." | live reads of the recorded release |
| 2:35 to 2:55 | What is pending | `docs/DEPLOYMENT.md` status table; the v2 estimate: 225.738 tPOT held, 147.58 short | "Version 2 of the token list fixes entry ownership. Its code, tests and deployment manifest are done; the deployment waits for testnet tokens. Nothing here claims otherwise." | estimate, no transaction |
| 2:55 to 3:00 | Close | README header with the explorer badge | "ReviveCheck: evidence on-chain, approvals contracts can read, a policy that decides." | |

## Rules for the recording

- Say what is simulated. The catalog demo scene carries the on-screen label `SIMULATED` that the tool prints; do not crop it.
- Say who the reviewer is. Owner, reviewer and operator are the project test account in every recorded transaction; the policy's reviewer-trust line says so and should be readable.
- Do not sign. The recording shows recorded transactions by block link and live reads only; the studio's write steps are not performed on camera.
- Keep the v0.1 and v0.2 videos as they are. This script describes a new recording; it does not edit the published files.

## Checks before publishing a recording

```sh
npm test && npx vite build && node scripts/release-status.js
node examples/token-catalog/catalog.js demo --strict
```

Then record, verify the duration is under 180 seconds with `ffprobe`, and keep the captions in a separate `.srt` as before.
