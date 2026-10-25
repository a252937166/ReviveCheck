# Maintainer pilot protocol: observed decisions on real token lists

**Status: not yet run.** Written 2026-10-25 for assessment item A-06. No participant has been recruited, no session has taken place, and nothing below is a result. The scripted comparison that this protocol extends is in `docs/VALUE_EXPERIMENT.md`.

## Purpose

The scripted benchmark shows that two implementations of the same five checks reach the same decisions on identical inputs. It says nothing about people. This pilot observes three to five maintainers of Portaldot wallet or DEX token lists making the same decision twice, once with the process they use today and once with ReviveCheck, and records what happened. The sample is small by design. It supports statements about individual cases, not about maintainers in general.

## Roles

Recruit each role separately; one person may hold two roles only if that is how their organization actually works, and the sheet records it.

| Role | Who | What they do in the pilot |
| --- | --- | --- |
| Maintainer | the person who decides whether a token entry goes into a list that wallets or a DEX read | performs the timed tasks in both arms |
| Reviewer | a second person who did not perform the task; ideally the person who approves listings today, or a colleague who would audit one | receives only the output artifact of a task and fills in the reconstruction form |
| Economic buyer | the person who would approve paying for, hosting or scheduling such a check (a lead maintainer, a product owner, a treasury or operations lead) | a 20-minute interview after the sessions; no timed task |

Three to five maintainers are the target. One well-documented maintainer with their reviewer is still worth running; report its scope instead of generalizing.

## Documented per participant before any task

- The list they maintain (name, where it is published, roughly how many entries, who reads it).
- The recurring trigger: when a listing decision comes up (new token request, metadata change, a report or audit being superseded, a reviewer withdrawing approval, a runtime upgrade), and how often.
- The decision owner, and who else must agree.
- The cost of a wrong enable (what happened the last time an entry was wrong, or what would) and of a wrong refusal (a token left out).
- The current substitute: the exact steps, tools and records they use today (explorer pages, a script, a spreadsheet, a pull-request review, a chat approval). This is their baseline arm. The pilot does not replace it with the benchmark's script unless they have no scripted process, in which case the benchmark baseline is offered as the substitute and recorded as such.

## Arms

- **Baseline:** the participant's documented current process, unchanged, run by the participant.
- **ReviveCheck:** `catalog.js acceptance` on a catalog configuration written by the participant for their own token during setup, with the explicit binding step. Setup is measured separately and is not part of the repeat decisions.

Both arms answer the same question for each scenario: may this entry be enabled right now? Both must produce a decision and whatever record the arm naturally leaves (a script log, a note, a comment, or the catalog and evaluation files).

## Setup phase (measured once, separately)

1. Installation: `git clone`, `npm ci`; wall clock by stopwatch, plus the output of `npm ci`.
2. Writing the policy and catalog configuration: active time, number of fields the participant filled in, number of fields they asked about, and every field they got wrong on the first try.
3. The explicit binding of their approved report (one command with six arguments): active time and assistance.
4. For the baseline, document what setting up their current process cost them originally if they can estimate it; mark it as recalled, not measured.

## Scenarios

The same five as the scripted benchmark, each prepared for the participant's own token where the chain state permits, and otherwise on the pUSD test token with captured inputs:

| # | Scenario | Expected decision | Inputs |
| --- | --- | --- | --- |
| 1 | correct entry | enable | the participant's entry as approved and listed |
| 2 | incorrect decimals | refuse | the same state with the entry's decimals changed to 18 |
| 3 | superseded report | refuse | an approval record for a revision the registry has since replaced (captured inputs, lifecycle step 7) |
| 4 | revoked approval | refuse | the trusted reviewer requested changes (captured inputs, lifecycle step 11) |
| 5 | unavailable verification | refuse | the nodes do not answer (captured error inputs; or a disconnected network for the live arm) |

Expected decisions are fixed before the session and written on the observation sheet. Scenario 5 is the one where a participant's own process may have no defined answer; whatever they do is recorded as is.

## Counterbalancing

Participants alternate arm order: P1 ReviveCheck first, P2 baseline first, P3 ReviveCheck first, and so on. Within an arm, scenario order follows one of two fixed sequences (1-2-3-4-5 or 1-4-2-5-3), alternating between participants. Scenario 1 always comes first so the participant sees a complete positive case before the negative ones. Order is recorded per task.

## Measures (per task)

