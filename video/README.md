# ReviveCheck Check-in walkthrough

A 78-second, 1920×1080 English caption-led walkthrough assembled from actual prototype screenshots. The video is intentionally silent; no generated voice, music, or paid provider was used.

The local rehearsal shots show synthetic fixtures, not signed Portaldot transactions. The live shot shows read-only queries. Contract deployment and write/readback evidence are still pending unless separately documented by a later verified artifact.

## Reproduce

```sh
npx hyperframes check --json
npx hyperframes snapshot --review
npx hyperframes preview --background
npx hyperframes render --quality looks --output check-in.mp4
```

The CLI version is pinned in this directory's package.json. Local runtime JavaScript is in assets/gsap.min.js. All screenshot sources are in assets/ and remain untouched.

## Sequence

- 0–8s: What proves the fix?
- 8–20s: Reproduce a wrong-network rehearsal failure.
- 20–32s: Rerun the corrected rehearsal.
- 32–50s: Compare compatible saved reports.
- 50–66s: Read live network observations and retain blocked evidence.
- 66–78s: Export a report and disclose remaining signed-deployment work.
