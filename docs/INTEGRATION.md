# Integrate ReviveCheck

ReviveCheck has three components: the ReleaseRegistry middleware with its ReviveCheckGuard library and the VerifiedTokenList consumer, an evidence store on the native Remark module with a public feed, and a verification API. The public site's docs page renders this guide with copyable examples (`#/docs`). Every capability has one implementation, in `lib/service.js`. It is reachable four ways:

| Route | Where | Use it for |
| --- | --- | --- |
| MCP server | `mcp/server.js`, stdio | Agents such as Claude Code and Claude Desktop |
| REST | `POST /api/tools/<name>` on the local workbench (loopback only) | Scripts and local tools |
| JavaScript | `import … from './lib/service.js'` (Node 22+ or a browser bundle) | Apps and tests |
| CLI | `npm run rc -- <tool> --key value` | Terminals and CI |

All four are read-only. A transaction is prepared and dry-run by `prepare_transaction`, then the user signs it in their own wallet. No route ever holds a key. The public studio (`#/try`) runs the same service in the browser.

```sh
git clone https://github.com/a252937166/ReviveCheck
cd ReviveCheck
npm install
```

## Products

### Middleware: gate your contract on the registry

```solidity
import {IReleaseRegistry, ReviveCheckGuard} from "./ReviveCheckGuard.sol";

contract MyLaunchpad {
    using ReviveCheckGuard for IReleaseRegistry;
    IReleaseRegistry constant registry = IReleaseRegistry(0xe949b200edf070b9d425b206ed24dc8fe5b7d339);

    function enable(bytes32 releaseId, bytes32 reportHash, address reviewer) external {
        registry.requireApproved(releaseId, reviewer, reportHash); // ReleaseNotApproved / ReportMismatch
    }
    function quorum(bytes32 releaseId, bytes32 reportHash, address[] memory reviewers) external view returns (bool) {
        return registry.approvals(releaseId, reportHash, reviewers) >= 2; // distinct reviewers of this exact report; [A, A] counts once
    }
}
```

`VerifiedTokenList` at `0xd0bd833b4b8658b1230a0e9a99640935b3c65819` is the reference consumer: `list(token, releaseId, reportHash, reviewer, decimals)` and `isListed(token)`. Its curator is open, so each lister names the reviewer the listing relies on; a curated deployment passes a reviewer to the constructor. The testnet deployment is v1: it never checked who owned an existing entry, so any release owner could replace any token's entry with their own approved release (2026-10-24 review, finding F-02). The v2 source in `contracts/` lets only the owner of the release an entry names, or the curator, replace or `delist` it, with regression tests in `test/verified-token-list.test.js`; the v1 sources stay under `contracts/deployed/v1` and still hash to the deployment record. v2 awaits its own deployment and code deposit; the deployment is driven by a validated manifest, estimated on 2026-10-24 at 226.37 tPOT committed (225.738 held, 0.316 fee) against 78.79 tPOT available, see [DEPLOYMENT.md](DEPLOYMENT.md). A consumer built on these interfaces, the Token Catalog, is under `examples/token-catalog/`.

### Storage: evidence on Portaldot

```sh
node scripts/store-evidence.js --report <hash>                          # estimate
node scripts/store-evidence.js --report <hash> --broadcast --max-fee-tpot 2
npm run rc -- retrieve_evidence --extrinsicHash 0x14b66988c9b160c1442485eae729ec92731fedd45820f8b63718f2c6405520ac
node scripts/index-registry.js                                          # rebuild public/api/registry.json
```

A report is stored with `remark.store`; `Remark.Stored` carries the publisher and the blake2-256 of the bytes. Retrieval checks the event, parses the report and recomputes its SHA-256. About 0.1 tPOT per KB.

### API

The thirteen tools below. `prepare_transaction` covers `submit`, `review`, `list`, `store` and `remark`; `evaluate_policy` decides whether a consumer may act on a release ([POLICY.md](POLICY.md)).

## MCP server

```sh
# Claude Code
claude mcp add revivecheck -- node /absolute/path/to/ReviveCheck/mcp/server.js
```

```json
{ "mcpServers": { "revivecheck": { "command": "node", "args": ["/absolute/path/to/ReviveCheck/mcp/server.js"] } } }
```

The server exposes thirteen read-only tools and two resources:

- `revivecheck://lifecycle/reference`: the recorded run.
- `revivecheck://registry`: the ReleaseRegistry record with its ABI.

