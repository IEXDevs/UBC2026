/**
 * Owner file catalog. Search uses names. Image previews stay in the browser
 * so a file can be opened again. File bytes are not sent to the model.
 */
import { enforceStorageCap, STORAGE_CAP_WARNING, USER_STORAGE_CAP } from './file-quota.mjs';
import { canonicalFileName, displayFileName } from './file-name.mjs';

const KEY_PREFIX = 'maelstrom.files.';
const MAX_BOTS = 40;
const MAX_FILES = 2000;
const PREVIEW_KEEP = 24;
const MAX_TYPE = 80;
const MAX_URL = 700_000;
const IMAGE_URL = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

export function catalogStorageKey(ownerId) {
  if (typeof ownerId !== 'string') return '';
  const id = ownerId.trim();
  if (!id || id.length > 256) return '';
  return `${KEY_PREFIX}${id}`;
}

function previewUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!url || url.length > MAX_URL) return '';
  if (url.startsWith('blob:')) return url;
  if (IMAGE_URL.test(url)) return url;
  return '';
}

export function cleanCatalogFile(file) {
  if (!file || typeof file !== 'object') return null;
  const name = displayFileName(file.name) || canonicalFileName(file.name);
  const id = typeof file.id === 'string' ? file.id.trim().slice(0, 160) : '';
  if (!name || !id) return null;
  const size = Number(file.size);
  const addedAt = Number(file.addedAt);
  const next = {
    id,
    name,
    type: typeof file.type === 'string' && file.type.trim() ? file.type.trim().slice(0, MAX_TYPE) : 'file',
    size: Number.isFinite(size) && size >= 0 ? Math.min(Math.round(size), 1_000_000_000_000) : 0,
    addedAt: Number.isFinite(addedAt) ? addedAt : 0,
  };
  const url = previewUrl(file.url);
  if (url) next.url = url;
  if (typeof file.ref === 'string' && /^[a-f0-9]{64}$/.test(file.ref)) next.ref = file.ref;
  return next;
}

function persistFile(file) {
  const clean = cleanCatalogFile(file);
  if (!clean) return null;
  if (typeof clean.url === 'string' && clean.url.startsWith('blob:')) delete clean.url;
  return clean;
}

export function normalizeCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next = {};
  for (const [botId, files] of Object.entries(value)) {
    if (typeof botId !== 'string' || !botId || botId.length > 128) continue;
    if (!Array.isArray(files)) continue;
    const rows = [];
    const seen = new Set();
    for (const file of files) {
      const clean = persistFile(file);
      if (!clean || seen.has(clean.id)) continue;
      seen.add(clean.id);
      rows.push(clean);
      if (rows.length >= MAX_FILES) break;
    }
    if (rows.length > 0) next[botId] = rows;
    if (Object.keys(next).length >= MAX_BOTS) break;
  }
  return keepNewestPreviews(enforceStorageCap(next).library);
}

function keepNewestPreviews(library) {
  const ranked = [];
  for (const files of Object.values(library || {})) {
    for (const file of files || []) ranked.push(file);
  }
  ranked.sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0));
  const keep = new Set(ranked.slice(0, PREVIEW_KEEP).map(file => file.id));
  const next = {};
  for (const [botId, files] of Object.entries(library || {})) {
    next[botId] = files.map(file => {
      if (keep.has(file.id) || typeof file.url !== 'string') return file;
      const copy = { ...file };
      delete copy.url;
      return copy;
    });
  }
  return next;
}

export function catalogAddition(library, botId, files) {
  if (typeof botId !== 'string' || !botId || botId.length > 128) {
    return { library: library || {}, warning: '', rejected: [] };
  }
  const incoming = [];
  const rejected = [];
  const seen = new Set();
  for (const file of Array.isArray(files) ? files : []) {
    const clean = cleanCatalogFile(file);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    if (clean.size > USER_STORAGE_CAP) rejected.push(clean);
    else incoming.push(clean);
  }
  if (incoming.length === 0 && rejected.length === 0) {
    return { library: library || {}, warning: '', rejected: [] };
  }
  const base = {};
  for (const [id, rows] of Object.entries(library || {})) {
    base[id] = (Array.isArray(rows) ? rows : []).filter(file => !seen.has(file?.id));
  }
  const merged = { ...base, [botId]: [...incoming, ...(base[botId] || [])] };
  const capped = enforceStorageCap(merged, USER_STORAGE_CAP, new Set(incoming.map(file => file.id)));
  return {
    library: keepNewestPreviews(capped.library),
    warning: capped.removed.length > 0 ? STORAGE_CAP_WARNING : '',
    rejected,
  };
}

export function addCatalogFiles(library, botId, files) {
  return catalogAddition(library, botId, files).library;
}

export function readCatalog(storage, ownerId) {
  const key = catalogStorageKey(ownerId);
  if (!key || !storage || typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    return normalizeCatalog(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeCatalog(storage, ownerId, library) {
  const key = catalogStorageKey(ownerId);
  if (!key || !storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(key, JSON.stringify(normalizeCatalog(library)));
    return true;
  } catch {
    return false;
  }
}

export function catalogForChat(library, bots = []) {
  const names = new Map();
  for (const bot of Array.isArray(bots) ? bots : []) {
    if (bot && typeof bot.id === 'string' && typeof bot.name === 'string') names.set(bot.id, bot.name.slice(0, 80));
  }
  const rows = [];
  for (const [botId, files] of Object.entries(library || {})) {
    for (const file of Array.isArray(files) ? files : []) {
      const name = displayFileName(file?.name) || canonicalFileName(file?.name);
      if (!name) continue;
      rows.push({
        name,
        type: typeof file.type === 'string' && file.type.trim() ? file.type.trim().slice(0, MAX_TYPE) : 'file',
        botName: names.get(botId) || '',
      });
      if (rows.length >= 40) return rows;
    }
  }
  return rows;
}

export function catalogPayload(entries) {
  if (!Array.isArray(entries)) return [];
  const rows = [];
  for (const entry of entries) {
    const name = displayFileName(entry?.name) || canonicalFileName(entry?.name);
    if (!name) continue;
    rows.push({
      name,
      type: typeof entry?.type === 'string' && entry.type.trim() ? entry.type.trim().slice(0, MAX_TYPE) : 'file',
      botName: displayFileName(entry?.botName) || canonicalFileName(entry?.botName),
    });
    if (rows.length >= 40) break;
  }
  return rows;
}

export function catalogRecallText(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  const lines = [];
  for (const entry of rows) {
    const name = displayFileName(entry?.name) || canonicalFileName(entry?.name);
    if (!name) continue;
    const type = typeof entry.type === 'string' && entry.type.trim() ? entry.type.trim().slice(0, MAX_TYPE) : 'file';
    const botName = displayFileName(entry?.botName) || canonicalFileName(entry?.botName);
    lines.push(botName ? `- ${name} (${type}, ${botName})` : `- ${name} (${type})`);
    if (lines.length >= 40) break;
  }
  if (lines.length === 0) return '';
  return [
    'Attached file catalog. These are names only. You have not read the file bytes.',
    ...lines,
    'When the owner asks about a file they attached, use this list. Do not invent a file that is not listed.',
  ].join('\n');
}
