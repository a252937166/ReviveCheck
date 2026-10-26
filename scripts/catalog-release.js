#!/usr/bin/env node
// The release gate and reader: one command that validates a consumer configuration,
// retrieves and verifies the bound report from the chain, evaluates the policy on fresh
// reads, derives the entry from the approved report, and writes an immutable catalog
// release ONLY when the entry is permitted; a reader that imports a release, verifies it
// and decides which entries may be used now; and a comparison of two releases.
//
//   revivecheck-catalog prepare --config <consumer config> [--out <dir>] [--previous <release.json>] [--fixture <reads>] [--now <ISO>] [--name <text>] [--producer <text>] [--retries <n>]
//   revivecheck-catalog read <release.json> [--now <ISO>] [--live] [--json]
//   revivecheck-catalog compare <before.json> <after.json> [--json]
//
// Exit codes of `prepare`: 0 permitted (release retained and verified, or the exact same
// release already held the version), 1 refused (a known policy or entry refusal: nothing
// written but the outcome and the evidence), 2 unknown (a read was unavailable: never a
// pass, never silently a fixture), 3 configuration error (including a predecessor that
// does not verify), 4 publication conflict or failure (the version is occupied by another
// release, or the file could not be written, read back and verified; no earlier release
// is changed). `read` exits 0 when at least one entry is usable at the clock given.
//
// Publication rule: a release file `catalog-release-<version>.json` is immutable. It is
// written fully to a temporary file in the same directory, published through an
// exclusive no-replace link (never a truncating write, never a replacing rename), read
// back and hash-verified before the run claims it. Version 1 opens a release line; every
// later version names its verified predecessor explicitly (`--previous`), so repeating a
// preparation in a directory that already holds release 1 conflicts instead of
// overwriting it, unless the bytes are identical (then the existing file stands and the
// outcome says `reused`). The predecessor must be the line the directory retains: a
// retained version with the predecessor's number must carry its exact hash, and a
// predecessor the directory does not retain must directly follow the retained version
// before it; anything else is a lineage conflict (exit 4, nothing written), so a release
// from another directory cannot fork the retained line. Every run has a run identity: its outcome and decision evidence
// are kept under `runs/<runId>/` (written once, never replaced), and `outcome.json` /
// `decision-evidence.json` in the output directory are the most recent run's copies,
// each naming its own run identity, written atomically.
import { mkdir, readFile, writeFile, rename, link, unlink, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildCatalogRelease, readCatalogRelease, verifyCatalogRelease, compareCatalogReleases, gateOutcome, publicationOutcome, loadConsumerConfig, selectorFrom, EXIT, CATALOG_RELEASE_SCHEMA } from '../lib/catalog-release.js';
import { createBinding, evaluateBinding } from '../lib/policy.js';
import { buildDecisionEvidence } from '../lib/decision.js';
import { verifyRun } from '../lib/report.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string' }, out: { type: 'string', default: 'releases' }, previous: { type: 'string' }, fixture: { type: 'string' }, now: { type: 'string' }, name: { type: 'string' }, producer: { type: 'string' }, retries: { type: 'string', default: '3' }, live: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
} });
const [command, ...files] = positionals;
const RUN_ID = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(4).toString('hex')}`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const text = (value) => `${JSON.stringify(value, null, 2)}\n`;
/** Replace a convenience file atomically: the complete document is written to a temporary file and renamed into place, so a reader never sees a partial document. */
const writeJsonAtomic = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${RUN_ID}.tmp`; await writeFile(temp, text(value)); await rename(temp, file); return file; };
/** Write a record once: `wx` refuses an existing path, so a run never replaces another run's record. */
const writeJsonOnce = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text(value), { flag: 'wx' }); return file; };
const usage = () => console.log('Usage: revivecheck-catalog prepare --config <file> [--out <dir>] [--previous <release.json>] [--fixture <reads>] [--now <ISO>]\n       revivecheck-catalog read <release.json> [--now <ISO>] [--live] [--json]\n       revivecheck-catalog compare <before.json> <after.json> [--json]');

