import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import worker from './index.mjs';
import { SOLANA_USDC_MINT } from '@ubc2026/contracts/solana';

const appId = 'testapp1';
const owner = 'did:privy:fixture_a';
const otherOwner = 'did:privy:fixture_b';
const address = SOLANA_USDC_MINT;
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function session(claims = {}, header = { alg: 'ES256', kid: 'key1' }, key = privateKey) {
  const payload = encode({ iss: 'privy.io', aud: appId, sub: owner, exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  const message = `${encode(header)}.${payload}`;
  const signature = sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' });
  return `${message}.${signature.toString('base64url')}`;
}

function envWith(fetcher, overrides = {}) {
  return {
    PRIVY_APP_ID: appId,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'offline',
    fetch: async (input, init) => {
      const url = new URL(input);
      if (url.hostname === 'auth.privy.io') {
        assert.equal(url.pathname, `/api/v1/apps/${appId}/jwks.json`);
        return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'key1' }] });
      }
      return fetcher(url, init);
    },
    ...overrides,
  };
}

function request(path, token, { method = 'GET', body, ownerHeader, extraHeaders } = {}) {
  const headers = new Headers(extraHeaders);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (ownerHeader) headers.set('x-owner-id', ownerHeader);
  return new Request(`https://runtime.test${path}`, {
    method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
}

test('owner routes reject header-only, unsigned, tampered, expired and wrong-app sessions before owner I/O', async () => {
  const token = session();
  const parts = token.split('.');
  const invalidSignature = `${parts[0]}.${parts[1]}.${Buffer.alloc(64).toString('base64url')}`;
  const unsigned = session({}, { alg: 'none' }).replace(/[^.]+$/, '');
  const checked = [];
  const env = envWith(async (url, init) => {
    if (url.pathname.endsWith('/activity_logs')) {
      checked.push(JSON.parse(init.body).owner_id);
      return new Response(null, { status: 204 });
    }
    assert.fail('invalid session reached owner data');
  });
  for (const [path, method] of [
    ['/api/state', 'GET'], ['/api/wallets/persist', 'POST'], ['/bots/bot_a', 'GET'],
    ['/bots/bot_a/shopping/prepare', 'POST'], ['/bots/bot_a/shopping/settle', 'POST'],
    ['/bots/bot_a/sns/send', 'POST'], ['/security/grab-back', 'POST'], ['/api/spend', 'POST'],
  ]) {
    for (const invalid of [null, unsigned, invalidSignature, session({ aud: 'otherapp1' }), session({ exp: 1 })]) {
      const res = await worker.fetch(request(path, invalid, { method, ownerHeader: owner }), env);
      assert.equal(res.status, 401, path);
      assert.equal((await res.json()).error, 'login_required');
    }
  }
  assert.equal(checked.length, 40);
  assert.ok(checked.every(ownerId => ownerId === null));
});

test('signed Privy sessions read owner-scoped data without an owner header or wallet login', async () => {
  const env = envWith(async url => {
    if (url.pathname.endsWith('/activity_logs')) return new Response(null, { status: 204 });
    assert.equal(url.pathname, '/rest/v1/users');
    assert.equal(url.searchParams.get('id'), `eq.${owner}`);
    return Response.json([{ id: owner, privy_user_id: owner }]);
  }, { transferClient: { acceptLogin: () => assert.fail('unexpected wallet sync') } });
  const token = session();
  const accepted = await worker.fetch(request('/api/me', token), env);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).user.id, owner);
  const wrongHeader = await worker.fetch(request('/api/me', token, { ownerHeader: otherOwner }), env);
  assert.equal(wrongHeader.status, 403);
  const missingApp = await worker.fetch(request('/api/me', token), { ...env, PRIVY_APP_ID: '' });
  assert.equal(missingApp.status, 503);
  assert.equal((await missingApp.json()).error, 'owner_auth_unconfigured');
});

