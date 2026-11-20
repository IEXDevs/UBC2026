/**
 * Existing Privy client suite. Each test below carries a rigor audit comment.
 * Oracles: Privy HTTP shapes, Solana-devnet genesis, and wallet assignment rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { ConfigError } from '@ubc2026/contracts';
import { assignBotWallet, createMainWallet } from './wallets.mjs';
import { accountWriteBodies } from './wallets.mjs';
import {
  DEVNET_GENESIS_HASH,
  WalletError,
  canonicalizeJson,
  privyAuthorizationSignature,
  createPrivyWalletClient,
  createPrivyWalletClientFromEnv,
  loginMethodsFromUser,
} from './privy.mjs';

const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const appId = 'app_test';
const appSecret = 'app-secret-value';
const accessToken = 'privy-access-token-value';
const rpcUrl = 'https://example.invalid/quicknode-secret-path';
const privyUserId = 'did:privy:user1';
const walletId = 'fmfdj6yqly31huorjqzq38zc';
const otherWalletId = 'cm5addwallet1234567890abcd';
const txSignature = '5'.repeat(88);
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const authorizationKey = `wallet-auth:${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}`;

const baseBot = {
  id: 'bot_1',
  ownerId: 'user_1',
  name: 'APY hunter',
  goal: 'Find yield',
  type: 'trading',
  approvalMode: 'ask',
  walletId: 'placeholder',
  enabled: true,
  frozen: false,
  policyVersion: 1,
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50' },
};

function embedded(id, walletIndex) {
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

function userWith(accounts) {
  return { id: privyUserId, linked_accounts: accounts };
}

function unsignedTx() {
  return Buffer.alloc(80, 3).toString('base64');
}

function signedTx() {
  return Buffer.alloc(180, 4).toString('base64');
}

function mockFetch(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    const match = routes.find(route => route.match(url, body, init));
    if (!match) return new Response(JSON.stringify({ error: 'unmocked' }), { status: 500 });
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

function assertNoSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(text.includes(appSecret), false);
  assert.equal(text.includes(accessToken), false);
  assert.equal(text.includes('quicknode-secret-path'), false);
  assert.equal(text.includes(authorizationKey), false);
  assert.equal(text.includes(authorizationKey.slice('wallet-auth:'.length)), false);
}

test('a prepared transfer binds the exact simulated message to its signature', async () => {
  const unsigned = Buffer.alloc(80, 0);
  unsigned[0] = 1;
  unsigned[65] = 1;
  const transaction = unsigned.toString('base64');
  const signed = Buffer.from(unsigned);
  signed.fill(4, 1, 65);
  let swapMessage = false;
  let broadcasts = 0;
  const wallet = { id: walletId, privyWalletId: walletId, ownerId: 'user_1', kind: 'main', label: 'Main', address, provider: 'privy', frozen: false };
  const bot = { ...baseBot, walletId };
  const privy = client({ fetcher: async (_url, init) => {
    const req = JSON.parse(init.body);
    if (req.method === 'getGenesisHash') return Response.json({ result: DEVNET_GENESIS_HASH });
    if (req.method === 'getFeeForMessage') {
      assert.equal(req.params[0], unsigned.subarray(65).toString('base64'));
      return Response.json({ result: { value: 5000 } });
    }
    if (req.method === 'simulateTransaction') {
      assert.equal(req.params[0], transaction);
      assert.equal(req.params[1].replaceRecentBlockhash, false);
      return Response.json({ result: { value: { err: null } } });
    }
    if (req.method === 'signTransaction') {
      assert.equal(req.params.transaction, transaction);
      const bytes = Buffer.from(signed);
      if (swapMessage) bytes[79] ^= 1;
      return Response.json({ data: { signed_transaction: bytes.toString('base64') } });
    }
    assert.equal(req.method, 'sendTransaction');
    assert.equal(req.params[0], signed.toString('base64'));
    broadcasts++;
    return Response.json({ result: txSignature });
  } });
  const prepared = await privy.prepareDevnetTransfer({ transaction });
  assert.equal(prepared.feeLamports, '5000');
  const input = { bot, wallet, prepared };
  await assert.rejects(privy.signPreparedDevnetTransfer({ ...input, prepared: { ...prepared } }), { code: 'simulation_required' });
  assert.equal((await privy.signPreparedDevnetTransfer(input)).signature, txSignature);
  await assert.rejects(privy.signPreparedDevnetTransfer(input), { code: 'simulation_required' });
  swapMessage = true;
  const again = await privy.prepareDevnetTransfer({ transaction });
  await assert.rejects(privy.signPreparedDevnetTransfer({ ...input, prepared: again }), { code: 'transaction_mismatch' });
  assert.equal(broadcasts, 1);
});

test('a prepared send uses the wallet owner session only when Privy requires it', async () => {
  const unsigned = Buffer.alloc(80);
  unsigned[0] = 1;
  unsigned[65] = 1;
  const transaction = unsigned.toString('base64');
  const signed = Buffer.from(unsigned);
  signed.fill(4, 1, 65);
  const wallet = { ...createMainWallet({ ownerId: privyUserId, address, id: walletId }), privyWalletId: walletId };
  const bot = { ...baseBot, ownerId: wallet.ownerId, walletId };
  const token = sub => `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.test`;
  const suite = new CipherSuite({
    kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305(),
  });
  const sessionKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  let rejection = 'zero_correct_authorization_signatures';
  let exchanged = 0;
  let broadcasts = 0;
  const privy = client({ authorizationKey, fetcher: async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    if (path === '/v1/wallets/authenticate') {
      exchanged++;
      assert.equal(body.user_jwt, token(privyUserId));
      assert.equal(body.encryption_type, 'HPKE');
      const recipientPublicKey = await crypto.subtle.importKey('spki', Buffer.from(body.recipient_public_key, 'base64'),
        { name: 'ECDH', namedCurve: 'P-256' }, true, []);
      const sessionPkcs8 = sessionKey.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
      const { enc, ct } = await suite.seal({ recipientPublicKey }, Buffer.from(sessionPkcs8));
      return Response.json({
        encrypted_authorization_key: {
          encryption_type: 'HPKE',
          encapsulated_key: Buffer.from(enc).toString('base64'),
          ciphertext: Buffer.from(ct).toString('base64'),
        },
        expires_at: Date.now() + 60000,
      });
    }
    if (path.endsWith('/rpc')) {
      assert.equal(path, `/v1/wallets/${walletId}/rpc`);
      assert.equal(body.method, 'signTransaction');
      assert.equal(body.params.transaction, transaction);
      const headers = new Headers(init.headers);
      const signedHeaders = {
        'privy-app-id': headers.get('privy-app-id'),
        'privy-request-expiry': headers.get('privy-request-expiry'),
      };
      const payload = Buffer.from(canonicalizeJson({ version: 1, method: 'POST', url: String(url), body, headers: signedHeaders }));
      const signature = Buffer.from(headers.get('privy-authorization-signature'), 'base64');
      if (verify('sha256', payload, publicKey, signature)) return Response.json({ code: rejection }, { status: 403 });
      assert.equal(verify('sha256', payload, sessionKey.publicKey, signature), true);
      return Response.json({ method: 'signTransaction', data: { signed_transaction: signed.toString('base64'), encoding: 'base64' } });
    }
    if (body.method === 'getGenesisHash') return Response.json({ result: DEVNET_GENESIS_HASH });
    if (body.method === 'getFeeForMessage') return Response.json({ result: { value: 5000 } });
    if (body.method === 'simulateTransaction') return Response.json({ result: { value: { err: null } } });
    assert.equal(body.method, 'sendTransaction');
    assert.equal(body.params[0], signed.toString('base64'));
    broadcasts++;
    return Response.json({ result: txSignature });
  } });
  async function send(accessToken) {
    const prepared = await privy.prepareDevnetTransfer({ transaction });
    return privy.signPreparedDevnetTransfer({ bot, wallet, prepared, accessToken });
  }
  await assert.rejects(send(token('did:privy:other')), { code: 'wallet_owner_session_required' });
  assert.equal(exchanged, 0);
  assert.equal(broadcasts, 0);
  assert.equal((await send(token(privyUserId))).signature, txSignature);
  assert.equal(exchanged, 1);
  assert.equal(broadcasts, 1);
  rejection = 'policy_violation';
  await assert.rejects(send(token(privyUserId)), { code: 'wallet_policy_rejected' });
  assert.equal(exchanged, 1);
  assert.equal(broadcasts, 1);
});

/**
 * Rigor audit — missing server-signing names throw before any request
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('missing server-signing names throw before any request', () => {
  const { fetcher, calls } = mockFetch([]);
  assert.throws(
    () => createPrivyWalletClientFromEnv({ PRIVY_APP_SECRET: appSecret, fetcher }),
    error => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.missing, ['PRIVY_APP_ID', 'QUICKNODE_DEVNET_RPC_URL']);
      assertNoSecrets(error.message);
      return true;
    },
  );
  assert.equal(calls.length, 0);
  assert.throws(
    () => createPrivyWalletClient({ appId, appSecret, rpcUrl: 'http://example.invalid/quicknode-secret-path' }),
    error => error instanceof WalletError && error.code === 'invalid_rpc' && !error.message.includes('quicknode-secret-path'),
  );
});

/**
 * Rigor audit — readLoginUser returns linked wallets and does not create one
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('readLoginUser returns linked wallets and does not create one', async () => {
  const phantom = 'So11111111111111111111111111111111111111112';
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: {
        id: privyUserId,
        linked_accounts: [
          embedded(walletId, 0),
          {
            type: 'wallet',
            address: phantom,
            chain_type: 'solana',
            wallet_client_type: 'phantom',
            connector_type: 'solana_adapter',
          },
        ],
      },
    },
  ]);
  const user = await client({ fetcher }).readLoginUser({
    accessToken,
    origin: 'http://localhost:3000',
    ownerId: privyUserId,
  });
  assert.equal(user.id, privyUserId);
  assert.equal(user.linked_accounts[1].address, phantom);
  assert.equal(calls.some(call => call.init?.method === 'POST'), false);
  assert.equal(calls.some(call => String(call.url).includes('/v1/wallets')), false);
  assert.equal(calls.some(call => String(call.url).includes('/users/me')), false);
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
});

/**
 * Rigor audit — readLoginUser falls back to users/me only for an opaque local token
 * Achieves: no JWT sub and no owner id still reads /users/me when Origin is allowed.
 * Fails when: the local fallback is removed, or a Worker-style client calls /users/me.
 * Oracle: acceptLogin's users/me rule — Origin only off Cloudflare.
 * Side effects: mocked fetch call list.
 * Gaps: does not exercise a live Privy session.
 */
