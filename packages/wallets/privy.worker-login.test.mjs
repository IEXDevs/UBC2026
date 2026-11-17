/**
 * Rigorous Worker-safe Privy login / wallet provision tests.
 * Expected results are derived from Privy HTTP contracts (which URL, which
 * auth headers, which fallback), not by mirroring acceptLogin line-by-line.
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

test('readPrivyAccessTokenSub reads sub independently of acceptLogin', () => {
  assert.equal(readPrivyAccessTokenSub(jwtFor(privyUserId)), privyUserId);
  assert.equal(readPrivyAccessTokenSub('opaque-token'), '');
  assert.equal(readPrivyAccessTokenSub('a.not-json.b'), '');
  assert.equal(readPrivyAccessTokenSub(''), '');
  assert.equal(readPrivyAccessTokenSub(null), '');
  // Would fail if we required signature verification here — we intentionally only decode.
  assert.equal(readPrivyAccessTokenSub(jwtFor('did:privy:other')), 'did:privy:other');
});

test('sanitizeOrigin rejects CR/LF and credentials (CORS/Origin injection)', () => {
  assert.equal(sanitizeOrigin('https://maelstrom.iexdevs.com'), 'https://maelstrom.iexdevs.com');
  assert.equal(sanitizeOrigin('https://dev.maelstrom.iexdevs.com'), 'https://dev.maelstrom.iexdevs.com');
  assert.equal(sanitizeOrigin('https://user:pass@evil.example'), '');
  assert.equal(sanitizeOrigin('https://ok.example\r\nX-Injected: 1'), '');
  assert.equal(sanitizeOrigin('javascript:alert(1)'), '');
  assert.equal(sanitizeOrigin(''), '');
});

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

test('missing access token fails before any Privy network call', async () => {
  const { fetcher, calls } = mockFetch([]);
  await assert.rejects(
    () => client({ fetcher }).acceptLogin({ ownerId: privyUserId, origin: 'http://localhost:3000' }),
    error => error instanceof WalletError && error.code === 'missing_config',
  );
  assert.equal(calls.length, 0);
});

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
      // Failures must never return a partially sanitized evil string.
      assert.equal(out, '');
      continue;
    }
    assert.match(out, /^https?:\/\//);
    assert.equal(/[\r\n\0]/.test(out), false);
    assert.equal(out.includes('@'), false);
    assert.equal(out.includes('?'), false);
    assert.equal(out.includes('#'), false);
    assert.equal(out.includes('/'), true);
    // Origin form: scheme://host[:port] only.
    assert.equal(new URL(out).origin, out);
  }
});
