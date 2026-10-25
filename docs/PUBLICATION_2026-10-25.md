# Public release provenance: October 25, 2026

The hosted site <https://revivecheck.axiqo.xyz/> was republished from source commit [`8aee632f9eff67211e482605527a043d89aa6b8a`](https://github.com/a252937166/ReviveCheck/commit/8aee632f9eff67211e482605527a043d89aa6b8a), which GitHub `main` and `redesign/custody-record` were fast-forwarded to the same day (from `4dfb1e3`). The release carries the live v2 lifecycle recorded on 2026-10-25, the Catalog decision page, the published-entry invariant, the fair benchmark and the authoritative status record. Nothing else changed: no DNS, no Nginx configuration, no Node service, no wallet or private file, no transaction.

## Release r1

| | |
| --- | --- |
| Release | `20261025-8aee632-public-r1`, served from `/var/www/revivecheck/current` → `releases/20261025-8aee632-public-r1` |
| Build | `npx vite build --base /` at commit `8aee632`, clean working tree |
| Payload | `revivecheck-public-20261025-8aee632-public-r1.tar.gz`, 2,943,115 bytes, SHA-256 `599d4fabc6f659e2ebb10abf29429edb10feb561aaf1872b5f7128bc86235611` |
| Files | 99 files, 5,324,348 bytes; per-file SHA-256 in `dist-manifest-20261025-8aee632-public-r1.json` and `sha256-20261025-8aee632-public-r1.txt` (server copies under `/var/www/revivecheck/ops/`) |
| Public index SHA-256 | `8b1a33ae0b9bbf6df1b29a68f34bcc5ea11ea9af77e4acc28d14efa23269e1d0` (the `index.html` entry of the manifest and of the receipt `deployment-20261025-8aee632-public-r1.json`) |
| Activated | 2026-10-25T11:27:50Z by atomically replacing the `current` symlink; the previous release `20261024-92f3091-public-r3` is retained for rollback |
| Nginx | `/etc/nginx/conf.d/revivecheck.conf` unchanged, SHA-256 `df68beecc4b0aac3023094bf364457ebb2c2ef577d94061bbb01f55460a2e1fc`; no reload |

## Verification

- On the server, every one of the 99 files matched its manifest hash after extraction and again after the cleanup below; no file was missing and none extra.
- Over HTTPS, all 99 files were fetched and matched the manifest. `/app/catalog` returns `index.html` (200), `lifecycle-demo-v0.2.mp4` answers range requests (206), HTTP redirects to HTTPS (301).
- `release-status.json` served the record generated before the publication commits (commit `b7449d3`, five of six levels established); `catalog/testnet-v2/lifecycle.json` served the 12 recorded steps ending in `reapprove-r2`, `valid`; `api/registry.json` is indexed to #187283 with 3 listings.
- Blocked or absent paths return 404: `api/workspaces`, `.private/wallet.json`, `._index.html`, `api/._registry.json`.
- Neighboring sites answered 200 after activation: `axiqo.xyz`, `recart.axiqo.xyz/api/health`, `attest.axiqo.xyz`, `faktura.axiqo.xyz`.

## Incident during r1

The first upload of the same files was packed with macOS `tar`, which stored AppleDouble metadata entries for the Apple provenance attribute. GNU `tar` on the server extracted them as 115 literal `._*` files beside the real files; they were served until the cleanup. At 11:31 UTC every `._*` file was deleted from the release directory, the 99 real files were verified again (no change), and a clean payload (`COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs`) replaced the first one under `ops/`. The receipt above names the clean payload.

## Rollback to r3

1. Confirm `/var/www/revivecheck/current` points to `releases/20261025-8aee632-public-r1` and the vhost SHA-256 still equals `df68beec…`. Stop if either differs.
2. `ln -s releases/20261024-92f3091-public-r3 /var/www/revivecheck/current.tmp && mv -Tf /var/www/revivecheck/current.tmp /var/www/revivecheck/current`.
3. Verify the r3 index SHA-256 `4ef6163849aeb408d8a33ab4b43d148ff866e6abebe42b085e751303474c9b78` over HTTPS. No Nginx reload is needed. Preserve every release directory, payload and receipt.

## What this publication does not change

- The YouTube video (recorded 2026-10-24) and the DoraHacks build description still describe the 2026-10-24 release; the status record lists them as pending. No DoraHacks or Discord message was sent.
- The GitHub Pages site (`a252937166.github.io/ReviveCheck`, branch `gh-pages`) still serves the historical v0.1 and v0.2 recordings and was not touched.
- No builder outside the project has installed or configured ReviveCheck; the second consumer repository is local and unpublished.

## Release r2

Release `20261025-e7044d1-public-r2` superseded r1 at 2026-10-25T11:38:11Z. It was built from commit `e7044d1` (clean working tree; GitHub `main` carries it), which adds this provenance document and the status record that names r1 to the r1 source; every other published file is byte-identical to r1. The commit that appends this paragraph is the only source change after r2, so the live site is one commit behind the repository by exactly this text.

| | |
| --- | --- |
| Payload | `revivecheck-public-20261025-e7044d1-public-r2.tar.gz`, 2,943,269 bytes, SHA-256 `28d73e68a464e274e01d8ef21c3174d921c66894f5c3a3d9b1aebf6773c05c77`, packed without macOS metadata |
| Files | 99 files, 5,324,725 bytes; index SHA-256 `8b1a33ae0b9bbf6df1b29a68f34bcc5ea11ea9af77e4acc28d14efa23269e1d0` (unchanged from r1) |
| Verification | all 99 files matched the manifest on the server after extraction and again when fetched over HTTPS; blocked paths 404; the four neighboring sites answered 200 |
| Live status record | `release-status.json` on the site was generated at commit `1af6ae8` and names `siteRelease 20261025-8aee632-public-r1`; that is the record this release was meant to publish |
| Rollback | `current` → `releases/20261025-8aee632-public-r1` by the same symlink replacement; r1 and r3 are retained |

Receipts: `deployment-20261025-8aee632-public-r1.json` and `deployment-20261025-e7044d1-public-r2.json` with their manifests, under `/var/www/revivecheck/ops/` on the server and in the author's local release bundle.