test('readLoginUser uses users/me only when the token has no user id', async () => {
  const { fetcher, calls } = mockFetch([
    { match: url => url.endsWith('/api/v1/users/me'), body: { id: privyUserId, linked_accounts: [] } },
  ]);
  const user = await client({ fetcher }).readLoginUser({
    accessToken,
    origin: 'http://localhost:3000',
  });
  assert.equal(user.id, privyUserId);
  assert.equal(calls.some(call => String(call.url).includes('/users/me')), true);
  assert.equal(calls.some(call => call.init?.method === 'POST'), false);
});

/**
 * Rigor audit — hosted portfolio read does not call users/me
 * Achieves: a JWT sub loads GET /v1/users/:id and never sets Origin or creates a wallet.
 * Fails when: Workers fall through to /users/me (the portfolio 502).
 * Oracle: same identity path as acceptLogin, without syncWallets.
 * Side effects: mocked fetch call list.
 * Gaps: signature of the JWT is not verified, matching acceptLogin.
 */
test('readLoginUser on Workers loads by JWT sub and does not call users/me', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: privyUserId })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: { id: privyUserId, linked_accounts: [embedded(walletId, 0)] },
    },
  ]);
  const user = await client({ fetcher, allowUsersMeFallback: false }).readLoginUser({
    accessToken: token,
  });
  assert.equal(user.id, privyUserId);
  assert.equal(user.linked_accounts[0].id, walletId);
  assert.equal(calls.length, 1);
  assert.equal(calls.some(call => String(call.url).includes('/users/me')), false);
  assert.equal(calls.some(call => call.init?.method === 'POST'), false);
  assert.equal(calls[0].init.headers.Origin, undefined);
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
});

