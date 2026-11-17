/**
 * Worker-safe Privy login / wallet provision tests.
 * Oracles: Privy HTTP contracts (URL + auth headers + Origin rules), not
 * acceptLogin control-flow mirrors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  WalletError,
  createPrivyWalletClient,
  readPrivyAccessTokenSub,
  sanitizeOrigin,
} from './privy.mjs';

const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const appId = 'app_test';
const appSecret = 'app-secret-value';
const rpcUrl = 'https://example.invalid/quicknode-secret-path';
const privyUserId = 'did:privy:user1';
const walletId = 'fmfdj6yqly31huorjqzq38zc';
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const authorizationKey = `wallet-auth:${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}`;

function jwtFor(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `${header}.${body}.sig`;
}

function embedded(id, walletIndex = 0) {
  return {
    id,
    type: 'wallet',
    address,
    chain_type: 'solana',
    wallet_client_type: 'privy',
    connector_type: 'embedded',
    wallet_index: walletIndex,
  };
}

function mockFetch(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), init, body });
    const match = routes.find(route => route.match(String(url), body, init));
    if (!match) return new Response(JSON.stringify({ error: 'unmocked', path: String(url) }), { status: 500 });
    return new Response(JSON.stringify(match.body), { status: match.status ?? 200 });
  };
  return { calls, fetcher };
}

function client(extra = {}) {
  return createPrivyWalletClient({
    appId,
    appSecret,
    rpcUrl,
    now: () => 1_700_000_000_000,
    ...extra,
  });
}

/**
 * Rigor audit — JWT payload decode helper
 * Achieves: extracts `sub` from a three-segment JWT without verifying signature.
 * Fails when: opaque/malformed tokens return a non-empty sub, or a valid payload
 *   sub is dropped (would break Worker path that keys off JWT sub).
 * Oracle: JWT payload JSON `sub` field (independent of acceptLogin).
 * Side effects: none (pure).
 * Gaps: none for decode contract. Remaining: does not prove signature verification
 *   (intentionally out of scope — Workers use app-secret user GET instead).
 */
test('readPrivyAccessTokenSub reads sub independently of acceptLogin', () => {
  assert.equal(readPrivyAccessTokenSub(jwtFor(privyUserId)), privyUserId);
  assert.equal(readPrivyAccessTokenSub('opaque-token'), '');
  assert.equal(readPrivyAccessTokenSub('a.not-json.b'), '');
  assert.equal(readPrivyAccessTokenSub(''), '');
  assert.equal(readPrivyAccessTokenSub(null), '');
  assert.equal(readPrivyAccessTokenSub(jwtFor('did:privy:other')), 'did:privy:other');
});

/**
 * Rigor audit — Origin sanitization for Privy/CORS
 * Achieves: only http(s) origins without credentials or CR/LF are accepted.
 * Fails when: credentialed URLs, header-injection strings, or non-http schemes
 *   are returned as usable origins.
 * Oracle: WHATWG URL `.origin` for valid http(s); empty string otherwise.
 * Side effects: none.
 * Gaps: none for injection/credentials. Property suite below widens input space.
 */
test('sanitizeOrigin rejects CR/LF and credentials (CORS/Origin injection)', () => {
  assert.equal(sanitizeOrigin('https://maelstrom.iexdevs.com'), 'https://maelstrom.iexdevs.com');
  assert.equal(sanitizeOrigin('https://dev.maelstrom.iexdevs.com'), 'https://dev.maelstrom.iexdevs.com');
  assert.equal(sanitizeOrigin('https://user:pass@evil.example'), '');
  assert.equal(sanitizeOrigin('https://ok.example\r\nX-Injected: 1'), '');
  assert.equal(sanitizeOrigin('javascript:alert(1)'), '');
  assert.equal(sanitizeOrigin(''), '');
});

