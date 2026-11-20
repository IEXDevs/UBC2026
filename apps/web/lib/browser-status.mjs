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
  if (!sessionUrl) {
    return runtimeBase === 'shell'
      ? 'This agent cannot open a browser session on the agent runtime.'
      : 'Set NEXT_PUBLIC_AGENT_RUNTIME_URL to the Worker origin so Live View can open browser sessions.';
  }
  if (sessionRecordId) {
    return 'A browser session is open for this agent (chat and this panel share it). Use Show live view — do not open another until you Release.';
  }
  if (openCount > 0) {
    return 'An open browser session was found for this agent. Use Show live view, or Release if you want a fresh one.';
  }
  return 'No browser session yet.';
}

export function browserErrorNote(code, providerStatus, providerReason) {
  const codes = new Set([
    'browser_session_expired', 'browser_readonly_not_configured', 'browser_not_configured',
    'search_not_configured', 'scrape_not_configured', 'concurrency_limit', 'owner_required',
    'forbidden', 'bot_not_found', 'bot_directory_unavailable', 'not_found', 'session_not_found',
    'browser_request_failed', 'browser_endpoint_missing', 'browser_provider_failed',
    'provider_rejected', 'provider_failed', 'provider_rate_limited', 'provider_unavailable',
    'invalid_provider_response', 'browser_viewer_failed', 'browser_failed', 'owner_has_control',
    'invalid_identity', 'invalid_navigate', 'invalid_session', 'invalid_target', 'invalid_purpose',
  ]);
  const key = codes.has(code) ? code : 'browser_request_failed';
  const status = Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599 ? providerStatus : null;
  const reasons = {
    targets_unavailable: 'Failed to fetch targets',
    binding_session_expired: 'binding session expired',
    binding_failed: 'browser binding unavailable or failed',
  };
  const reason = Object.hasOwn(reasons, providerReason) ? reasons[providerReason] : '';
  const detail = [status, reason || (status === 401 || status === 403 ? 'API token rejected' : '')].filter(Boolean).join(' ');
  return `Cloudflare Browser Run: ${key}${detail ? ` (${detail})` : ''}. ${browserErrorHint(key)}`;
}

function browserErrorHint(code) {
  const key = typeof code === 'string' ? code.trim() : '';
  if (!key) return 'Browser request failed.';
  if (key === 'browser_session_expired') return 'That browser session ended. Open a new one.';
  if (key === 'browser_readonly_not_configured') {
    return 'Read-only Live View requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the Worker. Interactive access has not been enabled.';
  }
  if (key === 'browser_not_configured') {
    return 'Browser Rendering is not configured. Put CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the Worker (wrangler secret put), redeploy, then retry.';
  }
  if (key === 'search_not_configured' || key === 'scrape_not_configured') {
    return 'Firecrawl is not configured on the Worker (FIRECRAWL_API_KEY).';
  }
  if (key === 'concurrency_limit') {
    return 'This agent already has the maximum open browser sessions (often one from chat). Use Show live view on the existing session, or Release first.';
  }
  if (key === 'owner_required' || key === 'forbidden') {
    return 'This browser session is not available for your account.';
  }
  if (key === 'bot_not_found') return 'This agent is unavailable in your account. Refresh the agent list and try again.';
  if (key === 'bot_directory_unavailable') return 'The agent directory is temporarily unavailable. Try again shortly.';
  if (key === 'not_found' || key === 'session_not_found') {
    return 'That browser session was not found. Refresh or open a new one.';
  }
  if (key === 'browser_request_failed') return 'The Worker did not open a browser session.';
  if (key === 'browser_endpoint_missing') {
    return 'Cloudflare did not recognize the browser session API. Confirm CLOUDFLARE_ACCOUNT_ID on the agent runtime.';
  }
  if (key === 'browser_provider_failed' || key === 'provider_rejected') {
    return 'Cloudflare Browser Run rejected the session. The API token needs Browser Rendering Edit.';
  }
  if (key === 'provider_failed') {
    return 'Cloudflare Browser Run failed to open a session. Retry in a moment.';
  }
  return `Browser request failed (${key}).`;
}