test('owner auth refreshes cached JWKS on rotation and limits further unknown key lookups', async () => {
  const rotated = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let fetches = 0;
  const env = envWith(null, { fetch: async url => {
    if (new URL(url).hostname === 'auth.privy.io') {
      const key = ++fetches === 1 ? publicKey : rotated.publicKey;
      return Response.json({ keys: [{ ...key.export({ format: 'jwk' }), kid: `key${fetches}` }] });
    }
    if (new URL(url).pathname.endsWith('/activity_logs')) return new Response(null, { status: 204 });
    return Response.json([{ id: owner }]);
  } });
  const read = token => worker.fetch(request('/api/me', token), env);
  assert.equal((await read(session())).status, 200);
  assert.equal((await read(session({}, { alg: 'ES256', kid: 'key2' }, rotated.privateKey))).status, 200);
  for (const kid of ['unknown1', 'unknown2']) {
    assert.equal((await read(session({}, { alg: 'ES256', kid }))).status, 401);
  }
  assert.equal(fetches, 2);
});

test('only authenticated voice webhook spends are recorded in the owner activity log', async () => {
  const logged = [];
  const env = envWith(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/activity_logs');
    logged.push(JSON.parse(init.body).owner_id);
    return new Response(null, { status: 204 });
  }, { ELEVENLABS_WEBHOOK_SECRET: 'offline-voice-secret' });
  const submit = secret => worker.fetch(request('/api/spend', null, {
    method: 'POST', ownerHeader: owner, extraHeaders: { 'x-elevenlabs-webhook-secret': secret },
  }), env);
  assert.equal((await submit('wrong-secret')).status, 401);
  assert.equal((await submit('offline-voice-secret')).status, 400);
  assert.deepEqual(logged, [null, owner]);
});

test('wallet persistence accepts signed sessions and only writes wallets verified with Privy', async () => {
  const wallet = { id: 'wallet_a', ownerId: owner, address, kind: 'main', label: 'Main' };
  const writes = [];
  const env = envWith(async (url, init) => {
    if (url.pathname.endsWith('/wallets') && init.method === 'POST') {
      writes.push(JSON.parse(init.body));
    }
    return init.method === 'GET' ? Response.json([]) : new Response(null, { status: 204 });
  }, {
    transferClient: { ensureMainWallet: async identity => {
      assert.deepEqual(identity, { privyUserId: owner, ownerId: owner });
      return { main: wallet, additional: [] };
    } },
  });
  const persist = wallets => worker.fetch(request('/api/wallets/persist', session(), { method: 'POST', body: { wallets } }), env);
  assert.equal((await persist([wallet])).status, 200);
  assert.equal(writes[0][0].owner_id, owner);
  assert.equal(writes[0][0].id, wallet.id);
  assert.equal(Object.hasOwn(writes[0][0], 'frozen'), false);
  assert.equal((await persist([{ ...wallet, id: 'unregistered_wallet' }])).status, 403);
  assert.equal(writes.length, 1);
});

test('signed commerce requests use server-owned wallets and a real different account cannot access the bot', async () => {
  const env = envWith(async url => {
    if (url.pathname.endsWith('/activity_logs')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/bots')) {
      const row = { id: 'bot_a', owner_id: owner, wallet_id: 'wallet_a' };
      return Response.json(url.searchParams.get('owner_id') === `eq.${owner}` ? [row] : []);
    }
    if (url.pathname.endsWith('/wallets')) {
      assert.equal(url.searchParams.get('owner_id'), `eq.${owner}`);
      return Response.json([{ id: 'wallet_a', owner_id: owner, address, kind: 'main' }]);
    }
    if (url.pathname.endsWith('/spend_ledgers')) return Response.json([]);
    assert.fail(`unexpected mock request: ${url.pathname}`);
  }, { SNS_DEMO_MAP: { 'demo.sol': 'So11111111111111111111111111111111111111112' } });
  const args = { method: 'POST', body: { domain: 'demo.sol', amount: '1000' } };
  const sent = await worker.fetch(request('/bots/bot_a/sns/send', session(), args), env);
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).intent.from, address);
  const forbidden = await worker.fetch(request('/bots/bot_a/sns/send', session({ sub: otherOwner }), args), env);
  assert.equal(forbidden.status, 404);
});
