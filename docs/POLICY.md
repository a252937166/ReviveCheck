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
| `evidence.requireFreshSubject` (optional, native-asset subjects; added 2026-10-25) | the subject's current symbol, name, decimals and address mapping must be read again at a finalized checkpoint through both interfaces and equal the approved report | a fresh subject read (`readSubjectWithClients`), compared field by field with the entry the report's `token.listing` check confirmed |
| `reviewers.trusted`, `threshold`, `basis` | who counts, how many, and why (the basis text is required) | the registry decisions of exactly those addresses |
| `registry.address`, optional `owner`, `label` | the ReleaseRegistry and the release owner | the registry read |
| `consumer.address`, `requireListed`, `version` | the consuming contract whose listing must agree | listing plus dual-interface identity at the same finalized checkpoint; an explicit, code-verified v1 selection for the legacy deployment |

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

- **Report semantics and read provenance.** A valid checksum alone is insufficient: report inputs and observations must reproduce its plan/environment bindings. Registry reads identify the expected contract, release and observation time; consumer reads identify the expected contract, token and observation time. Consumer identity is checked at the listing checkpoint. Legacy v1 is recognized only by its recorded address, exact runtime code and agreeing registry/curator reads, with the absent version getter preserved as `null` in the raw evidence.
- **Explicit reviewer trust.** Only addresses in `reviewers.trusted` count, each once, and `threshold` of them must have approved the current revision. An approval by any other account adds nothing. A trusted decision that was not read makes the result `unknown`, not a count of zero. `basis` must say why those reviewers are trusted and what that does not establish; the text is copied into every evaluation.
- **New approval and explicit rebinding for new reports.** The registry must hold exactly the bound report hash on exactly the bound revision. A new submission opens a new revision and clears approvals, so the entry is `recheck-required` until a trusted reviewer approves the new hash and the operator binds it. The approval alone does not move the binding.
- **Historical evidence is preserved.** Bindings are append-only; earlier reports, bindings and evaluations are never rewritten. A superseded binding is history, not an error. A changed policy has a new hash; bindings made under an earlier hash stay in the history when the configuration lists that hash under `supersededPolicies`, and never speak for the entry.
- **The published entry is the approved entry.** A consumer that publishes an entry derives its verified fields (chain, address, symbol, name, decimals, asset) from the approved report's own listing, confirmed by the report's passed `token.listing` check, never from a configured copy. The Token Catalog compares the configured entry with the approved one in canonical form, refuses a binding whose configured entry differs, and withholds the entry at build time with the field named (`entry-mismatch:decimals`), even when the policy evaluation is `valid`. An intact checksum never overrides that comparison; a report that approves no complete entry publishes nothing (`entry-unverified`).
- **Expiry is a policy clock, not a chain event.** `maxAgeSeconds` is evaluated off-chain by whoever runs the evaluator, from the report's `completedAt` and the evaluator's clock. The contracts have no notion of age.
- **Runtime drift is detected only from the observation supplied.** The evaluator compares the runtime the report pinned with the runtime in a fresh `network_status` observation. Without a fresh observation the result is `unknown`. Nothing watches continuously; a consumer re-evaluates before each use, or on a schedule in its own CI.
- **Unavailable or unsupported verification blocks.** A failed read, a stale observation, disagreeing interfaces or an unverifiable report is `unknown`. `unknown` never enables anything.
- **Current subject metadata is an explicit, optional assurance.** By default a valid evaluation says that the approval of the exact report stands, the consumer lists the subject, the network and runtime are the ones the report pinned, and the evidence is within its age; the subject's symbol, name and decimals were verified by the report at its checkpoint and the consumer contract checked decimals at listing time. It does not re-read them. A policy that sets `evidence.requireFreshSubject: true` makes every evaluation read the native Assets metadata and the ERC-20 precompile views again at one finalized checkpoint, through both interfaces, within `maxObservationAgeSeconds`, and compare them with the approved entry: an unchanged subject stays `valid`; a changed asserted field is `recheck-required` (`subject-changed`) although the old approval still stands; a missing, failed, stale, disagreeing or unsupported-runtime read is `unknown` (`subject-unavailable`, `observation-stale`, `interfaces-disagree`, `subject-unsupported`); a vanished asset is `recheck-required` (`subject-missing`). The subject read's time bounds the permission deadline and its checkpoint travels in the decision evidence. The key is written only when set, so every earlier policy keeps its fingerprint, and `policyAssurance(policy)` states in words which of the two assurances a policy gives. Supply and balance changes are not read: a metadata release does not depend on them. Contract-profile subjects verify declared code identity only; a proxy's unchanged bytecode does not prove its implementation or storage unchanged, and fresh-subject assertions for contracts are a separately scoped extension.

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

A `valid` result means the policy's conditions held at the recorded checkpoints and time. It is not a guarantee of future state, a security audit, or independent review: the trusted reviewer set is the policy author's choice. In the 2026-10-23 records the owner, the reviewer and the operator are the project's own test account; in the v2 lifecycle recorded on 2026-10-25 the owner and the reviewer are two distinct accounts, both controlled by the project. Neither is independent review. The evaluator trusts the public RPC operators it reads from, as every other read in ReviveCheck does. Fresh network, registry and listing reads do not continuously re-read every subject metadata field or arbitrary target code: subject/plan validation refers to the dated report, bounded by the policy age limit. Run a new acceptance check and reapproval/rebinding when fresh subject evidence is required.
