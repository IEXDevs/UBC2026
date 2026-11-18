/** Fallback when a model id is unknown and the endpoint did not report a window. */
export const CONTEXT_LIMIT = 128000;
export const COMPACT_AT = 80;
export const MESSAGE_CHAR_CAP = 500;
export const COMPLETION_RESERVE = 8192;
const MAX_WINDOW = 2_000_000;

/** Published windows. A positive number from the models endpoint replaces these. */
const WINDOWS = {
  'muse-spark-1.3': 1_048_576,
  'muse-spark-1.3-contributor': 1_048_576,
  'muse-spark-1.2': 1_048_576,
  'muse-spark-1.2-contributor': 1_048_576,
  'muse-spark-1.1': 1_048_576,
  'meta-llama/llama-3.3-70b-instruct': 131_072,
};

const rememberedWindows = new Map();

export function rememberedContextWindow(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  const value = rememberedWindows.get(id);
  return Number.isSafeInteger(value) ? value : 0;
}

export function rememberContextWindow(modelId, window) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  const size = Number(window);
  if (!id || !Number.isSafeInteger(size) || size < 1024 || size > MAX_WINDOW) return;
  rememberedWindows.set(id, size);
}

export function reportedContextWindow(model) {
  if (!model || typeof model !== 'object') return 0;
  const candidates = [
    model.context_window,
    model.contextWindow,
    model.context_length,
    model.max_context_length,
    model.context_length_tokens,
    model.top_provider?.context_length,
  ];
  for (const value of candidates) {
    const size = Number(value);
    if (Number.isSafeInteger(size) && size >= 1024 && size <= MAX_WINDOW) return size;
  }
  return 0;
}

export function contextWindowFor(model, reported = 0) {
  const fromCall = Number(reported);
  if (Number.isSafeInteger(fromCall) && fromCall >= 1024 && fromCall <= MAX_WINDOW) return fromCall;
  const id = typeof model === 'string' ? model.trim() : '';
  const remembered = rememberedWindows.get(id);
  if (Number.isSafeInteger(remembered)) return remembered;
  if (WINDOWS[id]) return WINDOWS[id];
  const bare = id.replace(/:free$/, '');
  if (WINDOWS[bare]) return WINDOWS[bare];
  if (id.startsWith('muse-spark-')) return 1_048_576;
  return CONTEXT_LIMIT;
}

/** Leave room for the reply. A small window reserves a quarter instead of 8192. */
export function inputBudget(window) {
  const size = Number.isFinite(window) && window > 0 ? Math.floor(window) : CONTEXT_LIMIT;
  const reserve = Math.min(COMPLETION_RESERVE, Math.floor(size / 4));
  return Math.max(256, size - reserve);
}

export function clipOwnerMessage(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  return value.length > MESSAGE_CHAR_CAP ? value.slice(0, MESSAGE_CHAR_CAP) : value;
}

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
    if (line?.role === 'note') continue;
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
