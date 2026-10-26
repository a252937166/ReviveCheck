import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evidenceHealth, renewalPlan, successorReports, screenSuccessor, successorConsumerConfig, diffConsumerConfigs, HEALTH_SCHEMA, RENEWAL_PLAN_SCHEMA } from '../lib/health.js';
import { createBinding, policyHash } from '../lib/policy.js';
import { sealRun } from '../lib/report.js';
import { subjectReadFrom } from '../lib/subject.js';

// Product plan 2026-10-25, D-06, and repair handoff 2026-10-26, R-07: evidence health and
// renewal as a workflow. The view says when the evidence expires and which role acts next;
// the plan derives each stage from verified state (the next revision from the registry,
// never assumed), a pending send stops it, and the successor configuration keeps the
// policy and names the new report, revision and storage. A stage is done only when the
// evidence passes the evaluator's own predicates: a read from another chain, registry,
// consumer, token or release, a stale, undated or disagreeing read, proves nothing and
// leaves the stage unknown, which stops the plan without suggesting a send. Read-only.
const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8').then(JSON.parse);
const config = await load('examples/token-catalog/config/testnet-v2.json');
const policy = config.policy;
const REPORT = await load('public/reports/1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51.json');
const OLDER = await load('public/reports/eb960cc73214722f3c0cbf3a87caae572d44aafa69219d2c53b492b85e7622b8.json');
const SUBJECT = '0x00001e6100000000000000000000000000010000';
const capture = (await load('examples/token-catalog/data/testnet-v2/captures/12-reapprove-r2.inputs.json')).tokens[SUBJECT];
const revoked = (await load('examples/token-catalog/data/testnet-v2/captures/11-revoke-r2.inputs.json')).tokens[SUBJECT];
const bindings = (await load('examples/token-catalog/data/testnet-v2/bindings.json')).bindings;
const binding = bindings.at(-1);
const EXPIRY = '2026-11-01T09:29:17.646Z';
const FREEZE = '2026-11-06T04:00:00.000Z';
const SUCCESSOR_AT = '2026-11-03T10:00:00.000Z';
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const consumerConfig = await load('examples/release-gate-starter/project.json');
/** A successor: the same plan and observations, sealed later (a real sealed report with its own hash); variants change one named field and are re-sealed. */
const reseal = (changes = {}) => { const { evidenceHash, binding: _binding, ...content } = REPORT; return sealRun({ ...content, id: 'successor', completedAt: SUCCESSOR_AT, startedAt: plus(SUCCESSOR_AT, -10_000), ...changes }); };
const successor = reseal();
/** Captured reads re-dated to `at`: the recorded values with the observation time changed, so freshness holds at a chosen clock (the changed field is observedAt only). */
const redate = (read, at) => ({ ...read, observedAt: at });
const fresh = (token, at) => ({ registry: redate(token.registry, at), listing: redate(token.listing, at), observation: redate(token.observation, at) });
const NOW = plus(SUCCESSOR_AT, 300_000);
const freshPolicy = { ...policy, evidence: { ...policy.evidence, requireFreshSubject: true } };
const subjectRead = (at, overrides = {}) => subjectReadFrom({ assetId: '7777', address: SUBJECT, values: { symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6 }, block: capture.observation.finalized, observedAt: at, ...overrides });

