import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCatalogRelease, verifyCatalogRelease, readCatalogRelease, compareCatalogReleases, releaseDiagnostics, gateOutcome, loadConsumerConfig, selectorFrom, CATALOG_RELEASE_SCHEMA, EXIT } from '../lib/catalog-release.js';
import { createBinding, evaluateBinding } from '../lib/policy.js';
import { buildDecisionEvidence } from '../lib/decision.js';

// Product plan 2026-10-25, D-03: a versioned catalog release is the business output. It
// includes exactly the entries eligible at generation, each backed by its decision
// evidence; a reader applies the deadline and, on fresh reads, the policy again; expired,
// revoked, superseded, mismatched or unverifiable evidence yields no usable entry; two
// releases compare entry by entry and every decision reconstructs.
const load = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8').then(JSON.parse);
const config = await load('examples/token-catalog/config/testnet-v2.json');
const policy = config.policy;
const REPORT = await load('public/reports/1faef921a720bf7af7ea87f6fd4875089b61de7617a16b3a4766075c819a1d51.json');
const SUBJECT = '0x00001e6100000000000000000000000000010000';
const capture = (name) => load(`examples/token-catalog/data/testnet-v2/captures/${name}.inputs.json`);
const reapproved = (await capture('12-reapprove-r2')).tokens[SUBJECT];     // valid, listed on revision 2
const revoked = (await capture('11-revoke-r2')).tokens[SUBJECT];           // the reviewer requested changes
const superseded = (await capture('07-submit-r2')).tokens[SUBJECT];         // revision 2 submitted, approval cleared, not listed (binding below names revision 1 report eb960cc7)
const ENTRY = { chainId: 420420777, address: SUBJECT, symbol: 'pUSD', name: 'Portaldot USD (test)', decimals: 6, assetId: '7777' };
const WRONG = { ...ENTRY, decimals: 18 };
const RELEASE_ID = '0x28ab8a86a4d1ca4f5b38784d8f0a32c14ed163ae7f1ff9f4f5b5128fe5fdd927';
const STORAGE = { extrinsicHash: '0x80d46a8611bb486f3b71bdd6e9e15c96e522c536e2671c9f35d0a4496792feb3', blockHash: '0x18a28f38f2a66093eab90d11f438664428141cfade5df5ce031ff3f4519ce868' };
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const PRODUCER = { name: 'test catalog', kind: 'catalog', control: 'the test suite' };

/** One decision: bind the report under the policy, evaluate on the captured reads at the capture's clock. */
function decide(inputs, { entry = ENTRY, now = inputs.collectedAt, revision = '2', report = REPORT } = {}) {
  const binding = createBinding({ policy, report, releaseId: RELEASE_ID, revision, boundBy: 'test operator', boundAt: report.completedAt, storage: STORAGE, id: `binding-r${revision}` });
  const evaluation = evaluateBinding({ policy, binding, report, registry: inputs.registry, observation: inputs.observation, listing: inputs.listing, evidence: inputs.evidence, now });
  return { policy, binding, report, evaluation, inputs, configuredEntry: entry };
}

test('a release includes exactly the eligible entry with its evidence, hashes, verifies and reads within its deadline', () => {
  const decision = decide(reapproved);
  const at = decision.evaluation.evaluatedAt;
  const release = buildCatalogRelease({ name: 'pUSD catalog', producer: PRODUCER, decisions: [decision], generatedAt: at });
  assert.equal(release.schema, CATALOG_RELEASE_SCHEMA);
  assert.equal(release.version, 1);
  assert.equal(release.entries.length, 1);
  assert.equal(release.withheld.length, 0);
  const [entry] = release.entries;
  assert.deepEqual([entry.chainId, entry.address, entry.symbol, entry.name, entry.decimals, entry.assetId], [420420777, SUBJECT, 'pUSD', 'Portaldot USD (test)', 6, '7777']);
  assert.equal(entry.source, 'approved-report');
  assert.equal(entry.reportHash, REPORT.evidenceHash);
  assert.equal(entry.revision, '2');
  assert.equal(entry.validUntil, plus(reapproved.observation.observedAt, 900_000), 'the network read plus the freshness limit');
  assert.equal(entry.limitedBy, 'observation');
  assert.equal(release.validity.validUntil, entry.validUntil);
  assert.equal(release.previousReleaseHash, null);
  assert.match(release.releaseHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(release));
  const verification = verifyCatalogRelease(release);
  assert.equal(verification.ok, true, JSON.stringify(verification.checks.filter((check) => !check.ok)));
  const within = readCatalogRelease(release, { now: entry.validUntil });
  assert.equal(within.ok, true);
  assert.equal(within.freshness, 'deadline-only');
  assert.equal(within.usable[0].address, SUBJECT);
  assert.match(selectorFrom(within)[0].label, /^pUSD · Portaldot USD \(test\) · 6 decimals$/);
  const lapsed = readCatalogRelease(release, { now: plus(entry.validUntil, 1) });
  assert.equal(lapsed.ok, false, 'one millisecond after the deadline nothing is usable');
  assert.deepEqual(lapsed.withheld[0].reasons, ['lapsed']);
  assert.equal(selectorFrom(lapsed)[0].selectable, false);
  // Tampering: a changed entry field, a changed hash, a removed evidence document.
  const edited = JSON.parse(JSON.stringify(release));
  edited.entries[0].decimals = 18;
  assert.equal(verifyCatalogRelease(edited).ok, false);
  assert.equal(readCatalogRelease(edited).ok, false);
  assert.deepEqual(readCatalogRelease(edited).withheld[0].reasons, ['release-unverified']);
  const rehashed = { ...edited, releaseHash: undefined };
  assert.equal(verifyCatalogRelease(JSON.parse(JSON.stringify({ ...rehashed, releaseHash: 'ab'.repeat(32) }))).ok, false);
});

