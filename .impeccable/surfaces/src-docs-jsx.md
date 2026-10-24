---
version: 1
slug: "src-docs-jsx"
primary_target: "src/Docs.jsx"
related_targets: ["mcp/tools.js"]
---

# Integration docs

Scope: `#/docs` on the public site, mode **Read**. It inherits the landing's world.

Reader's question: "How do I use this feature from my agent, app, CI or terminal, and what does it need?"

Source material:
- the MCP tools in `mcp/tools.js`, also served by the local workbench as `POST /api/tools/<name>`;
- the JavaScript service in `lib/service.js`;
- the CLI scripts;
- the ReleaseRegistry ABI and the remark format.

Structure: a left sidebar with "Get started" (install, MCP for Claude Code and Desktop, REST) and one entry per feature:
- network status;
- check;
- recheck and compare;
- replay;
- submit;
- review;
- attest and verify;
- promote;
- watch;
- reports.

Each feature section gives:
- a summary;
- what it proves and does not prove;
- its requirements (network, wallet, tPOT);
- integration tabs: MCP, REST, JavaScript, CLI, and on-chain where one applies;
- an example result.

Layout: a reading column of about 760px, an "On this page" list at wide widths, and code blocks with copy buttons. On mobile the sidebar becomes a jump menu.

## Direction contract

Inherited from the landing brief (`src/Landing.jsx`). Docs carry the world through Geist, hairlines and code surfaces, not decoration. seed:ed10de7f55b3d561.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
