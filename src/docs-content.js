// Integration docs, one entry per product and capability. Every example is a real
// command against this repository; outputs are trimmed from real runs on 2026-10-23.
const REG = '0xe949b200edf070b9d425b206ed24dc8fe5b7d339';
const LIST = '0xd0bd833b4b8658b1230a0e9a99640935b3c65819';
const PUSD = '0x00001E6100000000000000000000000000010000';
const PASSED = '9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661';
const FAILED = '49ea0e93c6163cb37ed5e4a1dc1f2119c8fb4ec8cb5afc3a174df3a3098de71f';
// From the studio run and the records that followed: the project test wallet's release.
const RELEASE = '0xe3f6ab7784cbaa8f60171e5201fea4e27fa5cec3d6682e06d8fcb7d89181f808';
const STUDIO_REPORT = 'cbd78faa85f8759860d88366794e0c70052b74f9ed775be5bb37ad20118ed427';
const OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const REMARK_TX = '0xf9f0b295e89528b906947969172032c207ac58d687004ff2dd29dd0651fdd686';
const STORE_TX = '0x14b66988c9b160c1442485eae729ec92731fedd45820f8b63718f2c6405520ac';
const LIST_TX = '0x395e5fce8acd48d8e6036c12a2b7da1eebf7c10426c053970f367afeb7494f8d';
const rest = (tool, body) => `curl -s http://127.0.0.1:4173/api/tools/${tool} \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(body)}'`;
const mcp = (tool, args) => `${tool}\n${JSON.stringify(args, null, 2)}`;

export const SETUP = [
  {
    id: 'start', title: 'Overview and install',
    body: [
      'ReviveCheck is release attestation middleware for Portaldot V3. It has three components: a ReleaseRegistry contract that other contracts read through the ReviveCheckGuard library, an evidence store that writes sealed reports to the chain through the native Remark module, and a verification API that checks releases through both V3 interfaces. The API is one implementation in lib/service.js, served over MCP for agents, REST on the local workbench, as a JavaScript module and as a CLI.',
      'Every route is read-only. Transactions are prepared and dry-run, then signed in the user’s own wallet. The public site runs the same service in the browser, so anything in the studio can be scripted.',
    ],
    code: [{ title: 'Install', code: 'git clone https://github.com/a252937166/ReviveCheck\ncd ReviveCheck\nnpm install\nnpm test' }],
  },
  {
    id: 'mcp', title: 'MCP server',
    body: [
      'mcp/server.js speaks the Model Context Protocol over stdio. It exposes twelve read-only tools and two resources: the recorded lifecycle and the ReleaseRegistry record with its ABI. Reports produced in a session can be referenced by hash in later calls.',
      'A call that reaches a slow public node sends progress notifications every 8 seconds, so clients that reset their timeout on progress keep waiting.',
    ],
    code: [
      { title: 'Claude Code', code: 'claude mcp add revivecheck -- node /absolute/path/to/ReviveCheck/mcp/server.js' },
      { title: 'Claude Desktop · claude_desktop_config.json', code: JSON.stringify({ mcpServers: { revivecheck: { command: 'node', args: ['/absolute/path/to/ReviveCheck/mcp/server.js'] } } }, null, 2) },
      { title: 'Any MCP client', code: 'npm run mcp   # stdio transport; logs go to stderr' },
    ],
  },
  {
    id: 'rest', title: 'REST API',
    body: ['The local workbench serves every MCP tool as JSON over HTTP on 127.0.0.1. The request body is the tool’s arguments; the response is its result. Unknown fields are rejected. It accepts loopback requests only.'],
    code: [{ title: 'Start and list', code: 'npm run dev                       # http://127.0.0.1:4173\ncurl -s http://127.0.0.1:4173/api/tools\n\n# POST /api/tools/<name> with the tool arguments as JSON' }],
  },
  {
    id: 'js', title: 'JavaScript',
    body: ['lib/service.js is an ES module for Node and the browser. It keeps one connection per network and reuses it, because the public nodes are slow to hand out metadata on first contact. In Node, call closeConnections() before exit.'],
    code: [{ title: 'lib/service.js', code: "import { checkDemoRelease, replay, readTokenList, closeConnections } from './lib/service.js';\n\nconst report = await checkDemoRelease('v1.0.1');\nconsole.log(report.status, report.evidenceHash, report.network.finalizedBlockNumber);\nconsole.log((await replay(report)).status);                 // 'reproduced'\nconsole.log((await readTokenList({ token: '" + PUSD + "' })).listed);\nawait closeConnections();" }],
  },
  {
    id: 'cli', title: 'CLI',
    body: ['npm run rc wraps the same tools for a terminal or a CI job. It takes --key value arguments, parses values as JSON where they parse, prints JSON, and exits non-zero on error.'],
    code: [{ title: 'Terminal', code: 'npm run rc                                    # list the tools\nnpm run rc -- network_status --network live\nnpm run rc -- check_release --release v1.0.1\nnpm run rc -- token_list_status --token ' + PUSD }],
  },
];

