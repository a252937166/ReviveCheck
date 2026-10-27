# Demo hostname TLS repair

> Historical TLS-only receipt. The pending-application/503 state below describes the end of the certificate repair. The consumer was subsequently published on 2026-10-26 and now serves HTTPS 200; see [publication provenance](PUBLICATION_2026-10-26.md) and [the public demo](https://demo.revivecheck.axiqo.xyz/).

Completed October 26, 2026, on the existing DogYun server. The user requested diagnosis and repair of the browser certificate warning for `https://demo.revivecheck.axiqo.xyz/`.

## Cause

Public DNS correctly pointed both the main application and demo hostname to `206.237.18.80`. The demo had no dedicated Nginx virtual host or deployed application directory. Its requests fell through to the default personal website, which returned the uploaded TrustAsia certificate containing only `axiqo.xyz` and `www.axiqo.xyz`.

A root-domain certificate covers only the names actually declared in its SAN extension. Even `*.axiqo.xyz` would cover `revivecheck.axiqo.xyz`, but would not cover the additional level in `demo.revivecheck.axiqo.xyz`. The existing main-application certificate also covered only its exact hostname. Changing DNS would not extend either certificate's coverage.

## Changes completed

- Added `/etc/nginx/conf.d/revivecheck-demo.conf` with the exact demo `server_name`.
- Issued a free dedicated Let's Encrypt certificate through the existing ACME account and a public HTTP-01 webroot challenge. Its exact SAN is `demo.revivecheck.axiqo.xyz`.
- Configured the certificate at `/etc/letsencrypt/live/demo.revivecheck.axiqo.xyz/fullchain.pem` and its existing managed private-key path. No private-key content was displayed or published.
- Configured HTTP-to-HTTPS redirection and retained the HTTP challenge location for renewal.
- Used the running server's `/usr/local/sbin/nginx-modern` binary for configuration validation, then reloaded through `systemctl reload nginx`. The older `nginx` binary on PATH is not the running implementation.
- Integrated with the existing active `certbot-renew.timer`; its existing reload hook reloads Nginx after successful renewals. A scoped staging renewal dry run passed with `--no-random-sleep-on-renew`.
- Prepared `/var/www/revivecheck-demo/acme`, `/var/www/revivecheck-demo/releases` and `/var/www/revivecheck-demo/ops`.

No DNS record, existing certificate, existing virtual host, application release, main-site symlink or wallet was changed. No product build or transaction was published by this operation.

## Verification

| Check | Result |
| --- | --- |
| Public DNS | Demo A record `206.237.18.80`; no demo AAAA record |
| Demo HTTPS with normal certificate validation and SNI | Passed; exact-name Let's Encrypt certificate |
| Certificate expiry | `2027-01-24T05:16:42Z` |
| Certificate SHA-256 fingerprint | `A4466DCE003856A05726A203EB78B92CF709301C819761147CD93DBA0D222F03` |
| Demo HTTP | 301 to the same hostname over HTTPS |
| Demo application response | Intentional 503, English plaintext explaining that application publication is pending |
| Renewal simulation | Passed for this certificate |
| Main app, apex, ReCart health, Attest and Faktura | All returned 200 with normal HTTPS verification after the repair |
| Existing Nginx files | Original hashes unchanged |
| Main application's index | Unchanged SHA-256 `8b1a33ae0b9bbf6df1b29a68f34bcc5ea11ea9af77e4acc28d14efa23269e1d0` |

Public checks bypassed local fake-IP DNS and used the actual public address with the requested hostname/SNI. HTTPS validation did not use an insecure bypass after activation.

## Application publication remains separate

The TLS warning is repaired. The independently built consumer has not been deployed to this server, so the hostname currently returns:

```text
ReviveCheck consumer demo deployment is pending.
HTTPS is configured. The independent application has not been published yet.
Main application: https://revivecheck.axiqo.xyz/
```

The vhost is already prepared to serve `/var/www/revivecheck-demo/current`. After the agreed consumer correctness repairs, deploy a verified static release, generate its real `hosting.json`, verify every file and atomically switch `current` to the release. The pending guard disappears when the verified release contains `index.html`; no DNS, certificate or additional Nginx change is required for that activation.

Keep `/hosting.json` a real JSON document: it returns 404 until published. Hidden paths and `/api/` are denied; only the static consumer is intended for this origin. A valid TLS certificate does not establish a deployed app, a current policy decision or completion of the seven product repairs.

## Receipts and rollback

Server receipts, original hashes, bootstrap/final vhost copies, issuance log and renewal-test log are retained under:

```text
/var/www/revivecheck/ops/tls-demo-20261026T061414Z/
```

The final vhost SHA-256 is `c86c3cc81a12cb4b87015763b1ff698090c33b682b826b781e3aa61ed1242058`.

To roll back only this vhost, first verify it still has that hash and that no other process has changed it. Move it outside the included `conf.d/*.conf` path, test the active Nginx binary and reload. Preserve the certificate, ACME webroot and receipts. Removing the demo vhost restores the old default-site/certificate behavior; it does not make the hostname valid. Do not modify neighboring vhosts as part of rollback.
