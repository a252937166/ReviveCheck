#!/usr/bin/env node
// The second-reviewer test: given ONLY an arm's output artifact, can someone who did not run
// the check reconstruct the decision, the exact report hash it rests on, the reviewer it
// relied on, the checkpoint(s) it read, the reasons, and what to do next? Each item is scored
// present or absent from the artifact alone; nothing is fetched and no other file is read.
// The decision is also re-derived from the recorded checks and compared with the stated one.
//
//   node examples/token-catalog/benchmark/reconstruct-decision.mjs <artifact.json> [--json]
import { readFile } from 'node:fs/promises';
import { fingerprint } from '../../../lib/report.js';

const HASH64 = /^[a-f0-9]{64}$/i, H160 = /^0x[0-9a-fA-F]{40}$/;
export const REQUIRED_ITEMS = Object.freeze(['decision', 'exact report hash', 'reviewer relied on', 'checkpoint(s)', 'reason codes', 'next action']);
export const EXTRA_ITEMS = Object.freeze(['artifact integrity hash', 'trust basis', 'policy identity', 'role control']);

export function detectArm(artifact) {
  if (artifact?.schema === 'maintainer-ci-script.result.v1') return 'baseline';
  if (artifact?.catalog?.schema === 'revivecheck.token-catalog.v2' && artifact?.evaluation?.schema === 'revivecheck.policy-evaluation.v1') return 'revivecheck';
  return 'unknown';
}