export const PRODUCTS = [
  {
    id: 'middleware', title: 'Middleware: the ReleaseRegistry and the guard',
    body: [
      'The ReleaseRegistry is an open contract on the V3 testnet. A release owner submits the SHA-256 of a sealed report under a label; the release ID is keccak256(owner, label). Each submission opens a new revision and clears every earlier decision. Any account reviews the current revision by naming the report hash it read; a decision on a superseded hash reverts with StaleReport.',
      'Other contracts consume that state through the ReviveCheckGuard library: isApproved, approvals over a reviewer set, and requireApproved. The VerifiedTokenList is the reference consumer. It lists a token only from the release owner, only while the named reviewer’s approval stands on the current revision, and only if the token contract itself reports the claimed decimals. Its isListed re-reads the registry on every call, so a new revision un-lists the token until it is approved again.',
    ],
    rows: [['ReleaseRegistry', `${REG} · deployed #162,962`], ['VerifiedTokenList', `${LIST} · deployed #164,220 · curator: open (each lister names their reviewer)`], ['Compiler', 'solc 0.8.24, Paris; registry optimizer 200, list optimizer 1'], ['Sources', 'contracts/ReleaseRegistry.sol, contracts/ReviveCheckGuard.sol, contracts/VerifiedTokenList.sol'], ['Live listing', `pUSD ${PUSD} on release ${RELEASE.slice(0, 10)}…, listed in #164,313 and read back through both interfaces`]],
    code: [
      { title: 'Gate your own contract (Solidity 0.8.24)', code: `import {IReleaseRegistry, ReviveCheckGuard} from "./ReviveCheckGuard.sol";

contract MyLaunchpad {
    using ReviveCheckGuard for IReleaseRegistry;
    IReleaseRegistry constant registry = IReleaseRegistry(${REG});

    function enable(bytes32 releaseId, bytes32 reportHash, address reviewer) external {
        registry.requireApproved(releaseId, reviewer, reportHash); // ReleaseNotApproved / ReportMismatch
        // ... act on the approved release
    }

    function stillApproved(bytes32 releaseId, address[] memory reviewers) external view returns (bool) {
        return registry.approvals(releaseId, reviewers) >= 2;      // any quorum you choose
    }
}` },
      { title: 'Read it from anywhere', code: `npm run rc -- read_registry --releaseId ${RELEASE} --reviewer ${OWNER}\nnpm run rc -- token_list_status --token ${PUSD}` },
    ],
  },
  {
    id: 'storage', title: 'Storage: evidence on Portaldot',
    body: [
      'A sealed report is stored on the chain itself with the native Remark module. remark.store keeps the bytes in the block and emits Remark.Stored with the publisher and the blake2-256 of the bytes. Retrieval reads the extrinsic from a canonical finalized block, checks the event against the bytes, parses the report, and recomputes its SHA-256. A 7.4 KB report costs about 0.75 tPOT to store.',
      'The public feed, api/registry.json, is built from the official explorer’s event index: every ReleaseRegistry and VerifiedTokenList event and every stored report, each with its block and extrinsic. It is a convenience; every row names the chain data to re-read.',
    ],
    rows: [['Stored reports', `${STUDIO_REPORT.slice(0, 12)}… in #164,266 (${STORE_TX.slice(0, 14)}…) and ${PASSED.slice(0, 12)}… in #164,335`], ['Feed', 'public/api/registry.json, rebuilt with node scripts/index-registry.js'], ['Module', 'pallet-remark (remark.store), events remark.Stored']],
    code: [
      { title: 'Store and retrieve', code: `node scripts/store-evidence.js --report ${PASSED}            # estimate only\nnode scripts/store-evidence.js --report ${PASSED} --broadcast --max-fee-tpot 2\nnpm run rc -- retrieve_evidence --extrinsicHash ${STORE_TX}` },
      { title: 'Read the feed', code: `curl -s https://a252937166.github.io/ReviveCheck/api/registry.json | jq '.releases[0], .evidence[0]'` },
    ],
  },
  {
    id: 'api', title: 'API: twelve tools, four routes',
    body: [
      'Checks read the native runtime through ReviveApi and the EVM RPC at one finalized block, and seal the result. Promotion reads V3 Live itself. Registry, token-list and evidence reads come back through both interfaces with an interfacesAgree flag. Every write is a prepared, dry-run transaction for the user’s wallet.',
      'The same twelve tools are exposed over MCP, as POST /api/tools/<name> on the local workbench, as lib/service.js, and as npm run rc. See the tool reference below for arguments.',
    ],
    rows: [['Read', 'network_status, check_release, get_report, replay_report, compare_reports, assess_promotion, read_registry, token_list_status, retrieve_evidence, list_releases, verify_attestation'], ['Prepare', 'prepare_transaction: submit, review, list, store, remark'], ['Never', 'signs, holds a key, or writes to the chain on its own']],
    code: [{ title: 'Claude Code', code: 'claude mcp add revivecheck -- node "$PWD/mcp/server.js"' }],
  },
];

