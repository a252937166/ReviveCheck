# ReviveCheck v0.2 interface and evidence design

The interface follows one developer task: save a release plan, observe its target, and let another person inspect the exact report. It has two surfaces: a local workbench for the project owner, and a static browser reviewer for the recipient. Product scope and evidence are recorded in [PRODUCT.md](PRODUCT.md) and [RELEASE_V2.md](RELEASE_V2.md).

## Local workbench

A cobalt project rail keeps active and archived projects in view. The work area places the acceptance editor beside the selected report, followed by comparison, sharing, review feedback and recheck. Saved history remains attached to the same project. The five navigation markers are **Plan → Check → Share → Review → Recheck**; correcting and rerunning belongs to the check loop, while archive/restore is a project action.

The empty workspace offers contract and native-asset plans, plan/report import, and a direct reviewer entry. It contains no fabricated run. Live acceptance is the primary execution action. Synthetic scenarios sit in a separate disclosure and retain a visible sample ribbon in the result.

| Surface | User decision | Information kept visible |
| --- | --- | --- |
| Plan editor | What behavior and version am I checking? | Profile, logical identity, target/caller, release/source, assertion signature/arguments/expectation or asset/holder |
| Check ledger | What failed, and what can I do next? | Explicit passed/failed/blocked/unknown label, expectation, observation, remediation and expandable raw evidence |
| Selected report | What observation am I reading? | Evidence scope, release, completed time, finalized height, runtime, limitations and JSON fingerprint |
| Comparison | Can these results support the same decision? | Comparison kind/caveat, changed inputs, outcome transitions; incompatible or changed context stays explicit |
| Share panel | Can the recipient open this exact report? | Complete link or JSON handoff, QR behavior and fingerprint |
| Review feedback | Which report did someone accept or question? | Exact-hash receipt, declared reviewer name, decision, comment and time |
| Recheck/history | Does this evidence cover the current plan? | Staleness reason, a new-check action, and preserved previous runs |

Edits save the current plan; each run freezes its own input. Imported reports and receipts do not overwrite conflicting IDs. Archived projects keep evidence visible but require restoration before editing or new checks. API details are in [API.md](API.md).

## Four states, no combined approval badge

| State | Meaning | What cannot change it |
| --- | --- | --- |
| Verification | Outcome of the saved checks; rehearsal is a sample | Sharing or a reviewer opinion |
| Publishing | Local share preparation | Copying a link does not prove hosting or delivery |
| Review | Opinions attached to this exact report hash | A new run cannot inherit those opinions |
| Freshness | Whether current local settings or later saved runtime observations differ | A historical pass does not guarantee the current chain is unchanged |

Next-step guidance explains the first unresolved check or stale context. A failed report can be accepted as an accurate failed observation; the failure remains visible. A new release, deployment, plan or detected runtime change calls for a new run, not a rewrite of history.

Comparison uses precise language. Correcting the expected chain is a configuration correction. Different deployments require the same explicit logical identity and assertion plan. Changed assertions, caller or asset holder require a new baseline. Runtime and fixture changes receive context-changed labels rather than a repair count. Even an improved check does not establish its cause.

## Static recipient experience

The reviewer verifies report JSON with browser Web Crypto, reads the same check ledger and saved plan, and creates an accepted/changes-requested receipt. The receipt binds one report hash and is downloaded for the owner to import. Reviewer identity is explicitly self-declared; no login, wallet, official authority or digital signature is implied. Imported receipts can be checked against the selected report.

Reports travel in one of three ways:

1. A gzip/base64url fragment contains the report and is decoded in the recipient's browser. The fragment payload is not sent to the static host.
2. A selected published reference report is fetched from the static site and must match its requested fingerprint.
3. A fingerprint-bound viewer opens with an explicit request for the matching JSON file. This is the fallback for long links or QR payloads.

The current limits are 512 KiB expanded report data, a 32,000-character complete link, and a conservative 1,800-character self-contained QR link. A hash-only QR does not contain a report and must say that JSON import is required. The local API and workspace database are never the sharing endpoint. Report metadata remains public to anyone who receives it; compression is not encryption.

The reviewer root also retains the original v0.1 video as historical material. A video or selected reference report is not proof that the viewer reproduced a live run or that a real external reviewer participated.

## Visual language

Blueprint `#2445a7` and deep cobalt `#18357f` distinguish actions and project navigation; paper `#f3f6fc` and white surfaces support long evidence reading. Ink is `#182747`, green `#26715b`, and red `#ad3e46`. Status is conveyed with text and icons as well as color. Avenir Next/Segoe UI provides navigation and body text; SFMono-Regular/Consolas is reserved for code, addresses and hashes.

The report uses a continuous check ledger and a strong result glyph. Comparison uses a change list rather than a score chart. Raw data stays in disclosures; no dashboard metrics imply adoption or application health. Visible focus styles, busy/error/empty states, reduced-motion handling and a stacked mobile layout are included. A build alone does not validate every interaction; integrated QA evidence belongs in the release record.

## Evidence contract behind the interface

A sealed run binds the acceptance plan, declared source revision, deployment and observed code fingerprint where available, runtime fingerprint, and finalized native/EVM checkpoint. Dynamic sharing, review and freshness data remain outside that sealed payload. Original JSON is the integrity artifact; HTML is a readable rendering with the companion JSON boundary stated explicitly.

Hash matching means the content is unchanged. It does not authenticate the source of RPC responses, the developer, the reviewer, or a declared source revision. A passing asset profile covers read parity of an existing public asset; local ReleaseGate EVM execution covers local bytecode behavior. Own signed V3 deployment/write/readback remains a separate pending milestone. These boundaries belong beside the relevant action and result, not only in a footer.
