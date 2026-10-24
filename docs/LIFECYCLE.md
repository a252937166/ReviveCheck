# Release lifecycle on Portaldot V3: the recorded run

The public page draws this lifecycle as one diagram of eight stages: check, recheck, store, submit, approve, consume, promote and watch. Each stage carries this recorded run's result and block link. The studio (`#/try`) runs every stage live from the visitor's browser, and its writes are signed in their own wallet. This file records the reference run, and a later run through the studio itself, with every identifier. Each step can be checked against the official explorers without the page.

The subject is a token-list release we wrote for the walkthrough. It lists the existing testnet asset **7777 (pUSD)** through its ERC-20 precompile, `0x00001E6100000000000000000000000000010000`. The checks read the real chain; the release text is ours. Release v1.0.0 copies the Ethereum default of 18 decimals; v1.0.1 uses the 6 decimals the chain reports.

Explorer links:

- Testnet: <https://scanner-testnet-v3.portaldot.dev>
- V3 Live: <https://scanner-live-v3.portaldot.dev>

## The recorded run, stage by stage

| Stage | Result | Finalized block | Sealed report (SHA-256) |
| --- | --- | --- | --- |
| Check v1.0.0 | **Failed**: `decimals: listed 18, chain 6`. Native/ERC-20 parity passed | testnet [#161715](https://scanner-testnet-v3.portaldot.dev/#/blocks/0xd6e1b9b391f8c9d51c2547c4080901b2ac43bc126ecd94b28274181fdd733e19) | [`49ea0e93…98de71f`](../public/reports/49ea0e93c6163cb37ed5e4a1dc1f2119c8fb4ec8cb5afc3a174df3a3098de71f.json) |
| Recheck v1.0.1 | **Passed** 4/4. Same plan hash, release changed, 1 improved | testnet [#161718](https://scanner-testnet-v3.portaldot.dev/#/blocks/0xcb31158afcc86f9e5c1a03b15788198d41eb582ea159e36ddbc43d507cf00a4d) | [`9707ec92…667c661`](../public/reports/9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661.json) |
| Replay | Replay reproduced **13/13** observations at the report's own block through both interfaces | testnet #161718 (EVM hash `0xf4afdb52…3753d0` via ReviveApi) | same report |
| Submit and approve | **ReleaseGate revision 2** commits `0x9707ec92…667c661`; approved | see below | readback [`bab546b4…9839fcc`](../public/reports/bab546b408c92922b42c2a75e8e1d9facdc286622e702526f58a8303c9839fcc.json) |
| Promote to V3 Live | **Refused**: chain ID 420420777 ≠ 780780777; asset 7777 absent; runtime 3001 ≠ 3002; no official EVM endpoint listed | live [#761215](https://scanner-live-v3.portaldot.dev/#/blocks/0x8d30c9fb2d581d9ec796bd93e1f5fd171e3ca7442a15ee59a2b3953dda92ad2d) | [`5dfe148e…0905966`](../public/reports/5dfe148e10b9084f5c7051a5098ed0d5902f10a2fbb2447dca48667500905966.json) |

Each report opens in the browser reviewer at `?report=<sha-256>#/review`. The reviewer recomputes the fingerprint, and **Replay at its block** re-reads every observation from the chain.

## Final outcome: approval on-chain, reset by each release

`ReleaseGate` (source `contracts/ReleaseGate.sol`, SHA-256 `8a8b703d…68064e6`) is deployed through pallet-revive at `0xf062d47c63613da90e3573e0ee2bba126347f3d3`:

- `submit(hash)` commits a report and clears approval.
- Only the configured reviewer can call `review`.
- The owner and reviewer are the **same isolated test account**, `5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt` (EVM `0x48b9e37a…6b9a6a71b`). The record therefore demonstrates the mechanism, not independent review.

| Event | Native extrinsic | Block |
| --- | --- | --- |
| Deploy (execution helper, 13:27 UTC) | [`0x30642aa5…1d75188a`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0x30642aa5bd5f11508189dfd1f9abfdd1c290386067761f01cf7a52b71d75188a) | #160874 |
| Revision 1 submit: pUSD asset baseline `0x02726742…9dc0d5` | [`0x906d4a31…a2683995`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0x906d4a31647610d07a1dea0c30b75e944a2bc531703733ca4ba949e9a2683995) | #160877 |
| Revision 1 review: approved | [`0x4ccf5a1c…8fe241b7`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0x4ccf5a1c1b53b2b5a174a696109a8c173adebde30efe85901bb7fe2a8fe241b7) | #160880 |
| Revision 2 submit: token list v1.0.1 `0x9707ec92…667c661` | [`0x9a28a929…ca1fc407`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0x9a28a9293b687ae299b01ffbb5658005ac6064742ae847d0805d0b00ca1fc407) | #161790 |
| Revision 2 review: approved | [`0x8366c5aa…f57d2f57`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0x8366c5aaf29078ad7bd2b5c1a054e47579842d8bfbf34e38c0e4a53df57d2f57) | #161839 |

At the revision-2 submit block, #161790, both interfaces returned `reportHash = 0x9707ec92…`, `revision = 2` and `approved = false`. This is the on-chain reset: an approval never covers a new release.

The readback report [`bab546b4…`](../public/reports/bab546b408c92922b42c2a75e8e1d9facdc286622e702526f58a8303c9839fcc.json) passed **7/7 checks** at finalized block [#161858](https://scanner-testnet-v3.portaldot.dev/#/blocks/0xc9bdcd67cf088f0db7005926169e4837a9eb6b0a084ffad4935ccc413e63529d). It includes `owner`, `reviewer`, `revision = 2`, `approved = true` and `reportHash`, each read through both the EVM and native interfaces, plus finality of the review extrinsic. On the public page, the Approve stage's **Read it back now** repeats this readback at the latest block, alongside the registry readback below.

Revision 2 cost **0.03592095535126 tPOT** in native fees: 0.01761106999768 for submit and 0.01830988535358 for review. The submit released the `approved` storage item. The review re-created it, holding up to **3.8415 tPOT** of storage deposit. The cap was 5 tPOT, with each hash journaled before sending. `public/lifecycle/release-gate.json` holds the machine-readable record.

## The shared ReleaseRegistry, and a run through the studio

ReleaseGate has one owner and one reviewer. Visitors therefore use a second, open contract: `ReleaseRegistry` (source `contracts/ReleaseRegistry.sol`, SHA-256 `6ae08245…c466a7`) at `0xe949b200edf070b9d425b206ed24dc8fe5b7d339`. It was deployed in extrinsic [`0xc099451a…aeea`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0xc099451a308eab45a2a29c1f1d628290d067c69250f129ad7aab145235c8aeea) at #162962, with 1,437 bytes of runtime code.

- Anyone can submit a report hash for a release they own; the release ID is `keccak256(abi.encode(owner, label))`.
- Anyone can review the current revision by naming the report hash they read.
- Each submission opens a new revision, so an earlier decision never covers a newer report.

On 2026-10-23 the whole lifecycle was driven through the studio's real UI in headless Chromium:

- A test-only Polkadot extension was injected into the page. Its signer forwarded each payload to a local process that held the isolated project test wallet.
- That process signed at most three payloads, and only a `revive.call` to this registry or a ReviveCheck review remark.
- The owner and reviewer are again one test account.

| Stage | Result | Block | Evidence |
| --- | --- | --- | --- |
| Check v1.0.0 | **Failed**, as designed | testnet #163478 | [`7f01ed85…b1dc14`](../public/reports/7f01ed85594c47523d44ecf4f87c3e42da920bff9925a33f4cd6fc0686b1dc14.json) |
| Recheck v1.0.1 | **Passed**; 1 improved, 3 unchanged, same target | #163480 | [`cbd78faa…8ed427`](../public/reports/cbd78faa85f8759860d88366794e0c70052b74f9ed775be5bb37ad20118ed427.json) |
| Replay | **13/13** reproduced at #163480 | #163480 | same report |
| Submit | Revision 1 of `pusd-token-list`, report `0xcbd78faa…8ed427` | [#163485](https://scanner-testnet-v3.portaldot.dev/#/blocks/0x5818f2cd19c2307868c45dba3be777d7744c8e2f58bbd8331cdd1b169b897487) | extrinsic [`0x8b2d357e…9e8bec9`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0x8b2d357ed411278e9fc79edbb87574924aa76cd10f3a96261c2b8d7979e8bec9) |
| Approve | `decisionOf` read back as reviewed and approved through both interfaces | [#163489](https://scanner-testnet-v3.portaldot.dev/#/blocks/0x9735187f65cb7cc841c1617abb6ce15ae060a45903c759010596b47a8b383256) | extrinsic [`0xee40fcec…313a05aa`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0xee40fcecedfd4b958756e6be14ec26439b8021b47cc0a6832014c324313a05aa) |
| Remark | `revivecheck:1:review:accepted:cbd78faa…`, verified | [#163493](https://scanner-testnet-v3.portaldot.dev/#/blocks/0x2b562f76539b4428b78354077e8cd98e75560b264e51ecc5d94211e00d82d881) | extrinsic [`0xf9f0b295…1fdd686`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0xf9f0b295e89528b906947969172032c207ac58d687004ff2dd29dd0651fdd686) |
| Promote | **Refused** by V3 Live | live #763020 | [`189aa2e9…734612`](../public/reports/189aa2e966070829412d586f4811b520c2e88a867c2d003f5ef260fd8a734612.json) |
| Watch | Recheck at a later head: same target, same runtime | #163525 | [`17baad39…903377`](../public/reports/17baad394b7c6df801a6c5d4e72d29202535d0e9f4b861623208f05fd2903377.json) |

`scripts/record-studio-run.js` published the session. Before writing anything, it re-read the registry from the chain: at #163561 both interfaces returned revision 1, report hash `0xcbd78faa…`, and an approval. It also re-verified the remark. `public/lifecycle/studio-run.json` holds the machine-readable record.

Two public-RPC timeouts during the run, one at the first check and one at promotion, surfaced in the UI as retries and recorded nothing. The retries passed.

## The consumer and the evidence store

`VerifiedTokenList` (sources `contracts/ReviveCheckGuard.sol` and `contracts/VerifiedTokenList.sol`, SHA-256 `7febe106…be31c69`, 2,116 bytes of runtime code) is the registry's reference consumer. It lists a token only from the release owner, only while the named reviewer's approval of the exact report stands on the current revision, and only if the token contract itself reports the claimed decimals. `isListed` re-reads the registry on every call, so a new revision un-lists the token until it is approved again.

| Event | Native extrinsic | Block |
| --- | --- | --- |
| VerifiedTokenList deployed (code deposit 178.158 tPOT, fee 0.253 tPOT) | [`0xe3efb1e7…f56570`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0xe3efb1e79d8544a42aa1ee4472c291e1f61538b1c6a2346ae9746ee004f56570) | #164220 |
| pUSD listed on release `0xe3f6ab77…f808`, report `0xcbd78faa…8ed427`, reviewer `0x48b9e37a…a71b`, 6 decimals | [`0x395e5fce…494f8d`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0x395e5fce8acd48d8e6036c12a2b7da1eebf7c10426c053970f367afeb7494f8d) | #164313 |

The readback at #164313 returned `isListed(pUSD) = true` through both the EVM RPC and ReviveApi. The contract address is `0xd0bd833b4b8658b1230a0e9a99640935b3c65819`; its curator is open, so each lister names the reviewer their listing relies on.

The sealed reports themselves are stored on Portaldot through the native Remark module (`remark.store`). The block keeps the bytes; `Remark.Stored` carries the publisher and the blake2-256 of the bytes. Retrieval re-reads the extrinsic from a canonical finalized block, checks that event, parses the report and recomputes its SHA-256.

| Report | Bytes | Content hash | Native extrinsic | Block |
| --- | --- | --- | --- | --- |
| `cbd78faa…8ed427` (studio recheck) | 7,404 | `0x99c9307f…5a4e3e` | [`0x14b66988…5520ac`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0x14b66988c9b160c1442485eae729ec92731fedd45820f8b63718f2c6405520ac) | #164266 |
| `9707ec92…67c661` (reference recheck) | 7,404 | `0x18f02767…efe237` | [`0xfac6d3d2…1cbe04`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0xfac6d3d2761091c9ed678a5fc590d6a3f7fcb6403fc79bfbf9ba9493711cbe04) | #164335 |

Each store cost 0.7515 tPOT. `public/lifecycle/evidence.json` and `public/lifecycle/token-list.json` hold the machine-readable records, and `public/api/registry.json` is the feed built from the explorer's event index by `scripts/index-registry.js`.

## Visitor attestation

Any reviewer can record their own decision from their wallet as `System.remark_with_event`:

```
revivecheck:1:review:accepted:<64-hex report SHA-256>
```

The studio's Approve stage and the reviewer show the exact remark and a fee estimate before the wallet asks for a signature. The decision can also be signed elsewhere, such as Polkadot.js Apps, and its extrinsic hash pasted in to verify. Verification reads the block and requires all of the following:

- a signed `system.remarkWithEvent` with `ExtrinsicSuccess`
- a `System.Remarked` event whose sender and BLAKE2-256 digest match the signer and remark
- a canonical, finalized block

## Environment watch

These are runtime upgrades, found by bisecting `state_getRuntimeVersion`:

- **Testnet:** 3000 → 3001 at [#50000](https://scanner-testnet-v3.portaldot.dev/#/blocks/0xcad07ddff0ca7d0f647b1438243082f4ac266cbfec6a03a7daae51af643be494); 3001 → 3002 at [#57052](https://scanner-testnet-v3.portaldot.dev/#/blocks/0x2f72b0eb30b9046271b12d05f188a6a50e11a8e60f7d86010d1c0b11b50980c5).
- **V3 Live:** 3000 → 3001 at [#660453](https://scanner-live-v3.portaldot.dev/#/blocks/0xd1f3a302074a2eef290af27995783d9a3ff2abe36e91a15e45df6263e4f5aa2d). Genesis is `0x6e7f1f24…cdbbc36`, chain ID 780780777, token POT.

The two networks expose the same 69 pallets and runtime APIs. Their revive constants differ only in chain ID. The official explorer configuration lists no EVM endpoint for V3 Live, so its ERC-20 reads are reported as blocked rather than assumed.

## Reproduce from a terminal or an agent

The same capabilities are tools: `npm run rc -- <tool>` in a terminal, `npm run mcp` for an MCP client, or `POST /api/tools/<tool>` on the local workbench. See [INTEGRATION.md](INTEGRATION.md).

```sh
npm run rc -- check_release --release v1.0.0
npm run rc -- read_registry --releaseId 0xe3f6ab7784cbaa8f60171e5201fea4e27fa5cec3d6682e06d8fcb7d89181f808 --reviewer 0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b
npm run rc -- token_list_status --token 0x00001E6100000000000000000000000000010000
npm run rc -- retrieve_evidence --extrinsicHash 0x14b66988c9b160c1442485eae729ec92731fedd45820f8b63718f2c6405520ac
npm run rc -- verify_attestation --extrinsicHash 0xf9f0b295e89528b906947969172032c207ac58d687004ff2dd29dd0651fdd686
node scripts/deploy-token-list.js                                     # dry run of the consumer deployment
node scripts/store-evidence.js --report <published report hash>       # store estimate, nothing signed
node scripts/list-token.js                                            # listing dry run
node scripts/index-registry.js                                        # rebuild public/api/registry.json

node scripts/run-lifecycle.js                 # read-only; writes artifacts/local/lifecycle/
node scripts/replay-report.js 9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661
node scripts/gate-revision.js --report <passing report hash>          # dry run, nothing signed
node scripts/attest-report.js --report <published report hash>        # remark estimate, nothing signed
```

`--publish`, `--broadcast` and an explicit cost cap are required before anything is written or signed.

The public RPC nodes were intermittently slow on 2026-10-23. Native WebSocket handshakes took 6 seconds to over 60 seconds, with Cloudflare 525 errors. A step that cannot reach a node is reported as a retry, never a result, and the header falls back to the explorer index for the finalized height.
