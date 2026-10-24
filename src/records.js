// The public records behind the site: the recorded run, the contracts, the
// studio run, the stored reports and the chain-built feed. One loader for the
// landing and the app, and the derived rows both draw from.
import { useEffect, useRef, useState } from 'react';
import { NETWORKS } from '../lib/networks.js';
import { short } from './components.jsx';

export const TESTNET = NETWORKS.testnet, LIVE = NETWORKS.live;
export const PUSD = '0x00001E6100000000000000000000000000010000';
export const fetchJson = (path) => fetch(new URL(path, new URL('./', location.href)), { credentials: 'omit' }).then((response) => response.ok ? response.json() : null).catch(() => null);
export const reviewerLink = (hash) => `./?report=${hash}#/review`;
export const evidenceFor = (data, hash) => data.evidence?.items?.find((item) => item.reportHash === hash) || null;
export const listingFor = (data, token = PUSD) => data.tokenList?.listings?.find((item) => item.token === token.toLowerCase()) || null;
/** The feed knows token addresses; only the demo precompile has a symbol here. */
export const symbolOf = (token) => String(token || '').toLowerCase() === PUSD.toLowerCase() ? 'pUSD' : short(token, 10);
export const fmt = (value) => value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString('en-US');
export const when = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(date) + ' UTC'; };

const FILES = ['lifecycle/reference.json', 'lifecycle/release-gate.json', 'lifecycle/registry.json', 'lifecycle/studio-run.json', 'lifecycle/token-list.json', 'lifecycle/evidence.json', 'api/registry.json', 'reports/index.json'];
let cache = null;
/** Every public record, loaded once per page and shared. */
export function useRecords() {
  const [data, setData] = useState(cache || {});
  useEffect(() => {
    if (cache) return undefined;
    let alive = true;
    Promise.all(FILES.map(fetchJson)).then(async ([rec, gate, registry, studio, tokenList, evidence, feed, reports]) => {
      const next = { rec, gate, registry, studio, tokenList, evidence, feed, reports: reports?.reports || [], loaded: true };
      if (rec) {
        const [checkRun, promotionRun] = await Promise.all([fetchJson(`reports/${rec.check.reportHash}.json`), fetchJson(`reports/${rec.promotion.reportHash}.json`)]);
        next.promotion = { check: checkRun, promotion: promotionRun };
      }
      cache = next;
      if (alive) setData(next);
    });
    return () => { alive = false; };
  }, []);
  return data;
}

/** The recorded run, stage by stage, in the record's own numbers. */
export function recordedState(data, liveSpec) {
  const { rec } = data;
  if (!rec) return {};
  const recordedSpec = rec.recheck.runtime.split('/')[1];
  const drifted = liveSpec && String(liveSpec) !== recordedSpec;
  const stored = evidenceFor(data, rec.recheck.reportHash) || data.evidence?.items?.[0];
  const listing = listingFor(data);
  return {
    check: { status: rec.check.status, label: 'Failed', detail: `${rec.check.release} · #${fmt(rec.check.block.number)}` },
    recheck: { status: rec.recheck.status, label: 'Passed', detail: `${rec.recheck.release} · #${fmt(rec.recheck.block.number)}` },
    store: stored ? { status: 'passed', label: `${fmt(stored.bytes)} B`, detail: `#${fmt(stored.blockNumber)}` } : { status: 'idle', label: 'Not stored', idle: 'Not stored' },
    submit: { status: 'passed', label: `Revision ${rec.attestation.revision}`, detail: `#${fmt(rec.attestation.submit.blockNumber)}` },
    approve: { status: 'approved', label: 'Approved', detail: `#${fmt(rec.attestation.review.blockNumber)}` },
    consume: listing ? { status: 'approved', label: 'pUSD listed', detail: `#${fmt(listing.blockNumber)}` } : { status: 'idle', label: 'Not listed', idle: 'Not listed' },
    promote: { status: 'refused', label: 'Refused', detail: `#${fmt(rec.promotion.block.number)}` },
    watch: liveSpec ? { status: drifted ? 'pending' : 'passed', label: drifted ? 'Recheck due' : `${liveSpec} holds`, detail: 'runtime, live' } : { status: 'idle', label: 'Connecting', detail: 'runtime, live' },
  };
}

