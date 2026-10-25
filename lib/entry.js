// The published-entry invariant, shared by every consumer that publishes a token
// entry: the fields an application publishes (chainId, address, symbol, name,
// decimals, assetId) are derived from the approved report, never copied from a
// configuration alone. A configuration says what the operator intends to publish;
// when it differs from what was verified and approved, the entry is withheld and the
// differing field is named. Nothing here reads the network.
import { fingerprint, verifyRun } from './report.js';

/** Every field a published entry carries. All of them must equal the approved report. */
export const ENTRY_FIELDS = Object.freeze(['chainId', 'address', 'symbol', 'name', 'decimals', 'assetId']);
/** The fields the report's `token.listing` check confirms per field through both interfaces. */
const CONFIRMED_FIELDS = Object.freeze(['chainId', 'address', 'symbol', 'name', 'decimals']);
const H160 = /^0x[0-9a-f]{40}$/;
const lower = (value) => String(value ?? '').toLowerCase();

/** One canonical shape for an entry, so two spellings of the same entry compare equal. */
export function canonicalEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    chainId: Number(entry.chainId),
    address: lower(entry.address),
    symbol: String(entry.symbol ?? ''),
    name: String(entry.name ?? ''),
    decimals: Number(entry.decimals),
    assetId: entry.assetId === undefined || entry.assetId === null ? null : String(entry.assetId),
  };
}

/** The identity of an entry: SHA-256 over its canonical fields. */
export const entryIdentity = (entry) => { const canonical = canonicalEntry(entry); return canonical ? fingerprint(canonical) : null; };

/**
 * The entry an approved report verified: the report's own listing claim, accepted only
 * when the report is intact, passed, and its `token.listing` check confirmed every
 * published field through both interfaces with the same values. Anything else yields
 * no entry, with the reason.
 */
export function approvedEntry(report) {
  if (!verifyRun(report)) return { entry: null, reason: 'the report fails its integrity check' };
  if (report.status !== 'passed') return { entry: null, reason: `the report did not pass (${report.status})` };
  const input = report.input || {};
  if (input.profile !== 'native-asset' || !input.listing || typeof input.listing !== 'object') return { entry: null, reason: 'the report carries no token-list entry; only a native-asset report with a listing can approve one' };
  const check = (report.checks || []).find((item) => item.id === 'token.listing');
  if (!check || check.status !== 'passed') return { entry: null, reason: 'the report has no passed token.listing check' };
  const fields = Array.isArray(check.evidence?.fields) ? check.evidence.fields : null;
  if (!fields) return { entry: null, reason: 'the token.listing check carries no per-field evidence' };
  const entry = canonicalEntry({ ...input.listing, assetId: input.nativeAsset?.assetId ?? null });
  for (const field of CONFIRMED_FIELDS) {
    const confirmed = fields.find((item) => item.field === field);
    if (!confirmed || confirmed.status !== 'passed') return { entry: null, reason: `the token.listing check did not confirm ${field}` };
    const claimed = field === 'address' ? lower(confirmed.claimed) : field === 'chainId' || field === 'decimals' ? Number(confirmed.claimed) : String(confirmed.claimed);
    if (claimed !== entry[field]) return { entry: null, reason: `the token.listing evidence for ${field} does not match the report's listing claim` };
  }
  if (check.evidence.assetId !== undefined && String(check.evidence.assetId) !== entry.assetId) return { entry: null, reason: 'the token.listing evidence names another asset than the report plan' };
  if (!H160.test(entry.address) || !Number.isSafeInteger(entry.chainId) || !Number.isInteger(entry.decimals) || !entry.symbol || !entry.name || entry.assetId === null) return { entry: null, reason: 'the report listing is incomplete' };
  return { entry, reason: null, reportHash: report.evidenceHash, checkpoint: report.binding?.checkpoint ?? null };
}

/** Field-by-field comparison of the configured entry with the approved one, in canonical form. */
export function compareEntry(configured, approved) {
  const want = canonicalEntry(configured), have = canonicalEntry(approved);
  if (!want) return { match: false, mismatches: [], reason: 'no configured entry' };
  if (!have) return { match: false, mismatches: [], reason: 'no approved entry' };
  const mismatches = ENTRY_FIELDS.filter((field) => want[field] !== have[field]).map((field) => ({ field, configured: want[field], approved: have[field] }));
  return { match: mismatches.length === 0, mismatches, reason: mismatches.length ? `the configured entry differs from the approved report in ${mismatches.map((item) => item.field).join(', ')}` : null };
}

/**
 * The complete entry decision for one configured entry and one bound report, in the
 * shape the Catalog, the decision page and the decision-evidence export all carry.
 */
export function entryDecision(configured, report) {
  const approved = report ? approvedEntry(report) : { entry: null, reason: 'no bound report' };
  const comparison = compareEntry(configured, approved.entry);
  return {
    configured: canonicalEntry(configured), approved: approved.entry, match: comparison.match, mismatches: comparison.mismatches,
    reason: comparison.match ? null : approved.entry ? comparison.reason : approved.reason,
    reportHash: approved.reportHash ?? null, identity: comparison.match ? entryIdentity(approved.entry) : null,
    reasons: comparison.match ? [] : approved.entry ? comparison.mismatches.map((item) => `entry-mismatch:${item.field}`) : ['entry-unverified'],
  };
}
