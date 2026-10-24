# ReviveCheck v0.2 product brief

ReviveCheck helps a Portaldot V3 application developer define release expectations, observe the real target, and hand the exact result to a maintainer for review. It is a developer acceptance and evidence-handoff tool. The decision it supports is: **“Does this version satisfy this plan in this observed environment, and what needs a new check?”**

Status: v0.3, reviewed 2026-10-23. ReviveCheck is positioned as release attestation middleware for the Modular Cloud & Middleware track: decentralized middleware (ReleaseRegistry, ReviveCheckGuard, VerifiedTokenList), storage and data components (reports stored through the native Remark module, a feed built from chain events), and APIs (twelve tools over MCP, REST, JavaScript and the CLI). The public site, the "Try it out" studio and wallet-signed writes carry that framing.

- **ReleaseGate** (`0xf062d47c63613da90e3573e0ee2bba126347f3d3`, V3 testnet), one owner and one reviewer. Revision 1 approved the pUSD baseline report. Revision 2 committed the token-list v1.0.1 report; its submit cleared approval at #161790, and the review at #161839 re-approved it. Each revision has a finalized dual-interface readback.
- **ReleaseRegistry** (`0xe949b200edf070b9d425b206ed24dc8fe5b7d339`, deployed at #162962), open to visitors. A run driven through the studio UI submitted at #163485, approved at #163489 and signed a review remark at #163493.
- **VerifiedTokenList** (`0xd0bd833b4b8658b1230a0e9a99640935b3c65819`, deployed at #164220) consumes the registry through ReviveCheckGuard; pUSD was listed at #164313 and read back through both interfaces.
- **Evidence store:** the studio and reference rechecks are stored on-chain with `remark.store` at #164266 and #164335, retrieved and verified from chain data.

In both records, the owner and reviewer are one isolated test account; see [LIFECYCLE.md](LIFECYCLE.md). The original 78-second video and six-page deck show v0.1. See [v0.2 delivery evidence](RELEASE_V2.md); submission and organizer decisions remain separate in [SUBMISSION.md](SUBMISSION.md).

## Positioning

What ReviveCheck provides externally is decentralized middleware, storage/data components and APIs built on Portaldot's modular architecture. The developer workflow (studio, reviewer, workbench) is how people reach those components; it is not the product. MCP and the CLI are routes to the API, not products of their own.

## Brand commitments

- **Light only.** The user prefers light themes. Every surface, deck and video frame uses a light ground unless the user asks otherwise.
- **A modern developer platform at Vercel's craft level.** The user judged the printed "custody record" world dated and took the category-standard path, naming Vercel as the bar. The world is recorded in DESIGN.md.
- **Co-brand.** The official Portaldot mark appears unaltered, only as "Built on Portaldot V3", with no implied endorsement.

## The user and the task

The primary user is a Solidity developer migrating or releasing an application on V3. A maintainer is the second participant: they need to inspect the same checks and return feedback on that exact observation. Native-asset integrators can instead check whether an existing native asset agrees with its ERC-20 interface.

Today this work often means reconciling a plan, RPC responses, account mappings, explorer references, and screenshots. ReviveCheck keeps the expected behavior, observed checkpoint, limitations, and review decision connected. It does not decide whether a business should launch or certify that a contract is secure.

For example, a release plan can require `approved() == true`, `revision() == 1`, and a specific `reportHash()`. A report records what the supplied target returned through both V3 interfaces. If a new release changes the contract, a reviewer can inspect a new report without their previous acceptance silently following it. The included ReleaseGate application exercises this pattern on the V3 testnet: a new submission clears approval until the reviewer signs again.

## Complete the implemented lifecycle

| Step | User action | Result and boundary |
| --- | --- | --- |
| Plan | Create or import a named project; save release/source, logical identity, target and assertions | A reusable acceptance plan. Source references and logical continuity are declared, not authenticated |
| Live check | Run the saved plan against V3 | A new report pinned to a finalized checkpoint, with individual expectations, observations and limitations. No transaction is signed by the UI |
| Correct and rerun | Address a failed prerequisite or application expectation | A separate report; earlier inputs and outcomes remain unchanged |
| Compare | Select a baseline and candidate | Distinguish configuration correction, deployment versions, assertion changes, runtime drift and sample scenario changes before crediting any improvement |
| Share | Export original JSON or prepare a static-reviewer link/QR | The recipient verifies the same report fingerprint. A locally prepared share is not proof of delivery or recipient access |
| Review | Inspect the report and return an accepted/changes-requested receipt; owner imports it | Append-only feedback bound to one exact report hash. Reviewer identity is self-declared and nonofficial |
| Recheck | Check the current plan after a version, target, plan or observed runtime change | A new live report, without inherited review or sharing state. Existing reports become historical evidence |
| Archive/restore | Retire or reopen a project | Preserve history; restore is required before another run |

Verification, sharing, review, and freshness are independent states. An accepted review can coexist with a failed check or stale report. Runtime drift is detected from later saved observations, not from a continuous monitoring service.

## Two bounded acceptance profiles

**Contract acceptance** supports up to eight ABI scalar view assertions with stable IDs, up to four arguments each, and an expected result. Supported values are `uint256`, `address`, `bool`, `string`, and `bytes32`; legacy `value()` plans remain supported. Checks cover network identity, a shared finalized checkpoint, native/H160 mapping, funding, deployed code, configured dual-interface reads, and supplied transaction provenance. Missing evidence stays blocked or unknown.

**Native asset acceptance** checks an existing asset's native supply, holder balance and precision against its ERC-20 precompile at the same finalized checkpoint. It needs no funded wallet or user-owned deployment. An empty holder selects the asset owner and records that choice. The current precompile address adapter is scoped to the observed runtime spec 3002; unsupported versions do not silently inherit it. A passing report establishes the configured read parity, not transfer/approve semantics.

## What is specific to V3

The useful platform integration is the evidence collected through two views of the same runtime:

- Resolve native/H160 identities through ReviveApi and require the mapping round trip, rather than assuming an Ethereum-derived address is the native account's mapping.
- Anchor native and Ethereum reads to one finalized height and map its distinct block hashes through ReviveApi.
- Keep native funding units, EVM balances, and runtime conversion parameters explicit.
- Compare native Assets storage with the runtime's ERC-20 precompile, using a version-scoped address adapter.
- Decode asset-paid native transaction evidence with the applicable runtime registry, including a retained real historical-block regression.

These checks make a specific V3 release plan reproducible. They are not a claim of arbitrary EVM equivalence or complete platform coverage. Runtime findings and the separate constructor-encoding simulation are documented in [CHAIN_FINDINGS.md](CHAIN_FINDINGS.md).

## The implemented innovation mechanism

The report binds an acceptance plan and its caller/asset, declared source revision, target/code fingerprint when available, runtime fingerprint, and native/EVM checkpoint. Hashing then preserves that payload during export and review. The browser reviewer checks integrity without needing the author's local server or a wallet.

Comparison preserves the meaning of that evidence. Changing an expectation, caller, or asset holder requires a new baseline. A new deployment can be compared under the same explicit logical identity and plan, with no causal claim that code fixed the result. Runtime and synthetic scenario changes are context changes, never credited as repairs. A review names the exact report; a later report starts unreviewed.

This is a concrete contribution beyond a collection of RPC checks: a portable acceptance record with rules for comparing and reviewing subsequent releases. It is not a proven market advantage or a claim that no other tool offers similar workflows. A JSON hash detects changed content; it does not authenticate RPC truth, ownership, the reviewer, or source-to-bytecode correspondence.

## Evidence and remaining limits

The retained live report for public asset **7777/pUSD** records finalized block **157426**, runtime **3002**, and **3/3 passed checks**. Its SHA-256 is `15baa9e1d2e8746bdc94b873e314a3fd839fbd52ecc13dd99470bec8444ba544`; [the original JSON](../public/reports/15baa9e1d2e8746bdc94b873e314a3fd839fbd52ecc13dd99470bec8444ba544.json) verifies locally. This is an existing external asset, not our deployment, state write, customer or independent adoption.

ReleaseGate's compiled bytecode has executed in a local in-memory EVM: constructor, first report submission, reviewer approval, and a second submission that clears approval and increments revision. Nonowner submission and nonreviewer decisions revert. Those local tests cover contract behavior. The testnet record adds revive execution, actual fees, finality and live readback: deploy, two submit/review revisions, and passing 7/7 readbacks through both interfaces. Owner and reviewer are the same test account, so it shows the mechanism, not independent review.

The local workbench, REST API, CLI and MCP tools stay read-only: they prepare and dry-run transactions but never sign. On the public site, only the visitor's own wallet signs studio writes (a registry submit or review, or a `System.remark_with_event`), after a dry-run is shown. Explicit CLI helpers sign testnet writes only with an isolated test wallet, behind cost caps and journals. Receipts remain self-declared: an on-chain remark authenticates an account, not a person or an official authority. There is no hosted team workspace, automatic promotion, background watcher, security audit, or production guarantee. The V3 Live check is a read-only promotion assessment. Archive/restore and importing/exporting files are implemented; these should not be described as team adoption.

## Validate value before expanding

An ecosystem maintainer or foundation could eventually fund repeatable migration acceptance; that is a buyer hypothesis, not an established customer. The first distribution hypothesis is an open-source local tool with a static reviewer. Managed CI or hosted team history should wait for evidence that this handoff is useful.

The next product gate is one independent builder bringing their own compatible target, then a maintainer reviewing a second report without the author explaining raw RPC logs. Record completion, author intervention, elapsed time, whether a useful failure was found, and whether the comparison changes the next release decision. These are pending validation; our samples, wallets and transactions do not count. If the guide and scripts solve that task just as well, narrow the tool before adding more checks, attestations or monitoring.
