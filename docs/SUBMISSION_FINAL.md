# ReviveCheck project-page copy (current, 2026-10-25)

Editable publication copy for the existing DoraHacks Build 50176. It is not a receipt that the platform fields have been updated; `docs/RELEASE_STATUS.md` lists republication as pending until it is. `docs/SUBMISSION_V03.md` is the copy of the 2026-10-24 release and stays as history.

## Vision

Release attestations and policy-based token acceptance on Portaldot V3, with retrievable evidence, a decision a maintainer can inspect, and an explicit recheck lifecycle.

## Description

ReviveCheck helps a token-list maintainer publish entries supported by the exact approved evidence, understand why an entry is no longer eligible, and restore eligibility through a new review and explicit binding.

A release owner submits an exact report hash to the ReleaseRegistry. A reviewer approves that revision. A consumer contract reads the approval, while an application policy also checks the intended network, token, acceptance plan, runtime, evidence age and trusted reviewer. The published catalog entry is derived from the approved report, never from a configured copy. Changed revisions, revoked decisions, differing entries, expired evidence and unavailable verification block the entry. A new report needs a new approval and explicit rebinding; earlier evidence remains inspectable.

Portaldot is part of the mechanism: Revive runs the contracts; ReviveApi maps native and EVM accounts and finalized blocks, so every read is checked through both interfaces; Assets and its ERC-20 precompile supply two views of the sample token; Remark stores report bytes on-chain. The same deterministic verification service is available through the browser, JavaScript, REST, MCP and the CLI, and as a packed npm artifact with documented exports. MCP is an integration interface, not a built-in AI verifier.

### Delivered evidence

- ReleaseRegistry: `0xe949b200edf070b9d425b206ed24dc8fe5b7d339`, testnet block 162962.
- VerifiedTokenList v2: `0xedaf8a25bb583ad164a94191b762414277198df9`, finalized deployment at 177354, nine verification checks. pUSD listed on it at 187124 and, after a revision, at 187205.
- The complete lifecycle recorded live on 2026-10-25 with a distinct owner and reviewer account: submit (187069), approve (187095), list (187124), revision 2 that un-lists (187165), approve (187181), explicit rebind, relist (187205), changes requested (187230), approve again (187271). Each step carries its finalized receipt and the policy decision read right after it.
- Sealed reports stored through `remark.store` at blocks 164266, 164335, 187058 and 187145, with retrieval and fingerprint verification.
- A Catalog decision page in the application: the published entry against the approved report, the on-chain approval, the listing, the policy verdict and reasons, evidence age, checkpoints, next action and binding history, with a live evaluation in the browser and no wallet.
- A standalone Token Catalog with a reproducible local lifecycle, the live v2 lifecycle, refusal cases (wrong entry, superseded revision, revoked approval, unreachable node) and downstream acceptance CI.
- A second consumer, a DEX allow-list, installed from the packed artifact (version 0.4.1, verified from a clean install) in a separate repository with its own policy and CI, and its public Token eligibility demo: anyone checks the configured entry without login or wallet, sees why a wrong entry is withheld, opens the exact report in the App, corrects the entry, refreshes under the consumer's own policy and watches the token selector obey the result; a decision-evidence document is downloadable and reconstructed offline by a second command.
- The library documented function by function (`docs/LIBRARY.md`) and shipped in the artifact: `retrieveEvidence`, `createBinding`, `collectPolicyInputs`, `evaluateBinding`, the published-entry invariant, the current-decision reducer and the portable decision document.
- VerifiedTokenList v1: `0xd0bd833b4b8658b1230a0e9a99640935b3c65819`, block 164220, pUSD listing at 164313: preserved as history; new writes to it are refused.

### Current boundaries

The owner and reviewer accounts of the recorded lifecycle are both controlled by the project: role separation on-chain, not independent review. The bound report is acceptable under the seven-day policy until 2026-11-01T09:29:17.646Z; the renewal runbook (`docs/RENEWAL.md`) names the steps by role, and no renewal transaction has been sent yet. Policy freshness is evaluated by the application when invoked, not discovered continuously by a Solidity contract; expiry, a runtime change and a node outage are demonstrated locally and labelled simulated. The second consumer and the value experiment were run by the author; no builder outside the project has installed or configured ReviveCheck, and the maintainer pilot described in `docs/PILOT_PROTOCOL.md` has not run. The value experiment compares equivalent checks at identical captured checkpoints and reports what was measured, not human time savings or demand. Unsupported historical replay observations are reported as partial.

### Try and verify

- Application: https://revivecheck.axiqo.xyz/ (republished on 2026-10-25 from commit `8aee632`)
- Video: https://www.youtube.com/watch?v=CvpzlQfya4U (recorded 2026-10-24; predates the live lifecycle)
- Source and setup: https://github.com/a252937166/ReviveCheck
- Token Catalog: https://github.com/a252937166/ReviveCheck/tree/main/examples/token-catalog
- Token eligibility demo (the second consumer): to be published from the separate repository; no public URL yet
- Status record: `public/release-status.json` in the repository
- Explorer: https://scanner-testnet-v3.portaldot.dev/

The original v0.1, v0.2 and v0.3 videos, the deployed v1 receipts and the immutable baseline remain preserved as historical evidence.
