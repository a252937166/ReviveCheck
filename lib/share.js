// Browser-only report transport. No signing keys, backend, or Node modules.
export const PUBLIC_REVIEW_URL = 'https://revivecheck.axiqo.xyz/';
export const MAX_REPORT_BYTES = 512 * 1024;
export const MAX_FRAGMENT_LENGTH = 32000;
export const MAX_QR_LENGTH = 1800;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const hashPattern = /^[a-f0-9]{64}$/i;

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Integrity verification needs HTTPS or localhost and a browser with Web Crypto.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function guardPublicData(value, depth = 0) {
  if (depth > 40) throw new Error('This file is nested too deeply.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(mnemonic|seed|seedphrase|privatekey|secretkey|accesstoken|apikey|password|authorization)$/i.test(key.replace(/[-_\s]/g, ''))) throw new Error('This file contains a credential field. Share public report data only.');
    guardPublicData(child, depth + 1);
  }
}

export function validateReportShape(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run) || !hashPattern.test(run.evidenceHash || '')) throw new Error('Choose an original ReviveCheck JSON report with its evidence fingerprint.');
  if (typeof run.id !== 'string' || !Array.isArray(run.checks) || run.checks.length > 100 || !run.input || typeof run.input !== 'object') throw new Error('The report is missing its run, checks, or saved plan.');
  for (const value of [run.projectName,run.release,run.input.name,run.input.release,run.input.logicalContractId]) if (value !== undefined && typeof value !== 'string') throw new Error('The report contains invalid project or release text.');
  if (run.limitations !== undefined && (!Array.isArray(run.limitations) || run.limitations.length > 100 || run.limitations.some(item => typeof item !== 'string'))) throw new Error('The report contains invalid evidence limitations.');
  if (run.network && (typeof run.network !== 'object' || Array.isArray(run.network))) throw new Error('The report contains invalid network information.');
  for (const value of [run.network?.specVersion,run.network?.finalizedBlockNumber]) if (value !== undefined && !['string','number'].includes(typeof value)) throw new Error('The report contains an invalid checkpoint.');
  if (!['live', 'rehearsal'].includes(run.mode)) throw new Error('The report has an unsupported evidence mode.');
  if (!['passed','failed','blocked','inconclusive'].includes(run.status)) throw new Error('The report has an invalid aggregate result.');
  if (run.mode === 'live' ? !['portaldot-testnet-readonly', 'portaldot-live-readonly'].includes(run.scope) : run.scope !== 'local-rehearsal') throw new Error('The report evidence mode and scope disagree.');
  if (run.checks.some(check => !check || typeof check.id !== 'string' || (check.title !== undefined && typeof check.title !== 'string') || !['passed', 'failed', 'blocked', 'unknown'].includes(check.status))) throw new Error('The report contains an invalid check.');
  if (encoder.encode(JSON.stringify(run)).length > MAX_REPORT_BYTES) throw new Error('The report exceeds the 512 KB sharing limit.');
  guardPublicData(run);
  return run;
}

export async function verifyReport(run, expectedHash = '') {
  validateReportShape(run);
  const { evidenceHash, ...payload } = run;
  if (expectedHash && expectedHash.toLowerCase() !== evidenceHash.toLowerCase()) throw new Error('This report does not match the fingerprint in the review link. Ask the owner for the matching JSON.');
  if (await sha256(payload) !== evidenceHash) throw new Error('Integrity check failed. The report changed or its fingerprint is invalid. Request the original JSON.');
  const aggregate = run.checks.some(check=>check.status==='failed') ? 'failed' : run.checks.some(check=>check.status==='blocked') ? 'blocked' : !run.checks.length || run.checks.some(check=>check.status!=='passed') ? 'inconclusive' : 'passed';
  if (aggregate !== run.status) throw new Error('The report aggregate result disagrees with its checks.');
  return run;
}

export async function readJsonFile(file, limit = MAX_REPORT_BYTES) {
  if (!file || file.size > limit) throw new Error(`Choose a JSON file smaller than ${Math.round(limit / 1024)} KB.`);
  try { return JSON.parse(await file.text()); }
  catch { throw new Error('This file is not valid JSON.'); }
}

