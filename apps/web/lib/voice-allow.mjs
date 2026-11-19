/**
 * Spoken "allow" for a wallet or access prompt that is already waiting.
 * A longer sentence still goes to the text agent.
 */

const FILLER = '(?:yes|yeah|yep|ok|okay|please|i)';
const TARGET = '(?:it|that|this|them)';

export function voiceGrantsAllow(text) {
  const spoken = String(text || '')
    .toLowerCase()
    .replace(/[.!?,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spoken || spoken.length > 40) return false;
  if (/\b(?:don'?t|do not|not|never|no|deny|cancel)\b/.test(spoken)) return false;
  return new RegExp(`^(?:${FILLER}\\s+)*allow(?:\\s+${TARGET})?$`).test(spoken);
}

/** The inline Allow button on the latest unanswered agent line, if one is waiting. */
export function latestInlineAllow(lines) {
  if (!Array.isArray(lines)) return null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || typeof line !== 'object') continue;
    if (line.role === 'user') return null;
    if (line.access?.kind === 'inline') return line;
    if (line.role === 'note') continue;
    if (line.role === 'agent' || line.role === 'assistant') return null;
  }
  return null;
}