/** Every on-chain record behind the site, in block order on each network. */
export function evidenceRows({ rec, gate, registry, studio, tokenList, evidence }) {
  if (!rec || !gate) return [];
  const rows = [
    ['Check v1.0.0', 'Failed', TESTNET, rec.check.block.nativeHash, rec.check.block.number, 'block', rec.check.reportHash, rec.check.completedAt],
    ['Recheck v1.0.1', 'Passed', TESTNET, rec.recheck.block.nativeHash, rec.recheck.block.number, 'block', rec.recheck.reportHash, rec.recheck.completedAt],
    ['ReleaseGate deployed', 'Finalized', TESTNET, gate.deploy.extrinsicHash, gate.deploy.blockNumber, 'extrinsic', null, gate.deploy.finalizedAt],
    ...gate.revisions.flatMap((revision) => [[`Revision ${revision.revision} submitted`, 'Finalized', TESTNET, revision.submit.extrinsicHash, revision.submit.blockNumber, 'extrinsic', null, revision.submit.finalizedAt], [`Revision ${revision.revision} approved`, 'Finalized', TESTNET, revision.review.extrinsicHash, revision.review.blockNumber, 'extrinsic', revision.readbackReportHash, revision.review.finalizedAt]]),
    ['Promotion to V3 Live', 'Refused', LIVE, rec.promotion.block.nativeHash, rec.promotion.block.number, 'block', rec.promotion.reportHash, rec.promotion.completedAt],
    ...(registry ? [['ReleaseRegistry deployed', 'Finalized', TESTNET, registry.deploy.extrinsicHash, registry.deploy.blockNumber, 'extrinsic', null, registry.deploy.finalizedAt]] : []),
    ...(studio ? [
      ['Studio: check v1.0.0', 'Failed', TESTNET, studio.reports.check.block.nativeHash, studio.reports.check.block.number, 'block', studio.reports.check.reportHash, studio.reports.check.completedAt],
      ['Studio: recheck v1.0.1', 'Passed', TESTNET, studio.reports.recheck.block.nativeHash, studio.reports.recheck.block.number, 'block', studio.reports.recheck.reportHash, studio.reports.recheck.completedAt],
      ['Studio: submitted to the registry', 'Finalized', TESTNET, studio.submit.extrinsicHash, studio.submit.blockNumber, 'extrinsic', null, studio.submit.finalizedAt],
      ['Studio: approved in the registry', 'Finalized', TESTNET, studio.approve.extrinsicHash, studio.approve.blockNumber, 'extrinsic', null, studio.approve.finalizedAt],
      ...(studio.remark ? [['Studio: review remark', 'Finalized', TESTNET, studio.remark.extrinsicHash, studio.remark.blockNumber, 'extrinsic', null, studio.remark.finalizedAt]] : []),
      ['Studio: promotion to V3 Live', 'Refused', LIVE, studio.reports.promote.block.nativeHash, studio.reports.promote.block.number, 'block', studio.reports.promote.reportHash, studio.reports.promote.completedAt],
    ] : []),
    ...(tokenList?.deploy ? [['VerifiedTokenList deployed', 'Finalized', TESTNET, tokenList.deploy.extrinsicHash, tokenList.deploy.blockNumber, 'extrinsic', null, tokenList.deploy.finalizedAt]] : []),
    ...(evidence?.items || []).map((item) => [`Report ${short(item.reportHash, 10)} stored on-chain`, 'Finalized', TESTNET, item.extrinsicHash, item.blockNumber, 'extrinsic', item.reportHash, item.finalizedAt]),
    ...(tokenList?.listings || []).map((item) => ['pUSD listed in the VerifiedTokenList', 'Finalized', TESTNET, item.extrinsicHash, item.blockNumber, 'extrinsic', null, item.finalizedAt]),
  ];
  return rows.sort((a, b) => (a[2] === b[2] ? Number(a[4]) - Number(b[4]) : a[2] === LIVE ? 1 : -1));
}

/** The four counts the stats band and the overview tiles show, from the feed. */
export function counts(data) {
  const feed = data.feed;
  const releases = feed?.releases || [];
  return {
    records: evidenceRows(data).length,
    releases: releases.length,
    approvals: releases.reduce((sum, release) => sum + Object.values(release.decisions || {}).filter((decision) => decision.approved && decision.revision === release.revision).length, 0),
    listings: new Set((feed?.listings || []).map((item) => item.token)).size,
    stored: feed?.evidence?.length || data.evidence?.items?.length || 0,
    indexedTo: feed?.indexedTo,
  };
}

/** The registry's own events plus listings and stored reports, newest first, for the activity views. */
export function activity(data) {
  const feed = data.feed;
  if (!feed) return [];
  const items = [];
  for (const release of feed.releases) for (const event of release.history) items.push({ kind: event.type === 'submitted' ? 'submitted' : event.approved ? 'approved' : 'changes', title: event.type === 'submitted' ? `${release.label} · revision ${event.revision} submitted` : `${release.label} · revision ${event.revision} ${event.approved ? 'approved' : 'changes requested'}`, who: event.type === 'submitted' ? event.owner : event.reviewer, report: event.reportHash, time: event.time, block: event.blockNumber, hash: event.extrinsicHash, kindOfHash: 'extrinsic', network: TESTNET });
  for (const listing of feed.listings) items.push({ kind: 'listed', title: `${symbolOf(listing.token)} listed in the VerifiedTokenList`, who: listing.reviewer, report: listing.reportHash, time: listing.time, block: listing.blockNumber, hash: listing.extrinsicHash, kindOfHash: 'extrinsic', network: TESTNET });
  for (const item of feed.evidence) items.push({ kind: 'stored', title: `Report ${short(item.reportHash, 10)} stored (${fmt(item.bytes)} bytes)`, who: item.publisher, report: item.reportHash, time: item.time, block: item.blockNumber, hash: item.extrinsicHash, kindOfHash: 'extrinsic', network: TESTNET });
  return items.sort((a, b) => Number(b.block) - Number(a.block));
}

/** A long-running read with an elapsed counter; a failure is a retry, never a result. */
export function useTask() {
  const [state, setState] = useState({});
  const timer = useRef();
  useEffect(() => () => clearInterval(timer.current), []);
  async function run(label, task) {
    const started = Date.now();
    setState({ busy: label, elapsed: 0 });
    clearInterval(timer.current);
    timer.current = setInterval(() => setState((current) => current.busy ? { ...current, elapsed: Math.round((Date.now() - started) / 1000) } : current), 1000);
    try { const result = await task(); setState({}); return result; }
    catch (error) { setState({ error: error?.message || String(error) }); return null; }
    finally { clearInterval(timer.current); }
  }
  return [state, run, () => setState({})];
}
