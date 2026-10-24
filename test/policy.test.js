import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizePolicy, policyHash, createBinding, verifyBinding, evaluateBinding, summarizeEvaluation, REASONS, POLICY_STATUSES } from '../lib/policy.js';
import { fingerprint } from '../lib/report.js';
import { NETWORKS } from '../lib/networks.js';

// Review F-05 (2026-10-24): the contracts answer whether an approval of an exact hash stands.
// A business action also needs the right network, subject, plan, runtime, evidence age and a
// trusted reviewer set, checked against fresh observations. Offline: the registry read, the
// observation and the clock are fixtures shaped like the live service's results.
const TESTNET = NETWORKS.testnet;
const REGISTRY = '0xe949b200edf070b9d425b206ed24dc8fe5b7d339';
const LIST = '0xd0bd833b4b8658b1230a0e9a99640935b3c65819';
const OWNER = '0x48b9e37a2a2c9621172745dc377b9fc6b9a6a71b';
const OTHER = `0x${'ab'.repeat(20)}`;
const RELEASE_ID = '0xe3f6ab7784cbaa8f60171e5201fea4e27fa5cec3d6682e06d8fcb7d89181f808';
const load = (hash) => readFile(new URL(`../public/reports/${hash}.json`, import.meta.url), 'utf8').then(JSON.parse);
const assetReport = await load('cbd78faa85f8759860d88366794e0c70052b74f9ed775be5bb37ad20118ed427');
const contractReport = await load('9dd04e0685d06a1a9a0525b2b8d6ac4b259d1618184789f345a7be5e55ae0645');

const policyFor = (report, overrides = {}) => ({
  schema: 'revivecheck.policy.v1', name: 'pUSD catalog policy',
  network: { key: 'testnet', chainId: TESTNET.chainId, genesisHash: TESTNET.genesisHash },
  runtime: { specName: 'portaldot-v3', specVersions: ['3002'] },
  subject: report.input.profile === 'native-asset' ? { kind: 'native-asset', assetId: report.input.nativeAsset.assetId, address: report.input.listing.address } : { kind: 'contract', address: report.input.contractAddress, codeHash: report.binding.codeHash },
  planHash: report.binding.planHash,
  evidence: { scope: 'portaldot-testnet-readonly', maxAgeSeconds: 7 * 86400, maxObservationAgeSeconds: 900 },
  reviewers: { trusted: [OWNER], threshold: 1, basis: 'The project test account; it is also the release owner, so this shows the mechanism and is not independent review.' },
  registry: { address: REGISTRY, owner: OWNER },
  consumer: { address: LIST, requireListed: true, version: 1 },
  ...overrides,
});
const seconds = (iso, delta) => new Date(Date.parse(iso) + delta * 1000);
const after = (report, delta) => seconds(report.completedAt, delta);
const bind = (policy, report, extra = {}) => createBinding({ policy, report, releaseId: RELEASE_ID, revision: '1', boundBy: 'catalog operator (project-controlled test account)', boundAt: report.completedAt, id: 'binding-1', ...extra });
const registryRead = (report, { revision = '1', reportHash = `0x${report.evidenceHash}`, decisions = { [OWNER]: { reviewer: OWNER, reviewed: true, approved: true } }, interfacesAgree = true, exists = true, owner = OWNER } = {}) => ({ releaseId: RELEASE_ID, block: { number: '170000', nativeHash: `0x${'aa'.repeat(32)}`, evmHash: `0x${'bb'.repeat(32)}` }, release: { exists, owner, revision, reportHash }, decision: decisions[OWNER] ?? null, decisions, interfacesAgree });
const observationAt = (now, { runtime = 'portaldot-v3/3002', chainId = TESTNET.chainId, genesisHash = TESTNET.genesisHash, age = 10 } = {}) => ({ network: 'testnet', chainId, genesisHash, runtime, finalized: { number: '170001', nativeHash: `0x${'cc'.repeat(32)}` }, observedAt: new Date(now.getTime() - age * 1000).toISOString() });
const listingRead = (report, { listed = true, reviewer = OWNER, releaseId = RELEASE_ID, reportHash = `0x${report.evidenceHash}`, interfacesAgree = true } = {}) => ({ token: report.input.listing?.address, block: { number: '170000' }, listed, entry: listed ? { releaseId, reportHash, reviewer } : null, interfacesAgree });
function evaluate(report, { policy = policyFor(report), binding = bind(policy, report), now = after(report, 60), registry = registryRead(report), observation = observationAt(now), listing = listingRead(report), evidence = null } = {}) {
  return evaluateBinding({ policy, binding, report, registry, observation, listing, evidence, now });
}
const codes = (evaluation) => evaluation.reasons.map((reason) => reason.code);

