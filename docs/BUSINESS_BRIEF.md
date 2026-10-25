# ReviveCheck: customer, problem, workflow, value, model

Prepared 2026-10-25

Written for item O-09 of `docs/2026-10-25_final-optimization-plan.md`. Every figure is taken from the project's existing records, named per section; nothing here is a new measurement or chain read.

## Primary customer

The maintainer responsible for a Portaldot wallet or token-catalog entry, who must decide whether an entry can be published or selected. Five recurring triggers: a metadata correction (the recorded case: decimals 18 against the chain's 6), a new release (a new registry revision), a review change (changes requested, or approved again), evidence expiry (the policy's report age limit, 604800 seconds) and an environment incompatibility (an unsupported runtime, or V3 Live, which refused the demo release: chain 780780777, runtime 3001, no asset 7777).

## Problem today

Per `PRODUCT.md` and the README: the approval is a JSON file, a spreadsheet or a chat thread no contract can read; "the release" was approved, with no record of what the reviewer saw; the evidence is a screenshot or a link whose content can change; the chain is read through one interface in an explorer. Nothing says when an approval stopped holding, so a configured entry can be published under evidence that checked different values, and the maintainer reconciles RPC responses, account mappings, explorer references and screenshots by hand.

## Workflow with ReviveCheck

Every step is implemented and was recorded live on the V3 testnet on 2026-10-25 (`RELEASE_STATUS.md`, "The live v2 lifecycle").