test('the health view names the expiry, each read\'s lapse, the standing approval and listing, and the next role; a planned gap before the freeze is stated', () => {
  const now = capture.collectedAt;
  const health = evidenceHealth({ policy, binding, report: REPORT, registry: capture.registry, listing: capture.listing, observation: capture.observation, now, freezeAt: FREEZE, plannedRenewalAt: SUCCESSOR_AT });
  assert.equal(health.schema, HEALTH_SCHEMA);
  assert.equal(health.report.expiresAt, EXPIRY);
  assert.equal(health.report.expired, false);
  assert.equal(health.reads.observation.state, 'fresh');
  assert.equal(health.reads.observation.lapsesAt, plus(capture.observation.observedAt, 900_000));
  assert.deepEqual(health.reads.registry.predicates, { dated: true, fresh: true, domain: true, interfaces: true, supported: true });
  assert.equal(health.approval.state, 'approved');
  assert.equal(health.approval.revision, '2');
  assert.ok(health.approval.predicates.includes('registry-domain'), 'the approval names the predicates that justify it');
  assert.equal(health.bound.onCurrentRevision, true);
  assert.equal(health.listed.state, 'listed-on-bound-report');
  assert.equal(health.subjectState.state, 'not-required', 'a legacy policy claims no check of the current metadata');
  assert.match(health.subjectState.detail, /no check of the current values is claimed/);
  assert.equal(health.nextRevision, '3', 'derived from the registry read, not assumed');
  assert.equal(health.nextRole.stage, 'evaluate');
  assert.equal(health.freeze.covered, false);
  assert.ok(health.warnings.some((item) => item.code === 'gap-before-freeze'), JSON.stringify(health.warnings));
  assert.ok(health.warnings.some((item) => item.code === 'planned-gap' && /2\.0 days/.test(item.text)), 'the planned renewal after expiry is a stated denial period');
  // Two days before expiry: the owner acts next (a new check is read-only).
  const soon = evidenceHealth({ policy, binding, report: REPORT, ...fresh(capture, plus(EXPIRY, -3600_000)), now: plus(EXPIRY, -3600_000) });
  assert.ok(soon.warnings.some((item) => item.code === 'evidence-expiring'));
  assert.deepEqual([soon.nextRole.role, soon.nextRole.stage], ['release owner', 'check']);
  // Expired: still the owner, until a successor exists.
  const expired = evidenceHealth({ policy, binding, report: REPORT, ...fresh(capture, plus(EXPIRY, 1)), now: plus(EXPIRY, 1) });
  assert.equal(expired.report.expired, true);
  assert.ok(expired.warnings.some((item) => item.code === 'evidence-expired'));
  assert.equal(expired.nextRole.role, 'release owner');
  // A successor known locally and fresh reads: the owner submits it next; a revoked approval names the owner again (a new report is the way back).
  const withSuccessor = evidenceHealth({ policy, binding, report: REPORT, ...fresh(capture, NOW), reports: [REPORT, OLDER, successor], now: NOW });
  assert.deepEqual(withSuccessor.successors.map((item) => item.reportHash), [successor.evidenceHash]);
  assert.ok(withSuccessor.successors[0].predicates.includes('plan'));
  assert.equal(withSuccessor.nextRole.stage, 'submit');
  const revokedHealth = evidenceHealth({ policy, binding, report: REPORT, registry: revoked.registry, listing: revoked.listing, observation: revoked.observation, now: revoked.observation.observedAt });
  assert.equal(revokedHealth.approval.state, 'changes-requested');
  assert.equal(revokedHealth.listed.state, 'not-listed');
  assert.equal(revokedHealth.nextRole.role, 'release owner', 'after a revocation a new report is the way back');
  const unread = evidenceHealth({ policy, binding, report: REPORT, registry: { error: 'node did not answer' }, listing: { error: 'x' }, observation: null, now });
  assert.equal(unread.approval.state, 'unknown');
  assert.equal(unread.reads.registry.state, 'unavailable');
  assert.ok(unread.warnings.some((item) => item.code === 'read-unavailable'));
  assert.deepEqual(successorReports([REPORT, OLDER], { binding, report: REPORT, policy, now: NOW }), [], 'older or bound reports are not successors');
});

