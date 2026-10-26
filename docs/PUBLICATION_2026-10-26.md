# Public release provenance: October 26, 2026

The hosted site <https://revivecheck.axiqo.xyz/> was republished from source commit [`06849813ecc993a44b1ece1df4bd49795450e6cb`](https://github.com/a252937166/ReviveCheck/commit/06849813ecc993a44b1ece1df4bd49795450e6cb), to which GitHub `main` and `redesign/custody-record` were fast-forwarded the same day (from `455cc60`). The release carries the 2026-10-26 repairs (`docs/2026-10-26_repair-completion.md`): the configuration boundary guard, corrected-plan adoption, fresh-browser bundles, immutable catalog releases with their release line, studio requests owned above the page, renewal from verified state, and the status documents at package 0.5.3. The same day the separate consumer was published for the first time (below).

## Site release r1

| | |
| --- | --- |
| Release | `20261026-0684981-public-r1`, served from `/var/www/revivecheck/current` → `releases/20261026-0684981-public-r1` |
| Build | `npx vite build --base /` at commit `0684981`, built 2026-10-26T11:16:22Z into a scratch output directory (the checkout held one untracked document of another agent, `docs/2026-10-26_demo-tls-repair.md`, which is not part of the build) |
| Payload | `revivecheck-public-20261026-0684981-public-r1.tar.gz`, 2,986,499 bytes, SHA-256 `b99eb2d1146d76cb432b0d52da062721fee0d5cb666e0abfdf38eb2c7369a6b0`, packed without macOS metadata |
| Files | 99 files, 5,488,117 bytes; per-file SHA-256 in `sha256-20261026-0684981-public-r1.txt`; `hosting.json` (`revivecheck.hosting-manifest.v1`, manifest SHA-256 `6a696ccc…de57f`) placed beside the files, the first release to carry one |
| Public index SHA-256 | `28d62dae390a07118cc03cfc827e1d45f91b89a243c809f1e0379408036fd486` |
| Activated | 2026-10-26T11:18:26Z by atomically replacing the `current` symlink; the previous release `20261025-e7044d1-public-r2` is retained for rollback, as are r1 of 2026-10-25 and r3 of 2026-10-24 |
| Nginx | `/etc/nginx/conf.d/revivecheck.conf` unchanged, SHA-256 `df68beecc4b0aac3023094bf364457ebb2c2ef577d94061bbb01f55460a2e1fc`; no reload |

### Verification

- On the server, every one of the 99 files matched its hash after extraction; no `._*` entry was extracted.
- From outside, `node scripts/verify-hosting.mjs --site https://revivecheck.axiqo.xyz/ --commit 0684981… --release 20261026-0684981-public-r1` reported every check ok: `hosting.json` served as `application/json` with the schema, commit, release and build time as built, and the served `index.html` hash equal to the manifest's. All 99 files were fetched over HTTPS and matched. `release-status.json` serves the record generated at commit `2cc2d63`. `app/catalog` answers with the page (200); HTTP redirects to HTTPS (301).
- Blocked or absent paths return 404: `api/workspaces`, `.private/wallet.json`, `._index.html`, `api/._registry.json`.
- Neighboring sites answered 200 after activation: `axiqo.xyz`, `recart.axiqo.xyz/api/health`, `attest.axiqo.xyz`, `faktura.axiqo.xyz`.
- Receipts: `deployment-20261026-0684981-public-r1.json`, `hosting-20261026-0684981-public-r1.json`, `hosting-verification-20261026-0684981-public-r1.json`, the SHA-256 list and the payload under `/var/www/revivecheck/ops/` on the server.

### Rollback to r2 of 2026-10-25

1. Confirm `/var/www/revivecheck/current` points to `releases/20261026-0684981-public-r1` and the vhost SHA-256 still equals `df68beec…`. Stop if either differs.
2. `ln -s releases/20261025-e7044d1-public-r2 /var/www/revivecheck/current.tmp && mv -Tf /var/www/revivecheck/current.tmp /var/www/revivecheck/current`.
3. Verify the r2 index SHA-256 `8b1a33ae0b9bbf6df1b29a68f34bcc5ea11ea9af77e4acc28d14efa23269e1d0` over HTTPS. No Nginx reload is needed. Preserve every release directory, payload and receipt.

## The separate consumer, published

| | |
| --- | --- |
| Repository | <https://github.com/a252937166/revivecheck-consumer-example>, created public on 2026-10-26 with `main` at commit `52ca088` (the 0.5.3 artifact vendored); the optional Pages mirror <https://a252937166.github.io/revivecheck-consumer-example/> is built by its workflow on every push |
| Demo | <https://demo.revivecheck.axiqo.xyz/>, release `20261026-52ca088-demo-r1` from commit `52ca088` (`WEB_BASE=/ npm run web:build`), served from `/var/www/revivecheck-demo/current` on the same server under the vhost and certificate prepared earlier that day (`docs/2026-10-26_demo-tls-repair.md`; vhost SHA-256 `c86c3cc8…42058`, unchanged by the deployment) |
| Payload | `revivecheck-demo-20261026-52ca088-demo-r1.tar.gz`, SHA-256 `8e97a4e085dd625829a2006c91b8e9a70757e806feea2baca657705816917996`; 4 files plus `hosting.json` (`revivecheck-consumer.hosting-manifest.v1`); index SHA-256 `5afcc667537a7e2658269d86deb0251507593f1485ab5f3e3ddeffbb4791b4f2` |
| Activated | 2026-10-26T11:18:55Z (the first release; the server's pending guard disappeared) |
| Verification | every file verified on the server and over HTTPS; `scripts/verify-hosting.mjs --site https://demo.revivecheck.axiqo.xyz/ --commit 52ca0880…` every check ok; `/api/anything` and `/.git/config` 404; HTTP redirects to HTTPS. In a clean browser against the public URL, the consumer's release journey passed 11 of 11 at 11:21:57Z: the wrong entry withheld with `entry-mismatch:decimals`, the corrected entry available with a stated deadline, release 1 `2a173b58…` prepared at 11:23:16Z (evaluation `a4135980…` at block 202,605), verified in Node, read by `revivecheck-catalog read` in another process and loaded back into the reader; no console errors |
| Receipts | under `/var/www/revivecheck-demo/ops/` on the server and in the consumer's `docs/DEPLOYMENT.md` |

The consumer's first hosted CI run failed at its repeat-conflict step: a repeat of the fixture gate with the fixture's own clock produces identical bytes, which the gate reuses by design (exit 0), so the step's expectation of a conflict was wrong; the step now expects the identical repeat to be reused and a repeat at another clock to conflict with exit 4, both leaving the release's bytes unchanged. The product behaved as documented.

## What this publication does not change

- The YouTube video and the DoraHacks build description still describe the 2026-10-24 release; no DoraHacks or Discord message was sent.
- The GitHub Pages site of this repository (`gh-pages`) was not touched.
- No renewal transaction was prepared or sent; the bound report `1faef921…` still expires 2026-11-01T09:29:17.646Z (`docs/RENEWAL.md`).
- The consumer remains author-built and author-run: a public URL and a public repository, not adoption or independent review.
