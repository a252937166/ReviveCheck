// The shape the separate consumer example (`revivecheck-consumer-example`, src/evaluate.js
// `loadConfig`) requires of a `revivecheck-consumer.config.v1` document, repeated here so
// the App's export is held to the consumer's contract without importing that repository.
import { normalizePolicy } from '../../lib/policy.js';

export function loadConfigShape(config, name = 'config') {
  if (config?.schema !== 'revivecheck-consumer.config.v1') throw new Error(`${name} declares schema revivecheck-consumer.config.v1.`);
  normalizePolicy(config.policy);
  for (const key of ['label', 'owner', 'releaseId', 'revision', 'reportHash', 'storage']) if (config.release?.[key] === undefined) throw new Error(`${name}: release.${key} is required.`);
  if (!config.entry || !config.boundBy) throw new Error(`${name}: entry and boundBy are required.`);
  return config;
}