A report produced in a session can be passed by hash to later calls. When a call reaches a slow public node, the server sends a progress notification every 8 seconds. A client that resets its timeout on progress keeps waiting.

## REST

```sh
npm run dev                                   # http://127.0.0.1:4173
curl -s http://127.0.0.1:4173/api/tools       # list
curl -s http://127.0.0.1:4173/api/tools/check_release \
  -H 'Content-Type: application/json' -d '{"release":"v1.0.1"}'
```

The request body is the tool's arguments, validated by the same schema as MCP. Unknown fields are rejected. The API accepts loopback requests only.

## Tools

| Tool | Does | Arguments |
| --- | --- | --- |
| `network_status` | Reads the finalized head, runtime and identity of the testnet or V3 Live. On the testnet it adds the EVM chain ID and the EVM hash of that block. | `network` |
| `check_release` | Checks a release at one finalized block through both interfaces and seals a SHA-256 report. | `release` (demo `v1.0.0` or `v1.0.1`) or `plan`; `previousReportHash`; `includeReport` |
| `get_report` | Loads a report by hash from this session, this checkout or the public site, and recomputes its SHA-256. | `reportHash` or `report` |
| `replay_report` | Re-reads every observation at the report's pinned block. | `reportHash` or `report` |
| `compare_reports` | Lists which checks changed between two reports of one target, and why the comparison is valid. | `baselineHash`, `candidateHash` |
| `assess_promotion` | Asks V3 Live whether a passed testnet report can stand there, and seals a promotion report. | `reportHash` or `report` |
| `read_registry` | Reads a release, and optionally one reviewer's decision, through the EVM RPC and ReviveApi at one finalized block. | `releaseId`, or `owner` and `label`; `reviewer` |
| `prepare_transaction` | Builds an unsigned registry `submit` or `review`, a token-list `list`, a `store` of a report, or a review remark. With `from`, a contract call is dry-run. | `action`, `reportHash`, `label`, `releaseId`, `approved`, `decision`, `token`, `reviewer`, `decimals`, `from` |
| `retrieve_evidence` | Retrieves a report stored through `remark.store` and verifies both hashes. | `extrinsicHash`, `blockHash`, `expectedHash` |
| `token_list_status` | Reads a token's listing in the VerifiedTokenList through both interfaces. | `token` |
| `list_releases` | The public feed: releases, decisions, listings and stored reports. | `owner`, `label` |
| `verify_attestation` | Verifies a review remark from chain data alone. | `extrinsicHash`, `blockHash` |
| `evaluate_policy` | Decides whether a consumer may act on a release: a policy (network and genesis, subject, plan fingerprint, supported runtimes, evidence age, trusted reviewers, consumer, stored report) and a binding (exact report, release, revision) against fresh reads. Returns `valid`, `recheck-required`, `expired` or `unknown`; only `valid` enables. | `policy`, `binding`, `reportHash` or `report` |

## Capabilities

### Check a release

```sh
npm run rc -- check_release --release v1.0.0     # fails: decimals listed 18, chain 6
```

```js
import { checkRelease, checkDemoRelease } from './lib/service.js';
const report = await checkDemoRelease('v1.0.0');
const mine = await checkRelease({ name: 'My token list', release: 'v2.0.0', profile: 'native-asset', logicalContractId: 'token-list:my',
  nativeAsset: { assetId: '7777' }, listing: { chainId: 420420777, address: '0x00001E6100000000000000000000000000010000', symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6 } });
```

- **Needs:** the official testnet RPCs. No wallet.
- **Shows:** what both interfaces returned at the pinned block. The sealed hash also detects any later change to the report.
- **Does not show:** that the RPC operators are honest, or that the release is a good idea.

### Recheck and compare

```sh
npm run rc -- check_release --release v1.0.1 --previousReportHash 49ea0e93c6163cb37ed5e4a1dc1f2119c8fb4ec8cb5afc3a174df3a3098de71f
npm run rc -- compare_reports --baselineHash 49ea0e93c6163cb37ed5e4a1dc1f2119c8fb4ec8cb5afc3a174df3a3098de71f --candidateHash 9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661
```

A comparison first names the kind of change: same target, configuration correction, new deployment, runtime change or changed plan. Only then does it count improvements. An improvement records a difference, not its cause.

### Replay

```sh
npm run rc -- replay_report --reportHash 9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661
```

The replay re-reads every observation at the report's own block, from native storage and from the EVM RPC at the mapped EVM block hash. It returns recorded and replayed values side by side.

### Submit to the ReleaseRegistry

