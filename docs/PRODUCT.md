# ReviveCheck product brief

Status: proposed product contract and implementation scope, 2026-10-23. This document describes the intended experience. Implementation and deployment evidence are recorded separately in [CHECK_IN.md](CHECK_IN.md).

## Product promise

ReviveCheck helps a Solidity developer decide whether a specific application version is ready to run on Portaldot V3. The developer brings a project, runs acceptance checks, fixes a concrete failure, and compares the next run with the original evidence.

The central question is: **“What did this change fix, what still fails, and what was actually observed on Portaldot?”** A reachable RPC or a successful local rehearsal cannot answer that question alone.

The first user is a developer migrating a small Solidity application to V3, or a maintainer reviewing that migration. The immediate job is to replace scattered wallet settings, RPC responses, deployment logs, and screenshots with one repeatable acceptance workflow.

## Why Portaldot V3 matters

The initial checks address the V3 environment: its chain configuration, native account and EVM address relationship, test-token funding, and revive-based Solidity execution. The official guide warns that the mapped H160 address must be checked rather than inferred from the Ethereum address produced by the same key. This creates a concrete migration task before funding or deployment.

The product should turn that difference into an observable result: identify which address was checked, where the mapping came from, which network answered, and which acceptance assertions were evaluated. It must preserve an unknown result when an endpoint or method cannot establish a fact.

