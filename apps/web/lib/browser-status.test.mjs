import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserErrorNote, browserStatusNote } from './browser-status.mjs';

/**
 * Achieves: verifies progressive browser status copy for signed-out → missing runtime → ready → live.
 * Fails when: signed-out skips Sign in, or live session with record id still says "No browser session".
 * Oracle: no owner→Sign in; owner without runtime→NEXT_PUBLIC_AGENT_RUNTIME_URL; sessionUrl only→No browser session yet; with record→Show live view.
 * Side effects / state checked: N/A.
 * Gaps: none for note helpers.
 */
test('browser status explains missing runtime and secrets', () => {
  assert.match(browserStatusNote({}), /Sign in/);
  assert.match(browserStatusNote({ ownerId: 'did:privy:x' }), /NEXT_PUBLIC_AGENT_RUNTIME_URL/);
  assert.match(
    browserStatusNote({
      ownerId: 'did:privy:x',
      runtimeBase: 'https://runtime.example',
      sessionUrl: 'https://runtime.example/bots/b1/browser/sessions',
    }),
    /No browser session yet/,
  );
  assert.match(
    browserStatusNote({
      ownerId: 'did:privy:x',
      runtimeBase: 'https://runtime.example',
      sessionUrl: 'https://runtime.example/bots/b1/browser/sessions',
      sessionRecordId: 'bs_1',
    }),
    /Show live view/,
  );
});

/**
 * Achieves: verifies Worker error codes map to actionable setup hints.
 * Fails when: browser_not_configured omits CLOUDFLARE_API_TOKEN, or unknown codes crash.
 * Oracle: browser_not_configured→CLOUDFLARE_API_TOKEN; search_not_configured→FIRECRAWL; concurrency→Release.
 * Side effects / state checked: N/A.
 * Gaps: unknown code path not asserted (returns generic note if implemented).
 */
test('browser errors map Worker codes to setup hints', () => {
  assert.match(browserErrorNote('browser_not_configured'), /CLOUDFLARE_API_TOKEN/);
  assert.match(browserErrorNote('search_not_configured'), /FIRECRAWL/);
  assert.match(browserErrorNote('not_found'), /not found/i);
  assert.match(browserErrorNote('concurrency_limit'), /Release/);
  assert.match(browserErrorNote('provider_failed'), /Browser Run failed/);
  assert.match(browserErrorNote('browser_session_expired'), /browser_session_expired.*That browser session ended/);
  assert.match(browserErrorNote('browser_readonly_not_configured'), /Read-only Live View requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN/);
  assert.match(browserErrorNote('browser_not_configured'), /CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(browserErrorNote('provider_failed'), /Turnstile/);
});

test('browser diagnostics show codes, HTTP status and only allowlisted reasons', () => {
  assert.match(browserErrorNote('browser_session_expired', 404, 'targets_unavailable'), /browser_session_expired \(404 Failed to fetch targets\)/);
  assert.match(browserErrorNote('browser_not_configured', 403), /403 API token rejected/);
  assert.match(browserErrorNote('provider_failed', undefined, 'binding_failed'), /binding unavailable or failed/);
  for (const secret of ['https://live.browser.run/ui/view?token=secret', 'Bearer secret', 'secret-value', 'secret_value']) {
    assert.ok(!browserErrorNote(secret, secret, secret).includes(secret));
    assert.ok(!browserErrorNote('provider_failed', 502, secret).includes(secret));
  }
});