test('R07-A, R07-B: a same-hash read from another chain, registry, consumer, token or release, or a stale, undated, missing or disagreeing read, proves nothing: the state is unknown and no send follows', () => {
  const reads = fresh(capture, NOW);
  const cases = {
    'registry contract': { ...reads, registry: { ...reads.registry, address: `0x${'ab'.repeat(20)}` } },
    'registry release': { ...reads, registry: { ...reads.registry, releaseId: `0x${'cd'.repeat(32)}` } },
    'consumer contract': { ...reads, listing: { ...reads.listing, list: `0x${'ef'.repeat(20)}` } },
    'consumer token': { ...reads, listing: { ...reads.listing, token: `0x${'12'.repeat(20)}` } },
    'observation chain': { ...reads, observation: { ...reads.observation, chainId: 1 } },
  };
  for (const [name, inputs] of Object.entries(cases)) {
    const health = evidenceHealth({ policy, binding, report: REPORT, ...inputs, reports: [successor], now: NOW });
    const kind = name.startsWith('registry') ? 'registry' : name.startsWith('consumer') ? 'listing' : 'observation';
    assert.equal(health.reads[kind].state, 'wrong-target', name);
    assert.equal(health.reads[kind].predicates.domain, false, name);
    if (kind === 'registry') { assert.equal(health.approval.state, 'unknown', name); assert.equal(health.bound.onCurrentRevision, null, name); }
    if (kind === 'listing') assert.equal(health.listed.state, 'unknown', name);
    // The observation places every other read on this policy's network: from another chain, the approval, the bound revision and the listing are unknown too.
    if (kind === 'observation') { assert.equal(health.approval.state, 'unknown', name); assert.equal(health.listed.state, 'unknown', name); assert.equal(health.bound.onCurrentRevision, null, name); assert.match(health.approval.detail, /network observation is wrong-target/, name); }
    assert.ok(health.warnings.some((item) => item.code === 'read-wrong-target'), name);
    assert.equal(health.nextRole.stage, 'read', `${name}: the operator reads again; nothing is sent`);
    const plan = renewalPlan({ policy, binding, report: REPORT, successor, storage: { verified: true, reportHash: successor.evidenceHash, extrinsicHash: `0x${'ab'.repeat(32)}`, blockHash: `0x${'cd'.repeat(32)}` }, ...inputs, bindings, now: NOW });
    assert.equal(plan.stages.find((item) => item.stage === (kind === 'listing' ? 'list' : 'submit')).status, 'unknown', name);
    if (kind === 'observation') { assert.deepEqual(plan.stages.map((item) => item.status), ['done', 'done', 'unknown', 'unknown', 'unknown', 'unknown', 'pending'], name); assert.match(plan.stop.reason, /network observation is wrong-target/, name); }
    assert.equal(plan.next, null, `${name}: no next stage while a stage is unknown`);
    assert.ok(plan.stop.kinds.includes('unknown-state'), name);
    assert.match(plan.stop.reason, /never send again merely because a result could not be established/, name);
  }
  const stale = evidenceHealth({ policy, binding, report: REPORT, ...fresh(capture, plus(NOW, -901_000)), now: NOW });
  assert.equal(stale.reads.registry.state, 'stale');
  assert.equal(stale.approval.state, 'unknown');
  const undated = evidenceHealth({ policy, binding, report: REPORT, ...reads, registry: { ...reads.registry, observedAt: undefined }, now: NOW });
  assert.equal(undated.reads.registry.state, 'undated');
  const unidentifiedChain = evidenceHealth({ policy, binding, report: REPORT, ...reads, observation: { ...reads.observation, chainId: undefined, genesisHash: undefined }, now: NOW });
  assert.equal(unidentifiedChain.reads.observation.state, 'undated', 'an observation that does not name its chain is undated, not from another target');
  assert.equal(unidentifiedChain.approval.state, 'unknown');
  const disagreeing = evidenceHealth({ policy, binding, report: REPORT, ...reads, registry: { ...reads.registry, interfacesAgree: false }, now: NOW });
  assert.equal(disagreeing.reads.registry.state, 'disagreeing');
  assert.equal(disagreeing.approval.state, 'unknown');
  const stalePlan = renewalPlan({ policy, binding, report: REPORT, successor, storage: { verified: true, reportHash: successor.evidenceHash, extrinsicHash: `0x${'ab'.repeat(32)}`, blockHash: null }, ...fresh(capture, plus(NOW, -901_000)), bindings, now: NOW });
  assert.deepEqual(stalePlan.stages.map((item) => item.status), ['done', 'done', 'unknown', 'unknown', 'unknown', 'unknown', 'pending']);
  assert.equal(stalePlan.next, null);
});