function toBase64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length > Math.ceil(MAX_REPORT_BYTES * 4 / 3)) throw new Error('The report link is malformed or too large. Import the JSON file instead.');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function readBounded(stream) {
  const reader = stream.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REPORT_BYTES) { await reader.cancel(); throw new Error('The expanded report exceeds the 512 KB safety limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function viewerUrl(evidenceHash = '') {
  return `${PUBLIC_REVIEW_URL}#/review${hashPattern.test(evidenceHash) ? `?hash=${evidenceHash}` : ''}`;
}

export async function fetchPublishedReport(hash, base = PUBLIC_REVIEW_URL) {
  if (!hashPattern.test(hash || '')) throw new Error('The published report fingerprint is invalid.');
  const url = new URL(`reports/${hash}.json`, base);
  const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('This public report is unavailable. Ask its owner for the original JSON.');
  let report;
  try { report = JSON.parse(decoder.decode(await readBounded(response.body))); }
  catch { throw new Error('The public report could not be read safely. Import the original JSON.'); }
  return verifyReport(report, hash);
}

export async function makeShareLink(run, { checkPublished = true } = {}) {
  await verifyReport(run);
  if (checkPublished) {
    try {
      await fetchPublishedReport(run.evidenceHash);
      const url = `${PUBLIC_REVIEW_URL}?report=${run.evidenceHash}#/review`;
      return { url, qrUrl: url, qrIncludesReport: true, requiresFile: false, published: true, length: url.length };
    } catch { /* Unpublished reports use a self-contained fragment or JSON. */ }
  }
  const bytes = encoder.encode(JSON.stringify(run));
  let format = 'rc1j', compressed = bytes;
  if (typeof CompressionStream !== 'undefined') {
    compressed = await readBounded(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')));
    format = 'rc1z';
  }
  const full = `${PUBLIC_REVIEW_URL}#/review?report=${format}.${toBase64(compressed)}`;
  const url = full.length <= MAX_FRAGMENT_LENGTH ? full : null;
  const qrIncludesReport = !!url && url.length <= MAX_QR_LENGTH;
  return { url, qrUrl: qrIncludesReport ? url : viewerUrl(run.evidenceHash), qrIncludesReport, requiresFile: !url, length: full.length };
}

export async function reportFromHash(hash = location.hash) {
  if (hash.length > MAX_FRAGMENT_LENGTH + 512) throw new Error('This review link is too long. Open the viewer and import the original JSON.');
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const expectedHash = params.get('hash') || '';
  if (expectedHash && !hashPattern.test(expectedHash)) throw new Error('The review link contains an invalid fingerprint.');
  const encoded = params.get('report');
  if (!encoded) return { run: null, expectedHash };
  const match = /^(rc1z|rc1j)\.([A-Za-z0-9_-]+)$/.exec(encoded);
  if (!match) throw new Error('This review-link format is not supported. Import the report JSON.');
  let bytes = fromBase64(match[2]);
  if (match[1] === 'rc1z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed reports. Import the original JSON file instead.');
    try { bytes = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))); }
    catch (error) { throw new Error(error.message.includes('512 KB') ? error.message : 'The compressed report is damaged. Import the original JSON.'); }
  }
  if (bytes.length > MAX_REPORT_BYTES) throw new Error('The report exceeds the 512 KB limit.');
  let run;
  try { run = JSON.parse(decoder.decode(bytes)); } catch { throw new Error('The report link does not contain valid JSON.'); }
  return { run: await verifyReport(run, expectedHash), expectedHash };
}

export async function createReviewReceipt(run, { reviewer, decision, comment }) {
  await verifyReport(run);
  const name = String(reviewer || '').trim();
  if (!name || name.length > 120) throw new Error('Enter a reviewer name of 1–120 characters.');
  if (!['accepted', 'changes-requested'].includes(decision)) throw new Error('Choose a review decision.');
  if (String(comment || '').length > 2000) throw new Error('Keep the review comment under 2,000 characters.');
  const payload = { schema: 'revivecheck.review.v1', id: crypto.randomUUID(), reportHash: run.evidenceHash, reviewer: name, decision, comment: String(comment || '').trim(), createdAt: new Date().toISOString(), identity: 'self-declared' };
  return { ...payload, receiptHash: await sha256(payload) };
}

export async function verifyReviewReceipt(review, reportHash = '') {
  if (!review || review.schema !== 'revivecheck.review.v1' || review.identity !== 'self-declared' || !hashPattern.test(review.receiptHash || '') || !hashPattern.test(review.reportHash || '')) throw new Error('Choose a ReviveCheck review receipt.');
  if (typeof review.id !== 'string' || typeof review.reviewer !== 'string' || !review.reviewer.trim() || review.reviewer.length > 120 || !['accepted','changes-requested'].includes(review.decision) || typeof review.comment !== 'string' || review.comment.length > 4000 || !Number.isFinite(Date.parse(review.createdAt))) throw new Error('The review receipt is missing valid reviewer, decision, comment, or time fields.');
  if (reportHash && review.reportHash !== reportHash) throw new Error('This review belongs to a different report.');
  const { receiptHash, ...payload } = review;
  if (await sha256(payload) !== receiptHash) throw new Error('The review receipt changed. Request the original file.');
  return review;
}

export function downloadJson(value, filename) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
