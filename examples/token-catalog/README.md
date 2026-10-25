# Token Catalog: a consumer built on ReviveCheck's documented interfaces

A token-list maintainer keeps a catalog of tokens that wallets and DEX allow-lists read. This example is that catalog, built on nothing but ReviveCheck's public interfaces: the `ReleaseRegistry` and `VerifiedTokenList` ABIs, `lib/service.js` (the same functions behind the MCP server, REST and the CLI) and the policy evaluator in `lib/policy.js`. A token is **available** in the catalog only while its latest binding evaluates to `valid` under the catalog's policy **and** the entry the catalog publishes is exactly the entry the approved report verified. Added 2026-10-24 for review finding F-07; the published-entry invariant and the live v2 lifecycle were added 2026-10-25 for assessment items A-01 and A-03.

## Configurations

| | `config/local.json` | `config/testnet-v2.json` | `config/testnet.json` |
| --- | --- | --- | --- |
| Chain | an in-memory Paris EVM with the compiled ReleaseRegistry and VerifiedTokenList **v2**, and a stub with `decimals() = 6` at pUSD's real precompile address | Portaldot V3 testnet: the deployed registry and the **v2** list at `0xedaf8a25…8df9`, read live through both interfaces | Portaldot V3 testnet: the deployed registry and the historical **v1** list |
| Evidence | sealed from fixture reads, `mode: rehearsal`, `scope: local-rehearsal`, every artifact labelled **SIMULATED** | the reports `eb960cc7…` and `1faef921…`, checked live and stored on-chain at #187058 and #187145 | the sealed pUSD report `cbd78faa…` stored on-chain at #164266 |
| Accounts | A (owner), B (reviewer), C (stranger): fixture accounts controlled by this example | the project's development account owns the release and lists; a separate project-controlled reviewer account signs decisions | the project's development account in every role |
| Writes | in memory, free | twelve live steps recorded on 2026-10-25 with their receipts | none; the 2026-10-23 transactions are preserved as history and new writes to v1 are refused |

A fourth configuration, `config/testnet-v2-wrong-entry.json`, shares the v2 policy and bindings but claims 18 decimals. It exists to show that a valid approval never publishes an entry the report did not approve.

No configuration establishes independent review or adoption. The `roles` block of each configuration says who controls each account, and that text is copied into every catalog document. The two testnet accounts are both controlled by the project: distinct signers show role separation, nothing more.

## The published entry is the approved entry

The catalog does not copy the configured symbol, name or decimals into its output. It derives the published fields (`chainId`, `address`, `symbol`, `name`, `decimals`, `assetId`) from the approved report's own listing, accepted only when the report passed and its `token.listing` check confirmed every field through both interfaces (`approvedEntry` in `lib/catalog.js`). The configuration states what the maintainer intends to publish; `compareEntry` compares the two in canonical form, so address casing and property order never differ. A mismatch withholds the entry under an otherwise valid evaluation and names the field (`entry-mismatch:decimals`); `bind` refuses such a binding before anything is written; a report that approves no complete entry yields `entry-unverified`. Display-only data (`display`) is passed through and marked unverified.

## Run it

```sh
npm ci

# The whole lifecycle on the local chain, checked against the expected sequence (exit 1 on any deviation).
node examples/token-catalog/catalog.js demo --strict

# The v2 catalog: evaluate the bound pUSD release live and write data/testnet-v2/catalog.json.
node examples/token-catalog/catalog.js build --config examples/token-catalog/config/testnet-v2.json

# Acceptance: exit 0 only when every token is available. Live, or from captured inputs.
node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet-v2.json
node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet-v2.json --fixture examples/token-catalog/data/testnet-v2/captures/12-reapprove-r2.inputs.json

# The same inputs under the wrong-entry configuration: valid policy, entry withheld, exit 1.
node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet-v2-wrong-entry.json --fixture examples/token-catalog/data/testnet-v2/captures/12-reapprove-r2.inputs.json

# Bind a new report explicitly (after a new revision was approved). Refused when the configured entry is not the approved one.
node examples/token-catalog/catalog.js bind --config examples/token-catalog/config/testnet-v2.json \
  --token 0x00001e6100000000000000000000000000010000 --report <64-hex> --release-id 0x… --revision 3 \
  --storage-extrinsic 0x… --storage-block 0x…

# Record one live step: evaluate now, capture the inputs, append the step with its receipts to data/testnet-v2/lifecycle.json.
node examples/token-catalog/catalog.js record --config examples/token-catalog/config/testnet-v2.json --step relist-r3 --actor "A (owner)" --action "…" --receipt '{"kind":"list","extrinsicHash":"0x…","blockNumber":"…","blockHash":"0x…","signer":"5…","reportHash":"…"}'

# Publish the catalog's records under public/catalog/<data dir> for the app's Catalog decision page.
node examples/token-catalog/catalog.js publish --config examples/token-catalog/config/testnet-v2.json
```

