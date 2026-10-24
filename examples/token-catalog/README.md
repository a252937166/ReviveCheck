# Token Catalog: a consumer built on ReviveCheck's documented interfaces

A token-list maintainer keeps a catalog of tokens that wallets and DEX allow-lists read. This example is that catalog, built on nothing but ReviveCheck's public interfaces: the `ReleaseRegistry` and `VerifiedTokenList` ABIs, `lib/service.js` (the same functions behind the MCP server, REST and the CLI) and the policy evaluator in `lib/policy.js`. A token is **available** in the catalog only while its latest binding evaluates to `valid` under the catalog's policy. Added 2026-10-24 for review finding F-07.

It has two configurations:

| | `config/local.json` | `config/testnet.json` |
| --- | --- | --- |
| Chain | an in-memory Paris EVM with the compiled ReleaseRegistry and VerifiedTokenList **v2**, and a stub with `decimals() = 6` at pUSD's real precompile address | Portaldot V3 testnet: the deployed registry and the **v1** list, read live through both interfaces |
| Evidence | sealed from fixture reads, `mode: rehearsal`, `scope: local-rehearsal`, every artifact labelled **SIMULATED** | the sealed pUSD report `cbd78faa…` stored on-chain at #164266 |
| Accounts | A (owner), B (reviewer), C (stranger): fixture accounts controlled by this example | the project's isolated test account in every role |
| Writes | in memory, free | none; the recorded transactions were signed earlier, and a v2 run awaits funding |

Neither configuration establishes independent review or adoption. The `roles` block of each configuration says who controls each account, and that text is copied into every catalog document.

## Run it

```sh
npm ci

# The whole lifecycle on the local chain, checked against the expected sequence (exit 1 on any deviation).
node examples/token-catalog/catalog.js demo --strict

# The testnet catalog: evaluate the bound pUSD release live and write data/testnet/catalog.json.
node examples/token-catalog/catalog.js build --config examples/token-catalog/config/testnet.json

# Acceptance: exit 0 only when every token is available. Live, or from captured inputs.
node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet.json
node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet.json --fixture examples/token-catalog/fixtures/testnet-policy-verified-2026-10-24.inputs.json

# Bind a new report explicitly (after a new revision was approved).
node examples/token-catalog/catalog.js bind --config examples/token-catalog/config/testnet.json \
  --token 0x00001e6100000000000000000000000000010000 --report <64-hex> --release-id 0x… --revision 2 \
  --storage-extrinsic 0x… --storage-block 0x…
```

The demo writes its transcript, bindings, simulated reports and catalog under `artifacts/local/token-catalog/`. `build` and `acceptance` write `catalog.json`, one evaluation per token and `acceptance.json` under the configuration's `data` directory; `--capture <file>` also saves the raw inputs (observation, registry read, listing, stored report) so the same evaluation can be replayed offline.

## The lifecycle the demo runs

| Step | Who | What happens | Catalog |
| --- | --- | --- | --- |
| check v1.0.0, recheck v1.0.1 | A | the 18-decimals entry fails, the 6-decimals entry passes; nothing is bound yet | unbound |
| submit | A, operator | revision 1 of `pusd-token-list` holds the passed report; the operator binds it | recheck-required: approval missing, not listed |
| approve | B | approves the exact hash | recheck-required: not listed by the consumer |
| list | A | lists pUSD in the VerifiedTokenList on B's approval | **valid, available** |
| stranger-replace | C | self-approves an unrelated release, tries `list` and `delist` | both revert with `EntryOwnedByAnother`; still valid |
| revision-2 | A | submits a new report as revision 2 | recheck-required: revision superseded, approval cleared, un-listed |
| approve-r2 | B | approves revision 2 | still recheck-required: the binding names revision 1 |
| rebind-r2 | operator | binds the revision-2 report explicitly | recheck-required: the consumer still carries the old entry |
| relist | A | lists again on revision 2 | **valid** |
| revoke, reapprove | B | requests changes, then approves again | recheck-required, then valid |
| wrong-target | operator | binds a passing report about asset 8888 | recheck-required: wrong target, plan changed |
| runtime-change | fixture node | the node reports runtime 3003 | recheck-required: runtime changed (the contract notices nothing) |
| node-unavailable | fixture node | every read fails | **unknown**: never available |
| expire | clock | 7 days pass | **expired** (the contract still lists the token) |
| renew | A, B, operator | recheck, revision 3, approval, explicit rebinding, relist | **valid** |

`lib/lifecycle.js` exports this sequence as `EXPECTED`; `demo --strict` and `test/token-catalog.test.js` fail when the run deviates from it.

## What is pending

The testnet catalog consumes the v1 `VerifiedTokenList`, whose entry-ownership defect (F-02) is fixed in v2. New v1 listing writes are refused by the application and shared script helper. The local lifecycle already runs on v2. Real v2 transactions on the testnet (deploy, list, a revision, a rebind) wait for about 148 tPOT of testnet funding; see `docs/DEPLOYMENT.md`. The stricter captured testnet inputs (`fixtures/testnet-policy-verified-2026-10-24.inputs.json`) verify the consumer identity at finalized block #177177. Legacy v1 has no `version()` getter; its version is derived only from its recorded address, exact runtime code and agreeing registry/curator reads. Missing getter results remain `null` in the raw evidence.

The original `data/testnet/catalog.json` and `fixtures/testnet-2026-10-24.inputs.json` remain historical evidence. The older fixture lacks the provenance now required and evaluates `unknown`; it must not be presented as a current acceptance pass. A policy also reads `expired` seven days after its bound report unless the release is rechecked, approved again and rebound. Captured acceptance evaluates at the capture's recorded time; use the live command for a current decision.

## Downstream CI

`.github/workflows/token-catalog.yml` runs the strict demo, the acceptance command on the captured inputs (must pass), the acceptance command on `fixtures/unreachable.inputs.json` (must fail) and `scripts/release-status.js`, all offline. `acceptance.workflow.yml` in this directory is the template a maintainer copies into their own repository to evaluate live on a schedule; it needs network access and fails when the public nodes do not answer, because an unavailable verification is `unknown`, never a pass.

## Files

| Path | What |
| --- | --- |
| `catalog.js` | the entry point: `demo`, `bind`, `build`, `acceptance` |
| `lib/catalog.js` | configuration, append-only bindings, the catalog document |
| `lib/lifecycle.js` | the scripted lifecycle and `EXPECTED` |
| `lib/local-chain.js` | the in-memory stand-in chain and fixture reads |
| `config/local.json`, `config/testnet.json` | the two configurations with their policies and role labels |
| `data/testnet/` | the pUSD binding, the live catalog and evaluation from 2026-10-24 |
| `fixtures/` | captured live inputs (pass) and an unreachable-node fixture (fail) |
| `benchmark/` | the maintainer-task benchmark behind `docs/VALUE_EXPERIMENT.md` |
