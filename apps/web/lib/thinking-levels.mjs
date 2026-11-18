/**
 * Thinking stops come from the model catalog. Each model advertises its own
 * reasoning efforts. A missing field falls back to the published list for that id.
 */
import { contextWindowFor, rememberContextWindow, reportedContextWindow } from './context-usage.mjs';

const ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const LABELS = {
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
};

/** Published lists. Contributor Spark has no Max. Standard Spark and Wonder do. */
const KNOWN = {
  'muse-spark-1.3-contributor': { efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], default: 'high' },
  'muse-spark-1.2-contributor': { efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], default: 'high' },
  'muse-spark-1.3': { efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'high' },
  'muse-spark-1.2': { efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], default: 'high' },
  'muse-wonder-1.0': { efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'max' },
};

function cleanId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ORDER.includes(id) ? id : '';
}

function level(id, isDefault) {
  return { id, label: LABELS[id], default: isDefault === true };
}

function ordered(ids, fallbackDefault) {
  const unique = [];
  for (const id of ids) {
    const clean = cleanId(id);
    if (clean && !unique.includes(clean)) unique.push(clean);
  }
  unique.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (unique.length === 0) return [];
  const preferred = cleanId(fallbackDefault);
  const chosen = unique.includes(preferred) ? preferred : unique[Math.min(unique.length - 1, unique.indexOf('high') >= 0 ? unique.indexOf('high') : unique.length - 1)];
  return unique.map(id => level(id, id === chosen));
}

function advertised(model) {
  const lists = [
    model?.reasoning?.effort,
    model?.reasoning?.efforts,
    model?.capabilities?.reasoning?.effort,
    model?.supported_reasoning_efforts,
  ];
  for (const list of lists) {
    if (Array.isArray(list) && list.length > 0) return list;
  }
  return null;
}

function advertisedDefault(model) {
  const value = model?.reasoning?.default
    ?? model?.reasoning_effort_default
    ?? model?.capabilities?.reasoning?.default;
  return typeof value === 'string' ? value : '';
}

export function thinkingLevelsForModel(model) {
  const id = typeof model === 'string' ? model.trim() : (typeof model?.id === 'string' ? model.id.trim() : '');
  const known = KNOWN[id];
  const fromApi = model && typeof model === 'object' ? advertised(model) : null;
  const efforts = ordered(fromApi || known?.efforts || [], advertisedDefault(model) || known?.default || '');
  return efforts;
}

export function reasoningEffortFor(modelId, requested) {
  const levels = thinkingLevelsForModel(modelId);
  if (levels.length === 0) return '';
  const raw = typeof requested === 'string' ? requested.trim().toLowerCase() : '';
  const byId = levels.find(item => item.id === raw);
  if (byId) return byId.id;
  const byLabel = levels.find(item => item.label.toLowerCase() === raw);
  if (byLabel) return byLabel.id;
  return levels.find(item => item.default)?.id || levels[0].id;
}

function displayName(id, model) {
  if (typeof model?.name === 'string' && model.name.trim()) return model.name.trim().slice(0, 80);
  return id;
}

export function fallbackThinkingCatalog() {
  const id = 'muse-spark-1.3-contributor';
  const contextWindow = contextWindowFor(id);
  rememberContextWindow(id, contextWindow);
  return [{ id, name: 'Muse Spark', levels: thinkingLevelsForModel(id), contextWindow }];
}

export async function loadThinkingCatalog({ apiKey = '', baseUrl = '', fetcher = fetch } = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const root = typeof baseUrl === 'string' ? baseUrl.replace(/\/$/, '') : '';
  if (!key || !root) return [];
  let response;
  try {
    response = await fetcher(`${root}/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return [];
  }
  if (!response?.ok) return [];
  const payload = await response.json().catch(() => null);
  return parseThinkingCatalog(payload);
}

export function parseThinkingCatalog(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  const models = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!/^[A-Za-z0-9_.:/-]{1,80}$/.test(id)) continue;
    const levels = thinkingLevelsForModel(row);
    if (levels.length === 0) continue;
    const contextWindow = contextWindowFor(id, reportedContextWindow(row));
    rememberContextWindow(id, contextWindow);
    models.push({
      id,
      name: displayName(id, row),
      levels,
      contextWindow,
    });
  }
  return models;
}