1. Check the entry through both V3 interfaces at one finalized block; the result is a sealed report with a SHA-256 fingerprint.
2. Store the report on-chain with `remark.store` (#187058, #187145).
3. The owner submits the exact report hash to the ReleaseRegistry (#187069).
4. A reviewer the consumer's policy trusts approves that exact hash (#187095).
5. The consumer operator binds the exact report explicitly (read at #187192); approval alone moves no binding.
6. The owner lists the entry on VerifiedTokenList v2 (#187124); an 18-decimals listing reverted in dry-run with `DecimalsMismatch` (#187110).
7. Before each use the consumer evaluates its own policy against fresh finalized reads; only `valid` enables (#187279: `valid`, 35 checks).
8. A new revision (#187165), a revocation (#187230) or expiry makes the entry `recheck-required` or `expired`, and the catalog withholds it.
9. Recovery is a new approval (#187181), explicit rebinding and relisting (#187205), or re-approval after revocation (#187271). Earlier reports, bindings and decisions stay in history.

## Feature-to-benefit mapping

| Implemented feature | Maintainer benefit | Supporting record |
| --- | --- | --- |
| Dual-interface finalized observations | Entry fields confirmed by two views of one runtime at one finalized block; the recorded mismatch reads entry 18, native 6, EVM 6 | README "What it is"; `VALUE_EXPERIMENT.md` check C1; reports at #187058, #187145 |
| Exact-report approval in the ReleaseRegistry (`0xe949b200edf070b9d425b206ed24dc8fe5b7d339`, #162962) | The approval names the hash the reviewer saw; a new submission opens an unapproved revision, so nothing carries over silently | `PRODUCT.md`; lifecycle steps 7, 11, 12 |
| VerifiedTokenList v2 consuming the registry through ReviveCheckGuard (`0xedaf8a25bb583ad164a94191b762414277198df9`, #177354) | A wallet or DEX reads the approval on-chain instead of trusting a file; a listing whose decimals differ from the report reverts | `DEPLOYMENT.md`; lifecycle steps 4, 5, 10 |
| Evidence stored with `remark.store` | The sealed report is retrievable and verifiable from any node by its hash, unlike a link or a screenshot | README "Storage and data"; #164266, #164335, #187058, #187145 |
| Consumer-owned policy: evidence age, observation age, trusted reviewers, supported runtime | The consumer states what its action needs; a failed read is `unknown` and never enables; an entry differing from the approved report is withheld with the field named (`entry-mismatch:decimals`) | `POLICY.md`; evaluation at #187279; the thirteenth case in `RELEASE_STATUS.md` |
| Catalog decision page (`#/app/catalog`) | Recorded lifecycle and live policy evaluation inspectable in a browser without a wallet; plan item O-02 records a gap to correct (a failed refresh can leave an earlier result visible) | `RELEASE_STATUS.md`; `PRODUCT.md`; plan item O-02 |
| Packed artifact and a second consumer (a DEX allow-list) | A second application installs the artifact, retrieves the report from chain data and refuses under its own policy; author-built and author-run, so portability only; its installed MCP server advertises two missing resources | `RELEASE_STATUS.md` level 6; plan section 2 and item O-05 |

## Measured value, stated fairly

The 2026-10-25 run in `VALUE_EXPERIMENT.md` ran the same five checks two ways, as a maintainer-style script over raw reads and through ReviveCheck, at identical captured checkpoints across five scenarios (correct entry, wrong decimals, superseded report, revoked approval, unavailable verification), three also live. All 16 arm runs completed with the predefined decision: 0 false enables, 0 false refusals. Live decisions took 17.1 to 24.0 s per arm, about 99 % of it waiting on the public nodes; ReviveCheck was faster in one pair (17.3 s against 19.1 s) and slower in the other (24.0 s against 17.1 s), so no speed difference is established. Set-up was counted, not timed: `npm ci` took 4.9 s warm or 14.4 s cold; a catalog needs 25 policy fields, 17 catalog fields and one six-argument binding command per approved revision; the baseline script encodes 19 constants and 10 chain facts in 217 lines. A second reader given only the output artifact reconstructed 6 of 6 required items from ReviveCheck's and 5 of 6 from the baseline's, which records no next action and none of the four supporting items (integrity hash, trust basis, policy identity, role control).

Caveats, as the experiment states them: one run per scenario, author-run scripts, no human took part, the baseline was written to perform the same checks, and the two signed scenarios ran on captured inputs only. The run does not establish superior speed, human time savings, demand, revenue or willingness to pay. The maintainer pilot in `PILOT_PROTOCOL.md` (three to five maintainers, each with a reviewer and an economic buyer) is defined and has not run; no participant has been recruited.

## Commercial hypothesis (unvalidated assumptions)

- The core library, contracts and API stay open source under MIT (README, `LICENSE`).
- A hosted offer could manage scheduled checks, evidence retention, indexing, status history and team notifications (plan item O-09); the README adds curated reviewer registries and CI integrations with report retention. Scheduled re-evaluation exists today only as a CI workflow (`examples/token-catalog/acceptance.workflow.yml`).
- Who would operate or pay: the organization owning the listing decision, which `PILOT_PROTOCOL.md` describes as a lead maintainer, product owner, treasury or operations lead at a wallet or DEX; `PRODUCT.md` names an ecosystem maintainer or foundation as a buyer hypothesis, not a customer.
- Self-hosting requires Node.js 22 or newer and `npm ci`, the public RPC nodes (reads cost nothing on-chain), the packed artifact for a consumer outside the source tree, and the consumer's own policy, catalog and binding step. The local workbench binds to loopback with no multi-user authentication (README).
- No price is proposed. Hosting and operator-labour costs are assumptions until measured; no billing or marketplace is built.

## Costs, distinguished

All amounts are testnet tPOT, not money.

| Kind | Items | Source |
| --- | --- | --- |
| Fees spent, 2026-10-25 lifecycle | submits 0.0216, 0.0209; reviewer decisions 0.0248, 0.0241, 0.0241, 0.0241; listings 0.0313, 0.0306; stored reports 0.748, 0.752; transfer 0.015 (about 1.72 summed) | `RELEASE_STATUS.md` |
| Fees spent, earlier | ReleaseRegistry deployment 0.160; v1 list 0.253; v1 pUSD listing 0.031; ReleaseGate submit and review 0.036; reports 0.752 each (#164266, #164335); v2 list 0.316 | `DEPLOYMENT.md` |
| Deposits held | ReleaseRegistry 125.196; VerifiedTokenList v1 178.158; v2 225.738 (maximum); v1 pUSD listing 11.525; ReleaseGate review 3.842; reviewer decision storage up to 3.8415; release and entry storage as shown by each dry-run, not itemized. Held, not spent; the live contracts have no demonstrated recovery path | `DEPLOYMENT.md`; `RELEASE_STATUS.md` |
| Estimates | v2 deployment estimate of 2026-10-24: deposit 225.738, fee 0.316 plus 0.632 reserve, 226.370 committed against 78.793 available (shortfall 147.578), cap 250; the deployment then followed it | `DEPLOYMENT.md` |
| Hosting and operations | no hosting charge or operator-labour figure is recorded in either source | `RELEASE_STATUS.md`; `DEPLOYMENT.md` |

## What remains unproven

`RELEASE_STATUS.md` establishes five of its six levels and marks "Independently adopted: no". No builder outside the project has installed or configured ReviveCheck; the second consumer and the benchmark were run by the author. The owner (`0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b`) and the reviewer (`0x95db300103ec8b45884b13ed85230fbf02114065`) are two test accounts both controlled by the project: role separation, not independent review. Customer demand, willingness to pay and any price point have no evidence yet; the pilot protocol is the planned route to the first case-level evidence.
