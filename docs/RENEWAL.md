# Renewing the evidence

The bound report of the live v2 catalog (`1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51`, sealed at `2026-10-25T09:29:17.646Z`) stops being acceptable under the seven-day policy (`maxAgeSeconds` 604800) at **2026-11-01T09:29:17.646Z** (November 1, 2026, 04:29:17 EST). From that moment every evaluation returns `expired` and withholds the entry, although nothing on the chain changes: the registry still holds the approval and the VerifiedTokenList still lists the token. The competition freeze is 2026-11-06T04:00:00Z, so the evidence has to be renewed before final verification and recording.

Two separate limits apply and neither renews the other:

| Limit | What it measures | Policy value | What renews it |
| --- | --- | --- | --- |
| Evidence age (`evidence.age`) | how long the approved report remains acceptable, from `completedAt` | 604800 s | a new sealed report, approved on its exact hash and bound explicitly |
| Observation freshness (`observation.fresh`, `registry.fresh`, `consumer.fresh`) | how recently the current registry, listing and network state was read | 900 s | reading again; no approval or binding changes |

Refreshing the registry does not renew the report's age. A new report never inherits an old approval: the registry clears every decision when a new revision is submitted, and the policy's `revision-superseded` reason withholds the entry until the new report is approved on its own hash and bound explicitly. The old report, decisions, binding and evaluations stay as history; nothing is rewritten.

## The sequence

Each step is performed by its own role. The scripts refuse to broadcast without an explicit cap, journal the hash before sending, wait for finality, record the fee and read the result back through both interfaces. Dry-run every step first (the default of every script); add `--broadcast` with a cap only after the dry-run reports what it will do.

Before the first signature: check the git status of the worktree (another agent may be editing it), and confirm that no transaction is pending on either account (`system.accountNextIndex` equals the account nonce) so that a stuck extrinsic is not duplicated.

| # | Role | Step | Command (dry-run form) | Preserves |
| --- | --- | --- | --- | --- |
| 1 | release owner | Check the release live and publish the new sealed report | `node scripts/publish-report.js --release v1.0.1 --role catalog-v2-renewal --previous 1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51` | the old report stays under `public/reports/` |
| 2 | release owner | Store the new report on-chain (the policy requires stored evidence) | `node scripts/store-evidence.js --report <new hash>` then `--broadcast --max-fee-tpot 1 --wallet <main worktree>/.private/wallet.json` | the earlier stored reports |
| 3 | release owner | Submit the new hash as revision 3 of `pusd-catalog-v2` | `node scripts/registry-write.js --action submit --label pusd-catalog-v2 --report <new hash> --previous-report 1faef921…` then `--broadcast --max-cost-tpot 1 --wallet …/.private/wallet.json` | revisions 1 and 2 and their decisions in `public/lifecycle/registry-writes.json` |
| 4 | trusted reviewer | Approve the exact hash of revision 3 | `node scripts/registry-write.js --action review --release-id 0x28ab8a86a4d1ca4f5b38784d8f0a32c14ed163ae7f1ff9f4f5b5128fe5fdd927 --report <new hash> --journal artifacts/local/registry-review-r3.json` then `--broadcast --max-cost-tpot 1 --wallet …/.private/reviewer-wallet.json` | the earlier decisions |
| 5 | consumer operator | Bind the new report explicitly under the catalog policy | `node examples/token-catalog/catalog.js bind --config examples/token-catalog/config/testnet-v2.json --token 0x00001e6100000000000000000000000000010000 --report <new hash> --release-id 0x28ab8a86… --revision 3 --by "<who>" --storage-extrinsic <store extrinsic> --storage-block <store block>` | the earlier bindings in `bindings.json` |
| 6 | release owner | List pUSD again on revision 3 and read it back | `node scripts/list-token.js --label pusd-catalog-v2 --decimals 6` then `--broadcast --max-cost-tpot 1 --wallet …/.private/wallet.json` | the earlier listings in `public/lifecycle/token-list-v2.json` |
| 7 | consumer | Evaluate, capture and record each step | `node examples/token-catalog/catalog.js build --config … --capture examples/token-catalog/data/testnet-v2/captures/NN-<step>.inputs.json` and `catalog.js record --step <id> --actor … --action … --receipt '<json>'` after each step, then `catalog.js publish --config …`, `node scripts/index-registry.js`, `node scripts/release-status.js --out public/release-status.json` | every earlier capture and recorded step |