/** Reads from a fixture: the separate consumer's fixture shape, or an example-catalog capture (`--fixture <file>` with the policy subject). */
function fixtureReads(fixture, config) {
  if (fixture?.schema === 'revivecheck-consumer.fixture.v1') return { report: fixture.report, inputs: fixture.inputs, now: fixture.now, binding: fixture.binding, source: `fixture:${fixture.name ?? 'consumer'}` };
  if (fixture?.schema === 'revivecheck.token-catalog-inputs.v1') {
    const token = fixture.tokens?.[config.policy.subject.address];
    if (!token) throw new Error(`The capture has no reads for ${config.policy.subject.address}.`);
    const report = token.evidence?.run;
    if (!report?.evidenceHash) throw new Error('The capture carries no retrieved report under evidence.run.');
    return { report, inputs: { observation: token.observation, registry: token.registry, listing: token.listing, evidence: token.evidence, ...(token.subject ? { subject: token.subject } : {}) }, now: fixture.now, binding: null, source: `fixture:${fixture.config ?? 'capture'}` };
  }
  throw new Error('A fixture declares schema revivecheck-consumer.fixture.v1 or revivecheck.token-catalog-inputs.v1.');
}

/** The reads a policy needs: every read that may carry an error is checked, including the subject read when the policy requires it. */
const readKeys = (policy) => ['observation', 'registry', 'listing', 'evidence', ...(policy.evidence.requireFreshSubject ? ['subject'] : [])];

/** Live: the bound report from the chain, then fresh reads; retried when the public nodes do not answer. */
async function liveReads(config, { retries, log }) {
  const service = await import('../lib/service.js');
  const { extrinsicHash, blockHash } = config.release.storage;
  const attempts = [];
  try {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const record = { attempt, startedAt: new Date().toISOString() };
      try {
        const result = await service.retrieveEvidence({ extrinsicHash, blockHash, expectedHash: config.release.reportHash });
        if (!result.verified || !result.run) { record.failure = `retrieveEvidence: ${(result.reasons || []).join(' ') || 'not verified'}`; attempts.push(record); log(`attempt ${attempt}: ${record.failure}`); await service.closeConnections().catch(() => {}); continue; }
        const { run, ...retrieval } = result;
        const binding = createBinding({ policy: config.policy, report: run, releaseId: config.release.releaseId, revision: String(config.release.revision), boundBy: config.boundBy, note: `Release gate binding for ${config.release.label}: report ${run.evidenceHash.slice(0, 12)}… on revision ${config.release.revision}.`, storage: { extrinsicHash, blockHash: blockHash ?? null }, id: `gate-${String(config.release.label).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)}-r${config.release.revision}-${run.evidenceHash.slice(0, 12)}` });
        const inputs = await service.collectPolicyInputs({ policy: config.policy, binding });
        const failed = readKeys(config.policy).filter((key) => inputs[key]?.error).map((key) => `${key}: ${inputs[key].error}`);
        record.failedReads = failed; attempts.push(record);
        if (failed.length && attempt < retries) { log(`attempt ${attempt}: ${failed.join('; ')}`); await service.closeConnections().catch(() => {}); continue; }
        return { report: run, binding, inputs, retrieval, now: new Date().toISOString(), source: 'live:portaldot-v3-testnet', attempts };
      } catch (error) { record.failure = error.message; attempts.push(record); log(`attempt ${attempt}: ${error.message}`); await service.closeConnections().catch(() => {}); }
    }
    return { report: null, binding: null, inputs: null, retrieval: null, now: new Date().toISOString(), source: 'live:portaldot-v3-testnet', attempts };
  } finally { await service.closeConnections().catch(() => {}); }
}

/** The release files already in the output directory, by version. */
async function existingReleases(out) {
  const names = await readdir(out).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
  return names.map((name) => name.match(/^catalog-release-(\d+)\.json$/)).filter(Boolean).map((match) => ({ version: Number(match[1]), file: path.join(out, match[0]) })).sort((a, b) => a.version - b.version);
}

