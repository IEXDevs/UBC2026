/**
 * Human-readable Live View / browser session errors for the shell.
 */

export function browserStatusNote({
  ownerId = null,
  runtimeBase = '',
  sessionUrl = null,
  sessionRecordId = null,
  openCount = 0,
} = {}) {
  if (!ownerId) return 'Sign in to open an owner-bound Cloudflare browser session.';
  if (!runtimeBase || !sessionUrl) {
    return 'Set NEXT_PUBLIC_AGENT_RUNTIME_URL to the Worker origin so Live View can open browser sessions.';
  }
  if (sessionRecordId) {
    return 'A browser session is open for this bot (chat and this panel share it). Use Show live view — do not open another until you Release.';
  }
  if (openCount > 0) {
    return 'An open browser session was found for this bot. Use Show live view, or Release if you want a fresh one.';
  }
  return 'Live View needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the Worker. Open a session here or ask the bot in chat.';
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
  if (key === 'concurrency_limit') {
    return 'This bot already has the maximum open browser sessions (often one from chat). Use Show live view on the existing session, or Release first.';
  }
  if (key === 'owner_required' || key === 'forbidden') {
    return 'This browser session is not available for your account.';
  }
  if (key === 'not_found' || key === 'session_not_found') {
    return 'That browser session was not found. Refresh or open a new one.';
  }
  if (key === 'browser_request_failed') return 'The Worker did not open a browser session.';
  return `Browser request failed (${key}).`;
}
