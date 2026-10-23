# Check-in video review

The selected storyline follows one project from failure to a corrected local rehearsal, then comparison, live read-only observation and evidence export. The evidence-first audit story and an account-mapping diagram story were not built.

The source screens are actual production-build UI captures. Screenshots are reframed within the video but not altered. There is no generated UI, private wallet material or claimed signed deployment. The first, rehearsal and comparison scenes state that they use synthetic fixtures. The live scene visibly shows two successful network observations while mapping, funding, contract code, value and finalized-transaction evidence remain blocked. The final caption explicitly states that signed testnet deployment is pending.

## Measured

- HyperFrames check: passed; browser audit ran.
- Lint, runtime, layout and motion: zero errors.
- Contrast: 15 of 15 checks passed.
- One retained warning: `film_silent`. The brief intentionally uses captions and no paid/audio resources.
- Review captures: 12 beat frames, all five seam strips and the 360px phone sheet inspected.

## Visual review

The real UI is the focal object. Headers and large captions carry the story at reduced width. Fine UI labels are best read at the delivered 1080p resolution; a phone viewer should not be expected to inspect transaction-level detail. The weakest shot is the comparison: its screenshot contains more rows than can be read on a phone. A later recording could show a close-up of one changed assertion as the cursor operates the real UI.

Still holds are deliberate for a technical evidence walkthrough. The render is a screenshot-based walkthrough, not a continuous recording of mouse interactions. Sound has not been heard because no sound is present.

## Output verification

Local encode completed successfully in 48.7 seconds using screenshot capture with the hardware GPU. ffprobe reports H.264, 1920×1080, 30 fps, 2,340 frames, exactly 78.000 seconds, 2,898,382 bytes, and no audio stream. Decoded frames at 4, 58 and 77.5 seconds were inspected. The live frame remains blocked and the final frame retains the pending signed-deployment caption. Output: check-in.mp4; poster: poster.png.
