// The catalog's lifecycle, end to end, on the local stand-in chain. Three fixture
// accounts play the roles: A owns the release, B reviews, C is a stranger. The
// catalog operator is this process. Each step records what was done, how the
// contracts answered, and what the policy evaluation says about the pUSD entry.
// EXPECTED is the sequence the demo must reproduce; `demo --strict` and the test
// both check against it.
import { createBinding, evaluateBinding, summarizeEvaluation } from '../../../lib/policy.js';
import { demoPlan } from '../../../lib/demo.js';
import { nativeAssetAddress } from '../../../lib/chain.js';
import { createLocalChain } from './local-chain.js';
import { appendBinding, buildCatalog, latestBinding, normalizeConfig } from './catalog.js';

const LABEL = 'pusd-token-list';
const DAY = 86400;

export const EXPECTED = Object.freeze([
  ['check-v1.0.0', 'unbound'], ['recheck-v1.0.1', 'unbound'], ['submit', 'recheck-required'], ['approve', 'recheck-required'], ['list', 'valid'],
  ['stranger-replace', 'valid'], ['revision-2', 'recheck-required'], ['approve-r2', 'recheck-required'], ['rebind-r2', 'recheck-required'], ['relist', 'valid'],
  ['revoke', 'recheck-required'], ['reapprove', 'valid'], ['wrong-target', 'recheck-required'], ['runtime-change', 'recheck-required'], ['node-unavailable', 'unknown'],
  ['expire', 'expired'], ['renew', 'valid'],
]);