/**
 * Rigor audit — hosted Worker login without Origin
 * Achieves: JWT login loads `/v1/users/:id` with Basic auth only (no Origin,
 *   no wallet-auth signature on user GET) and never calls `/users/me`.
 * Fails when: unsigned user GET is replaced by signed GET, or code falls through
 *   to `/users/me` without Origin (the hosted 502 regression).
 * Oracle: Privy docs — app-secret Basic for GET user; `/users/me` requires Origin.
 * Side effects: asserts exact first call URL/headers and zero `/users/me` calls.
 * Gaps closed: checks Authorization scheme + missing signature + missing Origin.
 * Remaining: mock Privy; does not prove live Cloudflare Origin stripping.
 */
test('JWT login without Origin never calls users/me (Worker regression)', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: { id: privyUserId, linked_accounts: [embedded(walletId)] },
    },
  ]);
  const result = await client({ fetcher, authorizationKey }).acceptLogin({
    accessToken: jwtFor(privyUserId),
  });
  assert.equal(result.main.address, address);
  assert.equal(calls.some(call => call.url.includes('/users/me')), false);
  assert.equal(calls[0].init.headers.Origin, undefined);
  assert.equal(calls[0].init.headers['privy-authorization-signature'], undefined);
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
});

/**
 * Rigor audit — signature policy split (user GET vs wallet create)
 * Achieves: user GET stays unsigned even when PRIVY_AUTHORIZATION_KEY is set;
 *   wallet create still carries privy-authorization-signature.
 * Fails when: signing is applied to GET /v1/users (Workers 403) or create drops
 *   the signature when a key is configured.
 * Oracle: Privy wallet-auth signs mutating wallet routes; user GET uses app secret.
 * Side effects: inspects headers on both network calls.
 * Gaps: none for header presence. Remaining: does not verify signature cryptographically
 *   against Privy (covered lightly in privy.test.mjs canonicalize path).
 */
test('user GET stays unsigned while wallet create still signs when auth key is set', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: { id: privyUserId, linked_accounts: [] },
    },
    { match: url => url.includes('/v1/wallets?'), body: { data: [] } },
    {
      match: (url, body) => url.endsWith('/v1/wallets') && body?.display_name === 'Main',
      body: { id: walletId, address, chain_type: 'solana' },
    },
  ]);
  await client({ fetcher, authorizationKey }).acceptLogin({
    accessToken: jwtFor(privyUserId),
    ownerId: privyUserId,
  });
  const userGet = calls.find(call => call.url.includes('/v1/users/'));
  const create = calls.find(call => call.body?.display_name === 'Main');
  assert.ok(userGet);
  assert.ok(create);
  assert.equal(userGet.init.headers['privy-authorization-signature'], undefined);
  assert.equal(typeof create.init.headers['privy-authorization-signature'], 'string');
  assert.ok(create.init.headers['privy-authorization-signature'].length > 20);
});

/**
 * Rigor audit — fail closed when Worker user GET 403s without Origin
 * Achieves: loadUser failure without Origin does not fall through to `/users/me`
 *   (which would appear to “succeed” on a mock and hide the Worker defect).
 * Fails when: catch path always retries `/users/me` regardless of Origin.
 * Oracle: without Origin, `/users/me` cannot succeed on hosted Workers.
 * Side effects: asserts zero `/users/me` calls after rejecting.
 * Gaps: none for this failure path.
 */
test('loadUser 403 without Origin does not fall through to users/me', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      status: 403,
      body: { error: 'invalid_authorization_signature' },
    },
    {
      match: url => url.endsWith('/users/me'),
      body: { id: privyUserId, linked_accounts: [embedded(walletId)] },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher }).acceptLogin({ accessToken: jwtFor(privyUserId) }),
    error => error instanceof WalletError && error.code === 'privy_failed',
  );
  assert.equal(calls.some(call => call.url.includes('/users/me')), false);
});

/**
 * Rigor audit — local Node fallback with Origin
 * Achieves: when loadUser fails AND a sanitized Origin is present, `/users/me`
 *   is called with Bearer + Origin.
 * Fails when: fallback is skipped despite Origin, or Origin/Bearer are omitted.
 * Oracle: Privy `/users/me` requires Authorization Bearer and Origin.
 * Side effects: asserts `/users/me` headers and resulting wallet address.
 * Gaps: none for happy fallback. Remaining: does not cover Origin that sanitizes
 *   to empty after being truthy as a string (covered by sanitizeOrigin tests).
 */