test('a withheld decision never becomes an entry: wrong metadata, revoked approval, superseded revision, expired evidence, unavailable reads', () => {
  const at = reapproved.collectedAt;
  const cases = {
    'wrong decimals': decide(reapproved, { entry: WRONG }),
    revoked: decide(revoked, { now: revoked.collectedAt }),
    superseded: decide(superseded, { now: superseded.collectedAt, revision: '1', report: REPORT }),
    expired: decide(reapproved, { now: '2026-11-02T09:43:18.329Z' }),
    unavailable: decide({ ...reapproved, observation: { error: 'node did not answer' }, registry: { error: 'node did not answer' }, listing: { error: 'node did not answer' }, evidence: { error: 'node did not answer' } }),
  };
  for (const [name, decision] of Object.entries(cases)) {
    const release = buildCatalogRelease({ name: `case ${name}`, producer: PRODUCER, decisions: [decision], generatedAt: decision.evaluation.evaluatedAt });
    assert.equal(release.entries.length, 0, name);
    assert.equal(release.withheld.length, 1, name);
    assert.equal(release.validity.validUntil, null, name);
    assert.equal(verifyCatalogRelease(release).ok, true, name);
    const read = readCatalogRelease(release, { now: decision.evaluation.evaluatedAt });
    assert.equal(read.ok, false, name);
    assert.ok(release.withheld[0].reasons.length > 0, `${name}: reasons named`);
    assert.ok(release.withheld[0].diagnostics.length > 0, `${name}: diagnostics named`);
    const outcome = gateOutcome({ evidence: release.evidence[0], release, subject: SUBJECT, generatedAt: at });
    assert.equal(outcome.permitted, false, name);
    assert.equal(outcome.status, name === 'unavailable' ? 'unknown' : 'refused', `${name}: ${outcome.status}`);
    assert.equal(outcome.exitCode, name === 'unavailable' ? EXIT.unknown : EXIT.refused, name);
  }
  const wrong = cases['wrong decimals'];
  const diagnostics = releaseDiagnostics(buildDecisionEvidence({ producer: PRODUCER, ...wrong, generatedAt: at }));
  assert.deepEqual(diagnostics.map((item) => item.pointer), ['/entry/configured/decimals']);
  assert.deepEqual([diagnostics[0].code, diagnostics[0].configured, diagnostics[0].approved, diagnostics[0].role], ['entry-mismatch:decimals', 18, 6, 'operator']);
  assert.equal(diagnostics[0].checkpoint.number, REPORT.binding.checkpoint.number, 'the checkpoint of the approved report');
  const revokedDiagnostics = releaseDiagnostics(buildDecisionEvidence({ producer: PRODUCER, ...cases.revoked, generatedAt: at }));
  assert.ok(revokedDiagnostics.some((item) => item.pointer === '/evaluation/checks/registry.approvals' && item.code === 'approval-revoked' && item.role === 'reviewer' && item.checkpointKind === 'registry'), JSON.stringify(revokedDiagnostics.map((item) => [item.pointer, item.code])));
  assert.ok(revokedDiagnostics.some((item) => item.code === 'consumer-not-listed' && item.role === 'release owner'));
});