test('R07-C: a passed report from another network, scope or runtime, about another subject, expired or invalid is not a successor', () => {
  const screen = (report) => screenSuccessor(report, { binding, report: REPORT, policy, now: NOW });
  assert.equal(screen(successor).ok, true, screen(successor).failed.join(','));
  const otherNetwork = reseal({ network: { ...REPORT.network, observedChainId: 1 } });
  assert.ok(screen(otherNetwork).failed.includes('network'));
  const otherScope = reseal({ scope: 'portaldot-live-readonly' });
  assert.ok(screen(otherScope).failed.includes('scope'));
  const otherRuntime = reseal({ network: { ...REPORT.network, specVersion: '3003' } });
  assert.ok(screen(otherRuntime).failed.includes('runtime'));
  const otherSubject = reseal({ input: { ...REPORT.input, nativeAsset: { ...REPORT.input.nativeAsset, assetId: '7778' }, listing: { ...REPORT.input.listing, address: '0x00001e6200000000000000000000000000010000' } } });
  assert.ok(screen(otherSubject).failed.includes('subject'));
  const expired = reseal({ completedAt: plus(REPORT.completedAt, 1000), startedAt: REPORT.startedAt });
  assert.ok(screen(expired).failed.includes('not-expired'), 'a report older than the policy allows at now is no successor');
  const notPassed = reseal({ status: 'failed' });
  assert.equal(screen(notPassed).ok, false);
  assert.ok(screen(notPassed).failed.includes('intact') || screen(notPassed).failed.includes('passed'));
  const tampered = { ...successor, completedAt: plus(SUCCESSOR_AT, 1) };
  assert.ok(screen(tampered).failed.includes('intact'));
  assert.deepEqual(successorReports([otherNetwork, otherScope, otherRuntime, otherSubject, expired, notPassed, tampered, successor], { binding, report: REPORT, policy, now: NOW }).map((item) => item.reportHash), [successor.evidenceHash]);
  for (const foreign of [otherNetwork, otherScope, otherRuntime, otherSubject]) {
    const plan = renewalPlan({ policy, binding, report: REPORT, successor: foreign, ...fresh(capture, NOW), bindings, now: NOW });
    assert.equal(plan.stages[0].status, 'pending', 'the check stage is not done by a foreign report');
    assert.ok(plan.stages[0].verified.failed.length > 0);
    assert.equal(plan.successor, null);
  }
});

