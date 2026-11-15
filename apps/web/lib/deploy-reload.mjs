/** Ask the current deployment which build is live, then drop caches and reload once if it changed. */

export const BUILD_QUERY = '__build';
export const RELOAD_MEMORY_KEY = 'maelstrom.deploy';
export const DEPLOY_CHECK_MS = 30_000;

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

  const tick = () => {
    if (stopped) return;
    void checkDeploy({
      localId,
      fetcher,
      href: href ?? view.location?.href,
      session: session ?? view.sessionStorage,
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
  };
}