/** Read an existing release file and verify it; `{ releaseHash }` when intact, `{ error }` otherwise. */
async function inspectRelease(file) {
  try { const document = await readJson(file); const verification = verifyCatalogRelease(document); return verification.ok ? { releaseHash: document.releaseHash, version: document.version } : { error: `the existing file does not verify (${verification.checks.filter((check) => !check.ok).map((check) => check.id).join(', ')})` }; }
  catch (error) { return { error: `the existing path could not be read as a release (${error.message})` }; }
}

/**
 * The supplied predecessor must be the line this directory retains (repair follow-up
 * 2026-10-26, R-04): when the directory holds the predecessor's version, that retained
 * file must verify and carry the predecessor's exact hash; when it holds releases but not
 * that version, the predecessor must be the direct successor of the retained version
 * before it (its `previousReleaseHash` is that file's verified hash), so the line stays
 * coherent with at most one externally held link; a gap of two or more versions, a
 * retained file that does not verify, or a predecessor from another line is refused
 * before anything is written. An empty directory accepts an external predecessor and
 * opens the next version there. Returns null when the line is coherent.
 */
async function checkLineage(existing, previous) {
  const versions = existing.map((item) => item.version);
  const atVersion = existing.find((item) => item.version === previous.version);
  if (atVersion) {
    const inspected = await inspectRelease(atVersion.file);
    if (inspected.error) return { detail: `this directory retains version ${previous.version} at ${atVersion.file}, but ${inspected.error}; the line cannot be verified, so the supplied predecessor cannot be placed in it` };
    if (inspected.releaseHash !== previous.releaseHash) return { existingReleaseHash: inspected.releaseHash, detail: `the supplied predecessor is version ${previous.version} with hash ${previous.releaseHash.slice(0, 12)}…, but this directory retains version ${previous.version} with hash ${inspected.releaseHash.slice(0, 12)}… (${atVersion.file}); a release from another line cannot continue this one` };
    return null;
  }
  if (!existing.length) return null;
  const before = existing.find((item) => item.version === previous.version - 1);
  if (!before) return { detail: `this directory retains version${versions.length === 1 ? '' : 's'} ${versions.join(', ')} and the supplied predecessor is version ${previous.version}, which is neither retained here nor the successor of a retained version; copy its line's earlier releases here first (each is verified), or publish into another directory` };
  const inspected = await inspectRelease(before.file);
  if (inspected.error) return { detail: `this directory retains version ${before.version} at ${before.file}, but ${inspected.error}; the line cannot be verified` };
  if (inspected.releaseHash !== previous.previousReleaseHash) return { existingReleaseHash: inspected.releaseHash, detail: `the supplied predecessor (version ${previous.version}) names ${String(previous.previousReleaseHash ?? 'no release').slice(0, 12)}… as its predecessor, but this directory retains version ${before.version} with hash ${inspected.releaseHash.slice(0, 12)}… (${before.file}); the supplied predecessor belongs to another line` };
  return null;
}

/**
 * Publish a release at its version path without ever replacing an existing file: write
 * the complete document to a temporary file in the same directory, link it exclusively to
 * the final name (EEXIST when the version is occupied), remove the temporary name, then
 * read the final file back and verify its hash. The result names what happened.
 */