Between step 3 and step 6 the entry is withheld on-chain and off-chain: the registry holds an unapproved revision, the consumer stops listing, and the policy says `revision-superseded`, `approval-missing`, `consumer-not-listed`. This is the expected consequence, not an incident; record it like the 2026-10-25 steps 7 to 10.

The separate consumer (`revivecheck-consumer-example`) then names the new report hash, revision and storage extrinsic in `config/allowlist.json`; its fixtures of the old revision remain valid history.

## What to test before and after

- Boundary: the evaluator accepts the report at exactly `maxAgeSeconds` and refuses it one second later (`test/policy.test.js`, "evidence age is a policy clock"); the consumer's `test/evaluate.test.js` checks the same boundary at `2026-11-01T09:29:17.646Z`.
- Stale observations, a revoked approval, a superseded revision and unavailable reads each withhold the entry (`test/policy.test.js`, the consumer's refusal fixtures, `examples/token-catalog` CI).
- After renewal: the new binding evaluates `valid`; the old binding evaluates `revision-superseded`; both are visible in the binding history; the status record's `evaluated` level names the new evaluation.

## Timing, and the gap stated

Renewing on October 25 would expire again on November 1, before the freeze. The sensible window is November 3 or 4, 2026: the renewed evidence then covers the freeze (November 6, 04:00 UTC) and the following days. The same sequence applies whenever the evidence is renewed later for judging; the policy value is not widened to keep a green state.

That choice leaves an expected denial period: from the expiry at 2026-11-01T09:29:17.646Z until the successor report is approved, bound and listed (planned 2026-11-03), every evaluation of the published catalog returns `expired` and the entry is withheld, although nothing on the chain changes. The period is stated on the App's **Evidence health** page (`#/app/health`) with the policy lifetime against the freeze, and it will be recorded like the 2026-10-25 steps when it happens. A maintainer who needs continuous availability renews before the first expiry instead; the policy's `maxAgeSeconds` is the maintainer's choice, and the gap is the consequence of this one.

## Verified state, unknown state, and what the plan never does

The plan (`revivecheck/health`, `node scripts/renewal-prepare.js`, the Evidence health page) marks a stage done only when the evidence passes the evaluator's own predicates: a registry read dated, fresh, about this registry and this release, agreeing across interfaces; a listing read about this consumer and this token; a successor report intact, passed, newer, in this scope, on this network, about this subject, under this plan, on a supported runtime and not expired; a stored report retrieved by exact content hash (a storage receipt has no artificial lifetime; the freshness limits apply to the current reads). A read that is stale, undated, unavailable, from another target or disagreeing proves nothing: the stages it would prove are `unknown`, the plan has no next stage, and the stop names them. An unknown stage is read again, never performed again on the assumption that it did not happen; a pending send on either signer stops everything. Under a fresh-subject policy the subject read appears in the health view with its availability, freshness and comparison; under the legacy policy it is labelled not required, and no check of the current metadata is claimed. Offline captures (`--capture`) establish replayed behavior, not present signing readiness.

## Preparing the renewal (read-only)

```sh
node scripts/renewal-prepare.js --planned 2026-11-03T12:00:00.000Z --consumer examples/release-gate-starter/project.json
```

The command reads the registry for every trusted reviewer, the consumer listing and the finalized head, checks `system.accountNextIndex` against the nonce of both signing accounts (a pending send is a stop condition), scans `public/reports` for a successor report under the same plan fingerprint, retrieves its stored copy when one is recorded, and writes `artifacts/local/renewal/evidence-health.json` (`revivecheck.evidence-health.v1`: expiry, each read's lapse, the standing approval and listing, the next revision derived from the registry, the next role, warnings) and `renewal-plan.json` (`revivecheck.renewal-plan.v1`: the seven stages above with their verified state and the dry-run command of the next pending one). With `--consumer` and a successor it also writes the successor consumer configuration and a diff against the current one; the operator adopts that configuration only after the successor is approved, bound and listed. `--capture <inputs.json> --now <ISO>` runs the same derivation offline on a recorded step. The App's Evidence health page shows the same facts from the recorded last step and from a live read. A stage is `done` only when verified state shows it, so an interrupted renewal resumes from the first pending stage without a duplicate send.

Writing this runbook performed no transaction. Each broadcast requires an explicit decision at the time, with the wallets that live outside this worktree.
