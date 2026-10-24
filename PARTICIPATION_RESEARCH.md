# Portaldot Hacker House 2026 participation research

Checked at 2026-10-22 23:44 America/New_York (2026-10-23 11:44 Asia/Shanghai).

Conclusion: worth entering as a small new project, with the October 24 Check-in as the first priority. The recommended direction is a Solidity migration acceptance and regression tool for Portaldot V3. The tightest dependencies are the registration credentials, testnet token distribution and the first real deployment; the November final deadline must not be treated as the only milestone.

This file is research and an implementation proposal. The project was not registered, submitted, published or deployed by this research; no Discord message was sent and no support ticket was created. Whether the account was registered by the user through another flow was not verified here.

## Verified information and sources

| Source | What was read |
| --- | --- |
| [DoraHacks official detail page](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail) | Read live through an open Chrome page; plain page fetching returns 405, so a fetch failure was not used to judge the event's status |
| [Public project list for this edition](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/build) | Shows 12 public projects live; that number does not represent all registrations, pending reviews or valid final entries |
| [Official Check-in announcement, October 21](https://discord.com/channels/1440212664751099996/1506204427651125349/1562526145373544599) | LevelMax announcement: deadline 10/24 12:00 UTC; a prototype and Portaldot integration must be demonstrable; submission is on DoraHacks, and a project needs admin approval to be public |
| [Official testnet update, October 16](https://discord.com/channels/1440212664751099996/1506204427651125349/1560719007307403354) | New RPC, chain ID, how to request test tokens; old endpoints retired |
| [hack-chat](https://discord.com/channels/1440212664751099996/1497976354157887680) | On 10/22 a community member replied that registration is still open; Titus asked for test-token requests through a ticket. Community replies were not taken as an official waiver or an entry approval |
| [Support ticket entry](https://discord.com/channels/1440212664751099996/1440324575387713588) | An Open Ticket button is visible; it was not clicked |
| [V3 guide recommended officially on Discord](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide) | V3 accounts, native assets, NFTs, Solidity and testnet examples |
| [V3 FAQ](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide/blob/main/FAQ.md) | Toolchain and unconfirmed compatibility boundaries |

The read-me, hackathon-rules, Q&A and progress-review content visible on Discord mostly belongs to the previous edition (April to May 2026). Its Rust/ink! restriction, May registration deadline, purely local node and progress-channel posting requirement cannot be applied to this edition. This edition follows the current DoraHacks rules and the October announcements.

## Timeline and eligibility thresholds

| Milestone | Official UTC | Beijing | New York |
| --- | --- | --- | --- |
| Check-in | 10/24 12:00 | 10/24 20:00 | 10/24 08:00 EDT |
| Feedback published | 10/26 16:00 | 10/27 00:00 | 10/26 12:00 EDT |
| Office Hour applications | 10/27 12:00 | 10/27 20:00 | 10/27 08:00 EDT |
| Final submission and code freeze | 11/06 04:00 | 11/06 12:00 | 11/05 23:00 EST |

The official text also lists Office Hours on 10/28 to 10/29 UTC and Demo Day on 11/8 to 11/9 UTC; exact session times were not published. Aggregator sites still carry old dates and must not be used for scheduling. New York switches to standard time before the final deadline, so the EST conversion above applies.

The page still shows Register / Submit Build. The rules allow individuals and teams, require the ability to develop independently and to keep delivering a Web3 product, and require real use of V3 features with a deployment on the Portaldot testnet. The page lists no separate, already-passed registration deadline, but whether a new registrant must pass the Check-in, whether missing it forfeits final eligibility, and this account's registration status still need confirmation. Submitting the Check-in on time is the safest path to participation.

## What must be delivered

For the Check-in:

- Current progress and open items.
- A public GitHub repository, a complete README, a continuous development record and an architecture diagram.
- Testnet integration evidence, including contract addresses, transaction hashes and explorer links where applicable.
- One demonstrable core flow: an online demo or a video of at most 3 minutes.
- Simulated data is allowed in the first demonstration but must be disclosed; real testnet interaction is encouraged, and the October announcement stresses that the V3 integration should be verified.

The final submission also needs complete runnable code with deployment instructions, a runnable demo, a public video of at most 3 minutes, and a pitch deck as a PDF or a public link. The deck should explain the problem, why Portaldot is necessary, the evidence for what was built, and the plan for further building.

Code rules: the main development happens between 10/14 and 11/6; the repository is public during the event; at least 3 meaningful commits; a genuine development record; the final version of the core modules cannot land in one commit in the last 24 hours; core functionality and architecture are frozen after the final deadline. An existing complete project cannot be submitted as is; third-party dependencies may be used and must be credited.

Judging weights: technical delivery 30%, innovation 30%, ecosystem contribution 20%, business potential 20%. On-chain evidence and a public submission history affect the judging directly; a polished interface alone is not enough.

## Prizes and whether the effort is worth it

The pool is worth 5,200 USDT, of which 2,600 is USDT and 2,600 is the equivalent in POT. The overall winner receives 1,000, each track winner 800, the DApp second and third places 500 and 300, and the community award 200. The overall win and a track win do not stack; the community award does; a track award may stay unclaimed.

Follow-on ecosystem funding, server subsidies, technical help and promotion are applied for separately and reviewed by milestone; registering or winning does not guarantee them. The 5,200 cannot be treated as all cash, and the number of public projects cannot be used to estimate the odds of winning.

## Testnet and funding dependencies

- Substrate: `wss://test-node-v3.portaldot.dev`
- EVM: `https://test-evm-rpc-v3.portaldot.dev`
- Chain ID: `420420777`
- Node console: <https://node-console.portaldot.dev/>

A read-only check confirmed that the new EVM RPC returns the right chain ID and that the block height moved from 155037 to 155049. That proves the RPC is reachable and the chain is producing blocks; it does not prove that our own contract is deployed or that the product loop is complete.

Test tokens are requested through the registered contest address or a Discord ticket. The ticket takes a registration or participation screenshot and a native POT SS58 address starting with `5`; an `0x` EVM address is not accepted in its place. The detail page also names the DoraHacks admin Stella707827 and Discord user titus242471 as the contacts when tokens do not arrive. Requesting and receiving are two different states, and the distribution speed is unconfirmed.

No requirement to buy mainnet POT was found for this edition; execution and on-chain storage use test tokens and may involve a storage deposit. Version 1 does not need a paid model API. Waiting for test tokens cannot be counted as controllable development time.

V3 Solidity runs on revive; account mapping must not be confused with the intuition that an Ethereum account uses the same private key. The H160 and native SS58 mapping and the actual funded account should be checked against the official guide. The guide covers MetaMask, Remix and Hardhat; Foundry, cross-VM synchronous calls and the iBridge opening route and fees are unconfirmed and are not dependencies of the first version.

The guide's Solidity examples include mapping and signed transactions and cannot be run as read-only scripts. Its hard-coded example addresses returned empty code during this check and cannot be cited as evidence of a successfully deployed product.

## Topic choice and differentiation

Among the 12 public entries, NodePulse, PortalPulse, PortalGuard and PortaPulse already cover node monitoring; SplitPot does bill splitting, Verigate does agent payment authorization, and PortalProof records delegated deliveries. The previous edition's ecosystem already has the officially promoted PDK/FailLens and ProofPort. A generic node dashboard, a payment pre-check or a generic custody product is therefore not recommended.

The working name is **ReviveCheck**, entered in **Modular Cloud & Middleware**: repeatable deployment acceptance and regression reports for developers migrating Solidity applications to Portaldot V3. The core is verifying V3 account mapping, deployment configuration, real state and transaction evidence, without relying on a large model to explain errors.

The minimum loop for the Check-in:

1. Identify the current network and show the correct native and deployment account mapping and the test-token status.
2. Show a clear failure for a wrong chain ID, a missing mapping or insufficient funds, instead of treating an unverifiable state as success.
3. Deploy a minimal Solidity probe contract on the V3 testnet ourselves, with one state write and one read-back.
4. Export a JSON or HTML report with the network, block, contract address, transaction hashes, assertions and failure reasons.
5. Demonstrate a failing configuration, then run the same acceptance flow after the fix.

Final-round extensions: contract regression cases, CI integration, a downloadable evidence package, and native/EVM dual-interface state consistency assertions once verified. Cross-VM or dual-interface consistency must not be claimed before it exists.

A few RPC queries behind a form would be weak on innovation. The competitive edge should come from reproducible regression cases and precise failure and success assertions, with at least one other participating developer verifying the value.

An alternative is a native NFT authorization check and revocation tool; it would first need the relevant runtime calls verified, and confirmation that collection and item IDs with extrinsic hashes satisfy the deployment-evidence requirement when no custom contract exists. It is not the main direction.

## Suggested order of work and effort ceiling

1. Register and obtain the credentials first; prepare an isolated test account at the same time and request tPOT. Keep the request status and the arrival result.
2. Create the contest repository and build a real record of milestone commits; disclose reused dependencies.
3. Give the first real deployment a technical verification window of about 2 hours. If it fails, solve account, funding and compilation problems first instead of expanding the interface.
4. Plan 5 to 7 hours for the core prototype and 2 to 3 hours for the README, the architecture diagram and the demo. The Check-in budget is about 8 to 12 hours, excluding the wait for test tokens.
5. Finish the Check-in before 10/24 20:00 Beijing time. If test tokens or a real deployment are still missing, say so honestly and confirm whether the organizers accept evidence supplied later.
6. Decide after the 10/26 feedback whether to invest another 20 to 30 hours for the final; have the final version of the core functions ready before the last 24 hours, leaving time for packaging and demo checks.

These hours are planning estimates, not time already spent or guaranteed.

## Questions for the organizers, with a draft

Not sent; for use once explicitly authorized:

> Hi team, we’re considering joining the current V3 Hacker House as a new entrant. Can we register now and submit the October 24 check-in? Is passing this check-in required for final eligibility? We plan to build a V3 Solidity deployment and regression tool using account mapping and verifiable testnet calls. Would this fit the Modular Cloud & Middleware track? We will request tPOT through a support ticket with our registration screenshot and native SS58 address. If token distribution is delayed, can the check-in include the working prototype with the outstanding deployment evidence clearly disclosed?

The first things to confirm are how a new entrant relates to the Check-in requirement, how quickly test tokens are distributed, and whether the tool fits the track. Office Hours and Demo Day sessions can be scheduled once they are announced.