test('fresh reads decide again: an entry within its deadline is withheld when the registry now shows the approval revoked', () => {
  const decision = decide(reapproved);
  const release = buildCatalogRelease({ name: 'pUSD catalog', producer: PRODUCER, decisions: [decision], generatedAt: decision.evaluation.evaluatedAt });
  const at = plus(reapproved.observation.observedAt, 60_000);
  // Reads re-dated to `at` so that freshness holds; the registry read is the revoked one.
  const redate = (inputs) => ({ observation: { ...inputs.observation, observedAt: at }, registry: { ...inputs.registry, observedAt: at }, listing: { ...inputs.listing, observedAt: at }, evidence: inputs.evidence });
  const still = readCatalogRelease(release, { now: at, reads: { [SUBJECT]: redate(reapproved) } });
  assert.equal(still.ok, true, JSON.stringify(still.withheld));
  assert.equal(still.freshness, 'fresh-reads');
  assert.equal(still.usable[0].fresh.status, 'valid');
  const revokedNow = readCatalogRelease(release, { now: at, reads: { [SUBJECT]: redate(revoked) } });
  assert.equal(revokedNow.ok, false);
  assert.ok(revokedNow.withheld[0].reasons.includes('approval-revoked'), JSON.stringify(revokedNow.withheld[0].reasons));
  const missing = readCatalogRelease(release, { now: at, reads: {} });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.withheld[0].reasons, ['reads-missing']);
});

test('releases chain and compare: a second release names the first, and the diff shows what changed', () => {
  const first = buildCatalogRelease({ name: 'pUSD catalog', producer: PRODUCER, decisions: [decide(reapproved)], generatedAt: reapproved.collectedAt });
  const laterReads = { ...revoked };
  const second = buildCatalogRelease({ name: 'pUSD catalog', producer: PRODUCER, decisions: [decide(laterReads, { now: revoked.collectedAt })], previous: first, generatedAt: revoked.collectedAt });
  assert.equal(second.version, 2);
  assert.equal(second.previousReleaseHash, first.releaseHash);
  assert.equal(verifyCatalogRelease(second).ok, true);
  const diff = compareCatalogReleases(first, second);
  assert.equal(diff.chained, true);
  assert.deepEqual(diff.summary, { added: 0, removed: 1, changed: 0, unchanged: 0 });
  assert.ok(diff.removed[0].withheldAfter.reasons.includes('approval-revoked'), 'the diff says why the entry dropped out');
  const third = buildCatalogRelease({ name: 'pUSD catalog', producer: PRODUCER, decisions: [decide(reapproved)], previous: second, generatedAt: plus(reapproved.collectedAt, 1000) });
  const back = compareCatalogReleases(first, third);
  assert.equal(back.chained, false, 'the third release follows the second, not the first');
  assert.equal(back.summary.unchanged + back.summary.changed, 1);
  const detached = { ...second, previousReleaseHash: null };
  assert.equal(verifyCatalogRelease(JSON.parse(JSON.stringify(detached))).ok, false, 'a release edited after generation does not verify');
  assert.throws(() => buildCatalogRelease({ name: 'x', producer: PRODUCER, decisions: [decide(reapproved)], previous: { schema: 'other' } }), /earlier catalog release/);
  assert.throws(() => buildCatalogRelease({ name: 'x', producer: PRODUCER, decisions: [decide(reapproved), decide(reapproved)] }), /one entry per subject/);
});

test('the gate reads the shipped starter consumer configuration and refuses a malformed one', async () => {
  // The starter and separate consumer share these policy, release and entry declarations.
  // Keep the test reproducible from this repository without a sibling checkout.
  const consumer = await load('examples/release-gate-starter/project.json');
  const loaded = loadConsumerConfig(consumer, 'allowlist');
  assert.equal(loaded.policy.subject.address, SUBJECT);
  assert.match(loaded.policyHash, /^[a-f0-9]{64}$/);
  assert.throws(() => loadConsumerConfig({ ...consumer, schema: 'x' }), /declares schema/);
  assert.throws(() => loadConsumerConfig({ ...consumer, release: { ...consumer.release, revision: '0' } }), /release\.revision/);
  assert.throws(() => loadConsumerConfig({ ...consumer, entry: { ...consumer.entry, address: `0x${'ab'.repeat(20)}` } }), /not the policy subject/);
  assert.throws(() => loadConsumerConfig({ ...consumer, release: { ...consumer.release, storage: null } }), /requires stored evidence/);
  const error = gateOutcome({ error: new Error('bad config'), subject: SUBJECT });
  assert.equal(error.status, 'configuration-error');
  assert.equal(error.exitCode, EXIT['configuration-error']);
  const permitted = gateOutcome({ release: buildCatalogRelease({ name: 'x', producer: PRODUCER, decisions: [decide(reapproved)], generatedAt: reapproved.collectedAt }), subject: SUBJECT });
  assert.equal(permitted.status, 'permitted');
  assert.equal(permitted.exitCode, 0);
  assert.match(permitted.nextAction, /Publish release 1/);
});
