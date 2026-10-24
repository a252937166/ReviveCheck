# Deployed v1 sources

These are the exact sources of the `VerifiedTokenList` deployed on the Portaldot V3 testnet at `0xd0bd833b4b8658b1230a0e9a99640935b3c65819` (block 164220, extrinsic `0xe3efb1e79d8544a42aa1ee4472c291e1f61538b1c6a2346ae9746ee004f56570`). Joined in this order with a newline, `ReviveCheckGuard.sol` then `VerifiedTokenList.sol`, they hash to the `sourceSha256` recorded in `public/lifecycle/token-list.json`; `test/verified-token-list.test.js` checks that.

Known issues in v1, found by the 2026-10-24 review and fixed in the v2 sources under `contracts/`:

- `ReviveCheckGuard.approvals` counted array entries, so a reviewer passed twice counted twice.
- `VerifiedTokenList.list` never checked who owned an existing entry, so any release owner could replace any token's entry with their own approved release and un-list it by submitting a new revision.

The deployed contract is immutable. The v2 contract needs its own deployment, with its own code deposit; until then the site, the feed and the recorded run describe v1.
