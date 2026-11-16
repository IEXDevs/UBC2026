/**
 * Call the agent-runtime Worker.
 * A same-account workers.dev fetch fails from the web Worker, so production
 * uses the AGENT_RUNTIME service binding. Local next dev keeps global fetch.
 */

export function selectRuntimeFetch(env, fallbackFetch = globalThis.fetch) {
  const binding = env?.AGENT_RUNTIME;
  if (binding && typeof binding.fetch === 'function') {
    return (url, init) => binding.fetch(url, init);
  }
  return fallbackFetch;
}

export async function fetchAgentRuntime(url, init) {
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
      return await binding.fetch(new Request(target, init));
    } catch (error) {
      const fallback = await fetch(target, init).catch(() => null);
      if (fallback) return fallback;
      const detail = error instanceof Error ? error.message : 'binding_fetch_failed';
      const wrapped = new Error(detail);
      wrapped.name = 'RuntimeFetchError';
      throw wrapped;
    }
  }
  return fetch(target, init);
}
