import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evidenceHealth, renewalPlan, successorReports, successorConsumerConfig, diffConsumerConfigs, HEALTH_SCHEMA, RENEWAL_PLAN_SCHEMA } from '../lib/health.js';
import { createBinding } from '../lib/policy.js';
import { sealRun } from '../lib/report.js';

// Product plan 2026-10-25, D-06: evidence health and renewal as a workflow. The view says
// when the evidence expires and which role acts next; the plan derives each stage from
// verified state (the next revision from the registry, never assumed), a pending send stops
// it, and the successor configuration keeps the policy and names the new report, revision
// and storage. Read-only: nothing here sends.
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
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const consumerConfig = await load('examples/release-gate-starter/project.json');
/** A successor: the same plan and observations, sealed later (a real sealed report with its own hash). */
const successor = (() => { const { evidenceHash, binding: _binding, ...content } = REPORT; return sealRun({ ...content, id: 'successor', completedAt: '2026-11-03T10:00:00.000Z', startedAt: '2026-11-03T09:59:50.000Z' }); })();

test('the health view names the expiry, each read\'s lapse, the standing approval and listing, and the next role; a planned gap before the freeze is stated', () => {
  const now = capture.collectedAt;
  const health = evidenceHealth({ policy, binding, report: REPORT, registry: capture.registry, listing: capture.listing, observation: capture.observation, now, freezeAt: FREEZE, plannedRenewalAt: '2026-11-03T10:00:00.000Z' });
  assert.equal(health.schema, HEALTH_SCHEMA);
  assert.equal(health.report.expiresAt, EXPIRY);
  assert.equal(health.report.expired, false);
  assert.equal(health.reads.observation.state, 'fresh');
  assert.equal(health.reads.observation.lapsesAt, plus(capture.observation.observedAt, 900_000));
  assert.equal(health.approval.state, 'approved');
  assert.equal(health.approval.revision, '2');
  assert.equal(health.bound.onCurrentRevision, true);
  assert.equal(health.listed.state, 'listed-on-bound-report');
  assert.equal(health.nextRevision, '3', 'derived from the registry read, not assumed');
  assert.equal(health.nextRole.stage, 'evaluate');
  assert.equal(health.freeze.covered, false);
  assert.ok(health.warnings.some((item) => item.code === 'gap-before-freeze'), JSON.stringify(health.warnings));
  assert.ok(health.warnings.some((item) => item.code === 'planned-gap' && /2\.0 days/.test(item.text)), 'the planned renewal after expiry is a stated denial period');
  // Two days before expiry: the owner acts next.
  const soon = evidenceHealth({ policy, binding, report: REPORT, registry: capture.registry, listing: capture.listing, observation: { ...capture.observation, observedAt: plus(EXPIRY, -3600_000) }, now: plus(EXPIRY, -3600_000) });
  assert.ok(soon.warnings.some((item) => item.code === 'evidence-expiring'));
  assert.deepEqual([soon.nextRole.role, soon.nextRole.stage], ['release owner', 'check']);
  // Expired: still the owner, until a successor exists.
  const expired = evidenceHealth({ policy, binding, report: REPORT, registry: capture.registry, listing: capture.listing, observation: capture.observation, now: plus(EXPIRY, 1) });
  assert.equal(expired.report.expired, true);
  assert.ok(expired.warnings.some((item) => item.code === 'evidence-expired'));
  assert.equal(expired.nextRole.role, 'release owner');
  // A successor known locally: the owner submits it next; a revoked approval names the reviewer.
  const withSuccessor = evidenceHealth({ policy, binding, report: REPORT, registry: capture.registry, listing: capture.listing, observation: capture.observation, reports: [REPORT, OLDER, successor], now: plus(EXPIRY, 1) });
  assert.deepEqual(withSuccessor.successors.map((item) => item.reportHash), [successor.evidenceHash]);
  assert.equal(withSuccessor.nextRole.stage, 'submit');
  const revokedHealth = evidenceHealth({ policy, binding, report: REPORT, registry: revoked.registry, listing: revoked.listing, observation: revoked.observation, now: revoked.observation.observedAt });
  assert.equal(revokedHealth.approval.state, 'changes-requested');
  assert.equal(revokedHealth.listed.state, 'not-listed');
  assert.equal(revokedHealth.nextRole.role, 'release owner', 'after a revocation a new report is the way back');
  const unread = evidenceHealth({ policy, binding, report: REPORT, registry: { error: 'node did not answer' }, listing: { error: 'x' }, observation: null, now });
  assert.equal(unread.approval.state, 'unknown');
  assert.equal(unread.reads.registry.state, 'unavailable');
  assert.ok(unread.warnings.some((item) => item.code === 'read-unavailable'));
  assert.deepEqual(successorReports([REPORT, OLDER], { binding, report: REPORT, policy }), [], 'older or bound reports are not successors');
});