```sh
npm run rc -- prepare_transaction --action submit --label pusd-token-list \
  --reportHash 9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661 --from <SS58 or H160>
```

The result carries:

- `to` and `data`;
- `evm`: parameters for `eth_sendTransaction`;
- `native.args`: `dest`, `weightLimit` and `storageDepositLimit` for `revive.call`;
- `dryRun`: `ok`, `revertReason`, `maxStorageDeposit` and `sender`;
- `releaseId`, which is `keccak256(abi.encode(owner, label))`.

A first submit reserves up to about 7.7 tPOT of storage deposit, plus a small fee.

```js
// Polkadot wallet (extension signer)
await api.tx.revive.call(tx.to, 0, tx.native.args.weightLimit, tx.native.args.storageDepositLimit, tx.data).signAndSend(from, { signer });
// EVM wallet
await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data }] });
```

### Approve on-chain

```sh
npm run rc -- prepare_transaction --action review --releaseId <id> --reportHash <current hash> --approved true --from <reviewer>
npm run rc -- read_registry --releaseId 0xe3f6ab7784cbaa8f60171e5201fea4e27fa5cec3d6682e06d8fcb7d89181f808 --reviewer 0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b
```

The reviewer names the report hash they read. A decision on a superseded report reverts with `StaleReport`. A new submission starts a new revision, so an earlier decision never covers a newer report. `read_registry` returns each view from both interfaces and `interfacesAgree`.

### Attest with a remark, and verify any remark

```
system.remarkWithEvent("revivecheck:1:review:<accepted|changes-requested>:<64-hex report hash>")
```

```sh
npm run rc -- verify_attestation --extrinsicHash 0xf9f0b295e89528b906947969172032c207ac58d687004ff2dd29dd0651fdd686
```

Verification requires all of the following:

- a signed, successful `system.remarkWithEvent`;
- a `System.Remarked` event whose sender and BLAKE2-256 digest match;
- a canonical, finalized block.

It authenticates an account, not a person.

### Assess promotion to V3 Live

```sh
npm run rc -- assess_promotion --reportHash 9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661
```

V3 Live is read directly: its identity, the chain the release names, the runtime, and whether the asset exists there. The official explorer configuration lists no EVM endpoint for V3 Live, so ERC-20 reads there are reported as blocked.

### Watch the networks

```sh
npm run rc -- network_status --network live
# In CI: fail when the testnet runtime moves past the one your reports pinned.
npm run rc -- network_status | grep -q '"runtime": "portaldot-v3/3002"'
```

There is no background watcher. A recheck runs when you or your CI start it.

### Decide with a policy

```sh
npm run rc -- evaluate_policy --policy "$(cat examples/token-catalog/config/testnet-v2.json | jq -c .policy)" \
  --binding "$(jq -c '.bindings[-1]' examples/token-catalog/data/testnet-v2/bindings.json)"
```

```js
import { evaluatePolicy } from './lib/service.js';
const evaluation = await evaluatePolicy({ policy, binding, report });
// evaluation.status: valid | recheck-required | expired | unknown; evaluation.enable; evaluation.reasons
```

The service reads the network observation, the registry for every trusted reviewer, the consumer listing when the policy requires it and the stored report when it requires that, in one call, then evaluates. A read that fails comes back as `unknown` rather than throwing. The policy, binding and evaluation formats, every reason code and the rules (explicit reviewer trust, new approval plus explicit rebinding for a new report, expiry as a policy clock, drift detected only from a fresh observation) are in [POLICY.md](POLICY.md). The Token Catalog under `examples/token-catalog/` is the worked consumer.

### Publish only the approved entry, and show the decision

A consumer that publishes an entry derives the verified fields (chain, address, symbol, name, decimals, asset) from the approved report, never from its own configuration: a passed native-asset report carries the listing it checked and a `token.listing` check with every field confirmed through both interfaces. The Token Catalog implements that with `approvedEntry` and `compareEntry` (`examples/token-catalog/lib/catalog.js`): a configured entry that differs is refused at `bind` and withheld at `build` with the field named, even when the policy evaluation is `valid`. Its `record` command appends each live step with its receipts to `lifecycle.json`, and `publish` copies the catalog's records under `public/catalog/` for the app's Catalog decision page (`#/app/catalog`), where a reader sees the published entry against the approved report, the on-chain approval, the listing, the policy verdict and reasons, evidence age against the policy clock, checkpoints, the next action and the binding history, and can evaluate again in the browser without a wallet.

