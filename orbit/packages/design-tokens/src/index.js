import tokenSource from '../tokens/design-tokens.json' with { type: 'json' };

// The JSON export and JavaScript entry point intentionally share one source.
// Copy before freezing so consumers cannot mutate Node's JSON-module cache.
export const orbitTokens = deepFreeze(structuredClone(tokenSource));
export const orbitVersion = orbitTokens.version;
export default orbitTokens;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
