/** Strip comments and trailing commas so wrangler.jsonc can be asserted in tests. */
export function parseJsonc(text) {
  if (typeof text !== 'string') throw new TypeError('JSONC text is required');
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(stripped);
}
