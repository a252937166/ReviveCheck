# v0.2 lifecycle progress walkthrough

[Watch the public 120-second video](https://a252937166.github.io/ReviveCheck/lifecycle-demo-v0.2.mp4). It is a 1920×1080, 30 fps H.264 MP4 with English captions and intentionally no audio. This walkthrough uses current, real interface screenshots and explicitly labeled observation cards; it is not a continuous screen recording. The original 78-second Check-in video is preserved, and the organizer submission form has not been changed by this release.

## What the video demonstrates

| Time | Evidence shown |
| --- | --- |
| 00:00–00:10 | Why an acceptance plan, observed result and review must stay connected |
| 00:10–00:24 | Saved acceptance plan in the current local workspace |
| 00:24–00:40 | The immutable live report at finalized block 157790, runtime 3002, with 3/3 checks passed |
| 00:40–00:58 | Official testnet explorer references, exact identifiers and a scannable address-only precompile QR |
| 00:58–01:08 | The official explorer resolving the retained native block hash |
| 01:08–01:24 | A verified public report link and an exact-report review receipt |
| 01:24–01:40 | Owner importing that receipt without changing the original check result |
| 01:40–01:52 | The actual later environment observation at block 158114: unchanged, no new acceptance report and no signing |
| 01:52–02:00 | Explicit pending gates and a scannable link to the retained public report |

The review receipt was created and returned during an internal walkthrough using an isolated local workspace. The reviewer identity is self-declared; this is workflow evidence, not independent adoption or official approval. Asset 7777 and its precompile are an existing public system target, not our deployed contract.

## Evidence and remaining gates

The retained report fingerprint is `0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5`. The exact JSON bytes, manifest and original report are preserved. A higher block number or the mainnet announcement alone does not establish that this testnet environment changed. Only observed runtime/constants/environment drift triggers a same-plan recheck and comparison.

The funding check at **2026-10-23 05:00 EDT** still returned `0 tPOT` available. No deployment or write was signed or sent. The prepared execution path is deploy → submit the retained report fingerprint → record review → finalized readback of owner, reviewer, revision, approval and report hash through native/EVM interfaces. Those scenes will be added only after actual finalized execution. The isolated test account serving both roles will be disclosed.

Official explorer routing was verified for native block/extrinsic hashes. A supported H160 detail route is unavailable; the current precompile QR therefore contains the actual address and is labeled address-only. Project contract/transaction evidence stays pending until execution produces it. EVM transaction hashes must not be presented as native extrinsic URLs.

## Delivery checks

- [Manifest and video SHA-256](https://a252937166.github.io/ReviveCheck/demo/manifest.json)
- [Automated and manual QA](https://a252937166.github.io/ReviveCheck/demo/qa.json)
- [Caption file](https://a252937166.github.io/ReviveCheck/demo/captions.srt) and [scene timing](https://a252937166.github.io/ReviveCheck/demo/scene-plan.json)

Final video SHA-256: `1a088f929bdbfa3a77609923916a174735d825ea5920865423a44424dcfbaf04`. FFprobe checks pass for duration, dimensions, frame rate and codec. QR decoding from final compressed video frames resolves the exact H160 at 00:48 and exact public report URL at 01:56. Manual review covers claim alignment, readability, safe areas, stale copy and sensitive data. There is no voice, music or synthesized speaker; the visuals use our product UI, the official explorer screenshot as technical evidence, and original title cards. No stock footage or third-party music was used.

Local assembly sources and raw captures are retained under ignored `scratchpad/demo-v0.2-lifecycle/`; only the reviewed delivery files and sanitized QA metadata are published. Anonymous public readback at **2026-10-23 05:04 EDT** matched the complete video bytes and manifest SHA-256. An anonymous browser then rendered both players with the expected 120-second and 78-second, 1920×1080 metadata. The [delivery receipt](../artifacts/v0.2-lifecycle-public-readback.json) records the file checks, unchanged baseline bytes and Pages revision `3ee7847b7d190b8014e0376182c33cab0fbc62e0`.
