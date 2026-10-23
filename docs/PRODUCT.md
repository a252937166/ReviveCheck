# ReviveCheck v0.2 product brief

ReviveCheck helps a Portaldot V3 application developer define release expectations, observe the real target, and hand the exact result to a maintainer for review. It is a developer acceptance and evidence-handoff tool. The decision it supports is: **“Does this version satisfy this plan in this observed environment, and what needs a new check?”**

Status: implemented v0.2 workflow, reviewed 2026-10-23. Our own signed testnet deployment and state writes remain pending a reported balance of 0 tPOT. The original 78-second video and six-page deck show v0.1. See [v0.2 delivery evidence](RELEASE_V2.md); submission and organizer decisions remain separate in [SUBMISSION.md](SUBMISSION.md).

## The user and the task

The primary user is a Solidity developer migrating or releasing an application on V3. A maintainer is the second participant: they need to inspect the same checks and return feedback on that exact observation. Native-asset integrators can instead check whether an existing native asset agrees with its ERC-20 interface.

Today this work often means reconciling a plan, RPC responses, account mappings, explorer references, and screenshots. ReviveCheck keeps the expected behavior, observed checkpoint, limitations, and review decision connected. It does not decide whether a business should launch or certify that a contract is secure.

For example, a release plan can require `approved() == true`, `revision() == 1`, and a specific `reportHash()`. A report records what the supplied target returned through both V3 interfaces. If a new release changes the contract, a reviewer can inspect a new report without their previous acceptance silently following it. The included ReleaseGate application exercises this pattern locally; its own V3 deployment is still pending.

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

ReleaseGate's compiled bytecode has executed in a local in-memory EVM: constructor, first report submission, reviewer approval, and a second submission that clears approval and increments revision. Nonowner submission and nonreviewer decisions revert. This establishes local contract behavior only; it does not establish revive execution, testnet fees, finality, or our own live write/readback.

The UI/API stay read-only. An explicitly invoked developer helper exists for testnet deployment and writes, but implementation readiness is not execution evidence. There is no hosted team workspace, authenticated reviewer identity, automatic promotion, background watcher, security audit, or production guarantee. Archive/restore and importing/exporting files are implemented; these should not be described as team adoption.

## Validate value before expanding

An ecosystem maintainer or foundation could eventually fund repeatable migration acceptance; that is a buyer hypothesis, not an established customer. The first distribution hypothesis is an open-source local tool with a static reviewer. Managed CI or hosted team history should wait for evidence that this handoff is useful.

The next product gate is one independent builder bringing their own compatible target, then a maintainer reviewing a second report without the author explaining raw RPC logs. Record completion, author intervention, elapsed time, whether a useful failure was found, and whether the comparison changes the next release decision. These are pending validation; our samples, wallets and transactions do not count. If the guide and scripts solve that task just as well, narrow the tool before adding more checks, attestations or monitoring.