test('the renewal plan derives each stage from verified state, names the next stage with its predicates, and stops on a pending send', () => {
  const reads = fresh(capture, NOW);
  const nothing = renewalPlan({ policy, binding, report: REPORT, ...reads, bindings, now: NOW });
  assert.equal(nothing.schema, RENEWAL_PLAN_SCHEMA);
  assert.equal(nothing.next.stage, 'check');
  assert.equal(nothing.nextRevision, '3');
  assert.deepEqual(nothing.stages.map((item) => item.status), ['pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
  // The successor exists and is stored, but the registry still holds revision 2: submit is next.
  const storage = { verified: true, reportHash: successor.evidenceHash, extrinsicHash: `0x${'ab'.repeat(32)}`, blockHash: `0x${'cd'.repeat(32)}`, blockNumber: '200000' };
  const stored = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, bindings, now: NOW });
  assert.deepEqual(stored.stages.slice(0, 3).map((item) => item.status), ['done', 'done', 'pending']);
  assert.ok(stored.stages[0].verified.predicates.includes('runtime'));
  assert.deepEqual(stored.stages[1].verified.predicates, ['retrieved-from-chain-data', 'content-hash-equals-successor', 'extrinsic-named']);
  assert.equal(stored.next.stage, 'submit');
  assert.match(stored.next.command, new RegExp(`registry-write\\.js --action submit --label pusd-catalog-v2 --report ${successor.evidenceHash}`));
  // No retrieval attempted: the store stage is unknown, not pending, and the plan stops.
  const unretrieved = renewalPlan({ policy, binding, report: REPORT, successor, storage: null, ...reads, bindings, now: NOW });
  assert.equal(unretrieved.stages[1].status, 'unknown');
  assert.equal(unretrieved.next, null);
  // No store recorded: pending (not performed), and the plan continues to it.
  const notRecorded = renewalPlan({ policy, binding, report: REPORT, successor, storage: { notRecorded: true, reason: 'not in the evidence record' }, ...reads, bindings, now: NOW });
  assert.equal(notRecorded.stages[1].status, 'pending');
  assert.equal(notRecorded.next.stage, 'store');
  // The registry holds the successor on revision 3 but no approval: the reviewer is next.
  const registryR3 = { ...reads.registry, release: { ...reads.registry.release, revision: '3', reportHash: `0x${successor.evidenceHash}` }, decisions: { [policy.reviewers.trusted[0]]: { reviewer: policy.reviewers.trusted[0], reviewed: false, approved: false } } };
  const submitted = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: registryR3, bindings, now: NOW });
  assert.equal(submitted.next.stage, 'approve');
  assert.equal(submitted.stages.find((item) => item.stage === 'submit').verified.revision, '3');
  assert.ok(submitted.stages.find((item) => item.stage === 'submit').verified.predicates.includes('registry-domain'));
  // Approved: the operator binds; then listed.
  const approvedR3 = { ...registryR3, decisions: { [policy.reviewers.trusted[0]]: { reviewer: policy.reviewers.trusted[0], reviewed: true, approved: true } } };
  const approved = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: approvedR3, bindings, now: NOW });
  assert.equal(approved.next.stage, 'bind');
  assert.match(approved.next.command, /--revision 3 /);
  const successorBinding = createBinding({ policy, report: successor, releaseId: binding.releaseId, revision: '3', boundBy: 'operator', boundAt: NOW, storage: { extrinsicHash: storage.extrinsicHash, blockHash: storage.blockHash }, id: 'binding-r3' });
  const bound = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: approvedR3, bindings: [...bindings, successorBinding], now: NOW });
  assert.equal(bound.next.stage, 'list');
  const listed = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: approvedR3, listing: { ...reads.listing, entry: { ...reads.listing.entry, reportHash: `0x${successor.evidenceHash}` } }, bindings: [...bindings, successorBinding], now: NOW });
  assert.equal(listed.next.stage, 'evaluate');
  assert.deepEqual(listed.stages.slice(0, 6).map((item) => item.status), ['done', 'done', 'done', 'done', 'done', 'done']);
  assert.ok(listed.stages.every((item) => item.status !== 'done' || item.verified.predicates.length > 0), 'every done stage names its predicates');
  // A pending send is a stop condition, whatever else holds.
  const stopped = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, bindings, pendingSends: [{ address: '5GH8…', pending: 1 }], now: NOW });
  assert.match(stopped.stop.reason, /pending transaction is in the pool/);
  assert.ok(stopped.stop.kinds.includes('pending-send'));
  assert.ok(stopped.guards.some((line) => /stop condition/.test(line)));
  // A successor under another plan is not a done check.
  const foreign = renewalPlan({ policy, binding, report: REPORT, successor: { ...successor, binding: { ...successor.binding, planHash: '0'.repeat(64) } }, ...reads, bindings, now: NOW });
  assert.equal(foreign.stages[0].status, 'pending');
});