References: [officially recommended V3 guide](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide), [V3 FAQ](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide/blob/main/FAQ.md), [October network update](https://discord.com/channels/1440212664751099996/1506204427651125349/1560719007307403354). The guide is an integration source, not evidence that our own contract has been deployed.

## One complete user journey

| Step | User action | Result the product must make clear |
| --- | --- | --- |
| 1. Create a project | Name a migration and enter the intended network, account, contract target, and version | A reusable acceptance target belonging to the user; a sample project remains visibly identified as a sample |
| 2. Check readiness | Run network, address-mapping, and funding checks | The observed network and account, the failed or unknown condition, and the next action |
| 3. Run acceptance | Evaluate the configured contract and read assertions | Each assertion has an expectation, an observation, a result, and its evidence source |
| 4. Fix and rerun | Correct the same project's configuration or implementation | A new run is created; the failed run remains available |
| 5. Save evidence | Retain and export the selected run | A reviewable record with its mode, time, target, version, checks, and unresolved items |
| 6. Compare versions | Select a baseline and candidate run | Show resolved, new, persistent, and incomparable findings; distinguish a configuration correction from an application change |

The demonstration should follow one project through all six steps. Creating a second unrelated sample is not evidence that the first failure was fixed.

## The core product mechanism

The unit of work is an acceptance run attached to a project version. Every result needs both a conclusion and its basis. The proposed run record contains:

- A project identity, configuration version, application version when supplied, and run identity.
- Evidence mode: `live-read-only`, `local-rehearsal`, or `testnet-execution`.
- Observation time, endpoint, chain ID, and observed block information when available.
- The account and contract targets actually checked, with the mapping method and source identified.
- Checks containing expected and observed values, a result, and a reason for failure or uncertainty.
- Contract addresses, transaction hashes, and receipt information only when obtained from actual execution.
- Outstanding checks and the limits of the conclusion.

Saved runs must not silently change when project settings change. A comparison must flag different networks, modes, targets, or assertion definitions before treating a changed result as a regression or repair. An unknown check becoming unknown again is not a resolved issue. A local rehearsal passing does not resolve a failed live testnet check.

Export is useful when another person can review the same migration or a developer can rerun the acceptance target after changing code. A downloaded JSON file alone does not establish adoption value, independent verification, or a security attestation. CI integration is a later delivery path for this mechanism.

## Differentiation hypothesis

The following comparison is based on the public descriptions observed during the October 22 research. It is not a fresh audit or a claim that competing projects lack unlisted capabilities.

| Existing approach | Its visible focus | ReviveCheck's proposed focus |
| --- | --- | --- |
| Portaldot PDK / FailLens | General development commands and transaction-error diagnosis | Repeated acceptance of a developer's own V3 migration, with saved before/after results |
| NodePulse, PortalPulse, PortalGuard, PortaPulse | Network, validator, node, or execution monitoring | A named application version and its migration acceptance criteria |
| Manual wallet, explorer, and RPC checks | Individual observations gathered by the developer | A repeatable target with explicit uncertainty and comparable runs |
| A single deployment script | Performing deployment and logging its result | Checking whether the resulting target satisfies application assertions, then repeating after a change |

The innovation hypothesis is the combination of **V3-specific migration checks, a reusable acceptance target, and evidence-aware version comparison**. This is unproven as a market advantage. If the first build is only a form that makes several RPC calls, it does not yet establish this distinction.

## MVP acceptance boundary

The Check-in target is one complete lifecycle with a small number of meaningful checks:

1. Create and reopen a project with an explicit Portaldot V3 target.
2. Observe the live network through read-only calls, exposing the real chain ID and account-check limits.
3. Show a deliberate configuration failure and correct it on the same project.
4. Run a clearly labeled local rehearsal for the Probe contract when live deployment is unavailable.
5. Save both runs and compare their evidence without turning simulated results into live success.
6. Export a report that a reviewer can understand without the author explaining every field.

The desired testnet execution milestone is separate: deploy our Probe contract on V3, write a value, read it back, and bind the real contract and transaction evidence to the acceptance run. This milestone remains pending until actual execution and readback are recorded. Mock data being permitted in preliminary demonstrations does not settle eligibility when deployment evidence is missing.

## Future scope and limits

After the lifecycle is useful, the next candidates are command-line acceptance targets, a CI example, content hashes for saved artifacts, checks against another developer's contract, and additional validated V3 assertions. These are roadmap items until implemented and tested.

The first version does not promise arbitrary EVM equivalence, cross-chain execution, synchronous ink!/Solidity interoperability, a security audit, production readiness, or guaranteed prevention of loss. The app should not request a seed phrase or private key. Any signed deployment workflow requires its own explicit controls and evidence; read-only acceptance must not imply that a deployment occurred.

## Business and adoption hypotheses

The likely initial users are V3 ecosystem builders and maintainers helping them migrate. A free, open-source local workflow is the first distribution hypothesis. Hosted history, team review, or managed CI could be later paid services; pricing, willingness to pay, and a sustainable business model are unvalidated.

Before adding more checks, test whether an external developer can bring one real project and complete the lifecycle. Record the task, elapsed time, author intervention, failed assumptions, and whether the saved comparison is useful for the developer's next release. Do not count our sample runs, wallets, or transactions as independent users.

Suggested validation gates:

- Two readers unfamiliar with the project can explain who uses it, what decision it supports, and why V3 matters after viewing the short introduction.
- At least one external developer can supply their own target and complete a run; the result may fail, provided it is accurate and actionable.
- The developer can identify what changed between two runs and name a next action without opening raw RPC logs.
- A maintainer can reproduce the documented checks or explain why the environment prevents reproduction.

All four are pending validation. If users obtain the same result as quickly from the existing guide and scripts, narrow or change the product before expanding it.

## Event fit

The intended primary track is Modular Cloud & Middleware. Technical delivery should be supported by reproducible runs; innovation by the migration and comparison mechanism; ecosystem contribution by an external builder workflow; business potential by a clear user and a measured adoption test. These are evidence plans aligned with the published 30/30/20/20 criteria, not predicted scores or organizer approval.

The event requires new work, a public repository with genuine development history, testnet integration evidence, and a short demonstration. Registration, Check-in acceptance, final submission, and deployment are separate states. Current event requirements and dates are recorded in [PARTICIPATION_RESEARCH.md](../PARTICIPATION_RESEARCH.md).