test('a policy is validated completely and hashes the same whatever the key order', () => {
  const policy = normalizePolicy(policyFor(assetReport));
  assert.equal(policy.simulation, false);
  assert.equal(policy.reviewers.threshold, 1);
  assert.equal(policy.evidence.maxObservationAgeSeconds, 900);
  assert.equal(policyHash(policyFor(assetReport)), policyHash({ ...policyFor(assetReport), registry: { owner: OWNER, address: REGISTRY } }));
  assert.throws(() => normalizePolicy({ ...policyFor(assetReport), schema: 'other' }), /schema/);
  assert.throws(() => normalizePolicy(policyFor(assetReport, { reviewers: { trusted: [OWNER], threshold: 1 } })), /basis/);
  assert.throws(() => normalizePolicy(policyFor(assetReport, { reviewers: { trusted: [OWNER, OWNER.toUpperCase().replace('0X', '0x')], threshold: 2, basis: 'x' } })), /threshold cannot exceed/, 'a reviewer listed twice is one reviewer');
  assert.throws(() => normalizePolicy(policyFor(assetReport, { reviewers: { trusted: [], threshold: 1, basis: 'x' } })), /at least one reviewer/);
  assert.throws(() => normalizePolicy(policyFor(assetReport, { evidence: { scope: 'local-rehearsal', maxAgeSeconds: 10 } })), /local network key/);
  assert.throws(() => normalizePolicy(policyFor(assetReport, { network: { key: 'local', chainId: 1, genesisHash: `0x${'00'.repeat(32)}` } })), /local network key/);
  assert.throws(() => normalizePolicy(policyFor(assetReport, { planHash: 'abc' })), /planHash/);
  assert.throws(() => normalizePolicy(policyFor(assetReport, { subject: { kind: 'token' } })), /subject.kind/);
  assert.throws(() => normalizePolicy(policyFor(assetReport, { evidence: { scope: 'portaldot-testnet-readonly', maxAgeSeconds: 0 } })), /maxAgeSeconds/);
  assert.deepEqual(Object.keys(REASONS).map((code) => REASONS[code].status).filter((status) => !POLICY_STATUSES.includes(status)), []);
});

test('a binding names one exact report, release and revision, and verifies only under its own policy', () => {
  const policy = policyFor(assetReport);
  const binding = bind(policy, assetReport, { storage: { extrinsicHash: '0x14b66988c9b160c1442485eae729ec92731fedd45820f8b63718f2c6405520ac', blockHash: '0xdeda40b38138e6b83de68871c8c66f147e37ec9968abe21ab4d63cf15f53eeea' } });
  assert.equal(binding.reportHash, assetReport.evidenceHash);
  assert.equal(binding.subject, assetReport.input.listing.address.toLowerCase());
  assert.equal(verifyBinding(binding, policy), true);
  assert.equal(verifyBinding({ ...binding, revision: '2' }, policy), false, 'a changed field breaks the binding hash');
  assert.equal(verifyBinding(binding, policyFor(assetReport, { name: 'another policy' })), false, 'a binding belongs to one policy');
  assert.throws(() => bind(policy, { ...assetReport, status: 'failed' }), /intact sealed report/);
  assert.throws(() => bind(policy, assetReport, { revision: '0' }), /revision/);
  assert.throws(() => bind(policy, assetReport, { boundBy: '' }), /boundBy/);
  assert.throws(() => bind(policy, assetReport, { storage: { extrinsicHash: '0x12' } }), /storage.extrinsicHash/);
});

