// Keep URLs, handles, code, and dotted identifiers intact while formatting prose.
const DISPLAY_NUMBER = /https?:\/\/[^\s)]+|@[a-z0-9][a-z0-9_.-]*|(`+)[\s\S]*?\1|(?<![\p{L}\p{N}_@.])(\d*\.\d{2})\d+(?![\p{L}\p{N}_]|\.[\p{L}\p{N}_])/giu;

export function formatAgentOutput(text) {
  return typeof text === 'string'
    ? text.replace(DISPLAY_NUMBER, (match, _code, decimal) => decimal ?? match)
    : text;
}
