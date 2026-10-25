# The library, function by function

What the installed package (`npm install revivecheck-<version>.tgz`) gives a consumer, with parameters, return shapes, limits and failure behavior. Everything here is read-only: no function signs, holds a key or sends a transaction. The shapes below are the ones the functions return today; a field that is not listed is not promised. Schema names (`revivecheck.policy.v1`, `revivecheck.binding.v1`, `revivecheck.policy-evaluation.v1`) are defined in `docs/POLICY.md`.

| Import | Contents |
| --- | --- |
| `revivecheck/policy` | `normalizePolicy`, `policyHash`, `createBinding`, `verifyBinding`, `evaluateBinding`, `summarizeEvaluation`, `REASONS`, `POLICY_STATUSES` |
| `revivecheck/service` (also the package root) | `retrieveEvidence`, `collectPolicyInputs`, `evaluatePolicy`, `networkStatus`, `readRegistry`, `readTokenList`, `checkRelease`, `replay`, `compare`, `prepareTransaction`, `accountOverview`, `closeConnections`, `REGISTRY`, `TOKEN_LIST` |
| `revivecheck/entry` | `approvedEntry`, `compareEntry`, `entryDecision`, `canonicalEntry`, `entryIdentity`, `ENTRY_FIELDS` |
| `revivecheck/current` | `initialDecision`, `beginCheck`, `settleCheck`, `failCheck`, `changeSelection`, `ageDecision`, `checkPermission`, `canAct`, `decisionValidity`, `describeDecision`, `VALIDITY_LIMITS` |
| `revivecheck/decision` | `buildDecisionEvidence`, `reconstructDecision`, `formatReconstruction`, `decisionSheetHtml`, `explainReason`, `evidenceExpiry`, `RENEWAL_STEPS`, `RECOVERY` |
| `revivecheck/catalog-release` | `buildCatalogRelease`, `verifyCatalogRelease`, `readCatalogRelease`, `compareCatalogReleases`, `releaseDiagnostics`, `gateOutcome`, `loadConsumerConfig`, `selectorFrom`, `EXIT`; the `revivecheck-catalog` command |
| `revivecheck/report` | `verifyRun`, `validateImportedRun`, `fingerprint`, `canonical`, `sealRun`, `compareRuns`, `reportHtml` |
| `revivecheck/registry`, `revivecheck/tokenlist`, `revivecheck/networks`, `revivecheck/chain`, `revivecheck/evidence`, `revivecheck/plan`, `revivecheck/demo` | the lower-level modules the above are built from; their exports are stable but documented in source |

Node 22 or later. In a browser, the same modules run through a bundler (the public site is built this way with Vite); the chain reads use WebSocket and HTTPS to the official public nodes.

## Lifecycle responsibilities

