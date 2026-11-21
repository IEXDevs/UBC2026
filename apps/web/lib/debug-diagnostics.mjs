/**
 * Global debugging diagnostics for the browser.
 * Captures and logs window errors, unhandled rejections, and failed fetch calls.
 */

function sanitizeUrl(input) {
  try {
    const raw = typeof input === 'string' ? input : (input?.url || '');
    if (!raw) return '';
    const parsed = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    for (const key of ['token', 'secret', 'key', 'signature', 'sig', 'code']) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.pathname + parsed.search;
  } catch {
    return String(input || '');
  }
}

export function installGlobalDebug(target = globalThis) {
  if (!target || target.__maelstromDebugInstalled) return;
  target.__maelstromDebugInstalled = true;

  if (typeof target.addEventListener === 'function') {
    target.addEventListener('error', (event) => {
      console.error('[global error]', event?.error || event?.message || event);
    });

    target.addEventListener('unhandledrejection', (event) => {
      console.error('[unhandled rejection]', event?.reason);
    });
  }

  if (typeof target.fetch === 'function') {
    const originalFetch = target.fetch.bind(target);
    target.fetch = async (input, init) => {
      const method = (init?.method || input?.method || 'GET').toUpperCase();
      const url = sanitizeUrl(input);
      let response;
      try {
        response = await originalFetch(input, init);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error(`[fetch failure] ${method} ${url}`, err);
        }
        throw err;
      }

      if (response && response.status >= 400) {
        try {
          const clone = response.clone();
          const contentType = clone.headers?.get?.('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              const data = await clone.json();
              console.error(`[fetch error ${response.status}] ${method} ${url}`, data);
            } catch {
              console.error(`[fetch error ${response.status}] ${method} ${url}`);
            }
          } else {
            try {
              const text = await clone.text();
              console.error(`[fetch error ${response.status}] ${method} ${url}`, text.slice(0, 500));
            } catch {
              console.error(`[fetch error ${response.status}] ${method} ${url}`);
            }
          }
        } catch {
          console.error(`[fetch error ${response.status}] ${method} ${url}`);
        }
      }

      return response;
    };
  }
}
