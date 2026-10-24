# ReviveCheck Offline Review Scope

This evidence package supports the user-authorized English description of ReviveCheck's current problems, improvement directions, and supporting evidence. It is a local diagnostic review, not an implementation change or a live-chain security test.

## Authorized diagnostic work

- Compile the current ReleaseRegistry, ReviveCheckGuard, and VerifiedTokenList sources with the project's existing pinned compiler helpers.
- Reproduce duplicate reviewer counting in a diagnostic harness inside an in-memory EVM.
- Reproduce an unrelated self-approved release replacing and then invalidating an existing token entry under the open-curator configuration, inside the same in-memory EVM.
- Call the current replay adapter with local checkpoint mocks and the unchanged retained ReleaseGate report to measure actual coverage and status behavior.
- Write this scope, the diagnostic script, and its results only inside `artifacts/review-2026-10-24/`.

## Boundaries

No network requests, private key loading, wallet connections, signing, real-chain deployments, or transaction broadcasts are part of this review. The script denies global `fetch`, passes only local mocked clients to the replay adapter, and uses in-memory EVM message calls. Existing compiler helpers are imported as functions; their artifact-writing CLI branches are not executed. Production sources, tests, sealed reports, and transaction history are not modified.

The source SHA-256 snapshot in `reproduction-results.json` binds the observations to the exact local inputs. The script checks those hashes again before writing its results, so concurrent changes to those reviewed inputs cause failure rather than a mixed-source result. `createdAt` records the actual diagnostic execution time; the directory date identifies this review package.

## Retained evidence

- ReleaseGate report: `9dd04e0685d06a1a9a0525b2b8d6ac4b259d1618184789f345a7be5e55ae0645`.
- Historical baseline: `0272674216c3687911b6e97349414d39a31eb49c8173c02919262dfafc9dc0d5`.

Both identifiers are retained exactly. The report's original fingerprint is verified without resealing or rewriting it. Mocked checkpoint agreement in the diagnostic does not establish current-chain truth.

## Reproduction

Run from the redesign project root with existing dependencies installed:

```sh
node artifacts/review-2026-10-24/reproduce-findings.mjs
```

The script writes `artifacts/review-2026-10-24/reproduction-results.json` and prints the same JSON. It exits with a nonzero status if the three currently documented behaviors no longer reproduce. After any implementation change, treat an older result as a historical snapshot and rerun the diagnostics against the new inputs.
