# ReviveCheck media and submission publication: October 27, 2026

## Scope and authorization

The owner requested publication of the completed music-free video and completion of the existing competition submission. This release updates media, submission copy and the final deck. It does not send any chain transaction, renew evidence, change the acceptance policy or replace the immutable upgrade baseline.

## Frozen media

| Item | Value |
| --- | --- |
| Public video | https://www.youtube.com/watch?v=4F80-0C9gVM |
| Title | ReviveCheck - Release approvals your contracts enforce (Portaldot Hacker House 2026) |
| Uploaded source | `scratchpad/demo-v04-explainer/final/revivecheck-explainer-4k.mp4`, 3840 x 2160, 30 fps, 172.313 seconds |
| SHA-256 | `524840b406975111fe23426678f1a4962eabb367286e70d4306f0f4248beb096` |
| 1080p companion SHA-256 | `1574d2c6e6890de28bcbb97f24cb7f1c036013b4a1c2dc568f1bc95eab1651a5` |
| Audio | English narration and soft UI clicks; no background music |
| Thumbnail | `scratchpad/demo-v04-explainer/final/thumbnail-1280x720.jpg`; API upload confirmed it was set |
| Description and chapters | `scratchpad/demo-v04-explainer/final/youtube-description.txt`; the first line is the title, and `upload-description.txt` contains the uploaded description body |
| Initial API result | Actual privacy `public`, upload status `uploaded`; further processing and anonymous playback verification recorded below |

The published film was recorded from the public App, separate consumer and official explorer on 2026-10-26. Historical on-chain writes and refusal replays are labelled. No transaction was signed for footage. Owner/reviewer are separate project-controlled accounts; the consumer is author-built. This is not independent review or adoption.

## Final pitch deck

- Public path: https://revivecheck.axiqo.xyz/revivecheck-final-deck.pdf
- Six pages, English, 16:9. Source: `docs/final-deck.md`.
- PDF SHA-256: `3297947a594129bbcbd1eb293fac07d9a5641aa79d411b551de969a3e7d38b32`.
- All six pages rendered and visually inspected; 11 clickable links and QR destinations checked. QA and the renderer are retained in `scratchpad/final-deck-public/`.
- The earlier Check-in and final draft decks remain unchanged.

## Existing submission

- Build: https://dorahacks.io/build/50176 (preserve this identity; no duplicate registration).
- Hackathon: https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail
- Track read back on 2026-10-27: Modular Cloud & Middleware. Registration exists (`Manage Submission` and `Unregister` controls).
- Official final materials: public source and development history, runnable demo, a public video of at most three minutes, pitch deck, deployment addresses and transaction evidence.
- Official final submission/code freeze: 2026-11-06T04:00Z, November 5 at 23:00 EST. The timeline header still says UTC-4; use the explicit UTC deadline in the detailed rules.
- Editable current copy: `docs/SUBMISSION_FINAL.md`. Saved fields and status are recorded after readback below.

## Publication verification

- YouTube upload returned the actual `public` visibility and a successful custom-thumbnail write. Anonymous metadata retrieval confirmed public availability, 172 seconds, all nine chapters and an available 1080p stream. The description matches after normalizing the platform's trailing whitespace. The embedded in-app browser cannot decode this media; native Chrome playback is checked separately.
- Existing DoraHacks Build 50176 was saved once and read back on 2026-10-27. The page shows the new video link and embed, updated lifecycle, both public repositories, public consumer and final deck link. No new legal agreement or new-submission action was displayed. Existing team, contacts, category, identity and track were preserved.
- This session reran all 255 main tests successfully, the offline release-status checks passed, and the production build passed. All edited text is English. No sealed report, baseline or transaction record was changed.
- YouTube API readback confirms `processingStatus=succeeded`, `uploadStatus=processed`, actual privacy `public` and embedding enabled. Anonymous extraction confirms 1080p availability and the nine chapters. A fresh in-app browser shows a Sign in control and the correct public title/description; its embedded codec is unsupported, so that browser does not establish playback.
- The competition Build list shows `Your Build` for 50176 and track `Modular Cloud & Middleware`. The current card has no explicit `Under Review` badge, so the README now labels it registered rather than carrying forward a stale review label. Anonymous DoraHacks readback shows the updated description and links with a Log in control; no private-before-review banner appears. Organizer acceptance and finalist selection are not inferred.
- Hosted build identity, full file verification and previous-video visibility are recorded after deployment below.

## Remaining operational boundaries

The bound report still expires 2026-11-01T09:29:17.646Z under the existing seven-day policy. No renewal transaction has been sent. External adoption, npm publication and the maintainer pilot remain future work. A saved Build update does not establish organizer acceptance, finalist selection or a score.

## Hosted release and final readback

| Item | Verified result |
| --- | --- |
| Source commit | `647f6c42f450160ac3a0d6c23ecd39c23ff3641a`; built from `git archive`, with existing dependencies, excluding the untracked TLS note and local scratch/private files |
| Release | `20261027-647f6c4-public-r1` |
| Activated | `2026-10-27T07:29:24.861027Z` |
| Files | **100/100** checked on the server and again over HTTPS |
| Public index SHA-256 | `edffe025d4151489ffbc62733583afc861dc7e74137a14507f35ec5297fc1e9c` |
| Payload | `revivecheck-public-20261027-647f6c4-public-r1.tar.gz`, 3010432 bytes, SHA-256 `cbdc41306d4d5ba2b19b1ef11c6cfa9d609283fcfaf1e756bdc46b4e9a155366` |
| Hosting manifest SHA-256 | `191032f306dbd6bf7492dbd3ff357840fbba760a1656c02b8f84c465d8db1ea6` |
| Previous release | `releases/20261026-0684981-public-r1` retained for rollback |

The first HTTPS pass exceeded its 25-second transfer limit on the main JavaScript bundle and the historical v0.2 video. Only those two bodies were retried with a longer bound and compression where supported; both matched their expected SHA-256. The initial result and the successful result are retained. This was a transfer-bound failure, not a changed payload.

The native Chrome player advanced through the published film with no media error, and after selecting 1080p the decoded video was 1920 x 1080; its settings also offer 2160p 4K. Anonymous YouTube metadata and formats establish public availability and HD access; the in-app browser's decoder does not support playback. The anonymous deployed homepage renders `Current demonstration - v0.4`, embeds the new video, and shows the new dated caption.

The historical v0.3 video `CvpzlQfya4U` was set to `unlisted` only after the replacement was public, processed and linked from the saved project and published site. It remains reachable by its historical link and was not deleted. The original v0.1/v0.2 materials were not changed.

`/.private/wallet.json`, `/api/workspaces` and `/._index.html` return 404. The demo and neighboring apex, ReCart health, Attest and Faktura sites all returned 200. Nginx, DNS, certificates, services and private wallet files were unchanged. No reload was needed.

Receipts are retained in `scratchpad/public-release-20261027/` locally and `/var/www/revivecheck/ops/` on the server: deployment, hosting, per-file hashes, external file verification, hosting verification and health/isolation checks. Screenshots show the saved DoraHacks page and public HD player. The associated Obsidian progress and handoff notes were updated in English.