/** Score one artifact. Returns the items with the values a reader can extract, and the re-derived decision. */
export function reconstruct(artifact) {
  const arm = detectArm(artifact);
  const items = [];
  const add = (item, present, value, note = null) => items.push({ item, required: REQUIRED_ITEMS.includes(item), present: !!present, value: present ? value : null, note });
  let stated = null, rederived = null;
  if (arm === 'revivecheck') {
    const token = artifact.catalog.tokens?.[0] ?? {};
    const evaluation = artifact.evaluation;
    stated = token.available === true ? 'enable' : 'refuse';
    add('decision', typeof token.available === 'boolean' && typeof evaluation.status === 'string', `${stated} (policy status ${evaluation.status}; entry ${token.entry?.match ? 'equals the approved report' : 'withheld'})`);
    add('exact report hash', HASH64.test(evaluation.reportHash || ''), evaluation.reportHash, token.binding?.reportHash === evaluation.reportHash ? 'the binding and the evaluation name the same report' : 'the binding and the evaluation name different reports');
    const trusted = artifact.catalog.policy?.reviewers?.trusted;
    add('reviewer relied on', Array.isArray(trusted) && trusted.length > 0 && trusted.every((address) => H160.test(address)), `${trusted?.join(', ')} (threshold ${artifact.catalog.policy?.reviewers?.threshold})`, 'the policy names the trusted set; consumer.entry records which reviewer the listing carries');
    const checkpoint = evaluation.checkpoint || {};
    const blocks = ['registry', 'observation', 'listing'].filter((key) => checkpoint[key]?.number).map((key) => `${key} #${checkpoint[key].number} ${checkpoint[key].nativeHash}`);
    add('checkpoint(s)', blocks.length > 0, blocks.join('; '), `evaluated at ${evaluation.evaluatedAt}`);
    add('reason codes', Array.isArray(evaluation.reasons) && Array.isArray(token.reasons), token.reasons?.length ? token.reasons.join(', ') : 'none: every policy condition holds and the entry equals the approved report', 'policy codes carry a documented meaning and the status they force (lib/policy.js REASONS, repeated in evaluation.reasons[].text); entry-mismatch:<field> and entry-unverified are the catalog\'s documented entry reasons, with the differing field named in entry.mismatches');
    add('next action', typeof token.nextAction === 'string' && token.nextAction.length > 0, token.nextAction);
    const { evaluationHash, ...payload } = evaluation;
    add('artifact integrity hash', HASH64.test(evaluationHash || '') && fingerprint(payload) === evaluationHash, evaluationHash, 'recomputed SHA-256 of the evaluation equals evaluationHash');
    add('trust basis', typeof evaluation.reviewerTrust === 'string' && evaluation.reviewerTrust.length > 0, evaluation.reviewerTrust);
    add('policy identity', HASH64.test(evaluation.policyHash || ''), `${evaluation.policyHash} (${evaluation.policyName})`);
    add('role control', !!artifact.catalog.roles && Object.values(artifact.catalog.roles).every((role) => role?.control), Object.entries(artifact.catalog.roles || {}).map(([role, value]) => `${role}: ${value.control}`).join(' | '));
    const allPassed = Array.isArray(evaluation.checks) && evaluation.checks.length > 0 && evaluation.checks.every((check) => check.status === 'passed');
    rederived = allPassed && token.entry?.match === true ? 'enable' : 'refuse';
  } else if (arm === 'baseline') {
    stated = artifact.decision === 'enable' ? 'enable' : artifact.decision === 'refuse' ? 'refuse' : null;
    add('decision', stated !== null, `${stated} (exit code ${artifact.exitCode})`);
    const recorded = artifact.config?.approvalRecord?.reportHash;
    const registryRead = artifact.checks?.find((check) => check.id === 'C2')?.release?.reportHash;
    add('exact report hash', HASH64.test(recorded || ''), recorded, registryRead ? `the registry read in C2 returned ${registryRead}` : 'no registry read recorded');
    add('reviewer relied on', H160.test(artifact.config?.trustedReviewer || ''), artifact.config?.trustedReviewer, 'a hard-coded address; the artifact does not say why this reviewer counts');
    const checkpoint = artifact.checkpoint;
    const c1 = artifact.checks?.find((check) => check.id === 'C1');
    add('checkpoint(s)', !!checkpoint?.number, checkpoint?.number ? `#${checkpoint.number} ${checkpoint.nativeHash} (EVM ${checkpoint.evmHash})` : null, c1?.readAt ? `entry values read at ${c1.readAt}` : null);
    add('reason codes', Array.isArray(artifact.problems), artifact.problems?.length ? artifact.problems.join(', ') : 'none: every check passed', 'labels chosen by the script author; the artifact carries no documented meaning or forced status for them');
    add('next action', false, null, 'the script records no next action');
    add('artifact integrity hash', false, null, 'the result carries no hash of itself');
    add('trust basis', false, null, 'the artifact does not record why the reviewer is trusted or who controls the accounts');
    add('policy identity', false, null, 'the configuration is echoed, but nothing identifies it as a versioned policy');
    add('role control', false, null);
    rederived = Array.isArray(artifact.checks) && artifact.checks.length === 5 && artifact.checks.every((check) => check.ok === true) ? 'enable' : 'refuse';
  } else {
    for (const item of [...REQUIRED_ITEMS, ...EXTRA_ITEMS]) add(item, false, null, 'unrecognized artifact');
  }
  const required = items.filter((item) => item.required);
  const extras = items.filter((item) => !item.required);
  return {
    arm, items, statedDecision: stated, rederivedDecision: rederived, consistent: stated !== null && stated === rederived,
    requiredPresent: required.filter((item) => item.present).length, requiredTotal: required.length,
    extrasPresent: extras.filter((item) => item.present).length, extrasTotal: extras.length,
  };
}

export function formatReconstruction(result, source) {
  const lines = [`Reconstruction from the artifact alone: ${source}`, `arm: ${result.arm}`, ''];
  const width = Math.max(...result.items.map((item) => item.item.length)) + 2;
  for (const item of result.items) {
    lines.push(`${item.required ? '' : '(extra) '}${item.item.padEnd(width)}${item.present ? 'present' : 'absent '}  ${item.present ? item.value : '-'}${item.note ? `\n${' '.repeat(width + 9)}note: ${item.note}` : ''}`);
  }
  lines.push('', `required items present: ${result.requiredPresent}/${result.requiredTotal}; extras: ${result.extrasPresent}/${result.extrasTotal}`);
  lines.push(`decision stated: ${result.statedDecision ?? 'none'}; re-derived from the recorded checks: ${result.rederivedDecision ?? 'none'}; ${result.consistent ? 'consistent' : 'NOT consistent'}`);
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const [file] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!file) { console.error('Usage: node examples/token-catalog/benchmark/reconstruct-decision.mjs <artifact.json> [--json]'); process.exit(2); }
  const artifact = JSON.parse(await readFile(file, 'utf8'));
  const result = reconstruct(artifact);
  console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : formatReconstruction(result, file));
}