export const FEATURES = [
  {
    id: 'check', title: 'Check a release', tool: 'check_release',
    summary: 'Run an acceptance plan against the V3 testnet at one finalized block, through native storage and the EVM RPC, and seal a SHA-256 report.',
    needs: ['Network access to the official V3 testnet RPCs', 'No wallet, no tPOT'],
    shows: 'What both interfaces returned at that block, and that the report is unchanged since sealing.',
    limits: 'It trusts the official RPC operators and does not judge business correctness.',
    tabs: {
      MCP: mcp('check_release', { release: 'v1.0.0' }) + '\n\n# your own native-asset release:\n' + JSON.stringify({ plan: { name: 'My token list', release: 'v2.0.0', profile: 'native-asset', logicalContractId: 'token-list:my', nativeAsset: { assetId: '7777' }, listing: { chainId: 420420777, address: PUSD, symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6 } } }, null, 2),
      REST: rest('check_release', { release: 'v1.0.0' }),
      JavaScript: "import { checkRelease, checkDemoRelease } from './lib/service.js';\n\nconst failed = await checkDemoRelease('v1.0.0');\nconst mine = await checkRelease(plan, { projectId: 'my-token-list' });",
      CLI: 'npm run rc -- check_release --release v1.0.0',
    },
    output: JSON.stringify({ reportHash: FAILED, status: 'failed', release: 'v1.0.0', runtime: 'portaldot-v3/3002', checkpoint: { number: '161715' }, checks: [{ id: 'network.chain-id', status: 'passed' }, { id: 'network.finalized', status: 'passed' }, { id: 'asset.native-erc20', status: 'passed' }, { id: 'token.listing', status: 'failed', observed: 'decimals: listed 18, chain 6' }] }, null, 2),
  },
  {
    id: 'recheck', title: 'Recheck and compare', tool: 'compare_reports',
    summary: 'Check a corrected release as a new report, then compare it with the earlier one. The comparison names the kind of change before it credits a repair.',
    needs: ['Two reports of the same project or logical contract'],
    shows: 'Which checks improved, regressed or stayed the same, and whether the plan, deployment or runtime changed in between.',
    limits: 'An improvement records a difference, not its cause.',
    tabs: {
      MCP: mcp('check_release', { release: 'v1.0.1', previousReportHash: FAILED }) + '\n\n' + mcp('compare_reports', { baselineHash: FAILED, candidateHash: PASSED }),
      REST: rest('compare_reports', { baselineHash: FAILED, candidateHash: PASSED }),
      JavaScript: "import { checkDemoRelease, compare } from './lib/service.js';\n\nconst fixed = await checkDemoRelease('v1.0.1', failed);\nconst diff = compare(failed, fixed);   // diff.summary.improved === 1",
      CLI: `npm run rc -- compare_reports --baselineHash ${FAILED} --candidateHash ${PASSED}`,
    },
    output: JSON.stringify({ compatible: true, comparisonKind: 'same-target', summary: { improved: 1, regressed: 0, unchanged: 3, changed: 0 }, changes: [{ id: 'token.listing', transition: 'improved', before: 'failed', after: 'passed' }] }, null, 2),
  },
  {
    id: 'store', title: 'Store evidence on-chain, retrieve and replay', tool: 'retrieve_evidence',
    summary: 'Write a sealed report to Portaldot through remark.store, retrieve it from any node with both hashes checked, and replay its observations at the pinned block.',
    needs: ['A Polkadot wallet to store (a native extrinsic), about 0.1 tPOT per KB', 'Nothing to retrieve or replay'],
    shows: 'The exact report, from chain data alone, and that the chain still returns its recorded values at that block.',
    limits: 'Storage proves what was sealed and when, not that the sealer read honestly. Replay trusts the same RPC operators.',
    tabs: {
      MCP: mcp('prepare_transaction', { action: 'store', reportHash: PASSED }) + '\n\n' + mcp('retrieve_evidence', { extrinsicHash: STORE_TX, expectedHash: STUDIO_REPORT }) + '\n\n' + mcp('replay_report', { reportHash: PASSED }),
      REST: rest('retrieve_evidence', { extrinsicHash: STORE_TX }),
      JavaScript: "import { prepareTransaction, retrieveEvidence, replay } from './lib/service.js';\n\nconst tx = await prepareTransaction({ action: 'store', report });\nawait api.tx.remark.store(tx.hex).signAndSend(from, { signer });\nconst stored = await retrieveEvidence({ extrinsicHash });   // stored.run, stored.contentHash\nconst result = await replay(stored.run);                    // 'reproduced'",
      CLI: `node scripts/store-evidence.js --report ${PASSED} --broadcast --max-fee-tpot 2\nnpm run rc -- retrieve_evidence --extrinsicHash ${STORE_TX}`,
      'On-chain': 'remark.store(bytes)                 // pallet-remark\nevent remark.Stored(sender, contentHash = blake2_256(bytes))',
    },
    output: JSON.stringify({ verified: true, extrinsicHash: STORE_TX, blockNumber: '164266', finalized: true, publisher: '5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt', length: 7404, contentHash: '0x99c9307f94420db10ebab5bcc9f1a511906add6b0a7383c6d6c011c89e5a4e3e', reportHash: STUDIO_REPORT }, null, 2),
  },
  {
    id: 'submit', title: 'Submit to the ReleaseRegistry', tool: 'prepare_transaction',
    summary: 'Commit a passed report’s hash on-chain. The release ID is keccak256(owner, label); each submission opens a new revision with no approval.',
    needs: ['A Polkadot wallet (Revive.call) or an EVM wallet (eth_sendTransaction)', 'tPOT for the storage deposit: up to about 7.7 tPOT for a first submit, plus a fee'],
    shows: 'Which account committed which report hash, in which block.',
    limits: 'The contract stores a hash; it does not re-run the checks.',
    tabs: {
      MCP: mcp('prepare_transaction', { action: 'submit', label: 'pusd-token-list', reportHash: PASSED, from: '5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt' }) + '\n\n# returns { to, data, evm: { method, params }, native: { pallet, call, args }, dryRun }\n# the user signs it in their wallet; the tool never signs',
      REST: rest('prepare_transaction', { action: 'submit', label: 'pusd-token-list', reportHash: PASSED, from: '0xYourEvmAddress' }),
      JavaScript: "import { prepareTransaction } from './lib/service.js';\n\nconst tx = await prepareTransaction({ action: 'submit', label: 'pusd-token-list', reportHash, from });\n// Polkadot wallet:\nawait api.tx.revive.call(tx.to, 0, tx.native.args.weightLimit, tx.native.args.storageDepositLimit, tx.data)\n  .signAndSend(from, { signer });\n// EVM wallet:\nawait window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data }] });",
      CLI: `npm run rc -- prepare_transaction --action submit --label pusd-token-list --reportHash ${PASSED} --from <address>`,
      'On-chain': `// ReleaseRegistry ${REG}\nfunction submit(bytes32 name, bytes32 reportHash) external returns (bytes32 id, uint64 revision);\nevent ReportSubmitted(bytes32 indexed releaseId, address indexed owner, uint64 indexed revision, bytes32 reportHash, bytes32 name);`,
    },
    output: JSON.stringify({ action: 'submit', to: REG, data: '0xd26ff86e…', releaseId: RELEASE, dryRun: { ok: true, sender: OWNER, maxStorageDeposit: '7.683 tPOT', weightRequired: { refTime: 406009193, proofSize: 22367 }, returned: [RELEASE, '1'] } }, null, 2),
  },
  {
    id: 'approve', title: 'Approve on-chain', tool: 'read_registry',
    summary: 'A reviewer approves or requests changes on the current revision by naming the report hash they read. read_registry reads the result back through both interfaces.',
    needs: ['A wallet, as for submit', 'The release ID and its current report hash'],
    shows: 'Which account decided on which revision and report hash.',
    limits: 'It authenticates an account, not a person or an authority. A decision on a superseded report reverts with StaleReport.',
    tabs: {
      MCP: mcp('prepare_transaction', { action: 'review', releaseId: RELEASE, reportHash: STUDIO_REPORT, approved: true, from: '5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt' }) + '\n\n' + mcp('read_registry', { releaseId: RELEASE, reviewer: OWNER }),
      REST: rest('read_registry', { owner: OWNER, label: 'pusd-token-list', reviewer: OWNER }),
      JavaScript: "import { readRegistry } from './lib/service.js';\n\nconst state = await readRegistry({ releaseId, reviewer });\n// state.release.revision, state.decision.approved, state.interfacesAgree",
      CLI: `npm run rc -- read_registry --owner ${OWNER} --label pusd-token-list --reviewer ${OWNER}`,
      'On-chain': 'function review(bytes32 id, bytes32 reportHash, bool approved) external;\nfunction releaseOf(bytes32 id) external view returns (address owner, uint64 revision, bytes32 reportHash);\nfunction decisionOf(bytes32 id, address reviewer) external view returns (bool reviewed, bool approved);\nerror StaleReport(); error UnknownRelease();',
    },
    output: JSON.stringify({ releaseId: RELEASE, block: { number: '163538' }, release: { exists: true, owner: OWNER, revision: '1', reportHash: `0x${STUDIO_REPORT}` }, decision: { reviewer: OWNER, reviewed: true, approved: true }, interfacesAgree: true }, null, 2),
  },
  {
    id: 'consume', title: 'Consume the approval from a contract', tool: 'token_list_status',
    summary: 'Gate any contract on the registry with the ReviveCheckGuard library. The VerifiedTokenList shows it: a token is listed only while the named reviewer’s approval of the exact report stands.',
    needs: ['A wallet, as for submit, to call list()', 'The token must implement decimals(); the lister must be the release owner'],
    shows: 'That a contract acted on a current approval, and stops when it lapses: isListed turns false the moment a new revision is submitted.',
    limits: 'The guard enforces the registry’s state, not the quality of the review.',
    tabs: {
      MCP: mcp('prepare_transaction', { action: 'list', token: PUSD, releaseId: RELEASE, reportHash: STUDIO_REPORT, reviewer: OWNER, decimals: 6, from: '5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt' }) + '\n\n' + mcp('token_list_status', { token: PUSD }),
      REST: rest('token_list_status', { token: PUSD }),
      JavaScript: "import { prepareTransaction, readTokenList } from './lib/service.js';\n\nconst tx = await prepareTransaction({ action: 'list', token, releaseId, reportHash, reviewer, decimals: 6, from });\n// tx.dryRun.revertReason: ReleaseNotApproved | ReportMismatch | NotReleaseOwner | DecimalsMismatch\nconst status = await readTokenList({ token });   // status.listed, status.entry",
      CLI: `node scripts/list-token.js --wallet .private/wallet.json           # dry-run\nnpm run rc -- token_list_status --token ${PUSD}`,
      'On-chain': `// VerifiedTokenList ${LIST}\nfunction list(address token, bytes32 releaseId, bytes32 reportHash, address reviewer, uint8 decimals) external;\nfunction isListed(address token) external view returns (bool);\n\n// ReviveCheckGuard\nfunction isApproved(IReleaseRegistry, bytes32 id, address reviewer, bytes32 reportHash) internal view returns (bool);\nfunction approvals(IReleaseRegistry, bytes32 id, address[] memory reviewers) internal view returns (uint256);\nfunction requireApproved(IReleaseRegistry, bytes32 id, address reviewer, bytes32 reportHash) internal view;`,
    },
    output: JSON.stringify({ token: PUSD.toLowerCase(), block: { number: '164313' }, listed: true, entry: { releaseId: RELEASE, reportHash: `0x${STUDIO_REPORT}`, reviewer: OWNER }, interfacesAgree: true }, null, 2),
  },
  {
    id: 'attest', title: 'Attest with a remark and verify', tool: 'verify_attestation',
    summary: 'Record a review decision as one System.remark_with_event, "revivecheck:1:review:<decision>:<report hash>", and verify any such remark from chain data alone.',
    needs: ['A Polkadot wallet to sign', 'Nothing to verify'],
    shows: 'A signed, successful remark in a canonical finalized block, whose Remarked event matches the signer and the remark digest.',
    limits: 'It authenticates an account, not a person.',
    tabs: {
      MCP: mcp('prepare_transaction', { action: 'remark', reportHash: STUDIO_REPORT, decision: 'accepted' }) + '\n\n' + mcp('verify_attestation', { extrinsicHash: REMARK_TX }),
      REST: rest('verify_attestation', { extrinsicHash: REMARK_TX }),
      JavaScript: "import { verifyAttestation } from './lib/service.js';\n\nconst result = await verifyAttestation({ extrinsicHash });\n// result.verified, result.reviewer, result.decision, result.reportHash",
      CLI: `npm run rc -- verify_attestation --extrinsicHash ${REMARK_TX}`,
      'On-chain': `system.remarkWithEvent("revivecheck:1:review:accepted:${STUDIO_REPORT}")`,
    },
    output: JSON.stringify({ verified: true, extrinsicHash: REMARK_TX, blockNumber: '163493', finalized: true, reviewer: '5GH8LpSTf6sp31FeacbFE99E3b9NQb5E7xWHeBL8XqW3YhTt', remark: `revivecheck:1:review:accepted:${STUDIO_REPORT}`, decision: 'accepted', reviewerEvm: OWNER }, null, 2),
  },
  {
    id: 'promote', title: 'Assess promotion to V3 Live', tool: 'assess_promotion',
    summary: 'Ask V3 Live whether a passed testnet report can stand for it: identity, the chain the release names, runtime, asset existence and the EVM interface. Seals a promotion report.',
    needs: ['A passed testnet report', 'Network access to the V3 Live node'],
    shows: 'Where V3 Live differs from the network that accepted the release.',
    limits: 'Read-only: nothing is deployed or listed. V3 Live has no official EVM endpoint listed, so EVM reads there are blocked.',
    tabs: {
      MCP: mcp('assess_promotion', { reportHash: PASSED }),
      REST: rest('assess_promotion', { reportHash: PASSED }),
      JavaScript: "import { assessPromotion } from './lib/service.js';\n\nconst live = await assessPromotion(report);   // live.status, live.checks",
      CLI: `npm run rc -- assess_promotion --reportHash ${PASSED}`,
    },
    output: JSON.stringify({ status: 'failed', network: 'live', checkpoint: { number: '761215' }, checks: [{ id: 'promotion.chain-id', status: 'failed', observed: 'The release names chain 420420777; V3 Live reports 780780777' }, { id: 'promotion.runtime', status: 'blocked' }, { id: 'promotion.asset', status: 'failed', observed: 'Asset 7777 does not exist on V3 Live at block 761215' }] }, null, 2),
  },
  {
    id: 'watch', title: 'Watch the networks', tool: 'network_status',
    summary: 'Read the finalized head, runtime and identity of either network. A report pins one runtime; when it changes, recheck.',
    needs: ['Network access only'],
    shows: 'The current runtime and finalized head, and on the testnet the EVM hash of that block.',
    limits: 'There is no background watcher. Schedule rechecks in your CI, or recheck when this reports a new runtime.',
    tabs: {
      MCP: mcp('network_status', { network: 'testnet' }),
      REST: rest('network_status', { network: 'live' }),
      JavaScript: "import { networkStatus } from './lib/service.js';\n\nconst { runtime, finalized } = await networkStatus('testnet');",
      CLI: 'npm run rc -- network_status --network testnet\n\n# in CI: fail the job when the runtime moves on\nnpm run rc -- network_status | grep -q \'"runtime": "portaldot-v3/3002"\'',
    },
    output: JSON.stringify({ network: 'testnet', chainId: 420420777, genesisMatches: true, runtime: 'portaldot-v3/3002', finalized: { number: '163027', nativeHash: '0x886cdd66…15ff' }, evm: { chainId: 420420777, finalizedHash: '0x79870ea5…c12a' } }, null, 2),
  },
  {
    id: 'reports', title: 'Reports, the feed and review', tool: 'get_report',
    summary: 'Load a sealed report by fingerprint and recompute its SHA-256, list every release and stored report from the feed, or open a report in the browser reviewer.',
    needs: ['The report hash: published on this site, from this session, stored on-chain, or as JSON'],
    shows: 'That the content is unchanged since sealing, plus its checks and checkpoint with explorer links.',
    limits: 'A hash detects changes; it does not authenticate who produced the report.',
    tabs: {
      MCP: mcp('get_report', { reportHash: PASSED, includeReport: false }) + '\n\n' + mcp('list_releases', { owner: OWNER }),
      REST: rest('list_releases', {}),
      JavaScript: "import { verifyReport } from './lib/share.js';\n\nawait verifyReport(reportJson, expectedHash);   // throws on mismatch",
      CLI: `npm run rc -- get_report --reportHash ${PASSED}\nnpm run rc -- list_releases`,
      Browser: `https://a252937166.github.io/ReviveCheck/?report=${PASSED}#/review`,
    },
    output: JSON.stringify({ schema: 'revivecheck.feed.v1', indexedTo: 164338, releases: [{ releaseId: RELEASE, owner: OWNER, label: 'pusd-token-list', revision: '1', reportHash: `0x${STUDIO_REPORT}`, decisions: { [OWNER]: { revision: '1', approved: true, blockNumber: '163489' } } }], listings: [{ token: PUSD.toLowerCase(), blockNumber: '164313' }], evidence: [{ reportHash: STUDIO_REPORT, bytes: 7404, blockNumber: '164266' }] }, null, 2),
  },
];

