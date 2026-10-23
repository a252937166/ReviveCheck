# Published Check-in video

**Public video player:** [Watch the 78-second walkthrough](https://a252937166.github.io/ReviveCheck/).

**Direct video:** [check-in.mp4](https://a252937166.github.io/ReviveCheck/check-in.mp4), served as `video/mp4`.

## GitHub Pages player

GitHub Pages uses the dedicated `gh-pages` branch at commit `f984a70712e5a64533956576eaa1bc4b8c5563ab`. The branch contains only `index.html`, `.nojekyll`, the unchanged MP4, and its poster. It was created through Git Data APIs without checking out a branch or editing the application. The site uses public legacy branch builds with HTTPS enforced.

Anonymous HTTP readback verified:

- Page: HTTP **200**, `text/html; charset=utf-8`; exactly matches the authored player HTML.
- MP4: HTTP **200**, `video/mp4`, **2,898,382 bytes**; SHA-256 matches the local original and Release asset.
- Poster: HTTP **200**, `image/png`, **431,881 bytes**; SHA-256 matches the local original and Release asset.
- Video range request: HTTP **206**, 1,024 bytes for `Range: bytes=0-1023`.
- Downloaded video: `ffprobe` confirms **78.000 seconds**, H.264, 1920×1080, 30 fps. A fetched frame at 58 seconds decoded successfully.

Requests used no Authorization header or cookies. The HTML5 player has native controls, inline playback, an actual poster, and English captions burned into the video. Chrome loaded the player with duration 78 seconds, readyState 4 and no media error. Clicking play changed paused to false. This page publishes the video only; it does not expose the interactive local application.

## GitHub Release

Published 2026-10-23 as the public GitHub Release **check-in-v0.1.0**, targeting source revision `4dc231e2418e7ba22d54ce386941f97c33faa93a`. The release is neither a draft nor a prerelease.

- [Release page](https://github.com/a252937166/ReviveCheck/releases/tag/check-in-v0.1.0)
- [Direct MP4 download](https://github.com/a252937166/ReviveCheck/releases/download/check-in-v0.1.0/check-in.mp4)
- [Poster download](https://github.com/a252937166/ReviveCheck/releases/download/check-in-v0.1.0/poster.png)

## Public readback

Independent `curl` GET requests used **no Authorization header or cookies**. The release page and both assets returned HTTP **200**. Downloaded asset hashes match the unchanged local originals.

| Asset | Size | Download response type | SHA-256 |
| --- | ---: | --- | --- |
| check-in.mp4 | 2,898,382 bytes | `application/octet-stream` | `e4f1d40e5e6e3333c754fc03f46299c667ed502bb999be37863c214d7a796d7d` |
| poster.png | 431,881 bytes | `application/octet-stream` | `4cad13bcc27be394e3d7b62e9e07cc44145dc245e93e11876795c339e85e8771` |

GitHub Release API metadata identifies the assets as `video/mp4` and `image/png`; the CDN GET responses above use `application/octet-stream`. These are publicly readable **download URLs**, not a dedicated HTML video player. Signed-out access is verified; acceptance by an external form or embedded browser remains a separate check.

`ffprobe` on the downloaded MP4 confirms **78.000 seconds**, H.264, **1920×1080**, **30 fps**, and 2,898,382 bytes. The file was uploaded as-is, without rerendering or transcoding. No cloud render, paid media API, new account registration, or terms acceptance was used.

## Demonstration scope

The silent English video is a walkthrough assembled from actual UI screenshots, not a continuous screen recording. Rehearsal and comparison results use synthetic fixtures. The Portaldot V3 segment is live read-only, with 2/7 checks passed and missing evidence still blocked. The wallet has 0 tPOT; signed testnet deployment, write, and readback are pending. The export scene shows real export controls and saved history rather than an opened HTML report.

## Publishing route

HyperFrames 0.8.186 was checked first. Its `publish --public` hosts HTML composition source and assets; anonymous playback requires a claimed account, while this machine is signed out. No HyperFrames publish request was made. The user-authorized fallback publishes the already completed MP4 through the existing GitHub account.

Local source and captions: [production notes](README.md), [check-in.mp4](check-in.mp4), [captions.srt](captions.srt).
