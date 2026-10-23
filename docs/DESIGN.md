# ReviveCheck interface direction

## First pass

The subject is release acceptance for a Solidity application moving to Portaldot V3. Its characteristic object is a check result that can be rerun and compared, rather than a network metric. The interface opens directly into a workspace, with project context, acceptance inputs, one execution action and an evidence report.

- Palette: blueprint `#2445a7`, deep cobalt `#18357f`, paper `#f3f6fc`, surface `#ffffff`, ink `#182747`, successful proof `#26715b`, failed assertion `#ad3e46`.
- Type: Avenir Next / Segoe UI for navigation and reading. SFMono-Regular is reserved for addresses, hashes and raw evidence. Page title 30px, section title 18px, body 14px, utility 12px.
- Layout: left-aligned project rail, then a broad workspace. The acceptance configuration sits beside the selected run. History and comparison remain beneath the same report, keeping the entire failure-to-fix task in one context.

```text
Project rail | Project / release                Network context
             | Configure ─ Run ─ Inspect ─ Compare ─ Export
             | Inputs / execution | Selected report
             |                   | Checks + fix instructions
             | Run history       | Baseline comparison
```

## Review and refinement

A conventional dashboard would emphasize charts, counts and repeated cards. ReviveCheck instead spends its visual emphasis on the report margin: a large vertical result glyph and a continuous check ledger make failure or missing evidence immediately legible. The comparison appears as a change list, not a score chart. There is no decorative gradient, animated background or fabricated initial report.

The workflow markers are sequential because they represent actual work. The rail is deliberately cobalt rather than a generic dark shell. Surfaces use an 8px radius only for controls and outer work areas; report rows stay continuous. The main canvas uses a soft blue grid only in the empty report, evoking a test worksheet while preserving reading contrast.

## Product truth and interaction

- Local rehearsal is visibly distinct from Portaldot live read-only checks at selection, execution and export.
- A successful rehearsal never says a contract is deployed or verified on testnet.
- Empty projects guide the user to a rehearsal or their own deployed contract.
- Unknown and blocked checks keep their own labels; no green success from absent evidence.
- A configuration is saved before a run; reports retain their own frozen inputs.
- Run history, compatible-baseline comparison, JSON/HTML exports and archive/restore provide a complete small lifecycle.
- Keyboard focus, reduced-motion handling and a stacked mobile layout are included.
