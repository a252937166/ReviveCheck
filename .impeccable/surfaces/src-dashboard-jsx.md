---
version: 1
slug: "src-dashboard-jsx"
primary_target: "src/Dashboard.jsx"
related_targets: ["src/App.jsx","src/dashboard.css","src/Try.jsx","src/Review.jsx"]
---

# The app: registry dashboard and the lifecycle run

Scope: `#/app` and its pages (`#/app`, `#/app/releases`, `#/app/tokens`, `#/app/evidence`, `#/app/activity`, `#/app/run[/step]`, `#/app/workbench` on loopback only) and the reviewer at `#/review`, mode **Operate**. It inherits the landing's world (`src/Landing.jsx` brief); this brief keeps only the app's own strategy.

Audience and task: a judge, reviewer or V3 developer who pressed "Open app" wants to see the registry's real state, look up any release, token or stored report against the chain, and run the lifecycle with their own wallet.

Information: everything comes from the public feed (`api/registry.json`), the lifecycle records (`lifecycle/*.json`), the published reports index, and live reads through the same service the MCP server uses (`read_registry`, `token_list_status`, `retrieve_evidence`, `network_status`). Every row names its block and extrinsic and links to the official explorer.

Composition:
- A 60px app bar: mark and wordmark with an "App" tag, the live network chip, the wallet button, Docs, and "Site".
- A 232px sidebar: Overview, Releases, Token list, Evidence, Activity, Run lifecycle (counts on the data pages), then the two contracts as copyable chips with explorer links. Below 900px the sidebar becomes a horizontal strip.
- Overview: a hero card with the live finalized head as a large odometer and the registry's facts; three tiles (releases, approvals standing, tokens listed); the recorded run on the pipeline track; latest activity. A right column holds "Rules the registry enforces" with live values, "Networks" with both heads and runtimes, and a dark "Run it with your own wallet" card.
- Data pages: a table of the feed's rows with explorer links, then a "Look up" form that reads the chain live and shows the result as a card.
- Run: the studio inherits its step anatomy (title, step count, product, signer and cost chips, What happens / Why it matters, signer line, Related API); the step rail and the session ledger share the left column.
- Reviewer: unchanged in function, inside the app shell.

States: loading skeletons for the feed; a live read is busy with an elapsed counter, then a result card or a retry; empty tables say what would fill them; the wallet is none, connecting, connected, wrong network or short of tPOT.

Constraints:
- Reads need no wallet and spend nothing; every write is dry-run, then signed in the visitor's own wallet with the visitor's own tPOT. The site holds no key.
- The local workbench appears only on loopback, where its API exists.

## Direction contract

Inherited from the landing brief (`src/Landing.jsx`): the same world at Operate restraint. The signature interaction here is the live head rolling in the overview's hero card and the lifecycle run advancing with the visitor's real transactions. seed:ed10de7f55b3d561.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
