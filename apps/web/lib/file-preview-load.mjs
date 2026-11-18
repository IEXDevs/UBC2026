/**
 * Load catalog file bytes for preview. Times out so the UI never stays on
 * "Opening this file" when Drive or auth hangs.
 */

export const FILE_PREVIEW_TIMEOUT_MS = 12_000;

export function isStoredFileSecret(id) {
  return typeof id === 'string' && /^[0-9a-z]{128}$/.test(id.trim());
}

export function classifyFileLoadFailure({ status = 0, body = null, timedOut = false } = {}) {
  if (timedOut) {
    return {
      state: 'error',
      message: 'Opening this file timed out. Check your connection and try again.',
    };
  }
  if (status === 404 && body?.gone === true) {
    return {
      state: 'gone',
      message: 'This file is no longer in storage. Remove it from the catalog or attach a new copy.',
    };
  }
  if (status === 503 || body?.error === 'drive_not_configured') {
    return {
      state: 'error',
      message: 'File storage is not ready on the server. Try again after storage is configured, or attach a fresh copy from this device.',
    };
  }
  if (status === 401 || body?.error === 'owner_required' || body?.error === 'account_required') {
    return {
      state: 'error',
      message: 'Sign in again to open this file, or attach a fresh copy from this device.',
    };
  }
  if (status === 502 || body?.error === 'unreachable' || body?.error === 'drive_failed') {
    return {
      state: 'error',
      message: 'Could not reach file storage. Try again in a moment.',
    };
  }
  return {
    state: 'error',
    message: 'Could not load this file. Check your connection and try again.',
  };
}

/**
 * @param {{
 *   fetcher?: typeof fetch,
 *   url: string,
 *   headers?: Record<string, string>,
 *   timeoutMs?: number,
 * }} options
 */
export async function fetchFilePreviewBytes({
  fetcher = fetch,
  url,
  headers = {},
  timeoutMs = FILE_PREVIEW_TIMEOUT_MS,
} = {}) {
  const limit = Math.max(1_000, Number(timeoutMs) || FILE_PREVIEW_TIMEOUT_MS);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      try { controller?.abort(); } catch { /* ignore */ }
      resolve({ ok: false, ...classifyFileLoadFailure({ timedOut: true }) });
    }, limit);
  });
  const work = (async () => {
    try {
      const response = await fetcher(url, {
        headers,
        signal: controller?.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        return { ok: false, ...classifyFileLoadFailure({ status: response.status, body }) };
      }
      const bytes = await response.arrayBuffer();
      const type = response.headers.get('content-type') || 'application/octet-stream';
      return { ok: true, bytes, type };
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      return { ok: false, ...classifyFileLoadFailure({ timedOut, status: 0 }) };
    }
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
