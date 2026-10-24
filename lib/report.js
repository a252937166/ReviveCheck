import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { reportExplorerEvidence, explorerQrSvgDataUrl } from './explorer.js';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
// Same SHA-256 hex in Node and the browser; the static reviewer seals and checks reports with it.
export function fingerprint(payload) { return bytesToHex(sha256(utf8ToBytes(canonical(payload)))); }
// Live read-only evidence comes from one of the two pinned V3 networks.
export const LIVE_SCOPES = Object.freeze(['portaldot-testnet-readonly', 'portaldot-live-readonly']);
export const scopeMatchesMode = run => run.mode === 'live' ? LIVE_SCOPES.includes(run.scope) : run.mode === 'rehearsal' && run.scope === 'local-rehearsal';
const address = value => String(value || '').startsWith('0x') ? String(value).toLowerCase() : String(value || '');
export function acceptancePlan(input = {}) {
  const profile = input.profile || 'contract';
  if (profile === 'native-asset') return { profile, logicalContractId: input.logicalContractId || '', nativeAsset: { assetId: String(input.nativeAsset?.assetId ?? ''), holder: address(input.nativeAsset?.holder) || 'asset-owner-at-checkpoint' } };
  const assertions = input.assertions?.length ? input.assertions : [{ id: 'value', signature: 'value()', returns: 'uint256', args: [], expected: String(input.expectedValue ?? '42') }];
  return { profile, logicalContractId: input.logicalContractId || '', caller: address(input.account), assertions: assertions.map(({ id, signature, returns, args = [], expected }) => ({ id, signature, returns, args, expected })), ...(input.nativeAsset ? { nativeAsset: { assetId: String(input.nativeAsset.assetId), holder: address(input.nativeAsset.holder) || 'asset-owner-at-checkpoint' } } : {}) };
}
export function environmentForRun(run) {
  const network = run.network || {};
  const raw = { chainId: network.observedChainId ?? network.chainId, genesisHash: network.nativeGenesisHash ?? network.genesisHash, specName: network.specName, specVersion: network.specVersion, transactionVersion: network.transactionVersion, stateVersion: network.stateVersion, constantsHash: network.constantsHash ?? network.runtimeFingerprint ?? network.environmentHash };
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => [key, String(value)]));
}
export function buildRunBinding(run) {
  const plan = acceptancePlan(run.input);
  const environment = environmentForRun(run);
  const network = run.network || {};
  return { plan, planHash: fingerprint(plan), logicalContractId: run.input?.logicalContractId || '', sourceRevision: run.input?.sourceRevision || '', ...(run.input?.listing ? { releaseArtifactHash: fingerprint(run.input.listing) } : {}), contractAddress: address(run.input?.contractAddress), codeHash: run.checks?.find(check => check.id === 'contract.code')?.evidence?.codeHash ?? network.contractCodeHash ?? network.codeHash ?? null, environment, environmentHash: fingerprint(environment), checkpoint: { number: network.finalizedBlockNumber ?? null, nativeHash: network.finalizedNativeBlockHash ?? null, evmHash: network.finalizedEvmBlockHash ?? null } };
}
export function sealRun(payload) {
  const { evidenceHash, binding, ...content } = payload;
  const sealed = { ...content, schemaVersion: content.schemaVersion ?? 2, binding: buildRunBinding(content) };
  return Object.freeze({ ...sealed, evidenceHash: fingerprint(sealed) });
}
export function verifyRun(run) {
  try {
    if (!run || typeof run !== 'object' || Array.isArray(run)) return false;
    const { evidenceHash, ...payload } = run;
    return /^[a-f0-9]{64}$/.test(evidenceHash) && fingerprint(payload) === evidenceHash;
  } catch { return false; }
}
export function validateImportedRun(run) {
  if (!verifyRun(run)) throw new Error('Report integrity check failed. Import the original exported JSON.');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(run.id) || !/^[A-Za-z0-9._-]{1,120}$/.test(run.projectId)) throw new Error('Report and project identifiers must be safe nonempty identifiers.');
  if (!run.input || typeof run.input !== 'object' || Array.isArray(run.input) || !Array.isArray(run.checks) || !run.checks.length || run.checks.length > 64 || !Array.isArray(run.limitations)) throw new Error('Report input, checks, and limitations are required.');
  if (!Number.isFinite(Date.parse(run.completedAt)) || (run.startedAt !== undefined && !Number.isFinite(Date.parse(run.startedAt)))) throw new Error('Report observation timestamps must be valid dates.');
  if (!['live', 'rehearsal'].includes(run.mode) || !scopeMatchesMode(run)) throw new Error('Report evidence mode and scope disagree.');
  if (run.checks.some(check => !check || typeof check.id !== 'string' || !['passed', 'failed', 'blocked', 'unknown'].includes(check.status)) || new Set(run.checks.map(check => check.id)).size !== run.checks.length || overall(run.checks) !== run.status) throw new Error('Report check statuses or aggregate result are inconsistent.');
  if (run.binding && canonical(run.binding) !== canonical(buildRunBinding(run))) throw new Error('Report plan/environment binding does not match its inputs and observations.');
  return run;
}
export function overall(checks) {
  if (!checks.length) return 'inconclusive';
  if (checks.some(c => c.status === 'failed')) return 'failed';
  if (checks.some(c => c.status === 'blocked')) return 'blocked';
  if (checks.some(c => c.status !== 'passed')) return 'inconclusive';
  return 'passed';
}
export function compareRuns(baseline, candidate) {
  const result = { baseline, candidate, compatible: false, changes: [], summary: { improved: 0, regressed: 0, unchanged: 0, changed: 0 } };
  if (!verifyRun(baseline) || !verifyRun(candidate)) return { ...result, reason: 'Evidence integrity check failed. Export the original saved report.' };
  const beforeBinding = buildRunBinding(baseline), afterBinding = buildRunBinding(candidate);
  const sameLogical = beforeBinding.logicalContractId && beforeBinding.logicalContractId === afterBinding.logicalContractId;
  if (baseline.projectId !== candidate.projectId && !sameLogical) return { ...result, reason: 'Choose runs from the same project or the same explicit logical contract.' };
  if (baseline.id === candidate.id) return { ...result, reason: 'Choose two different runs.' };
  if (baseline.mode === 'live' && candidate.mode === 'live' && baseline.scope !== candidate.scope) return { ...result, reason: 'Testnet and V3 Live observations come from different networks. Read them as a promotion assessment, not as a repair of the same target.' };
  if (baseline.scope !== candidate.scope || baseline.mode !== candidate.mode) return { ...result, reason: 'Local rehearsal and live testnet evidence cannot be compared as the same scope.' };
  result.inputChanges = ['name', 'release', 'profile', 'logicalContractId', 'sourceRevision', 'account', 'contractAddress', 'expectedValue', 'assertions', 'nativeAsset', 'listing', 'expectedChainId', 'transactionHash', 'transactionBlockHash'].filter(k => canonical(baseline.input[k]) !== canonical(candidate.input[k])).map(key => ({ key, before: baseline.input[key], after: candidate.input[key] }));
  if (beforeBinding.planHash !== afterBinding.planHash) return { ...result, comparisonKind: 'assertion-plan-changed', reason: 'The acceptance target or assertion plan changed. These results cannot establish a repair of the same target. Keep this candidate as a new baseline.' };
  const deploymentChanged = beforeBinding.contractAddress !== afterBinding.contractAddress;
  if (deploymentChanged && !sameLogical) return { ...result, comparisonKind: 'target-changed', reason: 'The contract address changed without a matching explicit logical contract. These results cannot establish a repair of the same target. Keep this candidate as a new baseline.' };
  const beforeEnvironment = beforeBinding.environment, afterEnvironment = afterBinding.environment;
  result.environmentChanges = Object.keys(beforeEnvironment).filter(key => key in afterEnvironment && beforeEnvironment[key] !== afterEnvironment[key]).map(key => ({ key, before: beforeEnvironment[key], after: afterEnvironment[key] }));
  const fixtureChanged = baseline.mode === 'rehearsal' && (baseline.scenario !== candidate.scenario || canonical(baseline.network) !== canonical(candidate.network));
  const networkCorrection = result.inputChanges.some(change => change.key === 'expectedChainId');
  result.comparisonKind = fixtureChanged ? 'fixture-scenario' : result.environmentChanges.length ? 'runtime-change' : deploymentChanged ? 'deployment-version' : networkCorrection ? 'configuration-correction' : 'same-target';
  const caveats = [];
  if (fixtureChanged) caveats.push('Synthetic fixture scenarios changed. Their differences do not establish a repair or live execution.');
  if (result.environmentChanges.length) caveats.push('The observed network/runtime environment changed. Differences require rechecking; they are not counted as a repair.');
  if (deploymentChanged) caveats.push('Different deployments of the same logical contract and assertion plan are compared. Changed observations do not prove an application code fix.');
  if (networkCorrection) caveats.push('The expected network configuration changed. Improvements show a configuration correction, not proof of an application code fix.');
  if (baseline.mode === 'rehearsal' && !fixtureChanged) caveats.push('These are synthetic rehearsal observations, not testnet execution evidence.');
  if (!caveats.length) caveats.push('A changed check result records an observation difference, not proof of the cause or an application code fix.');
  result.caveat = caveats.join(' ');
  const ids = new Set([...baseline.checks, ...candidate.checks].map(c => c.id));
  for (const id of ids) {
    const before = baseline.checks.find(c => c.id === id), after = candidate.checks.find(c => c.id === id);
    // Unknown, missing, and blocked evidence are never ranked as partial success.
    const changed = canonical(before) !== canonical(after);
    const contextChanged = fixtureChanged || result.environmentChanges.length > 0;
    const transition = contextChanged && changed ? 'context-changed' : after?.status === 'passed' && before?.status !== 'passed' ? 'improved' : before?.status === 'passed' && after?.status !== 'passed' ? 'regressed' : 'unchanged';
    result.changes.push({ id, title: after?.title || before?.title, before: before || null, after: after || null, transition });
    result.summary[transition === 'context-changed' ? 'changed' : transition]++;
  }
  result.compatible = true;
  return result;
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function explorerHtml(run) {
  const evidence = reportExplorerEvidence(run);
  if (!evidence.eligible) return `<section aria-label="Official explorer evidence"><h2>Official explorer and QR targets</h2><p>${escape(evidence.reason)}</p></section>`;
  const targetKinds = new Set(['contract', 'native-asset-precompile', 'evm-transaction', 'native-extrinsic']);
  const items = evidence.items.map((item) => {
    const link = item.url ? `<a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.url)}</a>` : '<strong>Explorer has no verified detail route — identifier only.</strong>';
    let qr = '';
    if (targetKinds.has(item.kind)) {
      const image = explorerQrSvgDataUrl(item.qrValue);
      const qrLabel = item.qrKind === 'identifier' ? (item.kind === 'evm-transaction' ? 'Hash only — plain text' : 'Address only — plain text') : 'Official explorer link';
      qr = `<figure><img src="${escape(image)}" width="220" height="220" alt="${escape(qrLabel)} QR for ${escape(item.identifier)}"><figcaption>${escape(qrLabel)}<br><code>${escape(item.qrValue)}</code><br><a href="${escape(image)}" download="revivecheck-${escape(item.kind)}.svg">Download QR SVG</a></figcaption></figure>`;
    }
    return `<article class="explorer-target"><h3>${escape(item.label)}</h3><code>${escape(item.identifier)}</code><p>${link}</p><p><small>${escape(item.scope)}</small></p>${qr}</article>`;
  }).join('');
  return `<section aria-label="Official explorer evidence"><h2>Official explorer and QR targets</h2><p><strong>${escape(evidence.chainLabel)}</strong><br>${escape(evidence.reason)}</p>${items}${evidence.pending.length ? `<h3>Unavailable or pending targets</h3><ul>${evidence.pending.map((item) => `<li><strong>${escape(item.label)}:</strong> ${escape(item.reason)}</li>`).join('')}</ul>` : ''}<p><small>A QR encodes exactly the displayed link or plain identifier. It does not sign a transaction, prove ownership, or prove current chain state. Native extrinsic and EVM transaction hashes are separate evidence types.</small></p></section>`;
}
export function reportHtml(run) {
  const label = run.mode === 'rehearsal' ? 'Local rehearsal — synthetic fixtures, no blockchain transaction' : run.scope === 'portaldot-live-readonly' ? 'Portaldot V3 Live — live read-only observations' : 'Portaldot V3 testnet — live read-only observations';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ReviveCheck · ${escape(run.projectName)}</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#17254a;background:#f6f8ff;max-width:1000px;margin:auto;padding:40px}h1{font-size:36px;line-height:1.2}table{border-collapse:collapse;width:100%;background:white}td,th{padding:14px;text-align:left;border-bottom:1px solid #dbe3fa;vertical-align:top}code,pre,a{overflow-wrap:anywhere}code,pre{white-space:pre-wrap}small{color:#50617e}.scope{border-left:4px solid #2445a7;padding:16px;background:#e9efff}details{margin:12px 0}.explorer-target{background:#fff;border:1px solid #dbe3fa;border-radius:8px;padding:20px;margin:16px 0}figure{margin:16px 0}figure img{display:block;max-width:100%;height:auto}figcaption{font-size:14px;max-width:620px}@media(max-width:600px){body{padding:20px}td,th{padding:8px}}</style><h1>ReviveCheck</h1><p>${escape(run.projectName)} / ${escape(run.release)}</p><p class="scope">${escape(label)}<br>Result: <strong>${escape(run.status)}</strong><br>Observed ${escape(run.completedAt)}. This report is a point-in-time observation, not a security audit or a guarantee of future execution.</p><table><thead><tr><th>Check</th><th>Result</th><th>Observation / next action</th></tr></thead><tbody>${run.checks.map(c => `<tr><td>${escape(c.title)}</td><td>${escape(c.status)}</td><td>${escape(c.observed)}<br><small>${escape(c.remediation)}</small>${c.evidence ? `<details><summary>Raw evidence</summary><pre>${escape(JSON.stringify(c.evidence, null, 2))}</pre></details>` : ''}</td></tr>`).join('')}</tbody></table>${explorerHtml(run)}<h2>Scope and limitations</h2><ul>${run.limitations.map(x => `<li>${escape(x)}</li>`).join('')}</ul><details><summary>Saved input</summary><pre>${escape(JSON.stringify(run.input, null, 2))}</pre></details><p>Run ${escape(run.id)}<br>Evidence SHA-256 <code>${escape(run.evidenceHash)}</code></p><p>The fingerprint corresponds to the companion JSON report. Download JSON and verify that file with the ReviveCheck CLI; this HTML rendering is not integrity-verified. It is not an on-chain attestation or proof that RPC responses are truthful.</p></html>`;
}
