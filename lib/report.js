import { createHash } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function fingerprint(payload) { return createHash('sha256').update(canonical(payload)).digest('hex'); }
export function sealRun(payload) { return Object.freeze({ ...payload, evidenceHash: fingerprint(payload) }); }
export function verifyRun(run) { const { evidenceHash, ...payload } = run; return typeof evidenceHash === 'string' && fingerprint(payload) === evidenceHash; }
export function overall(checks) {
  if (!checks.length) return 'inconclusive';
  if (checks.some(c => c.status === 'failed')) return 'failed';
  if (checks.some(c => c.status === 'blocked')) return 'blocked';
  if (checks.some(c => c.status !== 'passed')) return 'inconclusive';
  return 'passed';
}
export function compareRuns(baseline, candidate) {
  const result = { baseline, candidate, compatible: false, changes: [], summary: { improved: 0, regressed: 0, unchanged: 0 } };
  if (!verifyRun(baseline) || !verifyRun(candidate)) return { ...result, reason: 'Evidence integrity check failed. Export the original saved report.' };
  if (baseline.projectId !== candidate.projectId) return { ...result, reason: 'Choose two runs from the same project.' };
  if (baseline.id === candidate.id) return { ...result, reason: 'Choose two different runs.' };
  if (baseline.scope !== candidate.scope || baseline.mode !== candidate.mode) return { ...result, reason: 'Local rehearsal and live testnet evidence cannot be compared as the same scope.' };
  result.inputChanges = ['name', 'release', 'account', 'contractAddress', 'expectedValue', 'expectedChainId', 'transactionHash', 'transactionBlockHash'].filter(k => canonical(baseline.input[k]) !== canonical(candidate.input[k])).map(key => ({ key, before: baseline.input[key], after: candidate.input[key] }));
  const targetChanges = result.inputChanges.filter(change => ['account', 'contractAddress', 'expectedValue'].includes(change.key));
  if (targetChanges.length) return { ...result, reason: `The acceptance target or assertion changed (${targetChanges.map(c => c.key).join(', ')}). These results cannot establish a repair of the same target. Keep this candidate as a new baseline.` };
  result.comparisonKind = result.inputChanges.some(change => change.key === 'expectedChainId') ? 'configuration-correction' : 'same-target';
  if (result.comparisonKind === 'configuration-correction') result.caveat = 'The expected network configuration changed. Improvements show a configuration correction, not proof of an application code fix.';
  const ids = new Set([...baseline.checks, ...candidate.checks].map(c => c.id));
  for (const id of ids) {
    const before = baseline.checks.find(c => c.id === id), after = candidate.checks.find(c => c.id === id);
    // Unknown, missing, and blocked evidence are never ranked as partial success.
    const transition = after?.status === 'passed' && before?.status !== 'passed' ? 'improved' : before?.status === 'passed' && after?.status !== 'passed' ? 'regressed' : 'unchanged';
    result.changes.push({ id, title: after?.title || before?.title, before: before || null, after: after || null, transition });
    result.summary[transition]++;
  }
  result.compatible = true;
  return result;
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function reportHtml(run) {
  const label = run.mode === 'rehearsal' ? 'Local rehearsal — synthetic fixtures, no blockchain transaction' : 'Portaldot V3 — live read-only observations';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ReviveCheck · ${escape(run.projectName)}</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#17254a;background:#f6f8ff;max-width:1000px;margin:auto;padding:40px}h1{font-size:36px;line-height:1.2}table{border-collapse:collapse;width:100%;background:white}td,th{padding:14px;text-align:left;border-bottom:1px solid #dbe3fa;vertical-align:top}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}small{color:#50617e}.scope{border-left:4px solid #2445a7;padding:16px;background:#e9efff}details{margin:12px 0}</style><h1>ReviveCheck</h1><p>${escape(run.projectName)} / ${escape(run.release)}</p><p class="scope">${escape(label)}<br>Result: <strong>${escape(run.status)}</strong><br>Observed ${escape(run.completedAt)}. This report is a point-in-time observation, not a security audit or a guarantee of future execution.</p><table><thead><tr><th>Check</th><th>Result</th><th>Observation / next action</th></tr></thead><tbody>${run.checks.map(c => `<tr><td>${escape(c.title)}</td><td>${escape(c.status)}</td><td>${escape(c.observed)}<br><small>${escape(c.remediation)}</small>${c.evidence ? `<details><summary>Raw evidence</summary><pre>${escape(JSON.stringify(c.evidence, null, 2))}</pre></details>` : ''}</td></tr>`).join('')}</tbody></table><h2>Scope and limitations</h2><ul>${run.limitations.map(x => `<li>${escape(x)}</li>`).join('')}</ul><details><summary>Saved input</summary><pre>${escape(JSON.stringify(run.input, null, 2))}</pre></details><p>Run ${escape(run.id)}<br>Evidence SHA-256 <code>${escape(run.evidenceHash)}</code></p><p>The fingerprint corresponds to the companion JSON report. Download JSON and verify that file with the ReviveCheck CLI; this HTML rendering is not integrity-verified. It is not an on-chain attestation or proof that RPC responses are truthful.</p></html>`;
}
