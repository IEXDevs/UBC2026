/**
 * Helpers for provisioning Privy wallets from the OpenNext Cloudflare Worker.
 * Outbound `fetch` to api.privy.io from OpenNext/nodejs often throws TypeError;
 * the AGENT_RUNTIME service binding uses workerd fetch and can call Privy.
 */

export function cloudflareWorkerEnv() {
  return (async () => {
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const ctx = await getCloudflareContext({ async: true });
      return ctx?.env && typeof ctx.env === 'object' ? ctx.env : null;
    } catch {
      return null;
    }
  })();
}

export function hasAgentRuntimeBinding(env) {
  return Boolean(env?.AGENT_RUNTIME && typeof env.AGENT_RUNTIME.fetch === 'function');
}

/**
 * Sanitize a thrown fetch/TypeError message for API responses (no secrets).
 */
export function safeFetchErrorDetail(error, { label = 'Privy' } = {}) {
  const name = typeof error?.name === 'string' && error.name ? error.name : 'Error';
  const raw = typeof error?.message === 'string' ? error.message.replace(/[\r\n]+/g, ' ').trim() : '';
  const clipped = raw
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/(sk_[A-Za-z0-9]+)/gi, 'sk_[redacted]')
    .replace(/(password|api[_-]?key|secret)=[^\s]+/gi, '$1=[redacted]')
    .slice(0, 120);
  if (clipped && clipped.length > 2 && !/(password|api[_-]?key)\s*[:=]/i.test(clipped)) {
    return `${label} request failed (${name}: ${clipped})`;
  }
  return `${label} request failed (${name})`;
}

/**
 * Map a runtime `/api/wallets` create JSON body into the shell's provision shape.
 */
export function mapRuntimeWalletCreate(body = {}) {
  if (!body || typeof body !== 'object') {
    return { error: 'wallet_failed', detail: 'Agent runtime returned an empty wallet create response' };
  }
  if (typeof body.error === 'string' && body.error) {
    const detail = typeof body.detail === 'string' ? body.detail.replace(/[\r\n]+/g, ' ').slice(0, 180) : undefined;
    return detail ? { error: body.error, detail } : { error: body.error };
  }
  const wallets = Array.isArray(body.wallets) ? body.wallets : [];
  return {
    created: body.created === true,
    wallets,
    loginMethods: Array.isArray(body.loginMethods) ? body.loginMethods : [],
  };
}
