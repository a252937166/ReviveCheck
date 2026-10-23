# Local workspace API

The server binds `127.0.0.1:4173` by default (`PORT` overrides it). API requests require a local host and, when supplied, the matching local `Origin`. Mutations require `Content-Type: application/json`; bodies are limited to 512 KiB. This API has no signing or custody endpoint. The static review viewer uses report JSON or a compressed URL fragment and does not expose this server.

## Endpoints

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/workspace` | — | `{projects,runs,reviews,shares,imports,lifecycleByRun,network,capabilities}` |
| `POST /api/projects` | Project fields including `name` | Created project, HTTP 201 |
| `PATCH /api/projects/:id` | Changed project fields | Updated project; saved runs stay unchanged |
| `POST /api/projects/:id/archive` | `{}` | Archived project; new runs blocked |
| `POST /api/projects/:id/restore` | `{}` | Restored project |
| `POST /api/projects/:id/runs` | `{mode:"live"}` or `{mode:"rehearsal",scenario:"wrong-network"\|"ready"\|"missing-code"}` | New sealed run, HTTP 201 |
| `POST /api/projects/:id/recheck` | `{mode:"live"}` (defaults to live) | New sealed live run; old evidence and reviews unchanged |
| `POST /api/runs/import` | `{run: <original JSON report>}` | `{run,project,imported,lifecycle}`; HTTP 201 new, 200 duplicate |
| `GET /api/runs/:id` | — | Exact saved report after integrity verification |
| `GET /api/runs/:id/export?format=json\|html` | — | Downloadable report; only JSON corresponds to the evidence hash |
| `GET /api/runs/:id/plan` | — | `{plan:run.input,binding,reportHash}` |
| `GET /api/runs/:id/lifecycle` | — | Current local lifecycle for this report |
| `POST /api/runs/:id/shares` | `{method:"fragment"\|"json"\|"public-url",url?:"https://…"}` | Append-only local share-preparation record |
| `POST /api/runs/:id/reviews` | `{reviewer,decision:"accepted"\|"changes-requested",comment}` | New exact-report receipt, HTTP 201 |
| `GET /api/runs/:id/reviews` | — | `{reviews,lifecycle}` |
| `POST /api/reviews/import` | `{review: <receipt JSON>}` | Validated saved receipt; import its exact report first |
| `GET /api/reviews/:id/export` | — | Exact receipt JSON after integrity verification |
| `GET /api/compare?baseline=<runId>&candidate=<runId>` | — | Comparison described below |

Errors return `{error:string}`. Invalid data is HTTP 400, missing resources generally 404, conflicting IDs or archived/busy projects 409, and invalid mutation content type 415. Live checks use a 25-second execution signal; allow additional RPC cleanup time.

## Project and acceptance plan

```json
{
  "name":"My release",
  "release":"v0.1.0",
  "profile":"contract",
  "logicalContractId":"my-app:release-gate",
  "sourceRevision":"git-commit-or-build-reference",
  "contractAddress":"",
  "account":"",
  "expectedChainId":420420777,
  "expectedValue":"42",
  "transactionHash":"",
  "transactionBlockHash":"",
  "assertions":[
    {"id":"approved","label":"Release approved","signature":"approved()","returns":"bool","args":[],"expected":true}
  ]
}
```

Stored projects also have `id`, `createdAt`, `updatedAt`, and `archivedAt` (`null` while active). Existing project fields remain supported. Contract addresses require H160; `account` accepts H160 or native SS58 starting with `5`; transaction fields require 32-byte hashes. Empty deployment, mapping, balance, or transaction evidence cannot silently pass contract acceptance.

`profile` defaults to `contract`. Empty `assertions` retains legacy `value() -> uint256` acceptance using `expectedValue`. Configured assertions replace the legacy value check and aggregate under `contract.assertions`, retaining each result in its evidence. At most eight assertions and four scalar arguments per assertion are supported. Signatures and the single return support `uint256`, `address`, `bool`, `string`, and `bytes32`. Use decimal strings for integers and exactly 32 hex bytes for `bytes32`. Calls are read-only.

For native/EVM asset parity:

```json
{
  "name":"Native asset parity",
  "profile":"native-asset",
  "logicalContractId":"asset-7777",
  "nativeAsset":{"assetId":"7777","holder":""},
  "assertions":[]
}
```

This profile requires a u32 asset ID and runs only the two network checks plus `asset.native-erc20`. It does not require deployment, transaction evidence, or account funding. Empty holder resolves to the asset owner at the checkpoint and is explicitly recorded. Contract assertions are rejected in this profile. Contract plans may optionally add `nativeAsset`; patching `nativeAsset:null` removes that optional configuration. Switching to `native-asset` requires asset settings and an empty assertion list.

`logicalContractId` declares continuity across deployments and does not verify ownership. `sourceRevision` is a declared reference, not proof that deployed bytecode was built from that source.

## Sealed reports and legacy compatibility

A new run contains `schemaVersion:2`, immutable project `input`, checks, timestamps, `network`, `mode`, `scope`, aggregate `status`, `limitations`, `previousRunId`, `trigger`, `binding`, and `evidenceHash`. Trigger is `manual` or `recheck`; recheck creates a different run. Live scope is `portaldot-testnet-readonly`; rehearsal scope is `local-rehearsal`.

Checks use `{id,title,status,observed,expected,remediation,evidence?}`, with `status` one of `passed`, `failed`, `blocked`, or `unknown`. Aggregate status prioritizes failed, then blocked, then inconclusive for unknown/missing acceptance, otherwise passed. Passed rehearsal remains synthetic sample evidence.

`binding` records:

- `plan`/`planHash`: assertion signatures, arguments, expectations, caller, logical identity, and native asset/holder. Labels are excluded.
- `contractAddress`, `codeHash`, declared `sourceRevision`: target deployment and available observed code fingerprint.
- `environment`/`environmentHash`: observed chain/genesis and available runtime spec, transaction/state versions, and constants hash. Application bytecode is excluded from the runtime fingerprint.
- `checkpoint`: finalized block number and native/EVM block hashes when available.

The hash is SHA-256 of the canonical report excluding `evidenceHash`: object keys sorted lexicographically, undefined object properties omitted, array order retained. New sealing derives binding before hashing. Legacy reports without schema/binding remain verifiable and import unchanged. Import validates hash, IDs, timestamps, check consistency, scope, and supplied binding. Exact duplicate import is idempotent; conflicting IDs are rejected. Hash integrity is content consistency, not authenticated RPC truth, ownership, a security audit, or on-chain attestation. HTML is an escaped rendering; its companion JSON is the verifiable artifact.

## Independent lifecycle states

Lifecycle is outside sealed reports and is returned through `lifecycleByRun` or the lifecycle endpoint:

```json
{
  "verification":{"status":"passed","integrity":"valid","scope":"portaldot-testnet-readonly","caveat":"…"},
  "publishing":{"status":"not-shared","count":0,"caveat":"…"},
  "review":{"status":"unreviewed","count":0,"identity":"self-declared","official":false,"reportHash":"…","caveat":"…"},
  "freshness":{"status":"current-snapshot","reasons":[],"caveat":"…"},
  "recheck":{"available":true,"mode":"live","endpoint":"/api/projects/…/recheck"},
  "nextAction":{"kind":"share","label":"Prepare a shareable report","reason":"…","projectId":"…"}
}
```

Verification is `passed`, `failed`, `blocked`, `inconclusive`, `sample`, or `integrity-invalid`. Review never changes verification. Publishing is `not-shared` or `share-prepared`; a local preparation event does not prove hosting, recipient access, or submission.

Freshness is `current-snapshot`, `plan-changed`, `target-changed`, `release-changed`, or `environment-changed`. Actor/asset/assertion changes require a new plan check; target/expected-chain changes require checking that target; source/release changes require checking that version. Later saved live observations may reveal runtime drift. There is no background monitor, and no detected local change does not prove the live environment is unchanged. `nextAction` guides but never executes the next step.

New runs inherit neither reviews nor shares. Existing reports survive edits, archive, restart, and recheck.

## Review receipt interchange

The static viewer and API use exactly this shape:

```json
{
  "schema":"revivecheck.review.v1",
  "id":"unique-safe-identifier",
  "reportHash":"<64 lowercase hex characters>",
  "reviewer":"Self-declared reviewer name",
  "decision":"accepted",
  "comment":"Reviewed the stated scope.",
  "createdAt":"2026-10-23T12:00:00.000Z",
  "identity":"self-declared",
  "receiptHash":"<canonical SHA-256 excluding receiptHash>"
}
```

Extra payload fields are rejected. Reviewer names contain 1–120 characters, comments at most 4,000, timestamps must parse as dates. Import requires the exact intact report first. Exact duplicate receipts are idempotent; conflicting IDs are rejected. Receipts are append-only. The latest appended decision per declared reviewer name is current; any current `changes-requested` takes precedence. Names are unauthenticated and may collide or be impersonated. This is a local workflow opinion, never official or cryptographically authenticated approval.

## Comparison rules

Response: `{baseline,candidate,compatible,reason?,comparisonKind?,inputChanges?,environmentChanges?,caveat?,changes,summary}`. Summary contains `{improved,regressed,unchanged,changed}`. Both reports require valid integrity and matching mode/scope, with the same project or explicit nonempty logical identity.

- `same-target`: same plan/deployment; differences are observations without a causal claim.
- `configuration-correction`: expected network changed; improvement may reflect corrected configuration, not an application code fix.
- `deployment-version`: new address allowed only with the same explicit logical identity and plan. Improved observations do not prove a code fix or source/bytecode correspondence.
- `fixture-scenario`/`runtime-change`: changed rows use `context-changed` and increment `summary.changed`, never improved.
- `assertion-plan-changed`/`target-changed`: changed acceptance/actor/asset, or address replacement without continuity, requires a new baseline. No improvements are reported.

Weakened expectations, changed callers, or changed asset holders cannot claim repair of the previous plan. Rehearsal/live comparisons are rejected. Unknown, missing, or blocked evidence is never ranked as partial success.