test('every condition holding at fresh checkpoints is valid, and the evaluation is sealed', () => {
  const evaluation = evaluate(assetReport);
  assert.equal(evaluation.status, 'valid', JSON.stringify(evaluation.reasons));
  assert.equal(evaluation.enable, true);
  assert.deepEqual(evaluation.reasons, []);
  assert.ok(evaluation.checks.every((check) => check.status === 'passed'));
  assert.deepEqual(evaluation.checks.map((check) => check.id), ['evidence.integrity', 'evidence.scope', 'target.network', 'target.subject', 'plan.fingerprint', 'report.status', 'runtime.report', 'observation.present', 'observation.fresh', 'observation.network', 'runtime.current', 'evidence.age', 'registry.read', 'registry.interfaces', 'registry.release', 'registry.owner', 'registry.revision', 'registry.approvals', 'consumer.read', 'consumer.interfaces', 'consumer.listed', 'consumer.entry']);
  assert.equal(evaluation.simulation, false);
  assert.match(evaluation.reviewerTrust, /not independent review/);
  const { evaluationHash, ...rest } = evaluation;
  assert.equal(fingerprint(rest), evaluationHash);
  assert.ok(Object.isFrozen(evaluation));
  assert.equal(summarizeEvaluation(evaluation), 'valid: every policy condition holds');
});

test('a new revision or report in the registry requires a new approval and an explicit rebinding', () => {
  const superseded = evaluate(assetReport, { registry: registryRead(assetReport, { revision: '2', reportHash: `0x${'22'.repeat(32)}`, decisions: { [OWNER]: { reviewer: OWNER, reviewed: false, approved: false } } }) });
  assert.equal(superseded.status, 'recheck-required');
  assert.deepEqual(codes(superseded), ['revision-superseded', 'approval-missing']);
  assert.match(superseded.nextAction, /bind the new report explicitly/);
  // The old binding never follows the release forward: binding the new report is a new act.
  const policy = policyFor(assetReport);
  const rebound = bind(policy, assetReport, { revision: '2', id: 'binding-2' });
  const stillOld = evaluate(assetReport, { binding: rebound, registry: registryRead(assetReport, { revision: '2' }) });
  assert.equal(stillOld.status, 'valid', 'revision 2 carrying the same approved report, bound explicitly, is valid');
});

test('reviewer trust is explicit: only trusted reviewers count, revocation blocks, and an untrusted approval adds nothing', () => {
  const revoked = evaluate(assetReport, { registry: registryRead(assetReport, { decisions: { [OWNER]: { reviewer: OWNER, reviewed: true, approved: false } } }) });
  assert.equal(revoked.status, 'recheck-required');
  assert.deepEqual(codes(revoked), ['approval-revoked']);
  const untrusted = evaluate(assetReport, { registry: registryRead(assetReport, { decisions: { [OWNER]: { reviewer: OWNER, reviewed: false, approved: false }, [OTHER]: { reviewer: OTHER, reviewed: true, approved: true } } }) });
  assert.deepEqual(codes(untrusted), ['approval-missing']);
  const two = policyFor(assetReport, { reviewers: { trusted: [OWNER, OTHER], threshold: 2, basis: 'two project-controlled accounts' } });
  const oneOfTwo = evaluate(assetReport, { policy: two, binding: bind(two, assetReport), registry: registryRead(assetReport, { decisions: { [OWNER]: { reviewer: OWNER, reviewed: true, approved: true }, [OTHER]: { reviewer: OTHER, reviewed: false, approved: false } } }) });
  assert.deepEqual(codes(oneOfTwo), ['approval-missing']);
  assert.match(oneOfTwo.checks.find((check) => check.id === 'registry.approvals').observed, /1 of 2 trusted reviewers/);
  const unread = evaluate(assetReport, { policy: two, binding: bind(two, assetReport), registry: registryRead(assetReport, { decisions: { [OWNER]: { reviewer: OWNER, reviewed: true, approved: true } } }) });
  assert.equal(unread.status, 'unknown', 'a trusted decision that was not read cannot be counted either way');
  assert.deepEqual(codes(unread), ['registry-unavailable']);
});