test('R07-D: an old verified storage receipt stays completion evidence while unavailable current reads stop continuation without a duplicate submission', () => {
  const storage = { verified: true, reportHash: successor.evidenceHash, extrinsicHash: `0x${'ab'.repeat(32)}`, blockHash: `0x${'cd'.repeat(32)}`, blockNumber: '200000' };
  const plan = renewalPlan({ policy, binding, report: REPORT, successor, storage, registry: { error: 'node did not answer' }, listing: { error: 'node did not answer' }, bindings, now: NOW });
  assert.deepEqual(plan.stages.slice(0, 2).map((item) => item.status), ['done', 'done'], 'the sealed successor and its retrieved store are facts');
  assert.deepEqual(plan.stages.slice(2, 6).map((item) => item.status), ['unknown', 'unknown', 'unknown', 'unknown']);
  assert.equal(plan.next, null);
  assert.match(plan.stop.reason, /submit, approve, bind, list is unknown/);
  assert.doesNotMatch(plan.stages[2].verified.reason, /would open revision/, 'no revision is suggested from an unread registry');
  assert.deepEqual(plan.stop.stages, ['submit', 'approve', 'bind', 'list']);
});

test('R07-E: under a fresh-subject policy the subject read appears in health with its availability, freshness and comparison; a legacy policy keeps its fingerprint and labels the check not required', () => {
  assert.equal(policyHash(policy), 'ce1388f97d27489c770615d720ed39893e6250788eada8c45de6d8ab2b0534fd');
  // Before the expiry, so that the subject alone decides who acts next.
  const NOW = capture.collectedAt;
  const reads = fresh(capture, NOW);
  const absent = evidenceHealth({ policy: freshPolicy, binding, report: REPORT, ...reads, now: NOW });
  assert.equal(absent.reads.subject.state, 'unavailable');
  assert.equal(absent.subjectState.state, 'unknown');
  assert.ok(absent.warnings.some((item) => item.code === 'read-unavailable' && /subject/.test(item.text)));
  const stale = evidenceHealth({ policy: freshPolicy, binding, report: REPORT, ...reads, subject: subjectRead(plus(NOW, -901_000)), now: NOW });
  assert.equal(stale.reads.subject.state, 'stale');
  assert.equal(stale.subjectState.state, 'unknown');
  const unchanged = evidenceHealth({ policy: freshPolicy, binding, report: REPORT, ...reads, subject: subjectRead(NOW), now: NOW });
  assert.equal(unchanged.reads.subject.state, 'fresh');
  assert.equal(unchanged.subjectState.state, 'unchanged');
  assert.equal(unchanged.nextRole.stage, 'evaluate');
  const changed = evidenceHealth({ policy: freshPolicy, binding, report: REPORT, ...reads, subject: subjectRead(NOW, { values: { symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 18 } }), now: NOW });
  assert.equal(changed.subjectState.state, 'changed');
  assert.deepEqual(changed.subjectState.differing, ['decimals']);
  assert.ok(changed.warnings.some((item) => item.code === 'subject-changed'));
  assert.deepEqual([changed.nextRole.role, changed.nextRole.stage], ['release owner', 'check']);
  const disagreeing = evidenceHealth({ policy: freshPolicy, binding, report: REPORT, ...reads, subject: subjectRead(NOW, { evmValues: { decimals: 18 } }), now: NOW });
  assert.equal(disagreeing.reads.subject.state, 'disagreeing');
  assert.equal(disagreeing.subjectState.state, 'unknown', 'disagreeing interfaces are unknown, never changed');
  const otherAsset = evidenceHealth({ policy: freshPolicy, binding, report: REPORT, ...reads, subject: subjectRead(NOW, { assetId: '7778', address: '0x00001e6200000000000000000000000000010000' }), now: NOW });
  assert.equal(otherAsset.reads.subject.state, 'wrong-target');
  const legacy = evidenceHealth({ policy, binding, report: REPORT, ...reads, subject: subjectRead(NOW), now: NOW });
  assert.equal(legacy.reads.subject.state, 'not-required');
  assert.equal(legacy.subjectState.state, 'not-required');
  const plan = renewalPlan({ policy: freshPolicy, binding, report: REPORT, ...reads, subject: subjectRead(NOW), bindings, now: NOW });
  assert.equal(plan.reads.subject.state, 'fresh');
});