export const REFERENCE = {
  registry: {
    title: 'ReleaseRegistry contract',
    rows: [['Address', REG], ['Network', 'Portaldot V3 Testnet · chain 420420777'], ['Deployed', 'block #162,962 · extrinsic 0xc099451a…aeea'], ['Compiler', 'solc 0.8.24, Paris, optimizer 200'], ['Source', 'contracts/ReleaseRegistry.sol · sha-256 6ae08245…c466a7'], ['Runtime code', '1,437 bytes']],
    code: `function releaseId(address owner, bytes32 name) pure returns (bytes32)\nfunction submit(bytes32 name, bytes32 reportHash) returns (bytes32 id, uint64 revision)\nfunction review(bytes32 id, bytes32 reportHash, bool approved)\nfunction releaseOf(bytes32 id) view returns (address owner, uint64 revision, bytes32 reportHash)\nfunction decisionOf(bytes32 id, address reviewer) view returns (bool reviewed, bool approved)\n\nerror EmptyName(); error EmptyReport(); error UnknownRelease(); error StaleReport();`,
  },
  tokenlist: {
    title: 'VerifiedTokenList contract and ReviveCheckGuard',
    rows: [['Address', LIST], ['Deployed', 'block #164,220 · extrinsic 0xe3efb1e7…56570 · code deposit 178.158 tPOT'], ['Curator', 'open: 0x0000…0000, so each lister names the reviewer their listing relies on'], ['Compiler', 'solc 0.8.24, Paris, optimizer 1 (size)'], ['Sources', 'contracts/ReviveCheckGuard.sol + contracts/VerifiedTokenList.sol · sha-256 7febe106…be31c69'], ['Runtime code', '2,116 bytes'], ['First listing', `pUSD in #164,313 · extrinsic ${LIST_TX.slice(0, 14)}…`]],
    code: `library ReviveCheckGuard {\n  function isApproved(IReleaseRegistry, bytes32 id, address reviewer, bytes32 reportHash) internal view returns (bool);\n  function approvals(IReleaseRegistry, bytes32 id, address[] memory reviewers) internal view returns (uint256);\n  function requireApproved(IReleaseRegistry, bytes32 id, address reviewer, bytes32 reportHash) internal view;\n  error ReleaseNotApproved(bytes32 id); error ReportMismatch(bytes32 id, bytes32 expected, bytes32 current);\n}\ncontract VerifiedTokenList {\n  function list(address token, bytes32 releaseId, bytes32 reportHash, address reviewer, uint8 decimals)\n  function isListed(address token) view returns (bool)\n  function entryOf(address token) view returns (bytes32 releaseId, bytes32 reportHash, address reviewer)\n  event Listed(address indexed token, bytes32 indexed releaseId, address indexed reviewer, bytes32 reportHash, uint8 decimals)\n  error ReviewerNotAllowed(address); error NotReleaseOwner(); error DecimalsMismatch(uint8 chainDecimals);\n}`,
  },
  networks: {
    title: 'Networks',
    rows: [['V3 Testnet native', 'wss://test-node-v3.portaldot.dev'], ['V3 Testnet EVM', 'https://test-evm-rpc-v3.portaldot.dev · chain 420420777 (0x190f1ca9)'], ['V3 Testnet explorer', 'https://scanner-testnet-v3.portaldot.dev'], ['V3 Live native', 'wss://live-v3-node.portaldot.dev · chain 780780777'], ['V3 Live EVM', 'None listed in the official explorer configuration'], ['V3 Live explorer', 'https://scanner-live-v3.portaldot.dev']],
  },
};