test('evidence age is a policy clock, not a chain event: the same inputs expire when the clock passes the limit', () => {
  const fresh = evaluate(assetReport, { now: after(assetReport, 7 * 86400 - 1) });
  assert.equal(fresh.status, 'valid');
  const expired = evaluate(assetReport, { now: after(assetReport, 7 * 86400 + 1) });
  assert.equal(expired.status, 'expired');
  assert.deepEqual(codes(expired), ['evidence-expired']);
  assert.equal(expired.enable, false);
  assert.match(expired.nextAction, /does not extend evidence age/);
});

test('runtime drift is detected only from the observation supplied, and a missing or stale observation is unknown', () => {
  const now = after(assetReport, 60);
  const drifted = evaluate(assetReport, { now, observation: observationAt(now, { runtime: 'portaldot-v3/3003' }) });
  assert.equal(drifted.status, 'recheck-required');
  assert.deepEqual(codes(drifted), ['runtime-changed']);
  const missing = evaluate(assetReport, { now, observation: null });
  assert.equal(missing.status, 'unknown');
  assert.deepEqual(codes(missing), ['observation-missing']);
  const failed = evaluate(assetReport, { now, observation: { error: 'Portaldot V3 Testnet did not answer in time' } });
  assert.deepEqual(codes(failed), ['observation-missing']);
  const stale = evaluate(assetReport, { now, observation: observationAt(now, { age: 901 }) });
  assert.equal(stale.status, 'unknown');
  assert.deepEqual(codes(stale), ['observation-stale']);
  const elsewhere = evaluate(assetReport, { now, observation: observationAt(now, { chainId: NETWORKS.live.chainId, genesisHash: NETWORKS.live.genesisHash }) });
  assert.deepEqual(codes(elsewhere), ['observation-mismatch']);
  assert.equal(elsewhere.status, 'unknown');
});

test('an unavailable or disagreeing registry or consumer read blocks as unknown, never as valid', () => {
  const noRegistry = evaluate(assetReport, { registry: { error: 'did not answer in time' } });
  assert.equal(noRegistry.status, 'unknown');
  assert.deepEqual(codes(noRegistry), ['registry-unavailable']);
  const split = evaluate(assetReport, { registry: registryRead(assetReport, { interfacesAgree: false }) });
  assert.deepEqual(codes(split), ['interfaces-disagree']);
  const noConsumer = evaluate(assetReport, { listing: null });
  assert.deepEqual(codes(noConsumer), ['consumer-unavailable']);
  const consumerSplit = evaluate(assetReport, { listing: listingRead(assetReport, { interfacesAgree: false }) });
  assert.deepEqual(codes(consumerSplit), ['interfaces-disagree']);
  for (const evaluation of [noRegistry, split, noConsumer, consumerSplit]) assert.equal(evaluation.enable, false);
});