test('the successor configuration keeps the policy and names the new report, revision and storage; the diff lists exactly that', () => {
  const next = successorConsumerConfig(consumerConfig, { report: successor, revision: '3', storage: { extrinsicHash: `0x${'AB'.repeat(32)}`, blockHash: `0x${'cd'.repeat(32)}` } });
  assert.equal(next.release.reportHash, successor.evidenceHash);
  assert.equal(next.release.revision, '3');
  assert.equal(next.release.storage.extrinsicHash, `0x${'ab'.repeat(32)}`);
  assert.deepEqual(next.policy, consumerConfig.policy, 'the policy is unchanged');
  assert.equal(next.provenance.successorOf.reportHash, consumerConfig.release.reportHash);
  const diff = diffConsumerConfigs(consumerConfig, next);
  assert.equal(diff.policyUnchanged, true);
  assert.deepEqual(diff.changed.map((line) => line.pointer).filter((pointer) => pointer.startsWith('/release')), ['/release/reportHash', '/release/revision', '/release/storage/blockHash', '/release/storage/extrinsicHash']);
  assert.throws(() => successorConsumerConfig(consumerConfig, { report: { ...successor, status: 'failed' }, revision: '3', storage: null }), /intact, passed report/);
  assert.throws(() => successorConsumerConfig(consumerConfig, { report: successor, revision: '0', storage: null }), /positive integer/);
});

