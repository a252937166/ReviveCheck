# ReviveCheck Check-in demonstration

Delivered 2026-10-23. **78 seconds**, 1920 × 1080, 30 fps. The silent English video uses large headings, scope labels, and captions. It is a **walkthrough assembled from actual production-build UI screenshots, not a continuous screen recording**.

Watch the [Check-in video](../video/check-in.mp4), read the [English captions](../video/captions.srt), or see the [video production notes](../video/README.md).

## Delivered storyboard

The story follows one project's acceptance workflow: reproduce a configuration failure, rerun a corrected plan, compare saved results, inspect live evidence, and retain a report.

| Time | Heading and actual screen | Evidence scope | English caption |
| --- | --- | --- | --- |
| 0:00–0:08 | **What proves the fix?** Named project and failed report (`01-project.png`). | Check-in prototype; synthetic rehearsal shown. | “One project. The original failure. A comparable rerun.” |
| 0:08–0:20 | **Reproduce the configuration failure.** Wrong-network rehearsal result (`01-project.png`). | Local rehearsal; synthetic fixtures. | “Catch the wrong network before marking the plan ready.” |
| 0:20–0:32 | **Rerun the corrected plan.** Ready rehearsal result (`02-fixed.png`). | Local rehearsal; synthetic fixtures. | “The rehearsal passes. Testnet deployment remains unproven.” |
| 0:32–0:50 | **Show exactly what changed.** Baseline and candidate comparison (`03-compare.png`). | Local rehearsal; comparison of synthetic fixtures. | “Compare the same target. Separate configuration correction from execution proof.” |
| 0:50–1:06 | **Read the real network.** Live report with missing evidence (`04-live.png`). | Portaldot V3; live read-only observations. | “Live queries expose missing evidence. Blocked checks stay blocked.” |
| 1:06–1:18 | **Keep the proof with the fix.** Saved report, history, and JSON/HTML export controls (`05-export.png`). | Saved report; JSON and HTML export. | “Export the report. Signed testnet deployment is still pending.” |

The separate [SRT file](../video/captions.srt) includes the explicit “Local rehearsal — synthetic fixtures” subtitle in both rehearsal segments. All screenshots come from the actual UI; framing changes guide attention without manufacturing UI states or transactions.

## Demonstrated scope and remaining evidence

- The failure, corrected rehearsal, and improved comparison exercise synthetic fixtures. Their passing results do **not** establish a deployed contract or signed Portaldot transaction.
- The live read-only shot shows **2 of 7 checks passed**: network identity and a shared finalized checkpoint. Native/EVM mapping, funding, contract code, expected value, and finalized transaction remain **Blocked**.
- The observed wallet balance is **0 tPOT**. Signed testnet deployment, write, and readback remain pending.
- The export scene shows actual JSON/HTML export controls and saved history. It does not show a continuous download interaction or an opened HTML report.
- The walkthrough illustrates the repair-and-review lifecycle. It does not claim that project creation, field editing, or every action was captured as a continuous interaction.

## Delivery check

The local MP4 was rendered and previewed. Duration is **78.000 seconds** (2,340 frames); the result is H.264 at 1080p and 30 fps. HyperFrames checks and sampled rendered-frame review completed. Silence is intentional; the captions carry the narration. The video has not been externally published.