test('loadUser failure with Origin falls back to users/me (local Node path)', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      status: 403,
      body: { error: 'invalid_authorization_signature' },
    },
    {
      match: url => url.endsWith('/users/me'),
      body: { id: privyUserId, linked_accounts: [embedded(walletId)] },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken: jwtFor(privyUserId),
    origin: 'http://localhost:3000',
  });
  assert.equal(result.main.address, address);
  assert.equal(calls.some(call => call.url.includes('/users/me')), true);
  const me = calls.find(call => call.url.includes('/users/me'));
  assert.equal(me.init.headers.Origin, 'http://localhost:3000');
  assert.equal(me.init.headers.Authorization, `Bearer ${jwtFor(privyUserId)}`);
});

/**
 * Rigor audit — opaque access token + ownerId
 * Achieves: non-JWT tokens with a valid ownerId still use server user GET and
 *   skip `/users/me`.
 * Fails when: opaque tokens always require Origin/`/users/me`.
 * Oracle: server user id can come from trusted owner header when JWT sub absent.
 * Side effects: no `/users/me` call.
 * Gaps: none for this path.
 */
test('opaque access token with owner id uses server user API', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: { id: privyUserId, linked_accounts: [embedded(walletId)] },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken: 'opaque-privy-access-token-value',
    ownerId: privyUserId,
  });
  assert.equal(result.main.ownerId, privyUserId);
  assert.equal(calls.some(call => call.url.includes('/users/me')), false);
});

/**
 * Rigor audit — opaque token without owner or Origin fails closed
 * Achieves: no network calls; throws missing_origin before `/users/me`.
 * Fails when: code probes `/users/me` without Origin or invents a user id.
 * Oracle: `/users/me` without Origin is invalid; cannot invent owner from opaque token.
 * Side effects: calls.length === 0.
 * Gaps: none.
 */
test('opaque access token without owner id and without Origin fails closed', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.endsWith('/users/me'),
      body: { id: privyUserId, linked_accounts: [embedded(walletId)] },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher }).acceptLogin({ accessToken: 'opaque-privy-access-token-value' }),
    error => error instanceof WalletError && error.code === 'missing_origin',
  );
  assert.equal(calls.length, 0);
});

/**
 * Rigor audit — JWT sub beats stale x-owner-id
 * Achieves: conflicting ownerId header does not change which Privy user is loaded.
 * Fails when: header owner wins over JWT sub (account takeover / wrong wallet set).
 * Oracle: JWT `sub` is the session subject; client headers are untrusted.
 * Side effects: only the JWT subject's `/v1/users/:id` is requested.
 * Gaps: none for preference order.
 */
test('JWT sub wins over a conflicting x-owner-id (stale client header)', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: { id: privyUserId, linked_accounts: [embedded(walletId)] },
    },
    {
      match: url => url.includes('/v1/users/did%3Aprivy%3Astale'),
      body: { id: 'did:privy:stale', linked_accounts: [] },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken: jwtFor(privyUserId),
    ownerId: 'did:privy:stale',
  });
  assert.equal(result.main.ownerId, privyUserId);
  assert.equal(calls[0].url.includes(encodeURIComponent(privyUserId)), true);
  assert.equal(calls.some(call => call.url.includes('stale')), false);
});

/**
 * Rigor audit — missing access token
 * Achieves: fails with missing_config before any Privy HTTP call.
 * Fails when: empty token still hits the network or throws a generic Error.
 * Oracle: no Privy call is valid without an access token.
 * Side effects: calls.length === 0.
 * Gaps: none.
 */
test('missing access token fails before any Privy network call', async () => {
  const { fetcher, calls } = mockFetch([]);
  await assert.rejects(
    () => client({ fetcher }).acceptLogin({ ownerId: privyUserId, origin: 'http://localhost:3000' }),
    error => error instanceof WalletError && error.code === 'missing_config',
  );
  assert.equal(calls.length, 0);
});