async function publishRelease(out, release, { previous }) {
  const file = path.join(out, `catalog-release-${release.version}.json`);
  await mkdir(out, { recursive: true });
  const existing = await existingReleases(out);
  // The release line: without a predecessor only version 1 may open it, and only in a directory that holds no release yet.
  if (!previous) {
    const others = existing.filter((item) => item.version !== release.version);
    if (others.length) { const latest = others.at(-1); const inspected = await inspectRelease(latest.file); return { status: 'conflict', file, existingReleaseHash: inspected.releaseHash ?? null, detail: `this directory already holds a release line up to version ${latest.version} (${latest.file}); pass --previous ${latest.file} to publish the next version` }; }
  } else {
    const lineage = await checkLineage(existing, previous);
    if (lineage) return { status: 'conflict', kind: 'lineage', file, existingReleaseHash: lineage.existingReleaseHash ?? null, detail: lineage.detail };
  }
  const temp = path.join(out, `.catalog-release-${release.version}.${RUN_ID}.tmp`);
  try {
    await writeFile(temp, text(release));
    try { await link(temp, file); }
    catch (error) {
      if (error.code !== 'EEXIST') return { status: 'failed', file, error: `${error.code ?? 'error'}: ${error.message}` };
      const inspected = await inspectRelease(file);
      if (inspected.error) return { status: 'failed', file, error: `version ${release.version} is occupied and ${inspected.error}` };
      return inspected.releaseHash === release.releaseHash ? { status: 'reused', file, releaseHash: release.releaseHash, existingReleaseHash: inspected.releaseHash } : { status: 'conflict', file, existingReleaseHash: inspected.releaseHash, detail: `version ${release.version} is occupied by release ${inspected.releaseHash.slice(0, 12)}…` };
    }
    const back = await inspectRelease(file);
    if (back.error || back.releaseHash !== release.releaseHash) return { status: 'failed', file, error: back.error ?? `the file read back carries hash ${String(back.releaseHash).slice(0, 12)}…, not ${release.releaseHash.slice(0, 12)}…` };
    return { status: 'published', file, releaseHash: release.releaseHash };
  } finally { await unlink(temp).catch(() => {}); }
}

