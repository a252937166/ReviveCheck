# Final deck
- `final-deck.html` is the source of the twelve-slide deck outlined in `docs/FINAL_DECK.md`: one `<section class="slide">` per slide, 1920 by 1080 px, inline CSS only, no external fonts, scripts or images.
- To render: open `docs/deck/final-deck.html` in Chromium and print to PDF at 1920 by 1080 px with no margins (the `@page` rule sets that size, so zero margins and "default" paper give one slide per page, twelve pages), or run `node scripts/render-deck.mjs`, the render script the maintainer adds next to this file.
- Before rendering, replace the literal token `{{SOURCE_COMMIT}}` on slide 12 with the full hash of the commit the deck describes.
- Rule: the deck is rendered only after `node scripts/release-status.js` reports `ok` on that same commit; any other status means a published record is inconsistent and no deck is rendered from it.
- Every number on a slide traces to `public/release-status.json`, `docs/LIFECYCLE.md` or `docs/VALUE_EXPERIMENT.md`; change the source first, then the slide, never the other way round.
- Hashes may be shortened to their first 8 hex characters and an ellipsis; addresses and block numbers are written in full.
- No slide claims adoption, an audit or independent review; keep it that way when editing.
- Light theme only, one accent colour per slide at most, no images, so the PDF is reproducible from the HTML alone.
- The historical Check-in deck, `artifacts/ReviveCheck-Check-in-Deck.pdf`, is kept unchanged.
