# ReviveCheck v0.3 project-page copy

Prepared for the existing DoraHacks Build 50176. This document is editable publication copy, not a receipt that the platform fields have been updated.

## Vision

Release attestations and policy-based token acceptance on Portaldot V3, with retrievable evidence and an explicit recheck lifecycle.

## Description

ReviveCheck helps a token-list maintainer decide whether an entry may be enabled, which report supports that decision, and when it must be checked again.

A release owner submits an exact report hash to the ReleaseRegistry. A reviewer approves that revision. A consumer contract reads the approval, while an application policy also checks the intended network, token, acceptance plan, runtime, evidence age and trusted reviewer. Changed revisions, revoked decisions, expired evidence and unavailable verification block the Token Catalog. A new report needs a new approval and explicit rebinding; earlier evidence remains inspectable.

Portaldot is part of the mechanism: Revive runs the contracts; ReviveApi maps native/EVM accounts and finalized blocks; Assets and its ERC-20 precompile supply two views of the sample token; Remark stores report bytes on-chain. The same deterministic verification service is available through the browser, JavaScript, REST, MCP and CLI. MCP is an integration interface, not a built-in AI verifier.

### Delivered evidence

- ReleaseRegistry: `0xe949b200edf070b9d425b206ed24dc8fe5b7d339`, testnet block 162962.
- VerifiedTokenList v1: `0xd0bd833b4b8658b1230a0e9a99640935b3c65819`, block 164220; pUSD listing at 164313.
- VerifiedTokenList v2: `0xedaf8a25bb583ad164a94191b762414277198df9`, finalized deployment at 177354; verified code and dual-interface identity, locally selected after re-verification at 177362. No completed v2 listing is claimed.
- Sealed reports stored through `remark.store` at blocks 164266 and 164335, with retrieval and fingerprint verification.
- A standalone Token Catalog with a reproducible local lifecycle, policy refusal cases and downstream acceptance CI.
- A current-version demonstration distinguishing historical transactions, live reads and simulated lifecycle operations.

### Current boundaries

VerifiedTokenList v2 is deployed at `0xedaf8a25bb583ad164a94191b762414277198df9`, finalized at block 177354 in transaction `0xb0264f2bd82e55a791a21c265f1188c112c5b0b7bda60d5fe558666cbee5abab`. Code, version, registry and curator verification passed through the native and EVM interfaces; local activation independently reverified at block 177362. Its first v2 listing and live v2 Catalog acceptance are still pending. Historical v1 receipts remain preserved. The complete 17-step Token Catalog lifecycle is demonstrated locally and labelled SIMULATED.

Policy freshness is evaluated by the application when invoked, not discovered continuously by a Solidity contract. Historical testnet owner and reviewer roles use one project account; the two-role local demonstration uses project-controlled simulated accounts. The value experiment compares scripted operations and command packaging, not measured human time savings or external adoption. Unsupported historical replay observations are reported as partial.

### Try and verify

- Application: https://revivecheck.axiqo.xyz/
- Current video: https://www.youtube.com/watch?v=CvpzlQfya4U
- Source and setup: https://github.com/a252937166/ReviveCheck
- Token Catalog: https://github.com/a252937166/ReviveCheck/tree/main/examples/token-catalog
- Explorer: https://scanner-testnet-v3.portaldot.dev/

The original v0.1 and v0.2 videos, deployed v1 receipts and immutable baseline remain preserved as historical evidence.
