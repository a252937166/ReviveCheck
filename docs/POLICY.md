# Policy envelopes: when may a consumer act on a release?

Added 2026-10-24 for review finding F-05. The contracts answer one question: does an approval of this exact report hash stand on the current revision? A business action, such as enabling a token in a catalog, needs more than that, and nothing in a Solidity contract can supply it: the right network, the right subject, the acceptance plan the policy expects, a runtime the policy supports, evidence that is not too old, reviewers the policy author trusts, and fresh finalized observations to compare against. A policy envelope states those conditions; a binding ties one exact report to the subject; an evaluation decides.

Implementation: `lib/policy.js` (pure functions, offline-testable), `evaluatePolicy` and `collectPolicyInputs` in `lib/service.js`, the `evaluate_policy` tool over MCP, REST, JavaScript and the CLI, and the reference consumer under `examples/token-catalog/`. Tests: `test/policy.test.js`, `test/token-catalog.test.js`.

## The three documents

**Policy** (`revivecheck.policy.v1`). Authored by the consumer, hashed canonically.

| Field | Binds acceptance to | Checked against |
| --- | --- | --- |
| `network.key`, `chainId`, `genesisHash` | one network and genesis | the report's recorded network and the fresh observation |
| `subject` | a native asset (`assetId` and its precompile address) or a contract (`address`, optionally `codeHash`) | the report's plan input and, for contracts, the code hash the report bound |
| `planHash` | the acceptance plan fingerprint | `report.binding.planHash` |
| `runtime.specName`, `specVersions` | the runtimes the policy supports | the report's runtime and the observed runtime |
| `evidence.scope`, `maxAgeSeconds`, `maxObservationAgeSeconds`, `requireInterfacesAgree`, `requireStoredOnChain` | the evidence class, its age, how fresh the observation must be, dual-interface agreement, on-chain storage | the report, the clock, every read |
| `reviewers.trusted`, `threshold`, `basis` | who counts, how many, and why (the basis text is required) | the registry decisions of exactly those addresses |
| `registry.address`, optional `owner`, `label` | the ReleaseRegistry and the release owner | the registry read |
| `consumer.address`, `requireListed`, `version` | the consuming contract whose listing must agree | `isListed` and `entryOf` |

**Binding** (`revivecheck.binding.v1`). An explicit act by the operator: this subject, this exact report hash, this release ID and revision, who bound it and when, optionally where the report is stored on-chain. It carries the policy hash, so a binding made under one policy does not verify under another. A new report or a new revision needs a new binding; the old one stays in history.

**Evaluation** (`revivecheck.policy-evaluation.v1`). The verdict with every check and reason, the checkpoints read, the reviewer-trust basis, a `simulation` flag, the next action, and its own hash.

## Statuses

| Status | Meaning | Enables the action |
| --- | --- | --- |
| `valid` | every condition held at the recorded checkpoints and time | yes |
| `recheck-required` | the evidence no longer satisfies the policy: wrong target or plan, failed report, unsupported or changed runtime, superseded revision, missing or revoked approval, consumer disagreement | no |
| `expired` | the report is older than `maxAgeSeconds` | no |
| `unknown` | a read failed, an observation is missing or stale, the interfaces disagree, or the evidence cannot be verified | no |

A definite reason outranks an unavailable read: a report that is both expired and unverifiable is reported `expired`, with both reasons listed. Every reason code is in `REASONS` in `lib/policy.js`, with the text a maintainer reads.

## Rules the evaluator enforces

- **Explicit reviewer trust.** Only addresses in `reviewers.trusted` count, each once, and `threshold` of them must have approved the current revision. An approval by any other account adds nothing. A trusted decision that was not read makes the result `unknown`, not a count of zero. `basis` must say why those reviewers are trusted and what that does not establish; the text is copied into every evaluation.
- **New approval and explicit rebinding for new reports.** The registry must hold exactly the bound report hash on exactly the bound revision. A new submission opens a new revision and clears approvals, so the entry is `recheck-required` until a trusted reviewer approves the new hash and the operator binds it. The approval alone does not move the binding.
- **Historical evidence is preserved.** Bindings are append-only; earlier reports, bindings and evaluations are never rewritten. A superseded binding is history, not an error.
- **Expiry is a policy clock, not a chain event.** `maxAgeSeconds` is evaluated off-chain by whoever runs the evaluator, from the report's `completedAt` and the evaluator's clock. The contracts have no notion of age.
- **Runtime drift is detected only from the observation supplied.** The evaluator compares the runtime the report pinned with the runtime in a fresh `network_status` observation. Without a fresh observation the result is `unknown`. Nothing watches continuously; a consumer re-evaluates before each use, or on a schedule in its own CI.
- **Unavailable or unsupported verification blocks.** A failed read, a stale observation, disagreeing interfaces or an unverifiable report is `unknown`. `unknown` never enables anything.

## Using it

```sh
npm run rc -- evaluate_policy --policy "$(cat policy.json)" --binding "$(cat binding.json)" --reportHash <64-hex>
```

```js
import { evaluatePolicy } from './lib/service.js';
const evaluation = await evaluatePolicy({ policy, binding, report });
if (evaluation.enable) enableToken(); else console.log(evaluation.status, evaluation.reasons);
```

The service reads the network observation, the registry for every trusted reviewer, the consumer listing when required and the stored report when required, in one call. A read that fails is handed to the evaluator as an error and comes back as `unknown`; the call does not throw.

The Token Catalog (`examples/token-catalog/`) is the worked consumer: a token is `available` in its catalog document only while its latest binding evaluates to `valid`. Its local lifecycle shows every status above on an in-memory chain with fixture accounts; its testnet configuration evaluates the recorded pUSD release live.

## What this does not do

A `valid` result means the policy's conditions held at the recorded checkpoints and time. It is not a guarantee of future state, a security audit, or independent review: the trusted reviewer set is the policy author's choice, and in every record this project has produced so far the owner, the reviewer and the operator are the project's own test account. The evaluator trusts the public RPC operators it reads from, as every other read in ReviveCheck does.
