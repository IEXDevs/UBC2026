/**
 * Same-origin proxy allowlist for the glass shell.
 * The browser calls /api/runtime/*; the Next route forwards only these paths
 * to the configured Worker origin. No secrets, no arbitrary hosts.
 */

const BOT = '[a-zA-Z0-9:_-]{1,128}';
const REC = '[a-zA-Z0-9:_-]{1,128}';

const ALLOWED = Object.freeze([
  /^\/api\/me$/,
  /^\/api\/wallets$/,
  /^\/api\/wallets\/persist$/,
  /^\/api\/wallets\/[A-Za-z0-9_-]{10,128}\/export$/,
  /^\/api\/bots$/,
  /^\/api\/bots\/freeze$/,
  /^\/api\/desk$/,
  /^\/api\/desk\/lock$/,
  /^\/api\/desk\/unlock$/,
  new RegExp(`^/api/bots/${BOT}$`),
  /^\/api\/events$/,
  /^\/api\/logs$/,
  /^\/api\/decisions$/,
  /^\/api\/payments$/,
  /^\/api\/positions$/,
  /^\/api\/metrics$/,
  /^\/api\/profiles\/me$/,
  /^\/api\/profiles\/lookup$/,
  /^\/api\/transfers$/,
  /^\/api\/spend$/,
  new RegExp(`^/bots/${BOT}/status$`),
  new RegExp(`^/bots/${BOT}/pause$`),
  new RegExp(`^/bots/${BOT}/resume$`),
  new RegExp(`^/bots/${BOT}/wake$`),
  new RegExp(`^/bots/${BOT}/loop$`),
  new RegExp(`^/bots/${BOT}/sns/send$`),
  new RegExp(`^/bots/${BOT}/browser/sessions$`),
  new RegExp(`^/bots/${BOT}/browser/sessions/${REC}/(?:live-view|release|navigate)$`),
  new RegExp(`^/bots/${BOT}/shopping/(?:prepare|settle)$`),
  /^\/security\/grab-back$/,
  /^\/voice\/agent$/,
]);

const QUERY_KEYS = new Set(['botId', 'q', 'limit']);

export function isAllowedRuntimePath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0') || pathname.includes('://')) return false;
  return ALLOWED.some(pattern => pattern.test(pathname));
}

export function safeRuntimeSearch(search) {
  if (search == null || search === '' || search === '?') return '';
  const raw = typeof search === 'string' ? search.replace(/^\?/, '') : '';
  if (!raw) return '';
  if (raw.length > 512) return null;
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const kept = new URLSearchParams();
  for (const [key, value] of params) {
    if (!QUERY_KEYS.has(key) || typeof value !== 'string' || value.length > 256) return null;
    kept.append(key, value);
  }
  const text = kept.toString();
  return text ? `?${text}` : '';
}

/**
 * Build an absolute Worker URL, or an error code the route can return.
 * `origin` is the configured runtime base (public URL, not a secret).
 */
export function runtimeProxyTarget(origin, pathname, search = '') {
  if (!isAllowedRuntimePath(pathname)) return { error: 'not_found' };
  const query = safeRuntimeSearch(search);
  if (query == null) return { error: 'not_found' };
  if (typeof origin !== 'string' || !origin.trim()) return { error: 'runtime_unconfigured' };
  let base;
  try {
    base = new URL(origin.trim());
  } catch {
    return { error: 'runtime_unconfigured' };
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return { error: 'runtime_unconfigured' };
  if (base.username || base.password) return { error: 'runtime_unconfigured' };
  const root = `${base.origin}${base.pathname.replace(/\/$/, '')}`;
  return { url: `${root}${pathname}${query}` };
}
