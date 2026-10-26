# Release gate starter

One maintainer job on the installed ReviveCheck package, from a clean directory: configure a project, retrieve and verify its evidence from the chain, evaluate the policy on fresh reads, generate a versioned token-catalog release only when the entry is permitted, and consume that release in a separate process. Nothing here signs or holds a key; every read is public.

## Files

| Path | What |
| --- | --- |
| `project.json` | the consumer configuration (`revivecheck-consumer.config.v1`): the policy, the release and revision it relies on, the stored report's extrinsic, the entry it intends to publish, who controls each role. The App's **My projects** page exports this document; the shipped one is the pUSD example on the Portaldot V3 testnet |
| `package.json` | depends on `revivecheck` from a tarball (`revivecheck.tgz`) placed in this directory; the scripts below |
| `fixtures/` | reads captured live on 2026-10-25 by the ReviveCheck example catalog (the re-approved revision 2, and the revoked one), for the offline cases |
| `read-example.mjs` | the example reader: a separate process that verifies a release and fills a token selector from it |
| `.github/workflows/release-gate.yml` | the same commands in CI: the permitted and the refused case offline, a manual live job |

## Set up

```sh
cp <the ReviveCheck artifact>/revivecheck-<version>.tgz ./revivecheck.tgz   # or: npm pack inside a ReviveCheck checkout
npm install
```

The package's `docs/LIBRARY.md` and `docs/POLICY.md` document every function and document schema used here.

## Run

```sh
# Live: retrieve the bound report from the chain, read the registry, the consumer and the network, evaluate, write releases/catalog-release-<n>.json only when permitted.
npm run gate
# Exit 0 permitted (release written) · 1 refused (known policy or entry refusal; outcome and evidence written, no release)
#      2 unknown (a read was unavailable; never a pass) · 3 configuration error

# Offline, the same code path on captured reads: permitted, then refused.
npm run gate:fixture
npm run gate:refused        # exit 1; no release file

# Read a release: verify it from the document alone, apply each entry's permission deadline (or re-evaluate with --live), fill the selector.
npm run read -- releases/catalog-release-1.json
npm run read -- releases/catalog-release-1.json --live
npm run read:example -- releases/catalog-release-1.json --now 2026-10-25T09:43:18.329Z

# A later release names the earlier one; compare them entry by entry.
npx revivecheck-catalog prepare --config project.json --out releases --previous releases/catalog-release-1.json
npm run compare -- releases/catalog-release-1.json releases/catalog-release-2.json
```

Every run writes `outcome.json` (`revivecheck.release-gate-outcome.v1`): the status, the exit code, the reason codes and, for a refusal, field-level diagnostics (JSON pointer, configured, approved and observed values, the checkpoint, the responsible role, the next action) and `decision-evidence.json` (`revivecheck.decision-evidence.v1`), which `reconstructDecision` re-derives offline.

## Publication rule

A release file is immutable. `prepare` writes it fully to a temporary file, publishes it through an exclusive no-replace link, reads it back and verifies its hash before claiming it. Version 1 opens a release line in an empty directory; every later version names its verified predecessor with `--previous`. Running `npm run gate` twice into `releases/` therefore ends with exit 4 (`publication-conflict`) the second time and leaves release 1 untouched, unless the bytes are identical (then the outcome says `reused`, exit 0). Every run keeps its own `outcome.json` and `decision-evidence.json` under `releases/runs/<runId>/`; the files at the top of the directory are the most recent run's copies and name their `runId`. To publish version 2:

```sh
npx revivecheck-catalog prepare --config project.json --out releases --previous releases/catalog-release-1.json
```

## What a release is

`revivecheck.catalog-release.v1`: the entries that were eligible at generation (every field derived from the approved report), the entries withheld with their diagnostics, one decision-evidence document per entry, the earliest permission deadline, the previous release's hash and a recomputable hash of its own. A reader (`readCatalogRelease`) verifies the hash and every embedded decision, then decides per entry at the clock it is given: without fresh reads only the deadline is applied, and the result says so; with fresh reads the binding is evaluated again under the release's own policy. An expired release is history; a hash-valid file is not proof that an approval still stands.

## Configure your own project

Replace `project.json` with the consumer configuration exported from the ReviveCheck App (**My projects → Export → Consumer configuration**) after your release was checked, stored, submitted, approved and bound there, or write it by hand following `docs/POLICY.md`. The gate refuses a configuration whose entry is not the policy subject, whose policy requires stored evidence without a storage extrinsic, or whose fields do not validate, and names the field.

This starter was built and run by the ReviveCheck project; it shows a reusable integration, not adoption by a third party.
