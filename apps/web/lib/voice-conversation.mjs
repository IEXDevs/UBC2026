/**
 * Live conversation event bus for ElevenAgents Talk (Isaac / 8B).
 * Pushes UI/runtime events into a short transcript the voice agent can read back.
 * Full @elevenlabs/react mount still needs 8A agent id.
 */

export function createConversationLog({ max = 40 } = {}) {
  const entries = [];
  const listeners = new Set();

  function emit(entry) {
    entries.push(entry);
    while (entries.length > max) entries.shift();
    for (const listener of listeners) listener(entry, [...entries]);
    return entry;
  }

  return {
    entries: () => [...entries],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push({ kind, text, botId = null, at = Date.now() } = {}) {
      if (typeof text !== 'string' || !text.trim()) return null;
      return emit({
        id: `conv_${at}_${entries.length}`,
        kind: kind || 'event',
        text: text.trim().slice(0, 500),
        botId,
        at,
        role: 'system',
      });
    },
    pushUser(text) {
      return emit({
        id: `conv_${Date.now()}_${entries.length}`,
        kind: 'user',
        text: String(text || '').trim().slice(0, 500),
        botId: null,
        at: Date.now(),
        role: 'user',
      });
    },
    pushAssistant(text) {
      return emit({
        id: `conv_${Date.now()}_${entries.length}`,
        kind: 'assistant',
        text: String(text || '').trim().slice(0, 500),
        botId: null,
        at: Date.now(),
        role: 'assistant',
      });
    },
    /** Format recent events for an ElevenLabs client-tool read_back / system inject. */
    recentText(limit = 8) {
      return this.entries()
        .slice(-limit)
        .map((e) => `${e.role}: ${e.text}`)
        .join('\n');
    },
  };
}

export function eventToConversationText(event) {
  if (!event || typeof event !== 'object') return null;
  if (typeof event.summary === 'string' && event.summary) {
    return `${event.kind || 'event'}: ${event.summary}`;
  }
  if (typeof event.text === 'string' && event.text) return event.text;
  return null;
}
