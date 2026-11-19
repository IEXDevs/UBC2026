/**
 * One live voice call at a time.
 * A fresh claim from another agent is refused until the holder refreshes
 * or releases. A crashed tab expires after the heartbeat window.
 */

export const VOICE_LOCK_KEY = 'maelstrom.voiceCall';
export const VOICE_LOCK_TTL_MS = 15000;

function read(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(VOICE_LOCK_KEY) || 'null');
    if (!parsed || typeof parsed.botId !== 'string' || typeof parsed.at !== 'number') return null;
    return {
      botId: parsed.botId,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.botId,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

export function claimVoiceLock(storage, { botId, name = '', now = Date.now() } = {}) {
  if (!storage || typeof botId !== 'string' || !botId) return { ok: false, error: 'invalid_bot' };
  const current = read(storage);
  if (current && current.botId !== botId && now - current.at < VOICE_LOCK_TTL_MS) {
    return { ok: false, error: 'voice_busy', holder: current };
  }
  const holder = { botId, name: name || botId, at: now };
  storage.setItem(VOICE_LOCK_KEY, JSON.stringify(holder));
  return { ok: true, holder };
}

export function refreshVoiceLock(storage, botId, now = Date.now()) {
  const current = read(storage);
  if (!current || current.botId !== botId) return { ok: false };
  storage.setItem(VOICE_LOCK_KEY, JSON.stringify({ ...current, at: now }));
  return { ok: true };
}

export function releaseVoiceLock(storage, botId) {
  const current = read(storage);
  if (!current || current.botId !== botId) return { ok: false };
  storage.removeItem(VOICE_LOCK_KEY);
  return { ok: true };
}

export function voiceLockHolder(storage, now = Date.now()) {
  const current = read(storage);
  if (!current || now - current.at >= VOICE_LOCK_TTL_MS) return null;
  return current;
}
