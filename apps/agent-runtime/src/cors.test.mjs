import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedCorsOrigin,
  corsOriginList,
  corsPreflightResponse,
  withCors,
} from './cors.mjs';

/**
 * Achieves: default localhost allowlist plus env-configured origins are accepted; unknown Origin is denied.
 * Fails when: defaults drop localhost/127.0.0.1, CORS_ORIGINS is ignored, or evil.example is allowed.
 * Oracle: hardcoded default pair; includes() for configured host; allowedCorsOrigin null for unlisted Origin.
 * Side effects / state checked: N/A (pure allowlist helpers).
 * Gaps: none for happy-path allow/deny; CR/LF env filtering covered in a dedicated test.
 */
test('localhost and configured CORS origins are allowed', () => {
  assert.deepEqual(corsOriginList({}), [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  assert.ok(corsOriginList({ CORS_ORIGINS: 'https://app.example' }).includes('https://app.example'));

  const local = new Request('https://runtime/api/events', {
    headers: { Origin: 'http://localhost:3000' },
  });
  assert.equal(allowedCorsOrigin(local, {}), 'http://localhost:3000');
  assert.equal(
    allowedCorsOrigin(new Request('https://runtime/api/events', { headers: { Origin: 'https://evil.example' } }), {}),
    null,
  );
});

/**
 * Achieves: hosted maelstrom hosts work only when present in CORS_ORIGINS; whitespace/empty env tokens are ignored.
 * Fails when: listing is skipped (host allowed with empty env), defaults are dropped after env set, or blank tokens invent origins.
 * Oracle: allow when listed; deny same Origin with {}; length stays 2 for blank-only CORS_ORIGINS.
 * Side effects / state checked: N/A.
 * Gaps: none for hosted-host gating; header injection covered separately.
 */
test('hosted maelstrom origins are allowed only when listed in CORS_ORIGINS', () => {
  const env = {
    CORS_ORIGINS: 'https://maelstrom.iexdevs.com,https://dev.maelstrom.iexdevs.com',
  };
  const list = corsOriginList(env);
  assert.ok(list.includes('https://maelstrom.iexdevs.com'));
  assert.ok(list.includes('https://dev.maelstrom.iexdevs.com'));
  // Defaults remain — deploying must not lock out local Next.
  assert.ok(list.includes('http://localhost:3000'));

  assert.equal(
    allowedCorsOrigin(new Request('https://runtime/api/events', {
      headers: { Origin: 'https://dev.maelstrom.iexdevs.com' },
    }), env),
    'https://dev.maelstrom.iexdevs.com',
  );
  assert.equal(
    allowedCorsOrigin(new Request('https://runtime/api/events', {
      headers: { Origin: 'https://dev.maelstrom.iexdevs.com' },
    }), {}),
    null,
  );
  // Whitespace / empty tokens in the secret must not invent origins.
  assert.equal(
    corsOriginList({ CORS_ORIGINS: ' , https://ok.example , ' }).includes('https://ok.example'),
    true,
  );
  assert.equal(corsOriginList({ CORS_ORIGINS: ' , ' }).length, 2);
});

/**
 * Achieves: Origin values with CR/LF or extreme length never become an allowlisted ACAO echo.
 * Fails when: injected Origin is reflected, overlong Origin is accepted, or preflight returns 204 for injected Origin.
 * Oracle: allowedCorsOrigin null; preflight status 403 for CR/LF Origin (duck-typed request).
 * Side effects / state checked: N/A.
 * Gaps: none for Origin injection; env-token CR/LF covered in the next test.
 */
test('CORS rejects Origin header injection and overlong values', async () => {
  const env = { CORS_ORIGINS: 'https://ok.example' };
  // Fetch Request rejects CR/LF in header values — probe cors.mjs with a duck-typed request.
  const injected = {
    headers: { get: () => 'https://ok.example\r\nX-Evil: 1' },
  };
  assert.equal(allowedCorsOrigin(injected, env), null);
  assert.equal(
    allowedCorsOrigin(new Request('https://runtime/api/events', {
      headers: { Origin: `https://${'a'.repeat(300)}.example` },
    }), env),
    null,
  );
  const denied = corsPreflightResponse({
    method: 'OPTIONS',
    headers: { get: (name) => (String(name).toLowerCase() === 'origin' ? 'https://ok.example\nX-Evil: 1' : null) },
  }, env);
  assert.equal(denied.status, 403);
});

/**
 * Achieves: CORS_ORIGINS values containing CR/LF never appear as allowlist entries (header-injection fragments stay out).
 * Fails when: list entries retain \\r/\\n, or a CR/LF-split remnant is treated as an allowed Origin match.
 * Oracle: every list entry fails /[\\r\\n]/; Origin matching the pre-split host still works; remnant "X-Evil: 1" is not an allowed Origin.
 * Side effects / state checked: N/A.
 * Gaps: none — production splits on whitespace so CR/LF cannot survive inside a token; this locks that contract.
 */
test('CORS list must not include CR/LF env tokens', () => {
  const dirty = corsOriginList({
    CORS_ORIGINS: 'https://ok.example\r\nX-Evil: 1,https://also.example\nhttps://third.example',
  });
  assert.equal(dirty.some((origin) => /[\r\n]/.test(origin)), false);
  assert.ok(dirty.includes('https://ok.example'));
  assert.ok(dirty.includes('https://also.example'));
  assert.ok(dirty.includes('https://third.example'));
  // A CRLF-split remnant must not become a usable allowlisted Origin.
  assert.equal(
    allowedCorsOrigin({
      headers: { get: () => 'X-Evil: 1' },
    }, { CORS_ORIGINS: 'https://ok.example\r\nX-Evil: 1' }),
    null,
  );
});

/**
 * Achieves: allowed Origin gets ACAO on preflight/response; denied Origin gets 403 preflight and withCors does not add ACAO.
 * Fails when: localhost preflight lacks ACAO/headers, evil Origin gets 204, or withCors stamps ACAO onto a denied Origin response.
 * Oracle: 204 + ACAO for localhost; 403 without ACAO for evil; withCors leaves Access-Control-Allow-Origin unset for denied Origin.
 * Side effects / state checked: response Cache-Control preserved when CORS headers are applied.
 * Gaps: none for withCors deny path (explicitly asserted).
 */
test('preflight and responses carry CORS headers for localhost', async () => {
  const preflight = new Request('https://runtime/api/events?botId=bot_1', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-owner-id',
    },
  });
  const ok = corsPreflightResponse(preflight, {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  assert.match(ok.headers.get('Access-Control-Allow-Headers') || '', /x-owner-id/i);

  const denied = corsPreflightResponse(new Request('https://runtime/api/events', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  }), {});
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);

  const wrapped = withCors(
    new Request('https://runtime/api/events', { headers: { Origin: 'http://localhost:3000' } }),
    Response.json({ items: [] }, { headers: { 'Cache-Control': 'no-store' } }),
    {},
  );
  assert.equal(wrapped.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  assert.equal(wrapped.headers.get('Cache-Control'), 'no-store');

  const deniedWrapped = withCors(
    new Request('https://runtime/api/events', { headers: { Origin: 'https://evil.example' } }),
    Response.json({ items: [] }, { headers: { 'X-Keep': '1' } }),
    {},
  );
  assert.equal(deniedWrapped.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(deniedWrapped.headers.get('X-Keep'), '1');
  assert.equal(deniedWrapped.status, 200);
});