/**
 * Rigor audit — property-style Origin samples
 * Achieves: across a broader input set, outputs are either '' or a real URL.origin.
 * Fails when: partial sanitization returns evil substrings (e.g. with @, CR, query).
 * Oracle: URL.origin equality for non-empty outputs.
 * Side effects: none.
 * Gaps closed: samples beyond the hand-picked injection cases.
 * Remaining: not a randomized generator; fixed sample set.
 */
test('sanitizeOrigin property: only http(s) origins without credentials or control chars', () => {
  const samples = [
    'http://localhost:3000',
    'https://dev.maelstrom.iexdevs.com',
    'https://maelstrom.iexdevs.com',
    'HTTPS://EXAMPLE.COM',
    'http://127.0.0.1:3000',
    'ftp://evil.example',
    'https://ok.example/path',
    'https://ok.example?q=1',
    'https://ok.example#frag',
    ' https://ok.example ',
    'https://ok.example\n',
    'https://ok.example\u0000',
    'https://',
    '://missing',
    null,
    12,
    {},
  ];
  for (const sample of samples) {
    const out = sanitizeOrigin(sample);
    if (!out) {
      assert.equal(out, '');
      continue;
    }
    assert.match(out, /^https?:\/\//);
    assert.equal(/[\r\n\0]/.test(out), false);
    assert.equal(out.includes('@'), false);
    assert.equal(out.includes('?'), false);
    assert.equal(out.includes('#'), false);
    assert.equal(out.includes('/'), true);
    assert.equal(new URL(out).origin, out);
  }
});

/**
 * Rigor audit — partial failure during wallet create
 * Achieves: if Main wallet POST fails after empty linked accounts, acceptLogin
 *   rejects and does not return a half-built login object.
 * Fails when: create errors are swallowed and an empty/invalid main is returned.
 * Oracle: provision must yield a usable main wallet or fail closed.
 * Side effects: create attempted; no successful result object.
 * Gaps closed: partial-failure path (checklist).
 */
test('wallet create failure after empty user rejects without a fake main wallet', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: { id: privyUserId, linked_accounts: [] },
    },
    { match: url => url.includes('/v1/wallets?'), body: { data: [] } },
    {
      match: (url, body) => url.endsWith('/v1/wallets') && body?.display_name === 'Main',
      status: 500,
      body: { error: 'create_failed' },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher, authorizationKey }).acceptLogin({
      accessToken: jwtFor(privyUserId),
      ownerId: privyUserId,
    }),
    error => error instanceof WalletError,
  );
  assert.equal(calls.some(call => call.body?.display_name === 'Main'), true);
});

/**
 * Rigor audit — duplicate/concurrent acceptLogin
 * Achieves: two overlapping JWT logins both resolve to the same main address and
 *   never call `/users/me`; each performs its own user GET (no shared mutable cache
 *   required for correctness).
 * Fails when: concurrent calls corrupt ownerId/address or race into `/users/me`.
 * Oracle: idempotent sync of existing embedded wallet; same address both times.
 * Side effects: both calls hit `/v1/users/:id` only.
 * Gaps closed: concurrency / duplicate request (checklist) for the JWT sync path.
 * Remaining: does not simulate Privy create races (no empty linked_accounts here).
 */
test('concurrent JWT acceptLogin calls stay Worker-safe and return the same main', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: { id: privyUserId, linked_accounts: [embedded(walletId)] },
    },
  ]);
  const token = jwtFor(privyUserId);
  const c = client({ fetcher, authorizationKey });
  const [a, b] = await Promise.all([
    c.acceptLogin({ accessToken: token }),
    c.acceptLogin({ accessToken: token }),
  ]);
  assert.equal(a.main.address, address);
  assert.equal(b.main.address, address);
  assert.equal(a.main.ownerId, privyUserId);
  assert.equal(b.main.ownerId, privyUserId);
  assert.equal(calls.every(call => !call.url.includes('/users/me')), true);
  assert.equal(calls.length, 2);
});
