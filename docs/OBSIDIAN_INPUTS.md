# How the Obsidian notes shaped ReviveCheck

Compiled on 2026-10-23. The non-private product retrospectives below were read through the Obsidian CLI in `Obsidian Vault`; no credentials, wallet material or source snapshot directories were read. This file keeps only the design principles that can be made public and the titles of the notes; it copies no private project information.

The CLI's full-text search returned empty output this time, so the notes were located with `files` and read with `read path=...`. The empty search result was not taken as proof that no relevant material exists.

## Main inputs

| Note path in the vault | Conclusion adopted | Resulting design constraint |
| --- | --- | --- |
| `Hackathons/DoraHacks/ArcPreflight · Arc Microgrants 产品与评审深度复盘.md` | A system's own demo loop cannot stand in for an external developer doing their own work; execution proof and adoption value are two separate pieces of evidence | Start from "create my project"; let the user bring their own target; measure integration time and author intervention instead of only adding internal checks |
| `Hackathons/DoraHacks/Flare Summer Signal · 获奖项目复盘.md` | One complete round trip that can be retold, one memorable point and a layered path for judges are easier to understand than a feature list; online verifiability is part of delivery | The main demo is fixed as fail, fix, rerun on the same project; a 30-second value statement, a two-minute main flow, raw evidence underneath; never make the audience read the architecture first |
| `Hackathons/DoraHacks/VeilGuard · WTF 获奖项目对照复盘.md` | An empty niche is not demand; technical necessity still has to become a reason for users to adopt; before adding features, have a stranger retell the pitch | Write innovation as a hypothesis to be verified for now; ask a stranger to retell who uses it, why, and why V3 is needed before adding checks or pages |
| `Hackathons/通用/跨平台参赛通用经验.md` | Experience must be recalibrated against this edition's rules; a report has to feed the next piece of work; eligibility, technical credibility, competitive edge and outcome status are separate | Hand evidence to the next release or maintainer through saved history and version comparison; record registration, request, receipt, deployment and submission separately; never infer this edition's rules from an old format |

`Hackathons/DoraHacks/TEGATA · HashKey 落选复盘.md` was also read; only one principle was taken from it: present incremental value through a negative case, and prove rigor and business value together. Its inferences about other contests' selection preferences were not treated as Portaldot's official scoring rules.

## Why the lifecycle is designed this way

1. **New project.** The core object belongs to the user. The built-in sample is for understanding only; a user changing one demo amount does not mean the user has connected their own project.
2. **Network, mapping and funding checks.** Start from the concrete difficulties of migrating to V3 and answer first where the current state falls short. A mapping, balance or chain state that cannot be determined must stay unknown.
3. **Run the acceptance.** Checks revolve around one reproducible target and version; an interface returning success is not the end.
4. **Fix and rerun.** Keep the failed record and use the same target to show what the change repaired. Swapping in another sample is not a fix for the original problem.
5. **Save the evidence.** Keep the mode, version, time, source, observations and open items. An export is not user value by itself, nor independent verification.
6. **Compare versions.** Let a report feed later release or maintenance decisions. Runs on different networks, modes, targets or assertion definitions must be marked as not directly comparable; a local pass does not close a testnet evidence gap.

## Boundaries these notes keep explicit

- `live read-only`: information read from the real network, with no signing, deployment or write as a result.
- `local rehearsal`: the flow reproduced locally; no Portaldot V3 deployment follows from it.
- `testnet execution`: a state adopted only once a real transaction, target and read-back evidence exist.
- Requirement interviews, use by independent developers, hours saved and willingness to pay are all unverified; the project's own demo runs do not count toward them.
- Preparation of the contest material, the formal platform submission, admin review, final eligibility and any award are recorded separately.

These lessons decide the product's trade-offs; they do not replace this edition's live official rules. The technical and contest facts are in [PARTICIPATION_RESEARCH.md](../PARTICIPATION_RESEARCH.md) at the repository root. Reading the notes led to no outreach, publication, registration or submission.
