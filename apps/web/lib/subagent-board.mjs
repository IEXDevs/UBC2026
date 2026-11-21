/**
 * Recent subagent replies for one owner and agent.
 * The voice handoff and the parent agent read the same board.
 */

const board = new Map();
const LIMIT = 8;

function keyFor(ownerId, botId) {
  return `${ownerId}\n${botId}`;
}

export function recordSubagentResult(entry, store = board) {
  const ownerId = typeof entry?.ownerId === 'string' ? entry.ownerId : '';
  const botId = typeof entry?.botId === 'string' ? entry.botId : '';
  const reply = typeof entry?.reply === 'string' ? entry.reply.trim().slice(0, 1200) : '';
  if (!ownerId || !botId || !reply) return null;
  const activity = Array.isArray(entry?.activity)
    ? entry.activity.filter(item => item && typeof item === 'object').slice(0, 12)
    : [];
  const row = {
    id: typeof entry.id === 'string' && entry.id ? entry.id.slice(0, 40) : `sub_${Date.now().toString(36)}`,
    task: typeof entry.task === 'string' ? entry.task.trim().slice(0, 300) : '',
    skill: typeof entry.skill === 'string' ? entry.skill.slice(0, 32) : '',
    reply,
    activity,
    model: typeof entry?.model === 'string' ? entry.model.slice(0, 128) : '',
    status: entry?.status === 'error' ? 'error' : 'done',
    at: Number.isSafeInteger(entry?.at) ? entry.at : Date.now(),
  };
  const key = keyFor(ownerId, botId);
  const prior = store.get(key) || [];
  store.set(key, [...prior, row].slice(-LIMIT));
  return row;
}

export function readSubagentResults(ownerId, botId, store = board) {
  if (typeof ownerId !== 'string' || typeof botId !== 'string') return [];
  const rows = store.get(keyFor(ownerId, botId)) || [];
  return rows.map(row => ({ ...row }));
}

export function clearSubagentResults(store = board) {
  store.clear();
}
