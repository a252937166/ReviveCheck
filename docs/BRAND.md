# ReviveCheck brand and co-brand

## The mark

ReviveCheck reads a release through two views of one runtime: the native interface and the EVM interface, pinned to the same finalized block. The mark draws exactly that. Two lanes come in from the left: the EVM lane in indigo, the native lane in muted white. They meet at one point and leave as a single check, on a near-black rounded tile.

| Part | Color | Note |
| --- | --- | --- |
| Tile | `#0A0A0B` near-black | 8/32 corner radius; the site's ink color |
| EVM lane | `#6F7BFF` | A lighter indigo tint, for contrast on the tile; the interface accent is `#4353FF` |
| Native lane | `#FFFFFF` at 50% | |
| Check | `#FFFFFF` | Round caps and joins, 2.7/32 stroke |

Files in `public/brand/`:

- `revivecheck-mark.svg`: the mark, used in the header, the footer and the favicon (`public/favicon.svg`).
- `revivecheck-icon.svg`: a full-bleed square variant for platforms that apply their own mask; the touch icon is rendered from it.

In the interface, the mark renders as inline SVG through `Mark` in `src/components.jsx`. The wordmark is Geist at weight 650 with −0.025em tracking, set beside the mark. `artifacts/brand/` holds the DoraHacks logo files: the SVG and a 512 × 512 PNG.

At 16 px the two lanes read as two strokes into a check. The mark stays recognizable without them, so no simplified small-size variant is needed.

## Interface identity

The site is a light developer platform at the craft level the user named, Vercel:

- **Ground and ink:** a plain white ground, near-black ink, and neutral grays.
- **Shape:** 1px hairlines, 8–12px radii, and soft shadows only on raised surfaces.
- **Type:** Geist for text, and Geist Mono only for chain data and code.
- **Accent:** one indigo, `#4353FF`, for links and focus.
- **Status:** a dot plus a soft tint: green passed, red failed or refused, amber pending.

The Portaldot violet-to-azure gradient appears in two places only:

- live progress: the pipeline connectors as a run advances, a running stage, the current transaction step;
- the co-brand mark itself.

The type is self-hosted from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`.

## Built on Portaldot V3

The co-brand lockup reads **Built on [Portaldot mark] Portaldot V3** and links to the Hacker House event page. It appears in the site header, the footer and the social preview. On narrow screens the header keeps the mark alone, with the full label in its accessible name.

The Portaldot mark comes from the Portaldot organizer profile logo on DoraHacks:

- **Source:** `https://cdn.dorahacks.io/static/files/19d762229146812c4614d884a8f87f7b.png`
- **Original:** 2048 × 2048 RGBA, SHA-256 `91d30a35c7e19fa4f852f6bc49080bc67c2da116e736bef73f3e876f655fbefb`
- **Processing:** cropped to the mark's alpha bounds with a 4% margin and resized to `portaldot-mark-128.png` and `portaldot-mark-512.png`. The shape, purple-to-blue gradient and proportions are unaltered.

Its provenance is embedded in each PNG as text metadata. Read it back with `impeccable embed-prompt --read`.

Rules:

- Use the mark at its own colors, with clear space of at least a quarter of its height. Never recolor, outline, crop or animate it.
- Pair it only with "Built on … Portaldot V3". Never imply endorsement, partnership or an official Portaldot product.
- Portaldot and its mark belong to their owners. This is a Hacker House 2026 build.

## Other rasters

- **`og.png`:** the 1200 × 630 social preview. It is rendered with headless Chromium from an HTML template in the site's system and shows the lifecycle track with the recorded run's real statuses.
- **`favicon-32.png`, `apple-touch-icon.png` and `artifacts/brand/revivecheck-logo-512.png`:** rasterized from the SVGs above.

Each carries its origin as embedded text. `lifecycle-demo-v0.2-poster.png` is left byte-for-byte unchanged, because its SHA-256 is pinned by the v0.2 publication receipt. It still shows the earlier mark.