test('the consumer contract must list the subject on the bound release, report and a trusted reviewer', () => {
  const unlisted = evaluate(assetReport, { listing: listingRead(assetReport, { listed: false }) });
  assert.deepEqual(codes(unlisted), ['consumer-not-listed']);
  const otherReviewer = evaluate(assetReport, { listing: listingRead(assetReport, { reviewer: OTHER }) });
  assert.deepEqual(codes(otherReviewer), ['consumer-entry-mismatch']);
  const otherReport = evaluate(assetReport, { listing: listingRead(assetReport, { reportHash: `0x${'22'.repeat(32)}` }) });
  assert.deepEqual(codes(otherReport), ['consumer-entry-mismatch']);
  const withoutConsumer = evaluate(assetReport, { policy: policyFor(assetReport, { consumer: null }), binding: bind(policyFor(assetReport, { consumer: null }), assetReport), listing: null });
  assert.equal(withoutConsumer.status, 'valid', 'a policy without a consumer gate does not read one');
});

test('wrong-target, changed-plan, failed and wrong-scope reports can never become valid', () => {
  const otherAsset = policyFor(assetReport, { subject: { kind: 'native-asset', assetId: '8888', address: assetReport.input.listing.address } });
  const wrongAsset = evaluate(assetReport, { policy: otherAsset, binding: bind(otherAsset, assetReport) });
  assert.equal(wrongAsset.status, 'recheck-required');
  assert.deepEqual(codes(wrongAsset), ['wrong-target']);
  const otherToken = policyFor(assetReport, { subject: { kind: 'native-asset', assetId: '7777', address: OTHER } });
  const wrongToken = evaluate(assetReport, { policy: otherToken, binding: bind(otherToken, assetReport), listing: { ...listingRead(assetReport), token: OTHER } });
  assert.deepEqual(codes(wrongToken), ['wrong-target']);
  const otherPlan = policyFor(assetReport, { planHash: 'ab'.repeat(32) });
  assert.deepEqual(codes(evaluate(assetReport, { policy: otherPlan, binding: bind(otherPlan, assetReport) })), ['plan-changed']);
  const livePolicy = policyFor(assetReport, { network: { key: 'live', chainId: NETWORKS.live.chainId, genesisHash: NETWORKS.live.genesisHash }, evidence: { scope: 'portaldot-live-readonly', maxAgeSeconds: 86400 } });
  const now = after(assetReport, 60);
  const wrongNetwork = evaluate(assetReport, { policy: livePolicy, binding: bind(livePolicy, assetReport), now, observation: observationAt(now, { chainId: NETWORKS.live.chainId, genesisHash: NETWORKS.live.genesisHash, runtime: 'portaldot-v3/3002' }) });
  assert.deepEqual(codes(wrongNetwork), ['wrong-scope', 'wrong-target']);
  assert.equal(wrongNetwork.status, 'recheck-required');
});

test('a failed report bound to the subject is recheck-required', async () => {
  const failed = await load('7f01ed85594c47523d44ecf4f87c3e42da920bff9925a33f4cd6fc0686b1dc14');
  assert.equal(failed.status, 'failed');
  const policy = policyFor(failed);
  const evaluation = evaluateBinding({ policy, binding: bind(policy, failed), report: failed, registry: registryRead(failed), observation: observationAt(after(failed, 60)), listing: listingRead(failed), now: after(failed, 60) });
  assert.deepEqual(codes(evaluation), ['report-not-passed']);
  assert.equal(evaluation.status, 'recheck-required');
});

test('tampered or mismatched evidence is unknown and nothing else is evaluated', () => {
  const policy = policyFor(assetReport);
  const binding = bind(policy, assetReport);
  const tampered = evaluateBinding({ policy, binding, report: { ...assetReport, status: 'failed' }, registry: registryRead(assetReport), observation: observationAt(after(assetReport, 60)), listing: listingRead(assetReport), now: after(assetReport, 60) });
  assert.equal(tampered.status, 'unknown');
  assert.deepEqual(codes(tampered), ['evidence-unverifiable']);
  assert.equal(tampered.checks.length, 1);
  const otherReport = evaluateBinding({ policy, binding, report: contractReport, registry: registryRead(assetReport), observation: observationAt(after(assetReport, 60)), listing: listingRead(assetReport), now: after(assetReport, 60) });
  assert.deepEqual(codes(otherReport), ['evidence-unverifiable']);
  const forged = evaluateBinding({ policy, binding: { ...binding, boundBy: 'someone else' }, report: assetReport, registry: registryRead(assetReport), observation: observationAt(after(assetReport, 60)), listing: listingRead(assetReport), now: after(assetReport, 60) });
  assert.deepEqual(codes(forged), ['evidence-unverifiable']);
});

