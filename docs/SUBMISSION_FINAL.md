# ReviveCheck project-page copy (2026-10-27)

Publication copy for the existing DoraHacks Build 50176. The publication receipt is recorded separately in `docs/PUBLICATION_2026-10-27.md`; this copy alone does not prove that the platform fields were saved. Historical Check-in materials remain unchanged.

## Vision

Release attestations and policy-based token acceptance on Portaldot V3, with retrievable evidence and an explicit recheck lifecycle.

## Description

### The problem and the product

A token list says pUSD has 18 decimals; the chain says 6. A token-list maintainer needs more than a green check: the exact evidence, a review tied to that evidence, and a way to withdraw permission when the context changes.

ReviveCheck connects release acceptance to application behavior. Define a plan, check the actual target, correct a failure, seal the result, approve its exact fingerprint on-chain, and let a consumer admit the token only while its own published policy permits it. A changed revision clears approval; the consumer must explicitly bind the newly approved report. Earlier reports, comparisons and decisions remain inspectable.

### Why Portaldot V3 is essential

- **Revive** executes the Solidity ReleaseRegistry, VerifiedTokenList v2 and ReviveCheckGuard integration.
- **ReviveApi** aligns native and EVM accounts and finalized blocks. Checks compare both interfaces at the same checkpoint.
- **Assets and its ERC-20 precompile** expose two views of pUSD. Their precision, supply and holder balance are checked against the acceptance plan.
- **Remark** stores sealed report bytes on-chain. Retrieval verifies the fingerprint, and historical replay reproduces the original observations where supported.

These modules connect retrievable native evidence to contract-readable approval. This is a Portaldot release-verification workflow, with EVM and native interfaces used together; cross-chain interoperability is not claimed.

### A complete, usable lifecycle

1. Define a release plan, or use the public custom-input form for your own token. Run the check without a visitor login or wallet.
2. Compare the failed 18-decimal entry with the corrected 6-decimal result. Seal and share the exact report, with official explorer links and contract/transaction QR codes.
3. Retrieve and inspect the report, replay its original checkpoint, and record review feedback. A registry approval requires a wallet signature on the exact report revision.
4. Bind that approval explicitly to a consumer policy. Evaluate the network, token, plan, runtime, trusted reviewer, evidence age and current listing before admitting an entry.
5. Withhold on mismatch, superseded revision, revoked approval, expired evidence or unavailable verification. Recheck, obtain a new approval, rebind and relist to restore eligibility.

The public, separately built **Token eligibility demo** installs the 0.5.3 artifact with its own policy and CI. Its selector withholds the wrong entry, admits the corrected entry after a fresh evaluation, and prepares an immutable catalog release that another process can verify and consume. It exports portable decision evidence. This is an author-built integration demonstrating reuse, not independent customer adoption.

The browser, JavaScript, REST, MCP and CLI share deterministic verification logic. MCP is an integration interface, not a built-in AI verifier. Public static hosting provides the browser experience; REST and MCP are available through the documented local server.

### Verifiable testnet delivery

- **ReleaseRegistry:** `0xe949b200edf070b9d425b206ed24dc8fe5b7d339`, finalized deployment at block **162962**.
- **VerifiedTokenList v2:** `0xedaf8a25bb583ad164a94191b762414277198df9`, finalized deployment at **177354**, with all nine deployment checks passed.
- **Revision-2 pUSD listing:** block **187205**, transaction `0x435979c0ff353ecd887e031490752671f9739f249d2344b9967d7292cb0f7eb3`, with agreeing native/EVM readback.
- **Recorded lifecycle, 2026-10-25:** 12 steps and 10 finalized receipts cover checking, report storage, submission, approval, listing, a new revision that invalidates the old binding, explicit rebinding, relisting, revocation and restoration. The 18-decimal listing was refused in a real contract dry-run. No extra transaction was sent for the video.
- **Report verification:** the film verifies the exact SHA-256 report and replays **13/13** observations at its original block.
- **Local validation:** the 2026-10-26 repair release passed **255 main tests and 24 consumer tests**, both production builds, artifact verification and clean-browser consumer journeys. Reproducible instructions and repair records are public.

### Ecosystem value and continued support

The MIT-licensed library, contract guard, release-gate starter, public evidence format and separate consumer give Portaldot maintainers a reusable path from a check to an application decision. Initial users are token-list curators and application teams maintaining asset catalogs.

Next steps are a recorded external maintainer pilot, broader acceptance adapters, guarded evidence renewal and a security review before any production use. A possible paid service is hosted monitoring and evidence operations for maintainers, while verification formats and the self-hosted core remain open source. Demand, pricing and revenue are not yet validated. Ecosystem support would fund these pilots, chain-adapter maintenance and reliable public infrastructure.

### Boundaries

Portaldot V3 **testnet only**. The owner and reviewer are distinct accounts controlled by the project: role separation, not independent review. Contract approval and application policy freshness are separate; contracts do not continuously monitor every policy input. Expiry, unsupported runtime and node-outage examples are labelled simulated or recorded as appropriate. No independent adoption, audit, production readiness or measured human time saving is claimed.

The currently bound report expires under the existing seven-day policy at **2026-11-01T09:29:17.646Z**. After that, the application withholds the entry until a new check, exact-hash approval, explicit binding and relisting are completed. No renewal transaction has been sent; the policy is not widened for the competition.

### Try and verify

- App: https://revivecheck.axiqo.xyz/
- Separate consumer demo: https://demo.revivecheck.axiqo.xyz/
- Demo video (2:52, public, recorded 2026-10-26): https://www.youtube.com/watch?v=4F80-0C9gVM
- Final pitch deck: https://revivecheck.axiqo.xyz/revivecheck-final-deck.pdf
- Source and setup: https://github.com/a252937166/ReviveCheck
- Consumer source: https://github.com/a252937166/revivecheck-consumer-example
- Status and evidence: https://revivecheck.axiqo.xyz/release-status.json
- Official explorer: https://scanner-testnet-v3.portaldot.dev/

The original v0.1, v0.2 and v0.3 videos, v1 receipts and the immutable baseline remain historical evidence.
