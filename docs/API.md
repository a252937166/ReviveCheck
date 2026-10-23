# Prototype API contract

Local server binds 127.0.0.1:4173. Same-origin JSON API, no signing or custody in the UI. All UI copy is English.

- GET /api/workspace -> {projects: Project[], runs: Run[], network: {name, chainId, evmRpcUrl, substrateRpcUrl}, capabilities: {liveReadOnly:true, signing:false}}
- POST /api/projects {name, release, contractAddress:"", account:"", expectedValue:"42", expectedChainId:420420777} -> Project
- PATCH /api/projects/:id {name?,release?,contractAddress?,account?,expectedValue?,expectedChainId?} -> Project
- POST /api/projects/:id/runs {mode:"rehearsal"|"live", scenario?:"wrong-network"|"ready"|"missing-code"} -> Run (request waits up to 30s). Rehearsal always clearly labelled, no testnet verification claim.
- POST /api/projects/:id/archive {} -> Project. Project remains in history; cannot start new runs until restored.
- POST /api/projects/:id/restore {} -> Project
- GET /api/runs/:id -> Run
- GET /api/runs/:id/export?format=json|html -> Downloadable immutable content. Evidence hash uses canonical payload, not including itself.
- GET /api/compare?baseline=<runId>&candidate=<runId> -> {baseline,candidate,compatible,reason?,changes:[{id,title,before,after,transition}],summary:{improved,regressed,unchanged}}

Project: {id,name,release,contractAddress,account,expectedValue,expectedChainId,createdAt,updatedAt,archivedAt:null|string}

Project also supports optional transactionHash and transactionBlockHash (32-byte hex strings) to bind a real native extrinsic or EVM transaction to finality verification. Empty fields remain blocked, not passed. Add these under advanced evidence settings in the UI.

Run: {id,projectId,projectName,release,mode,scenario,startedAt,completedAt,status:"passed"|"failed"|"blocked"|"inconclusive",scope:"local-rehearsal"|"portaldot-testnet-readonly",checks:[Check],network:{...},input:{...immutable project snapshot...},evidenceHash,previousRunId:null|string,limitations:string[]}

Check: {id,title,status:"passed"|"failed"|"blocked"|"unknown",observed:string,expected:string,remediation:string,evidence?:object}

Check ids stable between runs: network.chain-id, network.finalized, account.mapping, account.balance, contract.code, contract.value, transaction.finality. Passed rehearsal != verified testnet. Missing/unknown evidence cannot pass a live release. Snapshot comparisons require same project and mode; mixed evidence scope is rejected. UI must show empty states, actionable failures, errors, loading, archive/restore and export. Create first project using suggested defaults; do not prepopulate fabricated runs.
