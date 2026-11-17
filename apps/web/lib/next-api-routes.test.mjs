/**
 * Contract tests for Next.js route handlers under apps/web/app/api.
 * Assert response status/body shapes that clients depend on — independent
 * of how each handler is implemented.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET as getBuild } from '../app/api/build/route.js';
import { GET as getToken } from '../app/api/token/route.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('GET /api/build returns no-store JSON with string id', async () => {
  const prev = process.env.NEXT_PUBLIC_BUILD_ID;
  process.env.NEXT_PUBLIC_BUILD_ID = 'abc123deadbeef';
  try {
    const res = await getBuild();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control') || '', /no-store/);
    const body = await res.json();
    assert.equal(body.id, 'abc123deadbeef');
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID;
    else process.env.NEXT_PUBLIC_BUILD_ID = prev;
  }
});

test('GET /api/build with missing env still returns an id field (empty string)', async () => {
  const prev = process.env.NEXT_PUBLIC_BUILD_ID;
  delete process.env.NEXT_PUBLIC_BUILD_ID;
  try {
    const body = await (await getBuild()).json();
    assert.equal(body.id, '');
    assert.equal(Object.keys(body).join(','), 'id');
  } finally {
    if (prev !== undefined) process.env.NEXT_PUBLIC_BUILD_ID = prev;
  }
});

test('GET /api/token refuses to proxy DexScreener (browser must call it)', async () => {
  const res = await getToken();
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'browser_dex');
  assert.equal(body.quoteSource, 'dexscreener');
  assert.match(res.headers.get('Cache-Control') || '', /no-store/);
});

test('page.js provisions wallets only through walletProvisionPaths (no runtime create)', () => {
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  assert.match(page, /walletProvisionPaths/);
  assert.match(page, /walletProvisionSucceeded/);
  // Regression: shell must not POST create through the runtime proxy.
  assert.equal(/\/api\/runtime\/api\/wallets/.test(page), false);
  assert.equal(/fetch\(\s*['"`]\/api\/runtime/.test(page), false);
  // Must still use the shared helper rather than a hard-coded path alone
  // (a hard-coded path would drift from the frozen contract).
  assert.match(page, /walletProvisionPaths\(\)\[0\]/);
});

test('wallets route uses shared Origin/publicWallet helpers and mirrors persist', () => {
  const route = readFileSync(join(root, 'app/api/wallets/route.js'), 'utf8');
  assert.match(route, /from ['"].*wallets-route\.mjs['"]/);
  assert.match(route, /requestOrigin\(request\)/);
  assert.match(route, /publicWallet/);
  assert.match(route, /walletErrorFields/);
  assert.match(route, /walletErrorStatus/);
  assert.match(route, /\/api\/wallets\/persist/);
  // Must not invent a second Origin sanitizer inline.
  assert.equal(/function requestOrigin/.test(route), false);
});

test('runtime proxy forwards Origin as x-maelstrom-origin for Worker Privy', () => {
  const route = readFileSync(join(root, 'app/api/runtime/[...path]/route.js'), 'utf8');
  assert.match(route, /x-maelstrom-origin/);
  assert.match(route, /runtimeProxyTarget/);
  // Must reject CR/LF in Origin before forwarding.
  assert.match(route, /\[\\r\\n\]/);
  assert.match(route, /body_too_large/);
});

test('GET /api/sns/resolve returns sns_not_found for empty domain without calling network', async () => {
  const { GET } = await import('../app/api/sns/resolve/route.js');
  const res = await GET(new Request('http://localhost/api/sns/resolve'));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'sns_not_found');
});

test('POST /api/voice/token fails closed when ElevenLabs is unconfigured', async () => {
  const { POST } = await import('../app/api/voice/token/route.js');
  const res = await POST(new Request('http://localhost/api/voice/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.ok(res.status === 503 || res.status === 502);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  // Never leak API keys into the client payload.
  assert.equal(JSON.stringify(body).includes('sk_'), false);
});

test('POST /api/sns/send requires bearer auth before SNS resolve', async () => {
  const { POST } = await import('../app/api/sns/send/route.js');
  const res = await POST(new Request('http://localhost/api/sns/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'richclub.sol', amount: '1' }),
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'login_required');
});

test('GET /api/wallets reports config flags without secret values', async () => {
  const { GET } = await import('../app/api/wallets/route.js');
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.hasAppId, 'boolean');
  assert.equal(typeof body.hasAppSecret, 'boolean');
  assert.equal(typeof body.hasRpc, 'boolean');
  assert.equal(typeof body.hasAuthorizationKey, 'boolean');
  assert.ok(Array.isArray(body.missing));
  // Oracle: response must be flags/names only — never secret material.
  const raw = JSON.stringify(body);
  assert.equal(/sk_|Bearer |wallet-auth:/.test(raw), false);
  assert.equal(Object.keys(body).sort().join(','), [
    'hasAppId', 'hasAppSecret', 'hasAuthorizationKey', 'hasRpc', 'missing',
  ].sort().join(','));
});

test('POST /api/bots/:botId/chat rejects invalid bot, missing owner, and empty message', async () => {
  const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
  const badBot = await POST(
    new Request('http://localhost/api/bots/bad bot/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:u1' },
      body: JSON.stringify({ message: 'hi' }),
    }),
    { params: Promise.resolve({ botId: 'bad bot' }) },
  );
  assert.equal(badBot.status, 400);
  assert.equal((await badBot.json()).error, 'invalid_bot');

  const noOwner = await POST(
    new Request('http://localhost/api/bots/bot_1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    }),
    { params: Promise.resolve({ botId: 'bot_1' }) },
  );
  assert.equal(noOwner.status, 401);
  assert.equal((await noOwner.json()).error, 'owner_required');

  const empty = await POST(
    new Request('http://localhost/api/bots/bot_1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:u1' },
      body: JSON.stringify({ message: '   ' }),
    }),
    { params: Promise.resolve({ botId: 'bot_1' }) },
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'message_required');
});

test('POST /api/wallets without bearer returns login_required before Privy', async () => {
  const { POST } = await import('../app/api/wallets/route.js');
  const res = await POST(new Request('http://localhost/api/wallets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'login_required');
});
