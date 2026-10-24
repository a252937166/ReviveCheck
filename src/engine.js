// Loaded on demand: the same service the MCP server and the CLI use, running in
// this browser against the official RPCs. One connection per network is reused.
export { warm, networkStatus, checkRelease, checkDemoRelease, replay, assessPromotion, compare, verifyAttestation, readRegistry, readTokenList, retrieveEvidence, prepareTransaction, accountOverview, TOKEN_LIST } from '../lib/service.js';
export { attestationRemark } from '../lib/attestation.js';
export { releaseIdOf } from '../lib/registry.js';