/**
 * Rigor audit — login recovers owner id from JWT sub without users/me (Worker-safe)
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login recovers owner id from JWT sub without users/me (Worker-safe)', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: privyUserId })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const { fetcher, calls } = mockFetch([
    { match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`), body: { id: privyUserId, linked_accounts: [] } },
    { match: url => url.includes('/v1/wallets?'), body: { data: [] } },
    {
      match: (url, reqBody) => url.endsWith('/v1/wallets') && reqBody?.display_name === 'Main',
      body: { id: walletId, address, chain_type: 'solana' },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken: token,
    ownerId: privyUserId,
    // No origin — Cloudflare Workers strip it on outbound Privy calls.
  });
  assert.equal(result.created, true);
  assert.equal(result.main.ownerId, privyUserId);
  assert.equal(calls.some(call => String(call.url).includes('/users/me')), false);
  assert.equal(calls[2].body.owner.user_id, privyUserId);
});

/**
 * Rigor audit — login prefers JWT sub over a stale x-owner-id header
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login prefers JWT sub over a stale x-owner-id header', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: privyUserId })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const { fetcher, calls } = mockFetch([
    { match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`), body: { id: privyUserId, linked_accounts: [embedded(walletId, 0)] } },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken: token,
    ownerId: 'did:privy:other',
  });
  assert.equal(result.main.ownerId, privyUserId);
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].url).includes(encodeURIComponent(privyUserId)), true);
});

/**
 * Rigor audit — Worker-safe login loads the user with app secret and no authorization signature
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('Worker-safe login loads the user with app secret and no authorization signature', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: privyUserId })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const { fetcher, calls } = mockFetch([
    { match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`), body: { id: privyUserId, linked_accounts: [embedded(walletId, 0)] } },
  ]);
  await client({ fetcher, authorizationKey }).acceptLogin({ accessToken: token, ownerId: privyUserId });
  const userCall = calls[0];
  assert.equal(userCall.init.headers.Authorization.startsWith('Basic '), true);
  assert.equal(userCall.init.headers['privy-authorization-signature'], undefined);
});

/**
 * Rigor audit — login keeps linked wallets and sign-in methods on the same owner
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login keeps linked wallets and sign-in methods on the same owner', async () => {
  const phantom = 'So11111111111111111111111111111111111111112';
  const { fetcher } = mockFetch([
    {
      match: url => url.endsWith('/api/v1/users/me'),
      body: {
        id: privyUserId,
        linked_accounts: [
          { type: 'email', address: 'a@example.com' },
          { type: 'google_oauth', email: 'g@example.com' },
          embedded(walletId, 0),
          {
            type: 'wallet',
            address: phantom,
            chain_type: 'solana',
            wallet_client_type: 'phantom',
            connector_type: 'solana_adapter',
          },
        ],
      },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken,
    ownerId: privyUserId,
    origin: 'http://localhost:3000',
  });
  assert.equal(result.main.address, address);
  assert.equal(result.main.spendable, true);
  assert.equal(result.additional.length, 1);
  assert.equal(result.additional[0].id, `linked_${phantom}`);
  assert.equal(result.additional[0].spendable, false);
  assert.equal(result.additional[0].privyWalletId, undefined);
  assert.deepEqual(result.loginMethods.map(method => method.method), ['email', 'google', 'wallet', 'wallet']);
  const stored = accountWriteBodies(result, privyUserId);
  assert.equal(stored.user.privy_user_id, privyUserId);
  assert.equal(stored.user.login_methods.length, 4);
  assert.equal(stored.wallets[1].spendable, false);
  assert.equal(stored.wallets[1].owner_id, privyUserId);
  assert.equal(loginMethodsFromUser({ linked_accounts: [] }).length, 0);
});

/**
 * Rigor audit — login creates the main Solana wallet when Privy has none
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login creates the main Solana wallet when Privy has none', async () => {
  const { fetcher, calls } = mockFetch([
    { match: url => url.includes('/v1/users/'), body: userWith([]) },
    { match: url => url.includes('/v1/wallets?'), body: { data: [] } },
    {
      match: (url, body) => url.endsWith('/v1/wallets') && body?.display_name === 'Main',
      body: { id: walletId, address, chain_type: 'solana' },
    },
  ]);
  const result = await client({ fetcher, authorizationKey }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, true);
  assert.equal(result.main.kind, 'main');
  assert.equal(result.main.provider, 'privy');
  assert.equal(result.main.address, address);
  assert.equal(result.main.privyWalletId, walletId);
  assert.equal(result.main.ownerId, 'user_1');
  assert.deepEqual(result.additional, []);

  const login = calls[0];
  assert.equal(login.url, `https://api.privy.io/v1/users/${encodeURIComponent('user_1')}`);
  assert.equal(login.init.headers.Authorization.startsWith('Basic '), true);
  assert.equal(login.init.headers['privy-authorization-signature'], undefined);
  assert.equal(login.url.includes(accessToken), false);
  assert.equal(login.init.headers.Authorization.includes(appSecret), false);

  assert.equal(calls[1].url.includes('/v1/wallets?'), true);
  assert.equal(calls[1].url.includes(encodeURIComponent(privyUserId)), true);

  const create = calls[2];
  assert.equal(create.url, 'https://api.privy.io/v1/wallets');
  assert.equal(create.body.chain_type, 'solana');
  assert.deepEqual(create.body.owner, { user_id: privyUserId });
  assert.equal(create.init.headers['privy-idempotency-key'], 'main-solana_did_privy_user1');
  assert.equal(create.url.includes(appSecret), false);
  const payload = canonicalizeJson({
    version: 1,
    method: 'POST',
    url: create.url,
    body: create.body,
    headers: {
      'privy-app-id': appId,
      'privy-idempotency-key': create.init.headers['privy-idempotency-key'],
      'privy-request-expiry': create.init.headers['privy-request-expiry'],
    },
  });
  assert.equal(
    verify('sha256', Buffer.from(payload), publicKey, Buffer.from(create.init.headers['privy-authorization-signature'], 'base64')),
    true,
  );
  assert.equal(calls.length, 3);
});

/**
 * Rigor audit — login recovers when createOnLogin linked a Solana wallet with null server id
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login recovers when createOnLogin linked a Solana wallet with null server id', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.endsWith('/api/v1/users/me'),
      body: userWith([
        {
          id: null,
          type: 'wallet',
          address,
          chain_type: 'solana',
          wallet_client_type: 'privy',
          connector_type: 'embedded',
          wallet_index: 0,
        },
      ]),
    },
    {
      match: url => url.includes('/v1/wallets?'),
      body: { data: [{ id: walletId, address, chain_type: 'solana' }] },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, false);
  assert.equal(result.main.privyWalletId, walletId);
  assert.equal(result.main.address, address);
  assert.equal(calls.some(call => call.body?.display_name === 'Main'), false);
});

/**
 * Rigor audit — login retries list after create fails when a server wallet already exists
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login retries list after create fails when a server wallet already exists', async () => {
  const calls = [];
  let listCount = 0;
  const dynamic = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    if (url.endsWith('/api/v1/users/me')) {
      return new Response(JSON.stringify(userWith([])), { status: 200 });
    }
    if (url.includes('/v1/wallets?')) {
      listCount += 1;
      const data = listCount === 1 ? [] : [{ id: walletId, address, chain_type: 'solana' }];
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    if (url.endsWith('/v1/wallets') && body?.display_name === 'Main') {
      return new Response(JSON.stringify({ error: 'wallet_already_exists' }), { status: 400 });
    }
    return new Response(JSON.stringify({ error: 'unmocked' }), { status: 500 });
  };
  const result = await client({ fetcher: dynamic }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, false);
  assert.equal(result.main.privyWalletId, walletId);
  assert.equal(listCount, 2);
  assert.equal(calls.some(call => call.body?.display_name === 'Main'), true);
});

/**
 * Rigor audit — login keeps an existing main wallet and maps later embedded wallets as additional
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login keeps an existing main wallet and maps later embedded wallets as additional', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes('/v1/users/'),
      body: userWith([
        { type: 'wallet', address, chain_type: 'solana', wallet_client_type: 'phantom', connector_type: 'solana_adapter', id: 'phantomwalletid1234567890' },
        embedded(otherWalletId, 1),
        embedded(walletId, 0),
      ]),
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, false);
  assert.equal(result.main.id, walletId);
  assert.equal(result.main.kind, 'main');
  assert.equal(result.additional.length, 1);
  assert.equal(result.additional[0].kind, 'additional');
  assert.equal(result.additional[0].id, otherWalletId);
  assert.equal(result.additional[0].label, 'Additional 1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['privy-authorization-signature'], undefined);
});

/**
 * Rigor audit — additional wallets require a main wallet and a label
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('additional wallets require a main wallet and a label', async () => {
  const empty = mockFetch([
    { match: url => url.includes('/v1/users/'), body: userWith([]) },
  ]);
  await assert.rejects(
    () => client({ fetcher: empty.fetcher }).createAdditional({ privyUserId, ownerId: 'user_1', label: 'Trading' }),
    error => error instanceof WalletError && error.code === 'main_wallet_required',
  );
  assert.equal(empty.calls.some(call => call.body?.chain_type === 'solana'), false);

  const labeled = mockFetch([]);
  await assert.rejects(
    () => client({ fetcher: labeled.fetcher }).createAdditional({ privyUserId, ownerId: 'user_1', label: ' ' }),
    WalletError,
  );
  assert.equal(labeled.calls.length, 0);

  const ready = mockFetch([
    { match: url => url.includes('/v1/users/'), body: userWith([embedded(walletId, 0)]) },
    {
      match: (url, body) => url.endsWith('/v1/wallets') && body?.display_name === 'Trading',
      body: { id: otherWalletId, address, chain_type: 'solana' },
    },
  ]);
  const created = await client({ fetcher: ready.fetcher }).createAdditional({
    privyUserId,
    ownerId: 'user_1',
    label: 'Trading',
  });
  assert.equal(created.kind, 'additional');
  assert.equal(created.label, 'Trading');
  assert.equal(created.privyWalletId, otherWalletId);
  assert.equal(ready.calls[1].init.headers['privy-idempotency-key'], 'add_did_privy_user1_trading');
  assert.equal(ready.calls[1].init.headers.Authorization.startsWith('Basic '), true);
});

/**
 * Rigor audit — server signing broadcasts only after devnet genesis matches
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('server signing broadcasts only after devnet genesis matches', async () => {
  const wallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
    privyUserId,
  };
  const bot = assignBotWallet({ ...baseBot, walletId: wallet.id }, wallet);
  const transaction = unsignedTx();
  const signed = signedTx();
  const { fetcher, calls } = mockFetch([
    {
      match: (url, body) => url.endsWith('/rpc') && body?.method === 'signTransaction',
      body: { method: 'signTransaction', data: { signed_transaction: signed, encoding: 'base64' } },
    },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash',
      body: { jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH },
    },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'sendTransaction',
      body: { jsonrpc: '2.0', id: 1, result: txSignature },
    },
  ]);
  const sent = await client({ fetcher }).signAndBroadcastDevnet({ bot, wallet, transaction });
  assert.equal(sent.cluster, 'devnet');
  assert.equal(sent.signature, txSignature);
  assert.equal(sent.botId, bot.id);
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(calls[1].init.headers['privy-app-id'], undefined);
  assert.equal(calls[2].body.params[0], signed);
  assert.equal(calls[2].body.params[1].encoding, 'base64');
  assert.equal(calls[0].url.includes(appSecret), false);
  assert.equal(calls[0].url.includes('quicknode-secret-path'), false);
  assert.equal(calls[1].url, rpcUrl);
  assert.equal(calls[2].url, rpcUrl);
});

/**
 * Rigor audit — a non-devnet QuickNode genesis hash never sends the transaction
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('a non-devnet QuickNode genesis hash never sends the transaction', async () => {
  const wallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
  };
  const bot = assignBotWallet({ ...baseBot, walletId: wallet.id }, wallet);
  const { fetcher, calls } = mockFetch([
    {
      match: (url, body) => url.endsWith('/rpc') && body?.method === 'signTransaction',
      body: { data: { signed_transaction: signedTx() } },
    },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash',
      body: { result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher }).signAndBroadcastDevnet({ bot, wallet, transaction: unsignedTx() }),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  assert.equal(calls.some(call => call.body?.method === 'sendTransaction'), false);
});

/**
 * Rigor audit — freeze and provider failures do not reveal secrets or broadcast
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('freeze and provider failures do not reveal secrets or broadcast', async () => {
  const openWallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
  };
  const openBot = assignBotWallet({ ...baseBot, walletId: openWallet.id }, openWallet);
  const wallet = { ...openWallet, frozen: true };
  const frozenFetch = mockFetch([]);
  await assert.rejects(
    () => client({ fetcher: frozenFetch.fetcher }).signAndBroadcastDevnet({
      bot: openBot,
      wallet,
      transaction: unsignedTx(),
    }),
    WalletError,
  );
  assert.equal(frozenFetch.calls.length, 0);

  const raw = mockFetch([
    {
      match: url => url.endsWith('/rpc'),
      body: { data: { signed_transaction: Buffer.alloc(64, 9).toString('base64') } },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher: raw.fetcher }).signAndBroadcastDevnet({
      bot: openBot,
      wallet: openWallet,
      transaction: unsignedTx(),
    }),
    error => error instanceof WalletError && error.code === 'invalid_signature',
  );
  assert.equal(raw.calls.some(call => call.body?.method === 'getGenesisHash'), false);

  const liveWallet = openWallet;
  const liveBot = openBot;
  const leaky = mockFetch([
    {
      match: url => url.endsWith('/rpc'),
      status: 401,
      body: { error: appSecret, message: `${rpcUrl} ${accessToken}` },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher: leaky.fetcher }).signAndBroadcastDevnet({
      bot: liveBot,
      wallet: liveWallet,
      transaction: unsignedTx(),
    }),
    error => {
      assert.ok(error instanceof WalletError);
      assertNoSecrets(error.message);
      return true;
    },
  );

  await assert.rejects(
    () => client({
      fetcher: async () => { throw new Error(rpcUrl); },
    }).signAndBroadcastDevnet({ bot: liveBot, wallet: liveWallet, transaction: unsignedTx() }),
    error => error instanceof WalletError && error.code === 'privy_failed' && !error.message.includes('quicknode-secret-path'),
  );
});

/**
 * Rigor audit — devnet reads and owner sweeps stay off the public client surface and off mainnet
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('devnet reads and owner sweeps stay off the public client surface and off mainnet', async () => {
  const live = client();
  assert.equal(live.rpc, undefined);
  assert.equal(live.sendSigned, undefined);
  assert.equal(live.signWithPrivy, undefined);

  const owner = 'So11111111111111111111111111111111111111112';
  const blockhash = '3'.repeat(32);
  const mainnet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  const wallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
    frozen: true,
  };

  const blocked = mockFetch([
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: mainnet } },
  ]);
  const blockedClient = client({ fetcher: blocked.fetcher });
  await assert.rejects(
    () => blockedClient.getDevnetBlockhash(),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  await assert.rejects(
    () => blockedClient.getDevnetUsdcBalance({ address: owner }),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  await assert.rejects(
    () => blockedClient.broadcastSignedDevnet({ signedTransaction: signedTx() }),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  assert.equal(blocked.calls.some(call => call.body?.method === 'getLatestBlockhash'), false);
  assert.equal(blocked.calls.some(call => call.body?.method === 'getTokenAccountsByOwner'), false);
  assert.equal(blocked.calls.some(call => call.body?.method === 'sendTransaction'), false);

  const read = mockFetch([
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: DEVNET_GENESIS_HASH } },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'getLatestBlockhash',
      body: { result: { value: { blockhash, lastValidBlockHeight: 42 } } },
    },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'getTokenAccountsByOwner',
      body: {
        result: {
          value: [
            { account: { data: { parsed: { info: { mint: address, tokenAmount: { amount: '1000', decimals: 6 } } } } } },
            { account: { data: { parsed: { info: { mint: address, tokenAmount: { amount: '2500', decimals: 6 } } } } } },
          ],
        },
      },
    },
  ]);
  const reader = client({ fetcher: read.fetcher });
  const hash = await reader.getDevnetBlockhash();
  assert.equal(hash.cluster, 'devnet');
  assert.equal(hash.blockhash, blockhash);
  const balance = await reader.getDevnetUsdcBalance({ address: owner });
  assert.equal(balance.amount, '3500');
  assert.equal(balance.mint, address);
  const balanceCall = read.calls.find(call => call.body?.method === 'getTokenAccountsByOwner');
  assert.deepEqual(balanceCall.body.params[1], { mint: address });
  assert.equal(balanceCall.body.params[0], owner);

  const mismatch = mockFetch([]);
  await assert.rejects(
    () => client({ fetcher: mismatch.fetcher }).signAndBroadcastOwnerDevnet({
      ownerId: 'user_2',
      wallet,
      transaction: unsignedTx(),
    }),
    error => error instanceof WalletError && error.code === 'owner_mismatch',
  );
  assert.equal(mismatch.calls.length, 0);

  const sweep = mockFetch([
    {
      match: (url, body) => url.endsWith('/rpc') && body?.method === 'signTransaction',
      body: { data: { signed_transaction: signedTx() } },
    },
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: DEVNET_GENESIS_HASH } },
    { match: (url, body) => url === rpcUrl && body?.method === 'sendTransaction', body: { result: txSignature } },
  ]);
  const swept = await client({ fetcher: sweep.fetcher }).signAndBroadcastOwnerDevnet({
    ownerId: 'user_1',
    wallet,
    transaction: unsignedTx(),
  });
  assert.equal(swept.signature, txSignature);
  assert.equal(swept.botId, undefined);
  assert.equal(wallet.frozen, true);
  assert.equal(sweep.calls.at(-1).body.method, 'sendTransaction');
});

/**
 * Rigor audit — an owner export returns HPKE ciphertext and refuses a plaintext key
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/devnet contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('an owner export returns HPKE ciphertext and refuses a plaintext key', async () => {
  const wallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
  };
  const recipient = Buffer.alloc(65, 7).toString('base64');
  const encapsulated = Buffer.alloc(65, 8).toString('base64');
  const ciphertext = Buffer.alloc(48, 9).toString('base64');
  const leaked = mockFetch([{
    match: (url) => url.endsWith(`/v1/wallets/${walletId}/export`),
    body: { encryption_type: 'HPKE', encapsulated_key: encapsulated, ciphertext, private_key: 'do-not-return' },
  }]);
  await assert.rejects(
    () => client({ fetcher: leaked.fetcher }).exportOwnerWallet({
      ownerId: 'user_1',
      wallet,
      recipientPublicKey: recipient,
    }),
    (error) => error instanceof WalletError && error.code === 'plaintext_key',
  );
  const clean = mockFetch([{
    match: (url, body) => url.endsWith(`/v1/wallets/${walletId}/export`)
      && body?.encryption_type === 'HPKE'
      && body?.recipient_public_key === recipient,
    body: { encryption_type: 'HPKE', encapsulated_key: encapsulated, ciphertext },
  }]);
  const exported = await client({ fetcher: clean.fetcher }).exportOwnerWallet({
    ownerId: 'user_1',
    wallet,
    recipientPublicKey: recipient,
  });
  assert.equal(exported.encryptionType, 'HPKE');
  assert.equal(exported.ciphertext, ciphertext);
  assert.equal(exported.encapsulatedKey, encapsulated);
  assert.equal(exported.privateKey, undefined);
  assert.equal(JSON.stringify(exported).includes('do-not-return'), false);
});

/**
 * Achieves: privyAuthorizationSignature produces a verifiable P-256 signature over the canonical payload.
 * Fails when: Wrong payload verifies, or junk/empty authorization keys succeed.
 * Oracle: node:crypto verify against independently generated public key + canonicalizeJson payload.
 * Side effects: none (local keypair fixture).
 * Gaps: does not call live Privy HTTP.
 */