The demo writes its transcript, bindings, simulated reports and catalog under `artifacts/local/token-catalog/`. `build` and `acceptance` write `catalog.json`, one evaluation per token and `acceptance.json` under the configuration's `data` directory; `--capture <file>` also saves the raw inputs (observation, registry read, listing, stored report) so the same evaluation can be replayed offline. `record` captures automatically under `data/<dir>/captures/`. The signed steps themselves are driven by the repository's terminal helpers (`scripts/registry-write.js`, `scripts/list-token.js`, `scripts/store-evidence.js`, `scripts/fund-account.js`), each with a dry-run, an explicit cap, a journal before sending and a readback through both interfaces.

## The live lifecycle on v2 (2026-10-25)

Recorded in `data/testnet-v2/lifecycle.json`; every receipt is in the public lifecycle records and links to the official explorer from the app.

| Step | Who | What happened | Catalog |
| --- | --- | --- | --- |
| check-r1 | A, operator | check pUSD v1.0.1 live (report `eb960cc7…`), publish, store on-chain at #187058 | unbound |
| submit-r1 | A, operator | revision 1 of `pusd-catalog-v2` at #187069; the operator binds the exact report | recheck-required: approval missing, not listed |
| approve-r1 | B | approves the exact hash at #187095 | recheck-required: not listed |
| wrong-decimals-refused | A | dry-run `list` with 18 decimals: `DecimalsMismatch`, nothing signed | unchanged |
| list-r1 | A | lists pUSD on v2 at #187124 on B's approval | **valid, available** |
| recheck-r2 | A, operator | recheck live (report `1faef921…`), publish, store on-chain at #187145 | valid |
| submit-r2 | A | revision 2 at #187165: approval cleared, v2 un-lists pUSD | recheck-required: revision superseded, approval missing, not listed |
| approve-r2 | B | approves revision 2 at #187181; the catalog still holds the revision-1 binding | recheck-required: revision superseded, not listed |
| rebind-r2 | operator | binds the revision-2 report explicitly | recheck-required: not listed |
| relist-r2 | A | lists again on revision 2 at #187205 | **valid** |
| revoke-r2 | B | requests changes at #187230; the contract un-lists pUSD | recheck-required: approval revoked, not listed |
| reapprove-r2 | B | approves again at #187271 | **valid** |

The local demo (`demo --strict`) still runs the 17-step sequence with a stranger's replacement attempt, a wrong-target report, a runtime change, a node outage, expiry and renewal; those last four conditions were not observed on the testnet and remain labelled simulated.

## Downstream CI

`.github/workflows/token-catalog.yml` runs the strict demo, the v2 acceptance on the inputs captured at step 12 (must pass), the historical v1 acceptance on its captured inputs (must pass), the wrong-entry configuration on the same step-12 inputs (must fail), the step-11 inputs with the approval revoked (must fail), `fixtures/unreachable.inputs.json` (must fail) and `scripts/release-status.js`, all offline. `acceptance.workflow.yml` in this directory is the template a maintainer copies into their own repository to evaluate live on a schedule; it needs network access and fails when the public nodes do not answer, because an unavailable verification is `unknown`, never a pass.

## Files

| Path | What |
| --- | --- |
| `catalog.js` | the entry point: `demo`, `bind`, `build`, `acceptance`, `record`, `publish` |
| `lib/catalog.js` | configuration, the approved-entry derivation and comparison, append-only bindings with superseded-policy history, the catalog document |
| `lib/lifecycle.js` | the scripted local lifecycle and `EXPECTED` |
| `lib/local-chain.js` | the in-memory stand-in chain and fixture reads |
| `config/local.json`, `config/testnet.json`, `config/testnet-v2.json`, `config/testnet-v2-wrong-entry.json` | the configurations with their policies and role labels |
| `data/testnet-v2/` | the v2 bindings (one historical under the first v2 policy), the live catalog, evaluation, lifecycle and per-step captures |
| `data/testnet/` | the historical v1 binding, catalog and evaluation from 2026-10-24 |
| `data/testnet-v2-wrong-entry/` | the withheld-entry demonstration on the step-10 inputs |
| `fixtures/` | the historical v1 captures (pass and the older provenance-less capture) and an unreachable-node fixture (fail) |
| `benchmark/` | the maintainer-task benchmarks behind `docs/VALUE_EXPERIMENT.md` |
