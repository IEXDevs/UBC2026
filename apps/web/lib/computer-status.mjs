/**
 * Awake / Asleep / Paused from open browser sessions, not the bot loop status.
 * Opening a session (chat/voice tools or Live View) means Awake.
 */

export function countOpenBrowserSessions(payload) {
  const sessions = Array.isArray(payload?.sessions)
    ? payload.sessions
    : (Array.isArray(payload) ? payload : []);
  let count = 0;
  for (const row of sessions) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.sessionRecordId !== 'string' || !row.sessionRecordId) continue;
    if (row.status === 'closed') continue;
    count += 1;
  }
  return count;
}

/**
 * @param {{ openSessionCount?: number, botStatus?: string }} input
 * @returns {'Awake' | 'Paused' | 'Asleep'}
 */
export function computerStatus({ openSessionCount = 0, botStatus } = {}) {
  if (Number(openSessionCount) > 0) return 'Awake';
  if (botStatus === 'paused') return 'Paused';
  return 'Asleep';
}