async function prepare() {
  const out = values.out;
  const records = { outcome: path.join(out, 'runs', RUN_ID, 'outcome.json'), evidence: path.join(out, 'runs', RUN_ID, 'decision-evidence.json') };
  const relative = (file) => path.relative(out, file);
  let config, reads, release = null, evidence = null;
  try {
    if (!values.config) throw new Error('--config <file> names the consumer configuration (revivecheck-consumer.config.v1).');
    config = loadConsumerConfig(await readJson(values.config), values.config);
    const previous = values.previous ? await readJson(values.previous) : null;
    if (previous) {
      if (previous.schema !== CATALOG_RELEASE_SCHEMA) throw new Error('--previous is an earlier catalog release.');
      const verification = verifyCatalogRelease(previous);
      if (!verification.ok) throw new Error(`--previous does not verify as an intact catalog release (${verification.checks.filter((check) => !check.ok).map((check) => check.id).join(', ')}); a corrupt or edited predecessor cannot be extended.`);
    }
    reads = values.fixture ? fixtureReads(await readJson(values.fixture), config) : await liveReads(config, { retries: Math.min(10, Math.max(1, Number.parseInt(values.retries, 10) || 3)), log: (line) => console.error(line) });
    const now = values.now ?? reads.now;
    if (!reads.report) {
      const outcome = { ...gateOutcome({ evidence: null, release: null, subject: config.policy.subject.address, generatedAt: new Date().toISOString() }), runId: RUN_ID, records: { outcome: relative(records.outcome), evidence: null, release: null } };
      outcome.status = 'unknown'; outcome.exitCode = EXIT.unknown; outcome.reasons = ['storage-unverified']; outcome.attempts = reads.attempts ?? [];
      outcome.nextAction = 'Do not publish. The bound report could not be retrieved from the chain; retry the retrieval. Unavailable verification never counts as valid.';
      await writeJsonOnce(records.outcome, outcome);
      console.log(`UNKNOWN ${config.policy.subject.address}: the bound report was not retrieved (${reads.source}); nothing written but ${await writeJsonAtomic(path.join(out, 'outcome.json'), outcome)} (run ${RUN_ID})`);
      process.exitCode = EXIT.unknown; return;
    }
    if (!verifyRun(reads.report) || reads.report.evidenceHash !== config.release.reportHash.replace(/^0x/, '').toLowerCase()) throw new Error(`The report in hand (${reads.report.evidenceHash?.slice(0, 12)}…) is not the configured bound report (${config.release.reportHash.slice(0, 12)}…).`);
    const revision = String(reads.binding?.revision ?? config.release.revision);
    // A deterministic binding identity (label, revision, report), so that the same inputs at the same clock give the same release bytes.
    const binding = reads.binding?.bindingHash ? reads.binding : createBinding({ policy: config.policy, report: reads.report, releaseId: reads.binding?.releaseId ?? config.release.releaseId, revision, boundBy: config.boundBy, note: `Release gate binding for ${config.release.label}.`, storage: reads.binding?.storage ?? (config.release.storage?.extrinsicHash ? { extrinsicHash: config.release.storage.extrinsicHash, blockHash: config.release.storage.blockHash ?? null } : null), boundAt: now, id: `gate-${String(config.release.label).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)}-r${revision}-${reads.report.evidenceHash.slice(0, 12)}` });
    const evaluation = evaluateBinding({ policy: config.policy, binding, report: reads.report, registry: reads.inputs.registry, observation: reads.inputs.observation, listing: reads.inputs.listing, evidence: reads.inputs.evidence, subject: reads.inputs.subject ?? null, now });
    // The release content is deterministic for the same inputs and clock (the run identity lives in the outcome records, never in the release), so an identical repeat is recognized as the same artifact.
    const producer = { name: values.producer || config.name, kind: 'release-gate', control: config.roles?.operator?.control ?? null, source: reads.source };
    evidence = buildDecisionEvidence({ producer, policy: config.policy, binding, report: reads.report, evaluation, inputs: reads.inputs, configuredEntry: config.entry, extra: { attempts: reads.attempts ?? [], fixture: values.fixture ?? null }, generatedAt: now });
    release = buildCatalogRelease({ name: values.name || config.name, producer, decisions: [{ evidence }], previous, generatedAt: now });
    let outcome = { ...gateOutcome({ evidence, release: release.entries.length ? release : null, subject: config.policy.subject.address, generatedAt: now }), runId: RUN_ID, records: { outcome: relative(records.outcome), evidence: relative(records.evidence), release: null } };
    let publication = { status: 'not-attempted', runId: RUN_ID };
    if (outcome.permitted) {
      publication = { ...(await publishRelease(out, release, { previous })), runId: RUN_ID };
      if (publication.status === 'published' || publication.status === 'reused') outcome.records.release = relative(publication.file);
      outcome = publicationOutcome(outcome, { ...publication, records: outcome.records });
    } else outcome = publicationOutcome(outcome, { ...publication, records: outcome.records });
    await writeJsonOnce(records.evidence, evidence);
    await writeJsonOnce(records.outcome, outcome);
    const written = [await writeJsonAtomic(path.join(out, 'outcome.json'), outcome), await writeJsonAtomic(path.join(out, 'decision-evidence.json'), evidence)];
    console.log(`${outcome.status.toUpperCase()} ${config.policy.subject.address} (${reads.source}; evaluated ${evaluation.evaluatedAt}; run ${RUN_ID})`);
    console.log(`evaluation: ${evaluation.status}${evaluation.reasons.length ? `: ${evaluation.reasons.map((reason) => reason.code).join(', ')}` : ''}; entry: ${evidence.entry.match ? 'equals the approved report' : evidence.entry.reason}`);
    if (outcome.permitted) console.log(`release ${release.version} ${release.releaseHash} · ${release.entries.length} entry · permission ends ${release.validity.validUntil} (${release.validity.limitedBy})${previous ? ` · after ${previous.releaseHash.slice(0, 12)}…` : ''} · ${publication.status === 'reused' ? `identical to the existing ${publication.file}; nothing written` : `retained and verified at ${publication.file}`}`);
    else if (outcome.status === 'publication-conflict' || outcome.status === 'publication-failed') console.log(`not published: ${outcome.nextAction}`);
    else for (const item of outcome.diagnostics) console.log(`  ${item.pointer}: ${item.code} · observed ${JSON.stringify(item.observed ?? item.configured)} · expected ${JSON.stringify(item.expected ?? item.approved)} · checkpoint #${item.checkpoint?.number ?? '-'} · ${item.role} → ${item.nextAction}`);
    console.log(`wrote ${[...written, records.outcome, records.evidence].join(', ')}${outcome.permitted ? '' : ' (no release file of this run)'}`);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    const outcome = { ...gateOutcome({ error, subject: config?.policy?.subject?.address ?? null }), runId: RUN_ID, records: { outcome: relative(records.outcome), evidence: null, release: null } };
    await writeJsonOnce(records.outcome, outcome).catch(() => {});
    await writeJsonAtomic(path.join(out, 'outcome.json'), outcome).catch(() => {});
    console.error(`CONFIGURATION ERROR: ${error.message}`);
    process.exitCode = EXIT['configuration-error'];
  }
}

