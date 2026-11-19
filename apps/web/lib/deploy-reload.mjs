/**
 * Ask the current deployment which build is live, then drop caches and reload once if it changed.
 * The reload waits until Privy has finished writing the session, then locks wallet unlocks.
 * Login stays. With Privy server cookies the session is the HttpOnly cookie.
 * Until that domain is verified, the session is localStorage and this wait
 * lets the refresh token finish writing before the navigation.
 */

import { lockOpenWallets } from './desk-lock.mjs';

export const BUILD_QUERY = '__build';
export const RELOAD_MEMORY_KEY = 'maelstrom.deploy';
export const DEPLOY_CHECK_MS = 30_000;
export const SESSION_QUIET_MS = 350;
export const SESSION_SETTLE_MS = 4_000;
const PRIVY_AUTH_HOST = 'auth.privy.io';
const SESSION_KEY = /^privy(?::[\w-]+)?:(?:token|pat|refresh_token|id[_-]?token)$/;
const FALLBACK_SESSION_KEYS = Object.freeze([
  'privy:token',
  'privy:pat',
  'privy:refresh_token',
  'privy:id_token',
]);

export function buildsDiffer(localId, remoteId) {
  if (typeof localId !== 'string' || localId.trim() === '') return false;
  if (typeof remoteId !== 'string' || remoteId.trim() === '') return false;
  return localId.trim() !== remoteId.trim();
}

export function reloadUrl(href, remoteId) {
  const url = new URL(href);
  url.searchParams.set(BUILD_QUERY, String(remoteId).trim());
  return url.toString();
}

/** Path to show after a reload landed on this build. Null when the query is still needed. */
export function cleanBuildQuery(href, localId) {
  const url = new URL(href);
  if (url.searchParams.get(BUILD_QUERY) !== localId) return null;
  url.searchParams.delete(BUILD_QUERY);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}

export function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

export function isPrivyAuthRequest(input) {
  const raw = requestUrl(input);
  if (!raw) return false;
  try {
    const url = new URL(raw, 'https://auth.privy.io');
    if (url.pathname === '/api/privy-auth' || url.pathname.startsWith('/api/privy-auth/')) return true;
    return url.hostname === PRIVY_AUTH_HOST || url.hostname.endsWith('.privy.io');
  } catch {
    return false;
  }
}

export function privySessionFingerprint(storage) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  const keys = [];
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (SESSION_KEY.test(String(key || ''))) keys.push(String(key));
    }
  } else {
    keys.push(...FALLBACK_SESSION_KEYS);
  }
  keys.sort();
  return keys.map((key) => {
    try {
      return `${key}=${storage.getItem(key) || ''}`;
    } catch {
      return `${key}=`;
    }
  }).join('\n');
}

/**
 * Track Privy session fetches already in flight so a reload does not cut a refresh in half.
 * A half-finished refresh rotates the token and the next page deletes the login.
 */