test('the renewal plan derives each stage from verified state, names the next stage, and stops on a pending send', () => {
  const now = plus(EXPIRY, 1);
  const nothing = renewalPlan({ policy, binding, report: REPORT, registry: capture.registry, listing: capture.listing, bindings, now });
  assert.equal(nothing.schema, RENEWAL_PLAN_SCHEMA);
  assert.equal(nothing.next.stage, 'check');
  assert.equal(nothing.nextRevision, '3');
  assert.deepEqual(nothing.stages.map((item) => item.status), ['pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
  // The successor exists and is stored, but the registry still holds revision 2: submit is next.
  const storage = { verified: true, reportHash: successor.evidenceHash, extrinsicHash: `0x${'ab'.repeat(32)}`, blockHash: `0x${'cd'.repeat(32)}`, blockNumber: '200000' };
  const stored = renewalPlan({ policy, binding, report: REPORT, successor, storage, registry: capture.registry, listing: capture.listing, bindings, now });
  assert.deepEqual(stored.stages.slice(0, 3).map((item) => item.status), ['done', 'done', 'pending']);
  assert.equal(stored.next.stage, 'submit');
  assert.match(stored.next.command, new RegExp(`registry-write\\.js --action submit --label pusd-catalog-v2 --report ${successor.evidenceHash}`));
  // The registry holds the successor on revision 3 but no approval: the reviewer is next.
  const registryR3 = { ...capture.registry, release: { ...capture.registry.release, revision: '3', reportHash: `0x${successor.evidenceHash}` }, decisions: { [policy.reviewers.trusted[0]]: { reviewer: policy.reviewers.trusted[0], reviewed: false, approved: false } } };
  const submitted = renewalPlan({ policy, binding, report: REPORT, successor, storage, registry: registryR3, listing: capture.listing, bindings, now });
  assert.equal(submitted.next.stage, 'approve');
  assert.equal(submitted.stages.find((item) => item.stage === 'submit').verified.revision, '3');
  // Approved: the operator binds; then listed.
  const approvedR3 = { ...registryR3, decisions: { [policy.reviewers.trusted[0]]: { reviewer: policy.reviewers.trusted[0], reviewed: true, approved: true } } };
  const approved = renewalPlan({ policy, binding, report: REPORT, successor, storage, registry: approvedR3, listing: capture.listing, bindings, now });
  assert.equal(approved.next.stage, 'bind');
  assert.match(approved.next.command, /--revision 3 /);
  const successorBinding = createBinding({ policy, report: successor, releaseId: binding.releaseId, revision: '3', boundBy: 'operator', boundAt: now, storage: { extrinsicHash: storage.extrinsicHash, blockHash: storage.blockHash }, id: 'binding-r3' });
  const bound = renewalPlan({ policy, binding, report: REPORT, successor, storage, registry: approvedR3, listing: capture.listing, bindings: [...bindings, successorBinding], now });
  assert.equal(bound.next.stage, 'list');
  const listed = renewalPlan({ policy, binding, report: REPORT, successor, storage, registry: approvedR3, listing: { ...capture.listing, entry: { ...capture.listing.entry, reportHash: `0x${successor.evidenceHash}` } }, bindings: [...bindings, successorBinding], now });
  assert.equal(listed.next.stage, 'evaluate');
  assert.deepEqual(listed.stages.slice(0, 6).map((item) => item.status), ['done', 'done', 'done', 'done', 'done', 'done']);
  // A pending send is a stop condition.
  const stopped = renewalPlan({ policy, binding, report: REPORT, successor, storage, registry: capture.registry, listing: capture.listing, bindings, pendingSends: [{ address: '5GH8…', pending: 1 }], now });
  assert.match(stopped.stop.reason, /pending transaction is in the pool/);
  assert.ok(stopped.guards.some((line) => /stop condition/.test(line)));
  // A successor under another plan is not a done check.
  const foreign = renewalPlan({ policy, binding, report: REPORT, successor: { ...successor, binding: { ...successor.binding, planHash: '0'.repeat(64) } }, registry: capture.registry, listing: capture.listing, bindings, now });
  assert.equal(foreign.stages[0].status, 'pending');
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
