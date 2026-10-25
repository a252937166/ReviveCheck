// "Check my token": a visitor's own native-asset release as an acceptance plan, without
// any React. The form carries the supported input only (the native-asset profile on the
// Portaldot V3 testnet, the one adapter the checker has verified); the effective plan is
// built and validated by the same `normalizePlan` the server and the checker use, so an
// unsupported input fails with its field named instead of being checked half-way. Both
// fingerprints a policy or a release relies on are derived here from the plan alone and
// survive export and import unchanged: the acceptance-plan fingerprint (`planHash`, what
// a policy pins) and the release-artifact hash (the listing content). A changed input
// gives a different plan and therefore a new report with its own hash; using that report
// in a bound release needs its own approval and an explicit binding.
import { acceptancePlan, fingerprint } from '../lib/report.js';
import { normalizePlan } from '../lib/plan.js';
import { nativeAssetAddress } from '../lib/chain.js';
import { NETWORKS } from '../lib/networks.js';
import { decodeAddress } from '@polkadot/util-crypto';

export const OWN_PLAN_SCHEMA = 'revivecheck.own-plan.v1';
const TESTNET = NETWORKS.testnet;
const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** What this form supports and what it does not. Shown beside the form; nothing here is checked silently. */
export const OWN_PLAN_LIMITS = Object.freeze({
  network: { key: 'testnet', name: TESTNET.name, chainId: TESTNET.chainId, note: 'The V3 Live network is reached only through the promotion step of the studio, from a passed testnet report.' },
  profile: { supported: 'native-asset', note: 'A token-list entry for a native asset, read from native Assets storage and the ERC-20 precompile. Contract-profile plans (view assertions, code hash, transaction finality) run in the local workbench and the CLI.' },
  runtime: { specName: 'portaldot-v3', specVersion: '3002', note: 'The precompile address scheme (u32 asset ID, twelve zero bytes, 00010000) is verified for this runtime only; on another runtime the listing check reports blocked, never passed.' },
  reads: { note: 'Reads go to the official public RPCs through both interfaces at one finalized block. The check trusts those operators and does not judge whether the release is a good idea.' },
  checks: Object.freeze(['network.chain-id', 'network.finalized', 'asset.native-erc20', 'token.listing']),
});

export const ownPlanDefaults = Object.freeze({ projectName: '', logicalContractId: '', release: 'v1.0.0', sourceRevision: '', assetId: '', holder: '', symbol: '', tokenName: '', decimals: '' });
const H160 = /^0x[0-9a-fA-F]{40}$/;

/** The stable identifier of the release line a policy pins through the plan fingerprint; derived from the project name unless given. */
export const derivedContractId = (projectName) => `token-list:portaldot-v3:${slug(projectName) || 'release'}`;

/** The precompile address the chain gives a native asset, derived from the asset ID; empty when the ID is not a u32. */
export function derivedAddress(assetId) {
  const text = String(assetId ?? '').trim();
  if (!/^\d+$/.test(text) || BigInt(text) > 0xffffffffn) return '';
  return nativeAssetAddress(BigInt(text).toString()).toLowerCase();
}

/** The effective plan for the form, validated. Throws with the field named. */
export function ownPlanFromForm(form) {
  const projectName = String(form.projectName ?? '').trim();
  if (!projectName || projectName.length > 120) throw new Error('A project name of 1 to 120 characters identifies the release.');
  const release = String(form.release ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(release)) throw new Error('The release label is 1 to 64 characters: letters, digits, dots, dashes or underscores.');
  const assetId = String(form.assetId ?? '').trim();
  const address = derivedAddress(assetId);
  if (!address) throw new Error('The asset ID is the native asset\'s u32 identifier (for example 7777 for pUSD).');
  const decimals = String(form.decimals ?? '').trim();
  if (!/^\d{1,3}$/.test(decimals) || Number(decimals) > 255) throw new Error('Decimals is an integer from 0 to 255: the precision the release claims, to be compared with what the chain reports.');
  const sourceRevision = String(form.sourceRevision ?? '').trim();
  if (sourceRevision.length > 200) throw new Error('The source revision is at most 200 characters.');
  const logicalContractId = String(form.logicalContractId ?? '').trim() || derivedContractId(projectName);
  if (logicalContractId.length > 200) throw new Error('The logical contract ID is at most 200 characters.');
  const holder = String(form.holder ?? '').trim();
  if (holder && !H160.test(holder)) { try { if (decodeAddress(holder).length !== 32) throw new Error('length'); } catch { throw new Error('The holder is a native SS58 or H160 address, or empty for the asset owner at the checkpoint.'); } }
  const plan = {
    name: projectName, profile: 'native-asset', logicalContractId, expectedChainId: TESTNET.chainId,
    nativeAsset: { assetId: BigInt(assetId).toString(), holder },
    release, sourceRevision,
    listing: { chainId: TESTNET.chainId, address, symbol: String(form.symbol ?? ''), name: String(form.tokenName ?? ''), decimals: Number(decimals) },
  };
  return normalizePlan(plan); // the same validation the server and the checker apply
}