test('R07-F (follow-up): unread trusted decisions, a listing without a verified consumer identity, and a missing or wrong-network observation are unknown states that stop the plan; a read decision that does not approve is pending; a trusted request for changes refuses the successor; a verified storage receipt stays visible', () => {
  const reads = fresh(capture, NOW);
  const storage = { verified: true, reportHash: successor.evidenceHash, extrinsicHash: `0x${'ab'.repeat(32)}`, blockHash: `0x${'cd'.repeat(32)}`, blockNumber: '200000' };
  const reviewer = policy.reviewers.trusted[0];
  const registryR3 = (decisions) => ({ ...reads.registry, release: { ...reads.registry.release, revision: '3', reportHash: `0x${successor.evidenceHash}` }, decisions });
  const approveOf = (plan) => plan.stages.find((item) => item.stage === 'approve');
  const listOf = (plan) => plan.stages.find((item) => item.stage === 'list');
  // 1. No trusted decision could be read (unavailable evidence): the approval is unknown, not pending; the plan stops; nothing suggests approving.
  const unread = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: registryR3({}), bindings, now: NOW });
  assert.equal(approveOf(unread).status, 'unknown');
  assert.match(approveOf(unread).verified.reason, /could not be read; whether revision 3 is approved is unknown, and an unread decision is not a missing one/);
  assert.equal(unread.next, null);
  assert.deepEqual([unread.stop.kinds, unread.stop.stages], [['unknown-state'], ['approve']]);
  assert.equal(evidenceHealth({ policy, binding, report: REPORT, ...reads, registry: registryR3({}), reports: [successor], now: NOW }).approval.state, 'unknown');
  // 2. The decision was read and does not approve yet (verified lack): pending, and approval is the next unperformed step.
  const notYet = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: registryR3({ [reviewer]: { reviewer, reviewed: false, approved: false } }), bindings, now: NOW });
  assert.equal(approveOf(notYet).status, 'pending');
  assert.match(approveOf(notYet).verified.reason, /every trusted decision was read and none approves/);
  assert.equal(notYet.next.stage, 'approve');
  assert.equal(notYet.stop, null);
  // 3. A trusted reviewer requested changes on the successor revision: refused; the plan stops; another approval is not suggested.
  const changes = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: registryR3({ [reviewer]: { reviewer, reviewed: true, approved: false } }), bindings, now: NOW });
  assert.equal(approveOf(changes).status, 'refused');
  assert.equal(changes.next, null);
  assert.ok(changes.stop.kinds.includes('changes-requested'));
  assert.match(changes.stop.reason, /requested changes on revision 3/);
  assert.doesNotMatch(changes.stop.reason, /approve the exact hash/);
  // 4. A listing whose entry names the successor but whose consumer identity is not verified at the listing checkpoint, names another registry, or was read at another block: unidentified, so the listing is unknown and so is the list stage.
  const approvedR3 = registryR3({ [reviewer]: { reviewer, reviewed: true, approved: true } });
  const successorBinding = createBinding({ policy, report: successor, releaseId: binding.releaseId, revision: '3', boundBy: 'operator', boundAt: NOW, storage: { extrinsicHash: storage.extrinsicHash, blockHash: storage.blockHash }, id: 'binding-r3' });
  const listedEntry = { ...reads.listing, entry: { ...reads.listing.entry, reportHash: `0x${successor.evidenceHash}` } };
  const complete = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: approvedR3, listing: listedEntry, bindings: [...bindings, successorBinding], now: NOW });
  assert.equal(listOf(complete).status, 'done');
  assert.ok(listOf(complete).verified.predicates.includes('consumer-identity'), 'a done listing names the identity predicate');
  assert.equal(complete.next.stage, 'evaluate');
  const identityCases = {
    'no identity': null,
    'another registry': { ...reads.listing.identity, evm: { ...reads.listing.identity.evm, registry: `0x${'ab'.repeat(20)}` }, native: { ...reads.listing.identity.native, registry: `0x${'ab'.repeat(20)}` } },
    'another checkpoint': { ...reads.listing.identity, block: { ...reads.listing.identity.block, nativeHash: `0x${'ef'.repeat(32)}` } },
    'interfaces disagree on it': { ...reads.listing.identity, interfacesAgree: false },
  };
  for (const [name, identity] of Object.entries(identityCases)) {
    const plan = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, registry: approvedR3, listing: { ...listedEntry, identity }, bindings: [...bindings, successorBinding], now: NOW });
    assert.equal(plan.reads.listing.state, 'unidentified', name);
    assert.equal(plan.reads.listing.predicates.identity, false, name);
    assert.equal(listOf(plan).status, 'unknown', name);
    assert.equal(plan.next, null, name);
    assert.deepEqual(plan.stop.stages, ['list'], name);
    const health = evidenceHealth({ policy, binding, report: REPORT, ...reads, listing: { ...reads.listing, identity }, reports: [successor], now: NOW });
    assert.equal(health.listed.state, 'unknown', name);
    assert.ok(health.warnings.some((item) => item.code === 'read-unidentified'), name);
    assert.equal(health.nextRole.stage, 'read', name);
  }
  // 5. The finalized-head observation is missing, unavailable or from another network while the registry and listing reads are fresh: no read can be placed on this policy's network, every chain-derived stage is unknown, the plan stops naming the observation, and the retrieved storage receipt stays visible as a fact.
  const observationCases = { missing: null, unavailable: { error: 'node did not answer' }, 'another network': { ...reads.observation, chainId: 1 } };
  for (const [name, observation] of Object.entries(observationCases)) {
    const plan = renewalPlan({ policy, binding, report: REPORT, successor, storage, ...reads, observation, registry: approvedR3, listing: listedEntry, bindings: [...bindings, successorBinding], now: NOW });
    assert.deepEqual(plan.stages.map((item) => item.status), ['done', 'done', 'unknown', 'unknown', 'unknown', 'unknown', 'pending'], name);
    assert.equal(plan.next, null, name);
    assert.ok(plan.stop.kinds.includes('unknown-state'), name);
    assert.match(plan.stop.reason, /network observation is (unavailable|wrong-target)/, name);
    assert.match(plan.stop.reason, /no read can be placed on this policy's network/, name);
    assert.doesNotMatch(plan.stop.reason, /would open revision/, name);
    assert.equal(plan.stages[1].verified.extrinsicHash, storage.extrinsicHash, `${name}: the verified storage receipt stays visible`);
    const health = evidenceHealth({ policy, binding, report: REPORT, ...reads, observation, reports: [successor], now: NOW });
    assert.equal(health.approval.state, 'unknown', name);
    assert.equal(health.listed.state, 'unknown', name);
    assert.equal(health.bound.onCurrentRevision, null, name);
    assert.equal(health.nextRole.stage, 'read', name);
  }
});
