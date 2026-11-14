/**
 * Human-readable Live View / browser session errors for the shell.
 */

export function browserStatusNote({
  ownerId = null,
  runtimeBase = '',
  sessionUrl = null,
} = {}) {
  if (!ownerId) return 'Sign in to open an owner-bound Cloudflare browser session.';
  if (!runtimeBase || !sessionUrl) {
    return 'Set NEXT_PUBLIC_AGENT_RUNTIME_URL to the Worker origin so Live View can open browser sessions.';
  }
  return 'Live View needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the Worker. Open a session to confirm.';
}

export function browserErrorNote(code) {
  const key = typeof code === 'string' ? code.trim() : '';
  if (!key) return 'Browser request failed.';
  if (key === 'browser_not_configured') {
    return 'Browser Rendering is not configured. Put CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the Worker (wrangler secret put), redeploy, then retry.';
  }
  if (key === 'search_not_configured' || key === 'scrape_not_configured') {
    return 'Firecrawl is not configured on the Worker (FIRECRAWL_API_KEY).';
  }
  if (key === 'owner_required' || key === 'forbidden') {
    return 'This browser session is not available for your account.';
  }
  if (key === 'not_found') return 'That browser session was not found. Open a new one.';
  if (key === 'browser_request_failed') return 'The Worker did not open a browser session.';
  return `Browser request failed (${key}).`;
}
