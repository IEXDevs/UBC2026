/**
 * Handles the composer can offer after `@`.
 * Own handle, recent sends, then names already typed in this thread.
 */
import { recentCounterparties } from './money-views.mjs';

const HANDLE = /^[\w-]{1,32}$/;

function addHandle(rows, seen, raw, description) {
  const name = String(raw || '').trim().replace(/^@/, '');
  if (!HANDLE.test(name)) return;
  const key = name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ key, name, description: description || '' });
}

export function mentionSuggestions({ handle, displayName, transfers, payments, lines } = {}) {
  const rows = [];
  const seen = new Set();
  if (handle) addHandle(rows, seen, handle, displayName ? String(displayName) : 'You');
  for (const row of recentCounterparties(transfers, payments)) {
    if (typeof row?.caption === 'string' && row.caption.startsWith('@')) {
      addHandle(rows, seen, row.caption, 'Recent');
    }
  }
  const text = (Array.isArray(lines) ? lines : []).map(line => (typeof line?.text === 'string' ? line.text : '')).join('\n');
  for (const match of text.matchAll(/(^|\s)@([\w-]{1,32})/g)) {
    addHandle(rows, seen, match[2], 'In this chat');
  }
  return rows.slice(0, 8);
}

export function filterMentionSuggestions(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const q = String(query || '').toLowerCase();
  if (!q) return list;
  const start = [];
  const rest = [];
  for (const row of list) {
    const name = String(row?.name || '').toLowerCase();
    if (name.startsWith(q)) start.push(row);
    else if (name.includes(q)) rest.push(row);
  }
  return [...start, ...rest];
}