export async function runLocalLifecycle({ config: rawConfig, startAt = '2026-10-24T12:00:00.000Z' } = {}) {
  const config = normalizeConfig(rawConfig);
  if (config.mode !== 'local') throw new Error('The scripted lifecycle runs on the local configuration.');
  let now = new Date(startAt);
  const clock = () => now;
  const tick = (seconds) => { now = new Date(now.getTime() + seconds * 1000); };
  const chain = await createLocalChain({ clock });
  const { owner: A, reviewer: B, stranger: C } = chain.accounts;
  const { policy } = config;
  const token = chain.token;
  let bindings = Object.freeze([]);
  const reports = [];
  const transcript = [];
  const operator = `catalog operator (${config.roles.operator.control})`;

  async function evaluate() {
    const binding = latestBinding(bindings, token);
    if (!binding) return null;
    const report = reports.find((item) => item.evidenceHash === binding.reportHash);
    const safely = async (read) => { try { return await read(); } catch (error) { return { error: error.message }; } };
    const [registry, listing, observation] = await Promise.all([
      safely(() => chain.readRegistry({ releaseId: binding.releaseId, reviewers: policy.reviewers.trusted })),
      safely(() => chain.readTokenList({ token })),
      safely(() => Promise.resolve(chain.observe())),
    ]);
    return evaluateBinding({ policy, binding, report, registry, observation, listing, now });
  }
  async function step(id, actor, action, perform) {
    tick(30);
    const outcome = {};
    try { Object.assign(outcome, (await perform()) || {}); } catch (error) { outcome.reverted = error.revert || error.message; }
    const evaluation = await evaluate();
    const listed = await (async () => { try { return (await chain.readTokenList({ token })).listed; } catch { return null; } })();
    transcript.push({ step: id, at: now.toISOString(), block: chain.height(), actor, action, outcome, listed, status: evaluation ? evaluation.status : 'unbound', available: evaluation?.enable === true, reasons: evaluation ? evaluation.reasons.map((reason) => reason.code) : ['no-binding'], summary: evaluation ? summarizeEvaluation(evaluation) : 'no binding yet', evaluation });
    return { outcome, evaluation };
  }
  const bind = (report, releaseId, revision, note) => { const binding = createBinding({ policy, report, releaseId, revision, boundBy: operator, boundAt: now.toISOString(), note }); bindings = appendBinding(bindings, binding, policy); return binding; };

  // 1. The release owner checks a wrong release, then the corrected one. Nothing is bound yet.
  const failed = await chain.check(demoPlan('v1.0.0'));
  reports.push(failed);
  await step('check-v1.0.0', 'A (owner)', 'check release v1.0.0 (18 decimals) against the fixtures', async () => ({ reportHash: failed.evidenceHash, reportStatus: failed.status, observed: failed.checks.find((check) => check.id === 'token.listing')?.observed }));
  const r1 = await chain.check(demoPlan('v1.0.1'), { previous: failed });
  reports.push(r1);
  await step('recheck-v1.0.1', 'A (owner)', 'recheck with v1.0.1 (6 decimals)', async () => ({ reportHash: r1.evidenceHash, reportStatus: r1.status }));
  // 2. A submits, the operator binds the exact report: not yet approved, not yet listed, so unavailable.
  let release;
  await step('submit', 'A (owner)', `submit the passed report under "${LABEL}", then the operator binds it`, async () => { release = await chain.submit(A, LABEL, r1.evidenceHash); const binding = bind(r1, release.releaseId, release.revision, 'first binding'); return { releaseId: release.releaseId, revision: release.revision, bindingId: binding.id }; });
  await step('approve', 'B (reviewer)', 'approve revision 1 by naming its exact report hash', () => chain.review(B, release.releaseId, r1.evidenceHash, true));
  await step('list', 'A (owner)', 'list pUSD in the VerifiedTokenList on B’s approval', () => chain.list(A, { token, releaseId: release.releaseId, reportHash: r1.evidenceHash, reviewer: B, decimals: 6 }));
  // 3. A stranger with a self-approved release cannot take the entry (v2 entry ownership).
  await step('stranger-replace', 'C (stranger)', 'self-approve an unrelated release and try to replace, then delist, the pUSD entry', async () => {
    const other = await chain.submit(C, 'other-release', '22'.repeat(32));
    await chain.review(C, other.releaseId, '22'.repeat(32), true);
    const attempts = {};
    try { await chain.list(C, { token, releaseId: other.releaseId, reportHash: '22'.repeat(32), reviewer: C, decimals: 6 }); attempts.list = 'accepted'; } catch (error) { attempts.list = error.revert || error.message; }
    try { await chain.delist(C, token); attempts.delist = 'accepted'; } catch (error) { attempts.delist = error.revert || error.message; }
    return attempts;
  });
  // 4. A new revision clears the approval and un-lists the token; the old binding does not follow it.
  const r2 = await chain.check({ ...demoPlan('v1.0.1'), release: 'v1.0.2', sourceRevision: 'pusd-token-list@1.0.2' }, { previous: r1 });
  reports.push(r2);
  let revision2;
  await step('revision-2', 'A (owner)', 'submit a new report (v1.0.2) as revision 2', async () => { revision2 = await chain.submit(A, LABEL, r2.evidenceHash); return { reportHash: r2.evidenceHash, revision: revision2.revision }; });
  await step('approve-r2', 'B (reviewer)', 'approve revision 2; the catalog still holds the revision-1 binding', () => chain.review(B, release.releaseId, r2.evidenceHash, true));
  await step('rebind-r2', 'operator', 'bind the revision-2 report explicitly; the token list still carries the old entry', async () => ({ bindingId: bind(r2, release.releaseId, revision2.revision, 'rebound after revision 2').id }));
  await step('relist', 'A (owner)', 'list pUSD again on revision 2', () => chain.list(A, { token, releaseId: release.releaseId, reportHash: r2.evidenceHash, reviewer: B, decimals: 6 }));
  // 5. Revocation and re-approval: the on-chain decision, nothing else, decides.
  await step('revoke', 'B (reviewer)', 'request changes on revision 2', () => chain.review(B, release.releaseId, r2.evidenceHash, false));
  await step('reapprove', 'B (reviewer)', 'approve revision 2 again', () => chain.review(B, release.releaseId, r2.evidenceHash, true));
  // 6. A passing report about another asset cannot be bound to this subject.
  await step('wrong-target', 'operator', 'bind a passing report about asset 8888 to the pUSD entry, then restore the right binding', async () => {
    const otherPlan = demoPlan('v1.0.1');
    const other = await chain.check({ ...otherPlan, logicalContractId: 'token-list:portaldot-v3:other', nativeAsset: { assetId: '8888', holder: '' }, listing: { ...otherPlan.listing, address: nativeAssetAddress('8888') } });
    reports.push(other);
    if (other.status !== 'passed') throw new Error('The wrong-target report is meant to pass on its own subject.');
    const wrong = bind(other, release.releaseId, revision2.revision, 'wrong target');
    const evaluation = await evaluate();
    bindings = appendBinding(bindings, createBinding({ policy, report: r2, releaseId: release.releaseId, revision: revision2.revision, boundBy: operator, boundAt: now.toISOString(), note: 'restored after the wrong-target binding' }), policy);
    return { wrongBindingId: wrong.id, wrongTargetStatus: evaluation.status, wrongTargetReasons: evaluation.reasons.map((reason) => reason.code) };
  });
  // The wrong-target step reports the status seen while the wrong binding was current.
  transcript.at(-1).status = transcript.at(-1).outcome.wrongTargetStatus;
  transcript.at(-1).reasons = transcript.at(-1).outcome.wrongTargetReasons;
  transcript.at(-1).available = false;
  // 7. A runtime change on the fixture node, then an outage: neither is detected by a contract.
  await step('runtime-change', 'fixture node', 'the node reports runtime 3003; the report pinned 3002', async () => { chain.setRuntime('3003'); return { runtime: chain.observe().runtime }; });
  chain.setRuntime('3002');
  await step('node-unavailable', 'fixture node', 'the node stops answering', async () => { chain.setReachable(false); return { reachable: false }; });
  chain.setReachable(true);
  // 8. The evidence ages past the policy. A recheck, a new approval and an explicit rebinding renew it.
  await step('expire', 'clock', `${policy.evidence.maxAgeSeconds / DAY} days pass`, async () => { tick(policy.evidence.maxAgeSeconds); return { now: now.toISOString() }; });
  await step('renew', 'A, B, operator', 'recheck (v1.0.3), submit revision 3, B approves, operator rebinds, A relists', async () => {
    const r3 = await chain.check({ ...demoPlan('v1.0.1'), release: 'v1.0.3', sourceRevision: 'pusd-token-list@1.0.3' }, { previous: r2 });
    reports.push(r3);
    const revision3 = await chain.submit(A, LABEL, r3.evidenceHash);
    await chain.review(B, release.releaseId, r3.evidenceHash, true);
    const binding = bind(r3, release.releaseId, revision3.revision, 'renewed after expiry');
    await chain.list(A, { token, releaseId: release.releaseId, reportHash: r3.evidenceHash, reviewer: B, decimals: 6 });
    return { reportHash: r3.evidenceHash, revision: revision3.revision, bindingId: binding.id };
  });
  const final = transcript.at(-1).evaluation;
  const catalog = buildCatalog({ config, entries: [{ token, binding: latestBinding(bindings, token), evaluation: final }], generatedAt: now.toISOString() });
  return { config, chain: { label: chain.label, registry: chain.registry, tokenList: chain.tokenList, token, accounts: chain.accounts }, transcript, bindings, reports, catalog };
}

/** Compare a transcript with EXPECTED: the step ids in order and the status after each. */
export function checkTranscript(transcript) {
  const observed = transcript.map((entry) => [entry.step, entry.status]);
  const mismatches = EXPECTED.map(([step, status], index) => ({ step, expected: status, observed: observed[index]?.[1] ?? 'missing', observedStep: observed[index]?.[0] ?? 'missing' })).filter((row) => row.expected !== row.observed || row.step !== row.observedStep);
  if (observed.length !== EXPECTED.length) mismatches.push({ step: 'length', expected: EXPECTED.length, observed: observed.length });
  return { ok: mismatches.length === 0, mismatches };
}
