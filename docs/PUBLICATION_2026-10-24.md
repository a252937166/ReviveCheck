# Public release provenance: October 24, 2026

This source candidate records the frozen source for release `20261024-92f3091-public-r3` at https://revivecheck.axiqo.xyz. It is based on commit `92f309159ec114e5c4d6a772cb0decb65181aa1a`. The 269 files declared in the final source manifest match their frozen SHA-256 values exactly; this provenance document is the sole additional source file.

## Frozen payload and source

- Final source manifest SHA-256: `5e1e607bb8a2a9ed8f0622bf6c0f9261c911c71ff85def9bb249235c9225188f`.
- Static payload SHA-256: `6a1b08c02d339c0b37501f918b5def7694fc382555521f66d61c9d2f6de2f2c6`.
- Release index SHA-256: `4ef6163849aeb408d8a33ab4b43d148ff866e6abebe42b085e751303474c9b78`.
- Current video: https://www.youtube.com/watch?v=CvpzlQfya4U . The actual public privacy, successful processing, exact title and description, custom thumbnail and anonymous CUA playback were verified separately. The video is 168.021 seconds at 1920x1080 and 30 fps, with burned-in English captions.
- Video SHA-256: `d9a267811ba133ac9075adacdab52fa8a4af6046d93f8dbfae71637dfdd6b514`. No new video binary is included in this source candidate.

The snapshot patch contains presentation, indexer-pagination and deployment-sensitive regression corrections. The public feed is a separately generated artifact, refreshed through block `177549`; it deliberately differs from the initial copied feed at block `164338`. All final source hashes, including that refreshed feed, were checked against the final source manifest. Original sealed reports and the retained baseline are unchanged.

## Validation and evidence boundaries

The frozen implementation passed 160 tests. The final own-domain review-link change passed its six targeted tests, and the final Vite production build with base `/` passed. This source reconstruction used exact hash verification and did not repeat those tests, sign a transaction, modify the live checkout or push a branch.

VerifiedTokenList v2 at `0xedaf8a25bb583ad164a94191b762414277198df9` was finalized at block `177354`, passed all nine deployment-verification checks and is selected in the public activation configuration. Its first listing and live v2 Token Catalog acceptance remain pending. Existing v1 transactions and the v1 policy observation are historical evidence. The full revision, revocation, rebinding and renewal sequence is a SIMULATED local demonstration. The testnet owner and reviewer are the same project-controlled account; independent review or adoption is not claimed.

The current site uses the published YouTube video. New report links and QR destinations use the current own domain; historical report bytes and their original links remain preserved.
