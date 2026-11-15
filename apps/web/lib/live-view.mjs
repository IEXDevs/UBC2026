import { shellRuntimeUrl } from './runtime-data.mjs';

const LIVE_VIEW_PATHS = new Set(['/ui/view', '/ui/inspector']);
const BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;

export function browserSessionUrl(runtimeBase, botId, { sessionRecordId, action } = {}) {
  if (runtimeBase === 'shell') {
    if (typeof botId !== 'string' || !BOT_ID.test(botId)) return null;
    const bot = encodeURIComponent(botId);
    if (!sessionRecordId) return shellRuntimeUrl(`/bots/${bot}/browser/sessions`);
    if (action !== 'live-view' && action !== 'release' && action !== 'navigate') return null;
    if (typeof sessionRecordId !== 'string' || !BOT_ID.test(sessionRecordId)) return null;
    return shellRuntimeUrl(`/bots/${bot}/browser/sessions/${encodeURIComponent(sessionRecordId)}/${action}`);
  }
  if (typeof runtimeBase !== 'string' || runtimeBase === '' || typeof botId !== 'string' || botId === '') return null;
  let base;
  try { base = new URL(runtimeBase); } catch { return null; }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const root = `${base.origin}${base.pathname.replace(/\/$/, '')}`;
  const bot = encodeURIComponent(botId);
  if (!sessionRecordId) return `${root}/bots/${bot}/browser/sessions`;
  if (action !== 'live-view' && action !== 'release' && action !== 'navigate') return null;
  return `${root}/bots/${bot}/browser/sessions/${encodeURIComponent(sessionRecordId)}/${action}`;
}

/**
 * Prefer the newest open session from GET /bots/:id/browser/sessions.
 * Chat and the Live View panel share the Worker store — the panel must adopt
 * sessions the model already opened instead of creating another slot.
 */
export function pickOpenSession(payload) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const open = sessions.filter(row => row
    && typeof row.sessionRecordId === 'string'
    && row.sessionRecordId
    && row.status !== 'closed');
  if (open.length === 0) return null;
  open.sort((a, b) => {
    const aAt = Number(a.updatedAt ?? a.createdAt ?? 0);
    const bAt = Number(b.updatedAt ?? b.createdAt ?? 0);
    return bAt - aAt;
  });
  return open[0];
}

/**
 * Decide how the owner UI should show a Live View URL.
 * The URL is a bearer credential: callers may set iframe src or an href, never text.
 */
export function liveViewFrame(view) {
  const hidden = { embed: false, fallback: 'open-viewer-in-separate-tab', src: null, referrerPolicy: 'no-referrer' };
  if (!view || typeof view.viewerUrl !== 'string') return hidden;
  let url;
  try { url = new URL(view.viewerUrl); } catch { return hidden; }
  const allowed = url.protocol === 'https:'
    && url.hostname === 'live.browser.run'
    && LIVE_VIEW_PATHS.has(url.pathname)
    && !url.username
    && !url.password;
  if (!allowed) return hidden;
  return {
    embed: view.embedVerified === true,
    fallback: view.fallback === 'open-viewer-in-separate-tab' ? view.fallback : 'open-viewer-in-separate-tab',
    src: url.href,
    referrerPolicy: 'no-referrer',
  };
}
