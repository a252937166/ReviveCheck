# Demo script, v0.4: an application uses ReviveCheck to admit a token

Prepared 2026-10-25 for the final submission video. Target 172 seconds, leaving eight seconds below the three-minute limit. It supersedes `docs/DEMO_SCRIPT_V3.md`, whose recording of 2026-10-24 predates the live v2 lifecycle; the v0.1, v0.2 and v0.3 videos stay as the historical record. Every scene names what the viewer is looking at: a recorded testnet transaction, a live read, or a simulation. Nothing is signed on camera.

The central proof is a separate application using the ReviveCheck App and then enforcing its own admission decision. A terminal-only package demonstration does not satisfy this chapter. Start and finish in the consumer application so the viewer can see the business consequence: an incorrectly configured token is withheld, its exact evidence is inspected in ReviveCheck, and a corrected entry becomes selectable only after the consumer's own fresh evaluation succeeds.

**Recording status: the interfaces exist; the public URL does not yet.** On 2026-10-25 the separate repository gained the Token eligibility demo (`web/`): the admission screen, the App links, the refresh action, the recorded-state replay, the decision-evidence export and a token selector that consumes the allow-list output. The complete consumer-to-App-to-consumer journey was performed in a clean browser session against a local production build and is recorded in `docs/VALIDATION.md`. The demo is deployed to GitHub Pages by its workflow only after the repository is pushed; until then the recording uses a local build labelled local, or waits for the public URL. A human pilot is optional additional evidence, not a prerequisite for this project-built demonstration.

Recording setup: a production build of ReviveCheck, the separate consumer application, 1920 × 1080, 30 fps, English captions. Show the separate repository and installed package briefly. A local build must remain labelled local; use the public domain only for the version actually deployed there.

## Public access

Anyone who can open the project URL must be able to use the public experience immediately. No visitor allow-list, invitation, login, application, administrator approval or wallet connection is required for read-only checks, report inspection, replay or eligibility evaluation. The separate consumer frontend must follow the same access model. A wallet is needed only when a user explicitly chooses to sign their own on-chain write.

Call the consumer interface **Token eligibility demo**. Show **Check token**, **Inspect evidence**, **Refresh status** and the resulting token availability. Existing `allowlist` filenames, schemas and contract records refer to token admission rules; they are not visitor access controls. Failed or withheld token eligibility must leave the application and its inspection tools accessible to everyone.

| Time | Scene | On screen | Caption | Evidence class |
| --- | --- | --- | --- | --- |
| 0:00 to 0:15 | A consumer has a problem | Open the separate Token eligibility demo directly, without login or a wallet. Show its entry and policy; configured decimals 18; admission denied; pUSD unavailable in the token selector | "Anyone can open this example and check a token. This entry claims eighteen decimals. A token symbol and an approval badge cannot tell the operator whether that exact entry is safe to publish." | planned consumer UI; record actual evaluation after implementation |
| 0:15 to 0:35 | Open the evidence in the App | Click **Inspect in ReviveCheck**. Open the exact bound report in the public Review page; show the verified fingerprint, asset and six-decimal observation | "The application opens the exact report it relies on. ReviveCheck verifies its fingerprint and shows the native asset and ERC-20 observations. The report checked six decimals; our configuration claimed eighteen." | existing App capability; consumer link pending |
| 0:35 to 1:00 | Use ReviveCheck to inspect and replay | Click Replay in Review; show recorded and replayed values at the report's pinned block. Open Catalog decision and click Evaluate now; show the fresh result's own checkpoint and time | "Replay checks what the report observed at its original block. Evaluate now separately reads the current registry and listing. These are different questions: what was verified then, and whether the published reference policy permits use now." | actual App reads; distinguish pinned replay from current evaluation |
| 1:00 to 1:30 | The consumer makes its own decision | Return to the separate application. Correct its entry to six decimals. Click **Refresh status**; display its own policy hash, report hash, revision, trusted reviewer and fresh checkpoint | "Back in the application, we correct the entry and evaluate our own policy. It retrieves the sealed report from the chain and checks the current approval and listing. It does not copy the green status from ReviveCheck's page." | planned UI over the existing live consumer evaluator |
| 1:30 to 1:55 | A real business consequence | Consumer token selector reads the generated admission result; pUSD becomes selectable. Show the wrong-entry result beside it with the actual mismatch reason | "Only the valid result admits this exact token entry. The selector consumes that result. Wrong decimals remain blocked even when the underlying report is approved. This is a token-admission example, not a working exchange." | actual consumer behavior required; no hardcoded success toggle |
| 1:55 to 2:25 | Approval has a lifecycle | App recorded execution, revision 1 to 2, approval, explicit rebinding and relisting, revocation and restoration; consumer replays matching captured refusals with a persistent recorded label | "The recorded testnet lifecycle shows what happens next. A new revision invalidates the old binding. Approval alone does not rebind it. Revocation withholds the entry; an explicitly rebound, approved revision restores eligibility. Expired or unavailable evidence also denies admission." | recorded testnet transactions and labelled consumer fixture replay |
| 2:25 to 2:42 | Verify the integration | Separate repository's dependency and policy, one public report or transaction link and its QR; show the owner and reviewer as different project-controlled accounts | "This separately built application installs the package and owns its policy. Portaldot supplies native asset evidence, ERC-20 access and contract-readable approval. Both signer accounts are ours; this demonstrates integration and role separation." | local reproducible integration plus public testnet evidence |
| 2:42 to 2:52 | Close on the user outcome | Consumer valid and withheld states, links to the App, source and evidence | "Inspect evidence in ReviveCheck. Enforce an exact, current decision in your application. This is our reference integration; independent adoption remains unproven." | show only implemented, verified behavior |

