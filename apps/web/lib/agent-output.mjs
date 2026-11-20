// Keep URLs, handles, code, and dotted identifiers intact while formatting prose.
const DISPLAY_NUMBER = /https?:\/\/[^\s)]+|@[a-z0-9][a-z0-9_.-]*|(`+)[\s\S]*?\1|(?<![\p{L}\p{N}_@.])(\d*\.\d{2})\d+(?![\p{L}\p{N}_]|\.[\p{L}\p{N}_])/giu;

export function formatAgentOutput(text) {
  return typeof text === 'string'
    ? text.replace(DISPLAY_NUMBER, (match, _code, decimal) => decimal ?? match)
    : text;
}

const LINK = /https?:\/\/[^\s)]+/g;

/** Split agent text so a Solscan URL can be an anchor in the same bubble. */
export function linkParts(text) {
  const source = typeof text === 'string' ? text : '';
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(LINK)) {
    if (match.index > last) parts.push({ type: 'text', value: source.slice(last, match.index) });
    parts.push({ type: 'link', value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < source.length || parts.length === 0) parts.push({ type: 'text', value: source.slice(last) });
  return parts;
}