- **Release owner**: produces reports (`checkRelease`), stores them (`prepareTransaction({ action: 'store' })`, signed in the owner's wallet), submits them to the ReleaseRegistry and lists tokens. The library prepares and dry-runs these calls; the owner's wallet signs them.
- **Trusted reviewer**: approves the exact report hash of a revision in the registry (`prepareTransaction({ action: 'review' })`, signed in the reviewer's wallet).
- **Consumer operator**: writes the policy, creates bindings explicitly (`createBinding`), and evaluates before each use (`collectPolicyInputs` + `evaluateBinding`, or `evaluatePolicy`). Nothing in the library migrates a binding to a new revision or extends evidence age.
- **Any consumer**: retrieves and verifies stored evidence (`retrieveEvidence`), reconstructs a decision from an evidence document (`reconstructDecision`).

## `revivecheck/policy`

### `normalizePolicy(policy)` → frozen policy

Validates a `revivecheck.policy.v1` document and returns its canonical form. Throws an `Error` naming the field on the first violation. Limits: `name` 1–120 characters; `network.key` is `testnet`, `live` or `local`; `runtime.specVersions` lists at least one decimal string; `subject.kind` is `native-asset` (with `assetId`, a u32 decimal string, and `address`) or `contract` (with `address`, optional `codeHash`); `planHash` is 64 hex characters; `evidence.scope` is `portaldot-testnet-readonly`, `portaldot-live-readonly` or `local-rehearsal` (the last only with `network.key` `local`); `evidence.maxAgeSeconds` ≥ 1; `evidence.maxObservationAgeSeconds` ≥ 1 (default 900); `reviewers.trusted` has at least one H160 address, `threshold` (default 1) at most its length, `basis` 1–400 characters; `registry.address` H160, optional `owner` H160 and `label` 1–31 characters; optional `consumer.address` H160 with `requireListed` (default true) and `version` ≥ 1.

### `policyHash(policy)` → 64-hex string

`fingerprint(normalizePolicy(policy))`: SHA-256 of the canonical JSON. Key order and address casing do not change it.

### `createBinding({ policy, report, releaseId, revision, boundBy, boundAt?, note?, storage?, id? })` → frozen `revivecheck.binding.v1`

Binds one exact report to the policy subject on one registry release and revision. Throws when the policy is invalid, when the report fails `validateImportedRun` (integrity and semantic consistency), when `revision` is not a positive integer string, when `boundAt` is not ISO-8601, when `id` is not `[A-Za-z0-9._-]{1,120}` (default: a random UUID), when `boundBy` is empty or longer than 160 characters, or when `storage.extrinsicHash` (optional, with optional `blockHash`) is not a 0x-prefixed 32-byte hash. `note` is cut at 400 characters. The result carries `policyHash`, `subject`, `reportHash` (bare 64 hex), `releaseId`, `revision`, `storage` and its own `bindingHash`.

### `verifyBinding(binding, policy?)` → boolean

True when the binding's hash recomputes and, if a policy is given, it was made under exactly that policy. Never throws.

### `evaluateBinding({ policy, binding, report, registry?, observation?, listing?, evidence?, now? })` → frozen `revivecheck.policy-evaluation.v1`

Pure. `registry` is a `readRegistry` result (or `{ error }`), `observation` a `networkStatus` result (or `{ error }`), `listing` a `readTokenList` result (or `{ error }`, required when `policy.consumer.requireListed`), `evidence` a `retrieveEvidence` result (or `{ error }`, required when `policy.evidence.requireStoredOnChain`), `now` the evaluator's clock (Date or ISO string; default the real clock). Returns `status` (`valid`, `recheck-required`, `expired`, `unknown`), `enable` (true only for `valid`), `reasons[]` (`{ code, status, text }`; every `code` is a key of `REASONS`), `checks[]` (`{ id, status, observed, expected }`), `checkpoint` (`registry`, `observation`, `listing` blocks or null), `evaluatedAt`, `nextAction`, `reviewerTrust`, `caveat`, `evaluationHash`. A missing or failed read is `unknown`, never a pass; a read older than `maxObservationAgeSeconds` is `unknown` (`observation-stale`); a report older than `maxAgeSeconds` is `expired`. Clock skew of up to 60 seconds in the future is tolerated. Throws only when `policy` is invalid or `now` is not a date.

### `summarizeEvaluation(evaluation)` → string

One line: the status and the reason codes.

## `revivecheck/service`

Every function opens one shared WebSocket per network on first use and reuses it; call `closeConnections()` before a Node process exits, or it stays open. Each call is bounded by a timeout (75 s for the chain reads, 45 s for evidence retrieval); on timeout the function throws (or, for `retrieveEvidence` and the reads inside `collectPolicyInputs`, returns an error result) and nothing is retried: the caller decides whether to read again. The public nodes can take tens of seconds to hand out metadata on first contact.

### `retrieveEvidence({ extrinsicHash, blockHash?, expectedHash? })` → retrieval result

Reads one `remark.store` extrinsic from chain data and verifies the stored report. Returns, never throws: `{ verified, extrinsicHash, blockHash, blockNumber, finalized, extrinsicIndex, time, publisher, length, contentHash, reportHash, run, reasons[] }`. `verified` is true only when the block is canonical and finalized, the extrinsic is signed and is `remark.store`, it dispatched successfully, the `Remark.Stored` event names the publisher and the blake2-256 content hash, the bytes parse as a report whose SHA-256 recomputes, and (when `expectedHash` is given) that hash is the expected one. The parsed report is `run`. Without `blockHash` the official explorer's API is asked for the block; when it has not indexed the extrinsic yet, `reasons` says so and the caller supplies the block hash or retries. Every failed condition is listed in `reasons`; a failure to reach the node is one of them.

### `collectPolicyInputs({ policy, binding })` → `{ observation, registry, listing, evidence, collectedAt }`

Collects, in parallel, the fresh reads `evaluateBinding` needs under this policy: `networkStatus`, the registry read with every trusted reviewer's decision (`readRegistryWithClients`), the consumer listing when `policy.consumer.requireListed` (reading the consumer named by the policy), and, when `policy.evidence.requireStoredOnChain`, the stored report named by `binding.storage` (`evidence`; `{ error }` when the binding names no extrinsic). Each read that fails becomes `{ error: '<message>' }` instead of throwing, so the evaluation is `unknown` rather than absent. Throws only for a local-rehearsal policy (evaluated offline, never by the service) or a policy naming another registry than the deployed one.

### `evaluatePolicy({ policy, binding, report, now? })` → evaluation

`collectPolicyInputs` followed by `evaluateBinding`.

### `networkStatus(key = 'testnet')` → observation

`{ network, name, symbol, decimals, chainId, genesisHash, genesisMatches, runtime: 'specName/specVersion', finalized: { number, nativeHash, explorerUrl }, evm: { rpcUrl, chainId, finalizedHash } | null, explorer, observedAt }`. Throws on timeout.

### `readRegistry({ releaseId?, owner?, label?, reviewer?, reviewers? })` → registry read

Reads `releaseOf` and one `decisionOf` per reviewer at one finalized block through both interfaces: `{ address, releaseId, block, observedAt, release: { exists, owner, revision, reportHash }, decision, decisions: { [reviewer]: { reviewer, reviewed, approved } }, interfacesAgree, views }`. Throws on timeout or when a native call fails.

### `readTokenList({ token })` → listing read

Reads `isListed` and `entryOf` of the active VerifiedTokenList at one finalized block through both interfaces, plus the contract identity (`version`, `registry`, `curator`, runtime code hash): `{ token, list, block, listed, entry: { releaseId, reportHash, reviewer } | null, interfacesAgree, views, identity, observedAt }`. To read another deployment, use `collectPolicyInputs` with a policy that names it.

### `checkRelease(plan, { previous?, projectId?, projectName? })` → sealed report

Runs an acceptance plan (`revivecheck/plan`, `normalizePlan`) against the V3 testnet and seals the report. Throws when the first check could not reach the network ("retry, not a result").

### `prepareTransaction({ action, … , from? })` → unsigned call

`action` is `submit`, `review`, `list`, `store` or `remark`. Returns the encoded call for the EVM RPC and for a native `revive.call`; with `from` (an SS58 or H160 address) the contract call is dry-run through ReviveApi and `dryRun` carries `ok`, `revertReason`, `weightRequired`, `maxStorageDeposit`. Listing on the historical v1 deployment is refused.

### `closeConnections()` → Promise

Disconnects every shared connection. Await it before exiting.

## `revivecheck/entry`

`approvedEntry(report)` → `{ entry | null, reason, reportHash, checkpoint }`: the entry a passed native-asset report verified, accepted only when its `token.listing` check confirmed every published field through both interfaces with the claimed values. `compareEntry(configured, approved)` → `{ match, mismatches: [{ field, configured, approved }], reason }`. `entryDecision(configured, report)` combines both into `{ configured, approved, match, mismatches, reason, reportHash, identity, reasons }` where `reasons` is `[]`, `['entry-mismatch:<field>', …]` or `['entry-unverified']`. `canonicalEntry` and `entryIdentity` give the canonical form and its SHA-256. None of these throws.

## `revivecheck/current`

A pure reducer for a consumer's current decision: `initialDecision({ selection, recorded })` → `beginCheck` (withdraws permission, numbers the request) → `settleCheck({ request, evaluation, entry, inputs, policy, report })` or `failCheck({ request, error, kind })`. Answers for an earlier request or another selection are ignored; `changeSelection` orphans an in-flight check.

The settled result carries `validity`, derived by `decisionValidity({ policy, report, inputs, evaluatedAt })` from the evidence itself, never from the evaluation time: `deadlines.report` is `report.completedAt + evidence.maxAgeSeconds`, and `deadlines.observation`, `deadlines.registry` and `deadlines.listing` (the last only when the policy requires a listed consumer entry) are each read's `observedAt + evidence.maxObservationAgeSeconds`. `validUntil` is the earliest required deadline and `limitedBy` names it; when any required timestamp, the report or the policy is missing or invalid, `validUntil` is null, `missing` names what, and the result is not available. The boundary is the evaluator's: valid at `validUntil`, denied one millisecond later; the evaluator's sixty-second allowance for future timestamps adds no grace.

`checkPermission(decision, { now })` → `{ allowed, reason, validUntil, limitedBy, secondsLeft }` checks the clock it is handed, so a business action verifies the deadline at the moment it acts, whatever a timer last did; `reason` is `not-checked`, `checking`, `failed`, `withheld`, `validity-unknown` or `lapsed`. `canAct(decision, { now })` is its boolean. `ageDecision(decision, { now })` marks a result stale once `now` passes its deadline, for display; callers run it on a timer, on visibility changes and at the deadline itself. `describeDecision(decision, { subject, now })` returns words for a screen and tells a report expiry apart from stale reads. None of this detects a change on the chain after the last read; that takes a new check. Used by the public site's Catalog page and the separate consumer example.

## `revivecheck/decision`

`buildDecisionEvidence({ producer, policy, binding, report, evaluation, inputs, configuredEntry })` → a frozen `revivecheck.decision-evidence.v1` document with the outcome (`available`, `status`, `reasons`, per-reason explanations with `who` and `then`, `nextAction`), the entry comparison, every identity hash, the release, the reviewer trust basis, the storage locator, evidence age and expiry, observation freshness, the permission deadline (`validity`, from `decisionValidity`), checkpoints, verified links and QR payloads, and the full policy, binding, report, evaluation and inputs, hashed as `evidenceHash`. Throws when the artifacts do not belong together. `reconstructDecision(document)` re-derives the evaluation, the entry comparison, the outcome and the permission deadline from the document alone and returns `{ ok, checks[], rederived, stated }`. `decisionSheetHtml(document, { qrSvgs })` renders a self-contained HTML sheet. `explainReason(code)` gives the documented meaning, the status it forces, who acts and what happens next for every evaluator and entry reason; `evidenceExpiry(report, policy, now)` gives `expiresAt` and `secondsLeft`; `RENEWAL_STEPS` is the renewal checklist by role.

## `revivecheck/catalog-release`

The business output: a versioned token-catalog release, the release gate's outcome and the reader. Added 2026-10-25 for the product plan's D-03 and D-05. The command `revivecheck-catalog` (installed with the package) wraps these functions: `prepare` (gate and write), `read`, `compare`, `verify`; `examples/release-gate-starter/` in the package is a clean-directory recipe with its CI workflow.

### `buildCatalogRelease({ name, producer, decisions, previous?, generatedAt?, note? })` → frozen `revivecheck.catalog-release.v1`

`decisions` are the pieces of each entry's decision (`{ policy, binding, report, evaluation, inputs, configuredEntry }`, as `buildDecisionEvidence` takes them) or ready-made `{ evidence }` documents; one per subject, all on one network. The release includes exactly the entries whose decision was available and whose permission deadline (`validity.validUntil`, derived from the evidence) had not passed at `generatedAt`; every included field comes from the approved report. The rest are listed under `withheld` with `reasons`, `nextAction` and field-level `diagnostics`. `evidence` embeds every decision-evidence document; `validity` is the earliest included deadline; `previous` chains `version` (previous + 1, else 1) and `previousReleaseHash`; `releaseHash` is the SHA-256 of the document. Throws when a decision does not reconstruct, when two decisions name one subject, or when `previous` is not a release.

### `verifyCatalogRelease(document)` → `{ ok, checks[] }`

From the document alone: schema, hash, version chain, every embedded decision reconstructs, the included entries are exactly the eligible decisions at generation, the withheld list and the validity recompute, one network. Never throws.

### `readCatalogRelease(document, { now?, reads? })` → frozen `revivecheck.catalog-release-read.v1`

Verifies, then decides per included entry at `now`: without `reads`, only the entry's permission deadline is applied (`freshness: 'deadline-only'`, and the result says that chain-state changes since the recorded reads are not checked); with `reads` (per subject address, the shape `collectPolicyInputs` returns), the binding is evaluated again under the release's own policy, the entry compared again and a new deadline derived (`freshness: 'fresh-reads'`). A release that does not verify permits nothing (`release-unverified`); an entry past its deadline is `lapsed`; a subject without reads is `reads-missing`. `usable` and `withheld` carry the entries with reasons and a detail line; `ok` is true when at least one entry is usable.

### `compareCatalogReleases(before, after)` → diff

`added`, `removed` (with the withheld record of `after` when there is one), `changed` (entry fields and evidence identities that differ), `unchanged`, `chained` (whether `after` names `before`), and a summary.

### `releaseDiagnostics(evidence)` → diagnostics[]

For each failed check of the evaluation and each entry mismatch of a decision-evidence document: `pointer` (JSON pointer into the document), `code`, `observed`/`expected` or `configured`/`approved`, the `checkpoint` the observation was made at and its kind, the responsible `role` and the `nextAction`.

### `gateOutcome({ evidence?, release?, error?, subject?, generatedAt? })` → `revivecheck.release-gate-outcome.v1`

The machine-readable result of one gate run: `status` `permitted` (the release includes the subject), `refused` (a known policy or entry refusal), `unknown` (a read was unavailable) or `configuration-error`, with `exitCode` from `EXIT` (0, 1, 2, 3), the reason codes, the diagnostics and the release identity. A refusal and an unavailable node both block publication and stay distinguishable.

### `loadConsumerConfig(config, name?)` → validated configuration

The document the gate reads (`revivecheck-consumer.config.v1`, the one the App's My projects page exports and the separate Token eligibility demo uses): the policy is normalized, `release.{label, owner, releaseId, revision, reportHash, storage}` are required and checked, `entry.address` must be the policy subject, `boundBy` is required, and a policy that requires stored evidence needs `release.storage.extrinsicHash`. Throws naming the field.

### `selectorFrom(read)` → rows

The entries of a read release as token-selector rows (`id`, `label`, `selectable`, `reason`, `entry`), the shape the Token eligibility demo's selector uses.

## Behavior outside the source checkout

The installed package carries no sealed reports and no registry feed. `revivecheck/service` reads the chain only. The MCP server and CLI tools that look a report up by fingerprint (`replay_report`, `compare_reports`, `assess_promotion` by hash) search the current session, then `public/reports/` of a checkout, and only with `REVIVECHECK_PUBLIC_FALLBACK=1` the public site; otherwise they ask for the original report JSON. `read_feed` needs `public/api/registry.json` from a checkout or the same opt-in fallback. The two MCP resources (`revivecheck://lifecycle/reference`, `revivecheck://registry`) are shipped in the package and read from it. `node scripts/verify-artifact.mjs` in the checkout packs the artifact, installs it in an empty project and checks every statement in this section.