test('stored evidence, when the policy requires it, must retrieve and match the bound report', () => {
  const policy = policyFor(assetReport, { evidence: { scope: 'portaldot-testnet-readonly', maxAgeSeconds: 7 * 86400, requireStoredOnChain: true } });
  const binding = bind(policy, assetReport, { storage: { extrinsicHash: '0x14b66988c9b160c1442485eae729ec92731fedd45820f8b63718f2c6405520ac' } });
  const base = { policy, binding };
  assert.equal(evaluate(assetReport, { ...base, evidence: { verified: true, reportHash: assetReport.evidenceHash } }).status, 'valid');
  const missing = evaluate(assetReport, { ...base, evidence: null });
  assert.equal(missing.status, 'unknown');
  assert.deepEqual(codes(missing), ['storage-unverified']);
  const unverified = evaluate(assetReport, { ...base, evidence: { verified: false, reasons: ['The block is not finalized yet; retrieve again shortly.'] } });
  assert.deepEqual(codes(unverified), ['storage-unverified']);
  const other = evaluate(assetReport, { ...base, evidence: { verified: true, reportHash: '9707ec92029bc1708cab17989922aef4ccbabffb6333a80ef0d2bc300667c661' } });
  assert.equal(other.status, 'recheck-required');
  assert.deepEqual(codes(other), ['storage-mismatch']);
});

test('a definite reason outranks an unavailable read, and every reason is kept', () => {
  const now = after(assetReport, 7 * 86400 + 1);
  const expiredAndDark = evaluate(assetReport, { now, observation: observationAt(now), registry: { error: 'timeout' } });
  assert.equal(expiredAndDark.status, 'expired');
  assert.deepEqual(codes(expiredAndDark), ['evidence-expired', 'registry-unavailable']);
  const supersededAndExpired = evaluate(assetReport, { now, observation: observationAt(now), registry: registryRead(assetReport, { revision: '2', reportHash: `0x${'22'.repeat(32)}`, decisions: {} }) });
  assert.equal(supersededAndExpired.status, 'recheck-required');
  assert.deepEqual(codes(supersededAndExpired), ['evidence-expired', 'revision-superseded', 'registry-unavailable']);
});

test('a contract subject binds to the deployed code identity', () => {
  const policy = policyFor(contractReport, { consumer: null, registry: { address: REGISTRY } });
  assert.equal(normalizePolicy(policy).subject.codeHash, contractReport.binding.codeHash.toLowerCase());
  const binding = bind(policy, contractReport);
  const evaluation = evaluateBinding({ policy, binding, report: contractReport, registry: registryRead(contractReport), observation: observationAt(after(contractReport, 60)), now: after(contractReport, 60) });
  assert.equal(evaluation.status, 'valid', JSON.stringify(evaluation.reasons));
  const otherCode = policyFor(contractReport, { consumer: null, registry: { address: REGISTRY }, subject: { kind: 'contract', address: contractReport.input.contractAddress, codeHash: `0x${'ee'.repeat(32)}` } });
  const redeployed = evaluateBinding({ policy: otherCode, binding: bind(otherCode, contractReport), report: contractReport, registry: registryRead(contractReport), observation: observationAt(after(contractReport, 60)), now: after(contractReport, 60) });
  assert.deepEqual(codes(redeployed), ['wrong-target']);
});