## The core App-to-application path

Use the existing approved revision for the main walkthrough. The consumer already retrieves its report from chain data and evaluates its own policy; implement the smallest interface around that path before filming.

1. The consumer shows its requested token entry, policy and admission result. Its wrong-decimals configuration must execute the real comparison and deny the entry.
2. **Inspect in ReviveCheck** opens the exact bound report: `https://revivecheck.axiqo.xyz/?report=1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51#/review`. Never substitute a sample report when the requested hash cannot be loaded.
3. The operator inspects the report and actually uses Replay in the App. A pinned replay does not establish current eligibility.
4. The App's reference Catalog at `https://revivecheck.axiqo.xyz/#/app/catalog/testnet-v2` can evaluate its published policy. Keep that policy distinct from the separate consumer's own policy. The large recorded Catalog headline must not be presented as the fresh result.
5. Back in the consumer, **Refresh status** runs its own evaluator against fresh reads and returns the report, binding, policy, exact entry and checkpoint identity. A static `out/allowlist.json` must not be presented as a new network read.
6. The consumer's token selector uses that evaluation and exact entry comparison. Denied, expired, unknown or failed-refresh results leave the token unavailable; no previous green result survives a failed refresh as if it were current.
7. Recorded lifecycle states can be replayed through the same consumer logic to show invalidation and recovery. Keep their historical checkpoints and provenance visible. Do not send duplicate transactions for footage.

This consumes an existing verified release. A separate application can reuse the same pUSD subject without claiming a second asset, third-party operator or independent reviewer.

## Recording gates and implementation scope

| Gate | Current state | Required before recording the full chapter |
| --- | --- | --- |
| Open access | Public ReviveCheck read-only routes have no visitor login or approval gate; the consumer frontend is built and was completed in a clean browser session on 2026-10-25 (local build) | Open the public consumer URL in a clean browser and complete the read-only journey without login, invitation, wallet connection or administrator action |
| Separate consumer | Repository with the packed 0.5.0 dependency, own policy, live-read outputs, the browser demo, a selector that obeys the decision and a business action that prepares a versioned catalog release; a selector that consumes the allow-list output; no public remote yet | Publish the repository and its Pages deployment for the final submission |
| App handoff | The consumer's "Inspect evidence in ReviveCheck" opens the exact report (`?report=1faef921…#/review`) in a new tab; the full hash is shown with a copy control on both sides | Keep the same report identity visible in both applications on camera |
| Fresh consumer evaluation | The browser runs the installed package's evaluator (`src/evaluate.js`, shared with the command line) with progress, a 90-second bound, unknown on failure and a lapse after the observation limit | Show loading, success and failure honestly on camera |
| Full lifecycle | Revision, approval, rebinding, relisting, revocation and restoration have recorded testnet evidence | Reuse verified records; label captured refusal playback and simulated expiry; retain old reports and decisions |
| New external acceptance plan | The public Check my token form and the browser-local projects carry a visitor's own release through check, review, binding and an exported consumer configuration; the Workbench's plan serialization preserves and validates `listing` (`src/plan-form.js`, `test/plan-form.test.js`) | Optional additional chapter, not a prerequisite for the existing-release integration; a public "Check my token" form is not built |
| Human pilot | No independently operated trial | Optional follow-up; never describe this project-built integration as external adoption |

Do not expand the consumer into an AMM, wallet or trading product for this video. The business action being demonstrated is token admission and selection. Package exports, CLI and MCP explain reuse in supporting documentation; they do not replace the App interaction or business result in the recording.

For a future new-plan handoff, carry the requested entry, validated plan and fingerprint, consumer policy and fingerprint, and, when present, the exact report hash, release ID, revision and storage locator. There is no generic public handoff-import endpoint today. The Workbench's plan serialization (`src/plan-form.js`) preserves `listing` through import, save, export and reload and validates it with the same `normalizePlan` the checker uses; an imported token-list plan can be filmed as intact.

## Rules for the recording

- Say what is simulated. The local demo's `SIMULATED` label stays on screen whenever the 17-step local sequence appears; the testnet lifecycle is shown only from its recorded receipts and live reads.
- Say who the reviewer is. The reviewer-trust line of the policy is readable in the Catalog decision scene.
- Do not sign. Every write shown is a recorded transaction with its block link; the studio's write steps are not performed on camera.
- Do not attach an old approval to a fresh report. A new Studio check produces a different fingerprint and needs its own submission and exact-hash Registry approval. If the optional Studio check is shown, label its new report as unapproved and keep it separate from the recorded approved revision.
- Distinguish review artifacts. A downloaded review receipt is self-declared feedback; a signed remark is an attestation. Neither is a ReleaseRegistry approval.
- Keep the report's age visible. The current bound report expires under the seven-day consumer policy at `2026-11-01T09:29:17.646Z`; re-evaluate before filming. Do not widen the policy merely to keep the result green. A later report needs a new exact-hash approval and explicit binding.
- Keep earlier videos as they are. This script describes a new recording; it does not edit the published files.

## Checks before publishing a recording

```sh
npm test && npx vite build && node scripts/release-status.js --out public/release-status.json
node examples/token-catalog/catalog.js demo --strict
node examples/token-catalog/catalog.js acceptance --config examples/token-catalog/config/testnet-v2.json
```

Then record, verify the duration is under 180 seconds with `ffprobe`, and keep the captions in a separate `.srt` as before.

Before that recording, dry-run the complete consumer-to-App-to-consumer journey. Confirm that the same report hash is shown on both sides, that the token selector follows the evaluator output, and that wrong entry, failed refresh and historical revocation cannot enable it. Run the separate consumer's tests and its actual live command; existing output files alone are insufficient. These are recording gates, not claims that the pending interface already passes.
