/**
 * Persist shell chat threads in localStorage, keyed by owner + bot.
 */
import { sanitizeActivity } from './chat-activity.mjs';

export const TALK_KEY_PREFIX = 'maelstrom.talks.';
const MAX_BOTS = 40;
const MAX_LINES = 80;

export function talkStorageKey(ownerId) {
  if (typeof ownerId !== 'string') return '';
  const id = ownerId.trim();
  if (!id || id.length > 256) return '';
  return `${TALK_KEY_PREFIX}${id}`;
}

function cleanLine(line) {
  if (!line || typeof line !== 'object') return null;
  const id = typeof line.id === 'string' ? line.id.trim().slice(0, 128) : '';
  const role = line.role === 'user' || line.role === 'agent' || line.role === 'assistant' || line.role === 'note'
    ? line.role
    : '';
  const text = typeof line.text === 'string' ? line.text.slice(0, 8000) : '';
  if (!id || !role || !text.trim()) return null;
  const next = { id, role, text };
  if (line.compacted === true) next.compacted = true;
  const activity = sanitizeActivity(line.activity);
  if (activity.length > 0) next.activity = activity;
  const access = cleanAccess(line.access);
  if (access) next.access = access;
  return next;
}

function cleanAccess(value) {
  if (!value || value.kind !== 'inline' || typeof value.name !== 'string' || !value.name.trim()) return null;
  const label = typeof value.label === 'string' ? value.label.trim().slice(0, 200) : '';
  if (!label) return null;
  const args = {};
  if (value.args && typeof value.args === 'object' && !Array.isArray(value.args)) {
    for (const key of Object.keys(value.args).slice(0, 8)) {
      if (typeof value.args[key] === 'string') args[key] = value.args[key].slice(0, 200);
    }
  }
  return {
    kind: 'inline',
    name: value.name.trim().slice(0, 64),
    args,
    label,
    prompt: typeof value.prompt === 'string' && value.prompt.trim() ? value.prompt.trim().slice(0, 240) : label,
  };
}

export function normalizeTalks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next = {};
  for (const [botId, lines] of Object.entries(value)) {
    if (typeof botId !== 'string' || !botId || botId.length > 128) continue;
    if (!Array.isArray(lines)) continue;
    const cleaned = lines.map(cleanLine).filter(Boolean).slice(-MAX_LINES);
    if (cleaned.length > 0) next[botId] = cleaned;
    if (Object.keys(next).length >= MAX_BOTS) break;
  }
  return next;
}

export function readTalks(storage, ownerId) {
  const key = talkStorageKey(ownerId);
  if (!key || !storage || typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    return normalizeTalks(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeTalks(storage, ownerId, talks) {
  const key = talkStorageKey(ownerId);
  if (!key || !storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(key, JSON.stringify(normalizeTalks(talks)));
    return true;
  } catch {
    return false;
  }
}

export function clearTalks(storage, ownerId) {
  const key = talkStorageKey(ownerId);
  if (!key || !storage || typeof storage.removeItem !== 'function') return;
  try {
    storage.removeItem(key);
  } catch {
    /* private mode */
  }
}