In the studio, a saved listing receipt is bound to the network and genesis, the consumer address and version, the token, the release, the exact report and revision and the reviewer (`src/receipts.js`). A receipt that does not match the operation in front of the visitor is history, not completion; a superseded revision makes it history without rewriting it; Listed requires a matching readback through both interfaces, never inclusion alone.

## VerifiedTokenList and ReviveCheckGuard

| | |
| --- | --- |
| Address (v2, active) | `0xedaf8a25bb583ad164a94191b762414277198df9` (V3 testnet), curator open |
| Deployed | block #177,354, extrinsic [`0xb0264f2b…beabab`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0xb0264f2bd82e55a791a21c265f1188c112c5b0b7bda60d5fe558666cbee5abab), code deposit up to 225.738 tPOT, nine verification checks; record `public/lifecycle/token-list-v2.json` |
| Listings | pUSD on release `pusd-catalog-v2`: #187,124 (revision 1) and #187,205 (revision 2), reviewer `0x95db300103ec8b45884b13ed85230fbf02114065` |
| Sources | `contracts/ReviveCheckGuard.sol`, `contracts/VerifiedTokenList.sol`, SHA-256 `e710ec145dcc8fae642218657725348c2c00d3c7686c88178344020a11768d1f` |
| Compiler | solc 0.8.24, Paris, optimizer 1; 2,726 bytes of runtime code |
| v1, historical | `0xd0bd833b4b8658b1230a0e9a99640935b3c65819`, block #164,220, sources under `contracts/deployed/v1` (SHA-256 `7febe106…be31c69`), pUSD listed at #164,313; any release owner could replace an entry (review F-02), so new writes to it are refused |

```solidity
library ReviveCheckGuard {
  function isApproved(IReleaseRegistry, bytes32 id, address reviewer, bytes32 reportHash) internal view returns (bool);
  function approvals(IReleaseRegistry, bytes32 id, address[] memory reviewers) internal view returns (uint256);                     // distinct reviewers who approved the current revision
  function approvals(IReleaseRegistry, bytes32 id, bytes32 reportHash, address[] memory reviewers) internal view returns (uint256); // the same, zero unless the current report is reportHash
  function requireApproved(IReleaseRegistry, bytes32 id, address reviewer, bytes32 reportHash) internal view;
}
contract VerifiedTokenList {
  function list(address token, bytes32 releaseId, bytes32 reportHash, address reviewer, uint8 decimals) external;
  function isListed(address token) external view returns (bool);
  function entryOf(address token) external view returns (bytes32 releaseId, bytes32 reportHash, address reviewer);
  function delist(address token) external;                                  // v2: the entry's release owner, or the curator
  function version() external pure returns (uint8);                         // v2
}
```

## ReleaseRegistry

| | |
| --- | --- |
| Address | `0xe949b200edf070b9d425b206ed24dc8fe5b7d339` (V3 testnet, chain 420420777) |
| Deployed | block #162,962, extrinsic [`0xc099451a…aeea`](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/0xc099451a308eab45a2a29c1f1d628290d067c69250f129ad7aab145235c8aeea) |
| Source | `contracts/ReleaseRegistry.sol`, SHA-256 `6ae08245bc8e5baa5c16643305c0db3704eff85dc0fb70ff337bf17600c466a7` |
| Compiler | solc 0.8.24, Paris, optimizer 200; 1,437 bytes of runtime code |

```solidity
function releaseId(address owner, bytes32 name) pure returns (bytes32)
function submit(bytes32 name, bytes32 reportHash) returns (bytes32 id, uint64 revision)
function review(bytes32 id, bytes32 reportHash, bool approved)
function releaseOf(bytes32 id) view returns (address owner, uint64 revision, bytes32 reportHash)
function decisionOf(bytes32 id, address reviewer) view returns (bool reviewed, bool approved)
error EmptyName(); error EmptyReport(); error UnknownRelease(); error StaleReport();
```

Anyone can submit a release they own, and anyone can review the current revision. A decision records the reviewer's opinion, not the truth of the report.

## Networks

| | Testnet | V3 Live |
| --- | --- | --- |
| Native RPC | `wss://test-node-v3.portaldot.dev` | `wss://live-v3-node.portaldot.dev` |
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` | None listed |
| Chain ID | 420420777 (`0x190f1ca9`) | 780780777 |
| Explorer | <https://scanner-testnet-v3.portaldot.dev> | <https://scanner-live-v3.portaldot.dev> |

The public nodes can take tens of seconds to hand out metadata on first contact. The service reuses one connection per network.