| Measure | How it is taken |
| --- | --- |
| active time | stopwatch, started when the task is read out and stopped at the stated decision; paused while the participant waits for a node, an explorer page or a command to return, and resumed when they act again |
| network wait | the paused time, recorded separately; for ReviveCheck the command's own timing is also kept |
| completion | whether a decision was stated (enable / refuse / cannot decide) |
| false enable | the decision was enable where the expected decision was refuse |
| false refusal | the decision was refuse where the expected decision was enable |
| assistance requests | each question the participant asked the observer, verbatim, and whether it was answered |
| corrections | each time the participant changed a decision, a field or a command after noticing a mistake |
| tool failures | each error message, timeout or crash, verbatim |
| record left | what artifact exists after the task (file paths, screenshots, notes) |

The observer does not help unless asked, and records every answer given.

## Second-reviewer reconstruction test

After each task the reviewer receives only the artifact the arm left (for the baseline, whatever the participant produced; for ReviveCheck, `catalog.json` and `evaluations/<token>.json`). No chain access, no conversation with the maintainer. The reviewer fills in a form with six items and may write "cannot tell":

1. the decision (enable or refuse);
2. the exact report hash the decision rests on;
3. the reviewer whose approval was relied on;
4. the checkpoint(s) read (block number or hash);
5. the reasons, if refused;
6. the next action.

Each item is scored present or absent against the known answer, and the time to fill the form is recorded. `examples/token-catalog/benchmark/reconstruct-decision.mjs` scores the scripted artifacts the same way and serves as the reference for what "present" means.

## Observation sheet

One CSV row per task, UTF-8, header included. Free text is quoted.

```
participant,session_date,arm,arm_order,scenario_id,scenario_order,expected_decision,stated_decision,completion,false_enable,false_refusal,active_seconds,network_wait_seconds,assistance_requests,assistance_text,corrections,corrections_text,tool_failures,tool_failures_text,artifact_paths,reviewer_code,reconstruction_present_count,reconstruction_absent_items,reconstruction_seconds,observer_notes
```

Setup rows use the same file with `arm` set to `setup-baseline` or `setup-revivecheck`, `scenario_id` set to `install`, `policy`, `binding` or `recalled`, and the field counts in `observer_notes`.

## Anonymization

Participants are coded P1 to P5 and reviewers R1 to R5. The code sheet linking codes to people is kept by the observer only and is not committed. Retained files carry codes, never names, employers, chat handles or personal wallets. A participant's public token-list repository or contract address identifies them; it is retained only with their explicit consent, otherwise the retained sheet says "participant's own token" and the case is reproduced on pUSD captures.

## Consent

Before the session, in writing: what is recorded (sheet entries, verbatim questions, error messages, artifacts), that no screen or audio recording is made unless they agree separately, that they may stop at any time and have their rows deleted, where the data is stored and for how long (twelve months, then deleted), and that nothing they say or do will be presented as an endorsement. No chain transaction is signed with a participant's key during the pilot; scenarios that need a signed state change use captured inputs.

## Retention

Everything below is kept under `artifacts/pilot-<date>/` with a `manifest.json` listing file hashes, and nothing is removed because it is unfavorable:

- this protocol as used, with any deviation noted;
- tool versions: commit, Node, `npm ls --depth=0`, node endpoints, runtime version observed;
- task inputs: the captures and configurations used, with hashes;
- the observation sheet;
- every artifact a task left, as produced;
- every failure, timeout and crash, verbatim;
- the reconstruction forms;
- the economic-buyer interview notes (coded).

## Economic-buyer interview (after the sessions)

Twenty minutes, notes only. What the listing decision costs them today in time and in incidents; who owns the budget for tooling; whether they would run the scheduled acceptance check on their list for thirty days, and under what conditions; what would make them stop. A yes to a thirty-day run on a real list, with a date and a named owner, is recorded as a pilot commitment. Encouraging remarks are recorded as remarks.

## Claims permitted from this sample

- Case-level statements only: "P2 refused the superseded report with ReviveCheck and enabled it with their current process", with the sheet row as the source.
- Counts across participants may be reported as counts (for example "3 of 4 reviewers reconstructed the report hash from the baseline artifact"), never as rates generalized beyond the participants.
- No speed claim unless both arms were timed by the same stopwatch rules on the same scenarios for the same participant; even then it describes that participant.
- Completion, false enables, false refusals, assistance and reconstruction are reported for every participant, including the ones that went against ReviveCheck.
- Adoption and willingness to pay are supported only by a recorded pilot commitment and observed repeated use, not by interview sentiment.

## Session plan (about 90 minutes per maintainer)

1. 10 min: consent, participant documentation (trigger, owner, failure cost, substitute).
2. 20 min: ReviveCheck setup, measured (install if not pre-installed, policy, binding).
3. 25 min: first arm, five scenarios.
4. 25 min: second arm, five scenarios.
5. 10 min: debrief; the participant may say what they would change, recorded as remarks.

The reviewer session (about 30 minutes) is scheduled separately and before the maintainer's debrief is shared with them.
