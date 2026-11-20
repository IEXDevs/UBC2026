/**
 * Call the agent-runtime Worker.
 * A same-account workers.dev fetch fails from the web Worker, so production
 * uses the AGENT_RUNTIME service binding. Local next dev keeps global fetch.
 * A local binding that answers "worker not found" is not a live runtime:
 * fall through to the public origin so seed checks and wallet create still run.
 */

export function selectRuntimeFetch(env, fallbackFetch = globalThis.fetch) {
  const binding = env?.AGENT_RUNTIME;
  if (binding && typeof binding.fetch === 'function') {
    return (url, init) => binding.fetch(url, init);
  }
  return fallbackFetch;
}

/** Wrangler's local service binding when that worker is not running. */
export function localWorkerMissing(status, body) {
  if (status !== 503 || typeof body !== 'string') return false;
  const text = body.replace(/^\uFEFF/, '').trim();
  if (!text || text.length > 240) return false;
  return /^Worker "[^"\r\n]{1,80}" not found\./.test(text);
}

export async function responseFromBinding(bindingFetch, target, init, fallbackFetch) {
  const bound = await bindingFetch(new Request(target, init));
  const peeked = await bound.clone().text().catch(() => '');
  if (!localWorkerMissing(bound.status, peeked)) return bound;
  const fallback = await fallbackFetch(target, init).catch(() => null);
  return fallback || bound;
}

export async function fetchAgentRuntime(url, init, fallbackFetch = globalThis.fetch) {
  let env;
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    env = ctx?.env;
  } catch {
    env = undefined;
  }
  const target = typeof url === 'string' ? url : String(url);
  const binding = env?.AGENT_RUNTIME;
  if (binding && typeof binding.fetch === 'function') {
    try {
      return await responseFromBinding(
        (request) => binding.fetch(request),
        target,
        init,
        fallbackFetch,
      );
    } catch (error) {
      const fallback = await fallbackFetch(target, init).catch(() => null);
      if (fallback) return fallback;
      const detail = error instanceof Error ? error.message : 'binding_fetch_failed';
      const wrapped = new Error(detail);
      wrapped.name = 'RuntimeFetchError';
      throw wrapped;
    }
  }
  return fallbackFetch(target, init);
}
