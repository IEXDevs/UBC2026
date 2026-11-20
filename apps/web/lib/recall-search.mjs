/**
 * Left-pane recall search. Matches chat names, message text, and file names.
 * File bytes and preview URLs are not searched.
 */

function fold(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function snippet(text, query) {
  const hay = String(text || '').replace(/\s+/g, ' ').trim();
  const at = hay.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return hay.slice(0, 72);
  const start = Math.max(0, at - 18);
  const slice = hay.slice(start, start + 72);
  const lead = start > 0 ? '…' : '';
  const tail = start + 72 < hay.length ? '…' : '';
  return `${lead}${slice}${tail}`;
}

export function searchRecall({ query = '', bots = [], talks = {}, files = {}, limit = 12 } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const cap = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 24) : 12;
  const hits = [];
  const take = (hit) => {
    if (hits.length < cap) hits.push(hit);
  };
  const roster = Array.isArray(bots) ? bots : [];

  for (const bot of roster) {
    if (!bot || typeof bot.id !== 'string') continue;
    const name = typeof bot.name === 'string' ? bot.name : '';
    const goal = typeof bot.goal === 'string' ? bot.goal : '';
    const nameHit = fold(name).includes(needle);
    const goalHit = fold(goal).includes(needle);
    if (!nameHit && !goalHit) continue;
    take({
      id: `chat:${bot.id}`,
      kind: 'chat',
      label: nameHit || !goal ? name || bot.id : `${name || bot.id}: ${snippet(goal, needle)}`,
      tag: 'Chat',
      botId: bot.id,
    });
  }

  for (const bot of roster) {
    const lines = Array.isArray(talks?.[bot.id]) ? talks[bot.id] : [];
    for (const line of lines) {
      const text = typeof line?.text === 'string' ? line.text : '';
      if (!text || !fold(text).includes(needle)) continue;
      const id = typeof line.id === 'string' ? line.id : '';
      if (!id) continue;
      take({
        id: `message:${bot.id}:${id}`,
        kind: 'message',
        label: snippet(text, needle),
        tag: typeof bot.name === 'string' && bot.name ? bot.name : 'Message',
        botId: bot.id,
        lineId: id,
      });
    }
  }

  for (const bot of roster) {
    const rows = Array.isArray(files?.[bot.id]) ? files[bot.id] : [];
    for (const file of rows) {
      const name = typeof file?.name === 'string' ? file.name : '';
      if (!name || !fold(name).includes(needle)) continue;
      const id = typeof file.id === 'string' ? file.id : name;
      take({
        id: `file:${bot.id}:${id}`,
        kind: 'file',
        label: name,
        tag: 'File',
        botId: bot.id,
        file,
      });
    }
  }

  return hits;
}
