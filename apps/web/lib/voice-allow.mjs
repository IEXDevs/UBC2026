/**
 * Spoken yes or no for a wallet or access prompt that is already waiting.
 * A sentence that contains an affirmation allows. A sentence that contains a
 * refusal denies. Refusal wins when both are present. Other speech still goes
 * to the text agent.
 */

const AFFIRMATION = /\b(?:go ahead|go for it|do it|send it|sounds good|that(?:'s| is) fine|it(?:'s| is) fine|fine by me|i agree|all right|of course|please do|that works|works for me|absolutely|definitely|certainly|affirmative|approved|approve|allowed|allow|confirmed|confirm|agreed|alright|yeah|yep|yup|yes|sure|okay|ok|granted|correct|fine)\b/;

const DENIAL = /\b(?:do not|don't|dont|cannot|can't|cant|never mind|nevermind|not now|no thanks|no thank you|hold off|rejected|reject|refused|refuse|denied|deny|cancel|stop|never|nope|nah|nothing|not|no)\b/;

const SOFT_NO = /\bno (?:problem|worries|worry|issue|issues|doubt|question)\b/g;

export function voiceConfirmDecision(text) {
  const spoken = String(text || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.!?,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spoken || spoken.length > 400) return null;
  SOFT_NO.lastIndex = 0;
  const cleared = spoken.replace(SOFT_NO, ' ').replace(/\s+/g, ' ').trim();
  if (!cleared) return null;
  if (DENIAL.test(cleared)) return 'deny';
  if (AFFIRMATION.test(cleared)) return 'allow';
  return null;
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