async function read() {
  const [file] = files;
  if (!file) { usage(); process.exitCode = 3; return; }
  const release = await readJson(file);
  let reads = null;
  if (values.live) {
    const service = await import('../lib/service.js');
    try {
      reads = {};
      for (const entry of release.entries || []) {
        const document = release.evidence.find((item) => item.evidenceHash === entry.evidenceHash);
        reads[entry.address] = await service.collectPolicyInputs({ policy: document.policy, binding: document.binding });
      }
    } finally { await service.closeConnections().catch(() => {}); }
  }
  const result = readCatalogRelease(release, { now: values.now ?? new Date(), reads });
  if (values.json) console.log(JSON.stringify({ ...result, selector: selectorFrom(result) }, null, 2));
  else {
    console.log(`Release ${result.version} ${String(result.releaseHash).slice(0, 16)}… · ${result.name} · read at ${result.readAt} (${result.freshness})`);
    for (const check of result.verification.checks) console.log(`${check.ok ? 'ok     ' : 'FAILED '} ${check.id.padEnd(26)} ${check.detail ?? ''}`);
    for (const row of selectorFrom(result)) console.log(`${row.selectable ? 'USABLE  ' : 'withheld'} ${row.label}\n         ${row.reason}`);
    console.log(result.note);
  }
  process.exitCode = result.ok ? 0 : 1;
}

async function compare() {
  const [before, after] = files;
  if (!before || !after) { usage(); process.exitCode = 3; return; }
  const diff = compareCatalogReleases(await readJson(before), await readJson(after));
  if (values.json) console.log(JSON.stringify(diff, null, 2));
  else {
    console.log(`${before} (version ${diff.before.version}) → ${after} (version ${diff.after.version})${diff.chained ? ', chained' : ', NOT chained'}`);
    for (const entry of diff.added) console.log(`added     ${entry.address} ${entry.symbol} · report ${entry.reportHash.slice(0, 12)}… revision ${entry.revision}`);
    for (const entry of diff.removed) console.log(`removed   ${entry.address} ${entry.symbol}${entry.withheldAfter ? ` · now withheld: ${entry.withheldAfter.reasons.join(', ')}` : ''}`);
    for (const entry of diff.changed) console.log(`changed   ${entry.address} · ${[...entry.fields.map((item) => `${item.field} ${JSON.stringify(item.before)} → ${JSON.stringify(item.after)}`), ...entry.evidence.map((item) => `${item.key} ${String(item.before).slice(0, 12)} → ${String(item.after).slice(0, 12)}`)].join('; ')}`);
    for (const entry of diff.unchanged) console.log(`unchanged ${entry.address}`);
  }
  process.exitCode = 0;
}

if (command === 'prepare') await prepare();
else if (command === 'read') await read();
else if (command === 'compare') await compare();
else if (command === 'verify') { const release = await readJson(files[0]); const result = verifyCatalogRelease(release); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1; }
else { usage(); process.exitCode = command ? 3 : 0; }