/** The form fields for a plan, so an imported plan can be edited further. */
export function formFromOwnPlan(plan) {
  return { projectName: plan.name ?? '', logicalContractId: plan.logicalContractId ?? '', release: plan.release ?? '', sourceRevision: plan.sourceRevision ?? '', assetId: String(plan.nativeAsset?.assetId ?? ''), holder: plan.nativeAsset?.holder ?? '', symbol: plan.listing?.symbol ?? '', tokenName: plan.listing?.name ?? '', decimals: plan.listing?.decimals === undefined ? '' : String(plan.listing.decimals) };
}

/** The two fingerprints a plan carries: what a policy pins (`planHash`) and the release content (`releaseArtifactHash`). */
export function describeOwnPlan(plan) {
  const acceptance = acceptancePlan(plan);
  return { plan, acceptance, planHash: fingerprint(acceptance), releaseArtifactHash: plan.listing ? fingerprint(plan.listing) : null, checks: OWN_PLAN_LIMITS.checks };
}

/** The exported document: the plan and its fingerprints, so a reader can recompute them. */
export function exportOwnPlan(plan) {
  const described = describeOwnPlan(plan);
  return { schema: OWN_PLAN_SCHEMA, network: { key: 'testnet', chainId: TESTNET.chainId, genesisHash: TESTNET.genesisHash }, plan: described.plan, planHash: described.planHash, releaseArtifactHash: described.releaseArtifactHash, exportedAt: new Date().toISOString() };
}

/**
 * Import a plan from JSON: the export document, or a bare plan. Validated by
 * `normalizePlan`, then held to this form's supported input; a stated fingerprint that
 * does not match the plan is refused, so an edited export cannot pass as the original.
 */
export function importOwnPlan(text) {
  let parsed;
  try { parsed = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('The import is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The import is a plan object or an exported plan document.');
  const raw = parsed.schema === OWN_PLAN_SCHEMA || (parsed.plan && typeof parsed.plan === 'object' && !parsed.profile) ? parsed.plan : parsed;
  const plan = normalizePlan(raw);
  if (plan.profile !== 'native-asset') throw new Error(`profile ${plan.profile} is not supported here: this form checks native-asset releases only; contract-profile plans run in the local workbench and the CLI.`);
  if (Number(plan.expectedChainId) !== TESTNET.chainId) throw new Error(`expectedChainId ${plan.expectedChainId} is not the V3 testnet (${TESTNET.chainId}); this form reads the testnet only.`);
  if (!plan.listing) throw new Error('A token-list entry (listing) is required: it is the release content the check compares with the chain.');
  const expectedAddress = derivedAddress(plan.nativeAsset.assetId);
  if (plan.listing.address !== expectedAddress) throw new Error(`listing.address ${plan.listing.address} is not the precompile address of native asset ${plan.nativeAsset.assetId} (${expectedAddress}); only native-asset precompile entries are supported here.`);
  if (Number(plan.listing.chainId) !== TESTNET.chainId) throw new Error(`listing.chainId ${plan.listing.chainId} is not the V3 testnet (${TESTNET.chainId}).`);
  if (!String(plan.name ?? '').trim()) throw new Error('name is required: it identifies the release.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(plan.release ?? ''))) throw new Error('release is a label of 1 to 64 characters.');
  const described = describeOwnPlan(plan);
  if (parsed.schema === OWN_PLAN_SCHEMA) {
    if (parsed.planHash !== undefined && parsed.planHash !== described.planHash) throw new Error(`The stated planHash ${String(parsed.planHash).slice(0, 12)}… does not match the plan (${described.planHash.slice(0, 12)}…); the document was altered after export.`);
    if (parsed.releaseArtifactHash !== undefined && parsed.releaseArtifactHash !== described.releaseArtifactHash) throw new Error('The stated releaseArtifactHash does not match the listing; the document was altered after export.');
  }
  return { plan, form: formFromOwnPlan(plan), ...described };
}
