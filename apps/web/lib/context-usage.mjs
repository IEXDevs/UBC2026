/** Local transcript usage. The runtime does not report a model window yet. */
export const CONTEXT_LIMIT = 128000;
export const COMPACT_AT = 80;

export function contextTone(percent) {
  const value = Number(percent) || 0;
  if (value >= 90) return '#ef4444';
  if (value >= 75) return '#f59e0b';
  if (value >= 50) return '#eab308';
  return '#a3a3a3';
}

export function estimateTokens(text) {
  const chars = typeof text === 'string' ? text.length : 0;
  if (chars === 0) return 0;
  return Math.ceil(chars / 4);
}

export function formatTokens(value) {
  const count = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(count);
}

export function contextUsage(lines, limit = CONTEXT_LIMIT) {
  const rows = Array.isArray(lines) ? lines : [];
  const window = Number.isFinite(limit) && limit > 0 ? limit : CONTEXT_LIMIT;
  let input = 0;
  let output = 0;
  let messages = 0;
  let compacted = 0;
  for (const line of rows) {
    if (line?.compacted) compacted += 1;
    const tokens = estimateTokens(line?.text);
    if (line?.role === 'user') {
      input += tokens;
      messages += 1;
    } else {
      output += tokens;
    }
  }
  const used = input + output;
  const percent = window === 0 ? 0 : Math.min(100, Math.round((used / window) * 1000) / 10);
  return { input, output, used, limit: window, messages, percent, compacted };
}

/** Keep the recent tail and replace older lines once the window is 80% full. */
export function compactLines(lines, limit = CONTEXT_LIMIT) {
  const rows = Array.isArray(lines) ? lines : [];
  const usage = contextUsage(rows, limit);
  if (usage.percent < COMPACT_AT || rows.length < 3) return rows;
  const budget = Math.max(1, Math.floor(usage.limit * 0.45));
  const tail = [];
  let tailTokens = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const tokens = estimateTokens(rows[index]?.text);
    if (tail.length > 0 && tailTokens + tokens > budget) break;
    tail.unshift(rows[index]);
    tailTokens += tokens;
  }
  const dropped = rows.length - tail.length;
  if (dropped <= 0) return rows;
  return [
    {
      id: `compact-${rows.length}-${dropped}`,
      role: 'assistant',
      compacted: true,
      text: `Compacted ${dropped} earlier messages to stay inside the context window.`,
    },
    ...tail,
  ];
}