export function installAuthFetchTracker(target) {
  if (!target || typeof target.fetch !== 'function' || target.fetch.__maelstromAuthTrack) {
    return { idle: () => true, restore() {} };
  }
  const original = target.fetch.bind(target);
  const pending = new Set();
  const tracked = async function trackedFetch(input, init) {
    const promise = original(input, init);
    if (!isPrivyAuthRequest(input)) return promise;
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  tracked.__maelstromAuthTrack = true;
  target.fetch = tracked;
  return {
    idle: () => pending.size === 0,
    restore() {
      if (target.fetch === tracked) target.fetch = original;
    },
  };
}

export async function waitForStablePrivySession({
  storage,
  idle = () => true,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  quietMs = SESSION_QUIET_MS,
  timeoutMs = SESSION_SETTLE_MS,
} = {}) {
  const started = now();
  let last = privySessionFingerprint(storage);
  let stableAt = started;
  while (now() - started < timeoutMs) {
    const next = privySessionFingerprint(storage);
    if (next !== last) {
      last = next;
      stableAt = now();
    }
    if (idle() && now() - stableAt >= quietMs) return true;
    await sleep(40);
  }
  return idle();
}

export async function clearBrowserCaches({ caches, serviceWorker } = {}) {
  if (typeof caches?.keys === 'function' && typeof caches?.delete === 'function') {
    const keys = await caches.keys();
    await Promise.all([...keys].map((key) => caches.delete(key)));
  }
  if (typeof serviceWorker?.getRegistrations === 'function') {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all([...registrations].map((registration) => registration?.unregister?.()));
  }
}

function claimReload(session, remoteId) {
  if (!session || typeof session.getItem !== 'function' || typeof session.setItem !== 'function') return true;
  if (session.getItem(RELOAD_MEMORY_KEY) === remoteId) return false;
  session.setItem(RELOAD_MEMORY_KEY, remoteId);
  return true;
}

export async function checkDeploy({
  localId,
  fetcher = fetch,
  href,
  session,
  persistent,
  settle,
  caches,
  serviceWorker,
  replace,
} = {}) {
  let response;
  try {
    response = await fetcher('/api/build', { cache: 'no-store' });
  } catch {
    return { reload: false };
  }
  if (!response?.ok) return { reload: false };
  const body = await response.json?.().catch(() => null);
  const remoteId = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!buildsDiffer(localId, remoteId)) return { reload: false };
  if (!claimReload(session, remoteId)) return { reload: false };
  if (typeof settle === 'function') {
    try {
      await settle();
    } catch {
      /* A settle that throws still yields to the new build. */
    }
  }
  try {
    lockOpenWallets(persistent);
  } catch {
    /* A locked wallet is the ceiling. The login stays either way. */
  }
  try {
    await clearBrowserCaches({ caches, serviceWorker });
  } catch {
    /* A cache the browser will not clear still yields to the cache-busted navigation. */
  }
  const next = reloadUrl(href, remoteId);
  if (typeof replace === 'function') replace(next);
  return { reload: true, id: remoteId };
}

export function watchDeploy({
  localId,
  fetcher,
  href,
  session,
  caches,
  serviceWorker,
  replace,
  replaceState,
  persistent,
  settle,
  intervalMs = DEPLOY_CHECK_MS,
  windowRef,
  documentRef,
} = {}) {
  const view = windowRef ?? (typeof window === 'undefined' ? null : window);
  if (!view) return () => {};
  const doc = documentRef ?? (typeof document === 'undefined' ? null : document);
  let stopped = false;

  const tidy = cleanBuildQuery(href ?? view.location?.href ?? '', localId);
  if (tidy && typeof replaceState === 'function') replaceState(tidy);
  else if (tidy && view.history?.replaceState) {
    view.history.replaceState(view.history.state, '', tidy);
  }

  const tracker = installAuthFetchTracker(view);
  const store = persistent ?? view.localStorage;
  const waitForSession = settle ?? (() => waitForStablePrivySession({
    storage: store,
    idle: tracker.idle,
  }));

  const tick = () => {
    if (stopped) return;
    void checkDeploy({
      localId,
      fetcher,
      href: href ?? view.location?.href,
      session: session ?? view.sessionStorage,
      persistent: store,
      settle: waitForSession,
      caches: caches ?? view.caches,
      serviceWorker: serviceWorker ?? view.navigator?.serviceWorker,
      replace: replace ?? ((next) => view.location.replace(next)),
    });
  };

  tick();
  const timer = view.setInterval(tick, intervalMs);
  const onVisible = () => {
    if (!doc || doc.visibilityState === 'visible') tick();
  };
  doc?.addEventListener?.('visibilitychange', onVisible);
  return () => {
    stopped = true;
    view.clearInterval(timer);
    doc?.removeEventListener?.('visibilitychange', onVisible);
    tracker.restore();
  };
}