test('privyAuthorizationSignature signs the canonical payload and rejects bad keys', () => {
  const url = 'https://api.privy.io/v1/wallets';
  const body = { chain_type: 'solana', owner: { user_id: privyUserId } };
  const signature = privyAuthorizationSignature({
    appId,
    authorizationKey,
    method: 'POST',
    url,
    body,
    idempotencyKey: 'idem_1',
    expiresAt: 1_700_000_000,
  });
  const payload = canonicalizeJson({
    version: 1,
    method: 'POST',
    url,
    body,
    headers: {
      'privy-app-id': appId,
      'privy-idempotency-key': 'idem_1',
      'privy-request-expiry': '1700000000',
    },
  });
  assert.equal(verify('sha256', Buffer.from(payload), publicKey, Buffer.from(signature, 'base64')), true);
  const withoutPrefix = privyAuthorizationSignature({
    appId,
    authorizationKey: authorizationKey.slice('wallet-auth:'.length),
    method: 'POST',
    url,
    body,
  });
  assert.equal(typeof withoutPrefix, 'string');
  assert.notEqual(withoutPrefix, '');
  assert.throws(
    () => privyAuthorizationSignature({ appId, authorizationKey: 'not-a-key', method: 'POST', url, body }),
    WalletError,
  );
  assert.throws(
    () => privyAuthorizationSignature({ appId, authorizationKey: '', method: 'POST', url, body }),
    WalletError,
  );
});
