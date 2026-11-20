/** Rows kept in view above the composer before the queue scrolls. */
export const QUEUE_VISIBLE_ROWS = 4;

export function appendQueued(queue, item) {
  const rows = Array.isArray(queue) ? queue : [];
  if (!item || typeof item.id !== 'string' || !item.id) return rows;
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  if (!text) return rows;
  const mention = typeof item.mention === 'string' ? item.mention : '';
  const row = { id: item.id, text, mention };
  if (typeof item.mentionAddress === 'string' && item.mentionAddress) row.mentionAddress = item.mentionAddress;
  return [...rows, row];
}

export function takeQueued(queue, id) {
  const rows = Array.isArray(queue) ? queue : [];
  const item = rows.find(entry => entry && entry.id === id) || null;
  if (!item) return { item: null, queue: rows };
  return { item, queue: rows.filter(entry => entry.id !== id) };
}

/**
 * A finished turn releases the oldest queued message.
 * A stop leaves the queue where it is.
 */
export function releaseQueued(queue, { stopped = false } = {}) {
  const rows = Array.isArray(queue) ? queue : [];
  if (stopped || rows.length === 0) return { next: null, queue: rows };
  return { next: rows[0], queue: rows.slice(1) };
}
