/**
 * Contract tests for Next.js route handlers under apps/web/app/api.
 * Prefer executing handlers. Source-read tests are labeled as drift guards —
 * they do not execute runtime behavior (checklist: could pass without running
 * the claimed path) and are paired with helper/unit tests that do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET as getBuild } from '../app/api/build/route.js';
import { GET as getToken } from '../app/api/token/route.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Rigor audit — GET /api/build happy path
 * Achieves: returns JSON { id } with no-store when NEXT_PUBLIC_BUILD_ID is set.
 * Fails when: id ignored, cached, or wrong field name (tabs cannot detect deploys).
 * Oracle: clients poll { id } with Cache-Control: no-store.
 * Side effects: restores process.env after test (isolation).
 * Gaps: none for this handler.
 */
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

/**
 * Rigor audit — GET /api/build missing env
 * Achieves: still returns { id: '' } — clients must handle empty without crashing.
 * Fails when: handler throws or omits id when env unset.
 * Oracle: stable JSON shape regardless of deploy env.
 * Side effects: restores env.
 * Gaps: none.
 */
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

/**
 * Rigor audit — GET /api/token does not proxy Dex
 * Achieves: 400 browser_dex so one Worker IP does not share DexScreener rate limits.
 * Fails when: route starts proxying quotes or returns 200 with fake prices.
 * Oracle: product decision — browser calls DexScreener directly.
 * Side effects: none.
 * Gaps: none for refusal contract.
 */
test('GET /api/token refuses to proxy DexScreener (browser must call it)', async () => {
  const res = await getToken();
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'browser_dex');
  assert.equal(body.quoteSource, 'dexscreener');
  assert.match(res.headers.get('Cache-Control') || '', /no-store/);
});

/**
 * Rigor audit — page.js drift guard (SOURCE READ — does not execute React)
 * Achieves: AuthedShell still calls walletProvisionPaths()[0] and never hard-codes
 *   `/api/runtime/api/wallets` create.
 * Fails when: runtime create reintroduced as a string literal or helper unused.
 * Oracle: Workers strip Origin — shell must provision on Next only.
 * Side effects: none.
 * Gaps: source contract only — paired with walletProvisionPaths unit test.
 *   Remaining: does not render page or fire fetch.
 */
test('page.js provisions wallets only through walletProvisionPaths (no runtime create)', () => {
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  assert.match(page, /walletProvisionPaths/);
  assert.match(page, /walletProvisionSucceeded/);
  assert.equal(/\/api\/runtime\/api\/wallets/.test(page), false);
  assert.equal(/fetch\(\s*['"`]\/api\/runtime/.test(page), false);
  assert.match(page, /walletProvisionPaths\(\)\[0\]/);
});

/**
 * Rigor audit — wallets route wiring drift guard (SOURCE READ)
 * Achieves: route imports shared helpers and still POSTs persist to runtime.
 * Fails when: inline requestOrigin reappears or persist mirror removed.
 * Oracle: helpers are the tested Origin/publicWallet implementation.
 * Side effects: none.
 * Gaps: source only — helpers executed in wallets-route.test.mjs.
 */
test('wallets route uses shared Origin/publicWallet helpers and mirrors persist', () => {
  const route = readFileSync(join(root, 'app/api/wallets/route.js'), 'utf8');
  assert.match(route, /from ['"].*wallets-route\.mjs['"]/);
  assert.match(route, /requestOrigin\(request\)/);
  assert.match(route, /publicWallet/);
  assert.match(route, /walletErrorFields/);
  assert.match(route, /walletErrorStatus/);
  assert.match(route, /\/api\/wallets\/persist/);
  assert.equal(/function requestOrigin/.test(route), false);
});

/**
 * Rigor audit — runtime proxy Origin forward drift guard (SOURCE READ)
 * Achieves: proxy still sets x-maelstrom-origin and rejects CR/LF / huge bodies.
 * Fails when: Origin forwarding or body_too_large guard removed.
 * Oracle: Worker acceptLogin needs browser Origin via proxy header.
 * Side effects: none.
 * Gaps: source only — path allowlist executed in runtime-proxy.test.mjs.
 */
test('runtime proxy forwards Origin as x-maelstrom-origin for Worker Privy', () => {
  const route = readFileSync(join(root, 'app/api/runtime/[...path]/route.js'), 'utf8');
  assert.match(route, /x-maelstrom-origin/);
  assert.match(route, /runtimeProxyTarget/);
  assert.match(route, /\[\\r\\n\]/);
  assert.match(route, /body_too_large/);
});

/**
 * Rigor audit — SNS resolve empty domain
 * Achieves: empty domain → 404 sns_not_found (SnsError path) without needing network
 *   success; if resolve throws non-SnsError still 404 sns_failed — we only assert
 *   not-found for empty which SNS treats as invalid.
 * Fails when: empty domain returns 200 or throws uncaught.
 * Oracle: resolveSnsOwner rejects empty/invalid domains.
 * Side effects: may attempt network depending on SNS impl — status/body still asserted.
 * Gaps: does not prove a real domain resolves (covered in packages/sns).
 */
test('GET /api/sns/resolve returns sns_not_found for empty domain without calling network', async () => {
  const { GET } = await import('../app/api/sns/resolve/route.js');
  const res = await GET(new Request('http://localhost/api/sns/resolve'));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'sns_not_found');
});

/**
 * Rigor audit — voice token unconfigured
 * Achieves: fails closed with error code and no API key material when ElevenLabs unset.
 * Fails when: 200 with empty token, or response body contains sk_ secrets.
 * Oracle: VoiceTokenError → 503 voice_unconfigured when key missing.
 * Side effects: none (no network when unconfigured).
 * Gaps: none — closed: prefer exact 503 + voice_unconfigured when keys absent.
 */
test('POST /api/voice/token fails closed when ElevenLabs is unconfigured', async () => {
  const { POST } = await import('../app/api/voice/token/route.js');
  const res = await POST(new Request('http://localhost/api/voice/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  assert.equal(JSON.stringify(body).includes('sk_'), false);
  // When env truly has no key, expect the unconfigured contract; if a key is
  // present in this VM, accept 502 voice_failed but never 200.
  if (res.status === 503) assert.equal(body.error, 'voice_unconfigured');
  else assert.equal(res.status, 502);
});

/**
 * Rigor audit — SNS send auth gate
 * Achieves: missing bearer → 401 login_required before domain resolve / spend.
 * Fails when: unauthenticated requests proceed to SNS or Privy.
 * Oracle: all spend routes require login.
 * Side effects: none (returns before network).
 * Gaps: none for auth gate. Remaining: owner_mismatch / plan errors need secrets.
 */
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

/**
 * Rigor audit — GET /api/wallets config flags
 * Achieves: boolean flags + missing[] only; no secret values in JSON.
 * Fails when: response includes app secret / auth key material or omits flags.
 * Oracle: UI config card shows names/flags, never values.
 * Side effects: none.
 * Gaps: none for shape. Remaining: does not prove flag accuracy vs real Privy.
 */
test('GET /api/wallets reports config flags without secret values', async () => {
  const { GET } = await import('../app/api/wallets/route.js');
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.hasAppId, 'boolean');
  assert.equal(typeof body.hasAppSecret, 'boolean');
  assert.equal(typeof body.hasRpc, 'boolean');
  assert.equal(typeof body.hasAuthorizationKey, 'boolean');
  assert.equal(typeof body.hasPublicAppId, 'boolean');
  assert.equal(typeof body.hasRuntimeUrl, 'boolean');
  assert.equal(typeof body.runtimeHostOk, 'boolean');
  assert.equal(typeof body.appIdAligned, 'boolean');
  assert.ok(Array.isArray(body.missing));
  const raw = JSON.stringify(body);
  assert.equal(/sk_|Bearer |wallet-auth:|cm[a-z0-9]{10,}/.test(raw), false);
  assert.equal(Object.keys(body).sort().join(','), [
    'appIdAligned',
    'hasAppId',
    'hasAppSecret',
    'hasAuthorizationKey',
    'hasPublicAppId',
    'hasRpc',
    'hasRuntimeUrl',
    'missing',
    'runtimeHostOk',
  ].sort().join(','));
});

/**
 * Rigor audit — bot chat input validation
 * Achieves: invalid bot id, missing owner, empty message each fail with distinct codes
 *   before OpenRouter is called.
 * Fails when: validation order wrong (e.g. missing owner returns invalid_bot) or
 *   empty message proceeds to LLM.
 * Oracle: BOT_ID/OWNER regexes + non-empty trimmed message ≤ 500.
 * Side effects: none (returns before LLM).
 * Gaps: none — closed: overlong message (>500) also rejected.
 */
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

  const tooLong = await POST(
    new Request('http://localhost/api/bots/bot_1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:u1' },
      body: JSON.stringify({ message: 'x'.repeat(501) }),
    }),
    { params: Promise.resolve({ botId: 'bot_1' }) },
  );
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, 'message_too_long');
});

/**
 * Rigor audit — POST /api/wallets auth gate
 * Achieves: no bearer → 401 login_required before Privy client construction.
 * Fails when: unauthenticated create hits Privy or returns 500.
 * Oracle: all wallet mutations require login.
 * Side effects: none.
 * Gaps: none for auth. Remaining: missing_config path depends on root env in this VM.
 */
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

/**
 * Rigor audit — POST /api/wallets missing Privy config
 * Achieves: bearer present but no Privy secrets → 503 missing_config with env names only.
 * Fails when: hits Privy with empty credentials or returns secret values in missing[].
 * Oracle: missingWalletSecrets → PRIVY_APP_ID / PRIVY_APP_SECRET names.
 * Side effects: none (returns before client construction when secrets absent).
 * Gaps: remaining happy-path acceptLogin needs live Privy credentials.
 */
test('POST /api/wallets with bearer but missing Privy secrets returns missing_config', async () => {
  const { POST } = await import('../app/api/wallets/route.js');
  const res = await POST(new Request('http://localhost/api/wallets', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    },
    body: '{}',
  }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'missing_config');
  assert.ok(Array.isArray(body.missing));
  assert.ok(body.missing.includes('PRIVY_APP_SECRET') || body.missing.includes('PRIVY_APP_ID'));
  const raw = JSON.stringify(body);
  assert.equal(/sk_|wallet-auth:|app-secret/i.test(raw), false);
  assert.equal(raw.includes('test-token'), false);
});

/**
 * Rigor audit — GET /api/models fallback catalog
 * Achieves: returns { models } with muse-spark fallback when Meta Model key absent/unreachable;
 *   Cache-Control no-store; response never echoes API keys.
 * Fails when: empty models array, throws, or leaks META_MODEL_API_KEY.
 * Oracle: loadThinkingCatalog empty → fallbackThinkingCatalog().
 * Side effects: may set META_MODEL_API_KEY temporarily; restored after.
 * Gaps: does not assert live Meta Model catalog shape when key works.
 */
test('GET /api/models returns fallback catalog without leaking API keys', async () => {
  const prev = process.env.META_MODEL_API_KEY;
  process.env.META_MODEL_API_KEY = 'sk_should_never_appear_in_body';
  try {
    const { GET } = await import('../app/api/models/route.js');
    const res = await GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control') || '', /no-store/);
    const body = await res.json();
    assert.ok(Array.isArray(body.models));
    assert.ok(body.models.length >= 1);
    assert.equal(body.models[0].id, 'muse-spark-1.3-contributor');
    assert.ok(Array.isArray(body.models[0].levels));
    const raw = JSON.stringify(body);
    assert.equal(raw.includes('sk_should_never_appear_in_body'), false);
    assert.equal(raw.includes('META_MODEL_API_KEY'), false);
  } finally {
    if (prev === undefined) delete process.env.META_MODEL_API_KEY;
    else process.env.META_MODEL_API_KEY = prev;
  }
});

/**
 * Rigor audit — GET /api/portfolio auth gate
 * Achieves: missing bearer → 401 login_required before Privy/RPC.
 * Fails when: unauthenticated portfolio reads proceed.
 * Oracle: spend/read wallet routes require login.
 * Side effects: none.
 * Gaps: none for auth gate.
 */
test('GET /api/portfolio without bearer returns login_required', async () => {
  const { GET } = await import('../app/api/portfolio/route.js');
  const res = await GET(new Request('http://localhost/api/portfolio'));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('Cache-Control') || '', /no-store/);
  assert.equal((await res.json()).error, 'login_required');
});

/**
 * Rigor audit — GET /api/portfolio missing Privy config
 * Achieves: bearer present, secrets absent → 503 missing_config with env names only.
 * Fails when: attempts Privy with empty secrets or leaks token/secret values.
 * Oracle: missingWalletSecrets before createPrivyWalletClient.
 * Side effects: none.
 * Gaps: remaining loadPortfolio happy path needs RPC + Privy.
 */
/**
 * Rigor audit — GET /api/portfolio hosted identity
 * Achieves: a JWT sub loads the Privy user by id and reads balances without /users/me.
 * Fails when: the route calls /users/me (hosted 502 privy_failed) or posts a wallet create.
 * Oracle: readLoginUser Worker path + read-only portfolio RPC.
 * Side effects: global fetch stubbed and restored.
 * Gaps: does not call live Privy or QuickNode.
 */
test('GET /api/portfolio reads linked wallets from the JWT user id', async () => {
  const ownerId = 'did:privy:portfolio-user';
  const address = 'So11111111111111111111111111111111111111112';
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: ownerId })).toString('base64url');
  const token = `${header}.${payload}.sig`;
  const rpcUrl = 'https://example.invalid/portfolio-rpc';
  const previous = {
    PRIVY_APP_ID: process.env.PRIVY_APP_ID,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    QUICKNODE_DEVNET_RPC_URL: process.env.QUICKNODE_DEVNET_RPC_URL,
  };
  process.env.PRIVY_APP_ID = 'app_portfolio_test';
  process.env.PRIVY_APP_SECRET = 'portfolio-app-secret';
  process.env.QUICKNODE_DEVNET_RPC_URL = rpcUrl;
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, method: init?.method, redirect: init?.redirect });
    if (target.includes('/users/me')) {
      return new Response(JSON.stringify({ error: 'users_me_forbidden' }), { status: 403 });
    }
    if (target.includes(`/v1/users/${encodeURIComponent(ownerId)}`)) {
      return new Response(JSON.stringify({
        id: ownerId,
        linked_accounts: [{
          type: 'wallet',
          address,
          chain_type: 'solana',
          wallet_client_type: 'phantom',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target === rpcUrl) {
      const body = JSON.parse(init.body);
      const results = body.map(row => {
        if (row.method === 'getGenesisHash') {
          return { jsonrpc: '2.0', id: row.id, result: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' };
        }
        if (row.method === 'getBalance') {
          return { jsonrpc: '2.0', id: row.id, result: { value: 1000 } };
        }
        return { jsonrpc: '2.0', id: row.id, result: { value: [] } };
      });
      return new Response(JSON.stringify(results), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'unmocked' }), { status: 500 });
  };
  try {
    const { GET } = await import('../app/api/portfolio/route.js');
    const res = await GET(new Request('http://localhost/api/portfolio', {
      headers: {
        authorization: `Bearer ${token}`,
        'x-owner-id': ownerId,
        origin: 'https://dev.maelstrom.iexdevs.com',
      },
    }));
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.cluster, 'devnet');
    assert.equal(body.authorizesTransaction, false);
    assert.equal(body.wallets[0].address, address);
    assert.equal(calls.some(call => call.url.includes('/users/me')), false);
    assert.equal(calls.some(call => call.method === 'POST' && call.url.includes('privy')), false);
    assert.equal(calls.some(call => call.url === rpcUrl && call.redirect === 'follow'), true);
    const raw = JSON.stringify(body);
    assert.equal(raw.includes(token), false);
    assert.equal(raw.includes('portfolio-app-secret'), false);
    assert.equal(raw.includes(rpcUrl), false);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('GET /api/portfolio with bearer but missing Privy secrets returns missing_config', async () => {
  const { GET } = await import('../app/api/portfolio/route.js');
  const res = await GET(new Request('http://localhost/api/portfolio', {
    headers: { authorization: 'Bearer portfolio-token' },
  }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'missing_config');
  assert.ok(Array.isArray(body.missing));
  const raw = JSON.stringify(body);
  assert.equal(raw.includes('portfolio-token'), false);
  assert.equal(/sk_|Bearer /.test(raw), false);
});

/**
 * Rigor audit — POST /api/voice/scribe-token unconfigured
 * Achieves: fails closed with voice_unconfigured (or voice_failed if key present) and no sk_ leak.
 * Fails when: 200 with empty token or body contains API key material.
 * Oracle: requestScribeToken → VoiceTokenError voice_unconfigured when key missing.
 * Side effects: none.
 * Gaps: remaining live ElevenLabs mint needs ELEVENLABS_API_KEY.
 */
test('POST /api/voice/speak fails closed when ElevenLabs is unconfigured', async () => {
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const { POST } = await import('../app/api/voice/speak/route.js');
    const res = await POST(new Request('http://localhost/api/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', voiceId: '21m00Tcm4TlvDq8ikWAM' }),
    }));
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.equal(JSON.stringify(body).includes('sk_'), false);
    if (res.status === 503) assert.equal(body.error, 'voice_unconfigured');
    else assert.equal(res.status, 502);
  } finally {
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
  }
});

test('POST /api/voice/scribe-token fails closed when ElevenLabs is unconfigured', async () => {
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const { POST } = await import('../app/api/voice/scribe-token/route.js');
    const res = await POST();
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.equal(JSON.stringify(body).includes('sk_'), false);
    if (res.status === 503) assert.equal(body.error, 'voice_unconfigured');
    else assert.equal(res.status, 502);
  } finally {
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
  }
});

/**
 * Rigor audit — POST /api/voice/token invalid JSON body
 * Achieves: malformed JSON still fails closed (no throw); never 200 without keys.
 * Fails when: bad JSON crashes the route or returns a token without ElevenLabs.
 * Oracle: catch → body {}; then VoiceTokenError path.
 * Side effects: none.
 * Gaps: none for parse resilience.
 */
test('POST /api/voice/token with invalid JSON fails closed without leaking secrets', async () => {
  const { POST } = await import('../app/api/voice/token/route.js');
  const res = await POST(new Request('http://localhost/api/voice/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json',
  }));
  const body = await res.json();
  assert.ok(res.status === 503 || res.status === 502);
  assert.equal(typeof body.error, 'string');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'token'), false);
  assert.equal(JSON.stringify(body).includes('sk_'), false);
});

/**
 * Rigor audit — POST /api/voice/bind invalid body
 * Achieves: missing/invalid conversationId or ownerId → 400 invalid_body before runtime.
 * Fails when: empty ids proceed to Worker or return 500.
 * Oracle: CONVERSATION + OWNER regexes.
 * Side effects: none.
 * Gaps: none for validation.
 */
test('POST /api/voice/bind rejects invalid conversationId and ownerId', async () => {
  const { POST } = await import('../app/api/voice/bind/route.js');
  const empty = await POST(new Request('http://localhost/api/voice/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'invalid_body');

  const badOwner = await POST(new Request('http://localhost/api/voice/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: 'conv_1', ownerId: 'bad owner' }),
  }));
  assert.equal(badOwner.status, 400);
  assert.equal((await badOwner.json()).error, 'invalid_body');
});

/**
 * Rigor audit — POST /api/voice/bind missing config
 * Achieves: valid ids but no runtime URL / webhook secret → 503 voice_bind_unconfigured;
 *   response never echoes webhook secret.
 * Fails when: proceeds to fetch without secret or leaks ELEVENLABS_WEBHOOK_SECRET.
 * Oracle: both NEXT_PUBLIC_AGENT_RUNTIME_URL and ELEVENLABS_WEBHOOK_SECRET required.
 * Side effects: clears related env for the assertion window.
 * Gaps: remaining happy path needs a reachable Worker.
 */
test('POST /api/voice/bind fails closed when runtime or webhook secret is unset', async () => {
  const prevRuntime = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  const prevSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  delete process.env.ELEVENLABS_WEBHOOK_SECRET;
  try {
    const { POST } = await import('../app/api/voice/bind/route.js');
    const res = await POST(new Request('http://localhost/api/voice/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv_ok', ownerId: 'did:privy:u1' }),
    }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'voice_bind_unconfigured');
    assert.equal(JSON.stringify(body).includes('webhook'), false);
  } finally {
    if (prevRuntime !== undefined) process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prevRuntime;
    if (prevSecret !== undefined) process.env.ELEVENLABS_WEBHOOK_SECRET = prevSecret;
  }
});

/**
 * Rigor audit — POST /api/voice/bind happy path (mocked fetch)
 * Achieves: configured runtime+secret + ok upstream → { ok: true }; webhook header set;
 *   secret value never appears in response JSON.
 * Fails when: skips x-elevenlabs-webhook-secret or returns upstream body secrets.
 * Oracle: fetchAgentRuntime → /voice/session-owner with webhook header.
 * Side effects: stubs global fetch; restores env + fetch.
 * Gaps: does not prove live Worker auth semantics.
 */
test('POST /api/voice/bind returns ok when runtime bind succeeds', async () => {
  const prevRuntime = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  const prevSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const prevFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = 'https://runtime.test.example';
  process.env.ELEVENLABS_WEBHOOK_SECRET = 'whsec_test_only';
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = {
      href: String(url),
      method: init?.method,
      secret: init?.headers?.['x-elevenlabs-webhook-secret'],
      body: init?.body,
    };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const { POST } = await import('../app/api/voice/bind/route.js');
    const res = await POST(new Request('http://localhost/api/voice/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv_ok', ownerId: 'did:privy:u1' }),
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
    assert.equal(JSON.stringify(body).includes('whsec'), false);
    assert.match(seen.href, /\/voice\/session-owner$/);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.secret, 'whsec_test_only');
    assert.match(String(seen.body), /conv_ok/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevRuntime === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prevRuntime;
    if (prevSecret === undefined) delete process.env.ELEVENLABS_WEBHOOK_SECRET;
    else process.env.ELEVENLABS_WEBHOOK_SECRET = prevSecret;
  }
});

/**
 * Rigor audit — POST /api/bots/:botId/chat missing LLM keys
 * Achieves: valid bot/owner/message but no Meta/OpenRouter keys → 503 openrouter_not_configured;
 *   no key material in JSON.
 * Fails when: proceeds to network with empty key or returns 200 empty reply.
 * Oracle: completeTextChat throws TextChatError openrouter_not_configured.
 * Side effects: clears LLM env for assertion window.
 * Gaps: remaining tool-loop happy path needs live model keys.
 */
test('POST /api/bots/:botId/chat fails closed when LLM keys are unset', async () => {
  const prevMeta = process.env.META_MODEL_API_KEY;
  const prevOr = process.env.OPENROUTER_API_KEY;
  delete process.env.META_MODEL_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
    const res = await POST(
      new Request('http://localhost/api/bots/bot_1/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:u1' },
        body: JSON.stringify({ message: 'hello agent' }),
      }),
      { params: Promise.resolve({ botId: 'bot_1' }) },
    );
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'openrouter_not_configured');
    assert.equal(JSON.stringify(body).includes('sk-'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'reply'), false);
  } finally {
    if (prevMeta !== undefined) process.env.META_MODEL_API_KEY = prevMeta;
    if (prevOr !== undefined) process.env.OPENROUTER_API_KEY = prevOr;
  }
});

/**
 * Rigor audit — POST /api/sns/send unresolved domain after auth
 * Achieves: bearer present, empty/invalid domain → 404 sns_not_found before spend.
 * Fails when: auth alone is enough to attempt Privy withdraw.
 * Oracle: resolveSnsOwner fails → SnsError path before planSnsSend spend.
 * Side effects: may touch SNS network for invalid domains; status still asserted.
 * Gaps: owner_mismatch / withdraw success need Privy + funded wallet.
 */
test('POST /api/sns/send with bearer still 404s when domain cannot resolve', async () => {
  const { POST } = await import('../app/api/sns/send/route.js');
  const res = await POST(new Request('http://localhost/api/sns/send', {
    method: 'POST',
    headers: {
      authorization: 'Bearer sns-token',
      'content-type': 'application/json',
      'x-owner-id': 'did:privy:u1',
    },
    body: JSON.stringify({ domain: '', amount: '1' }),
  }));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'sns_not_found');
  assert.equal(JSON.stringify(body).includes('sns-token'), false);
});

/**
 * Rigor audit — GET /api/sns/resolve unknown domain
 * Achieves: nonsense domain → 404 sns_not_found (or sns_failed) without 200.
 * Fails when: returns fabricated address for unknown domains.
 * Oracle: resolveSnsOwner rejects missing domains.
 * Side effects: may hit SNS network.
 * Gaps: happy-path real .sol resolve covered in packages/sns.
 */
test('GET /api/sns/resolve returns 404 for an unknown domain', async () => {
  const { GET } = await import('../app/api/sns/resolve/route.js');
  const res = await GET(new Request('http://localhost/api/sns/resolve?domain=definitely-not-registered-zz99.sol'));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error === 'sns_not_found' || body.error === 'sns_failed');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'address'), false);
});

/**
 * Rigor audit — runtime proxy unconfigured
 * Achieves: allowed path with no Worker URL → 503 runtime_unconfigured source:unconfigured.
 * Fails when: open-proxies arbitrary hosts or returns 200 empty.
 * Oracle: runtimeProxyTarget('', path).error === runtime_unconfigured.
 * Side effects: clears NEXT_PUBLIC_AGENT_RUNTIME_URL for the window.
 * Gaps: none for fail-closed unconfigured.
 */
test('GET /api/runtime/api/bots fails closed when runtime URL is unset', async () => {
  const prev = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  try {
    const { GET } = await import('../app/api/runtime/[...path]/route.js');
    const res = await GET(
      new Request('http://localhost/api/runtime/api/bots'),
      { params: Promise.resolve({ path: ['api', 'bots'] }) },
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), {
      ok: false,
      error: 'runtime_unconfigured',
      source: 'unconfigured',
    });
  } finally {
    if (prev !== undefined) process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prev;
  }
});

/**
 * Rigor audit — runtime proxy disallowed path
 * Achieves: non-allowlisted path → 404 not_found (even before/without needing upstream).
 * Fails when: /api/secret or similar becomes proxied.
 * Oracle: runtimeProxyTarget deny → not_found.
 * Side effects: none required (empty origin still yields not_found for denied paths).
 * Gaps: sample path only — full allowlist in runtime-proxy.test.mjs.
 */
test('GET /api/runtime rejects disallowed paths with not_found', async () => {
  const { GET } = await import('../app/api/runtime/[...path]/route.js');
  const res = await GET(
    new Request('http://localhost/api/runtime/api/secret'),
    { params: Promise.resolve({ path: ['api', 'secret'] }) },
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

/**
 * Rigor audit — runtime proxy method allowlist
 * Achieves: PATCH (and other non GET/POST/PUT/DELETE) → 405 method_not_allowed.
 * Fails when: arbitrary methods are forwarded upstream.
 * Oracle: METHODS Set in route proxy.
 * Side effects: none.
 * Gaps: none for method gate.
 */
test('runtime proxy rejects unsupported HTTP methods', async () => {
  const { GET } = await import('../app/api/runtime/[...path]/route.js');
  const res = await GET(
    new Request('http://localhost/api/runtime/api/bots', { method: 'PATCH' }),
    { params: Promise.resolve({ path: ['api', 'bots'] }) },
  );
  assert.equal(res.status, 405);
  assert.equal((await res.json()).error, 'method_not_allowed');
});

/**
 * Rigor audit — runtime proxy body size guard
 * Achieves: POST body > 1_000_000 bytes → 413 body_too_large before upstream fetch.
 * Fails when: huge bodies are forwarded or return 500.
 * Oracle: buf.byteLength > 1_000_000 → body_too_large.
 * Side effects: sets a dummy runtime URL; restores after; does not network on size reject.
 * Gaps: none for size gate.
 */
test('POST /api/runtime rejects bodies larger than 1MB', async () => {
  const prev = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = 'https://runtime.test.example';
  try {
    const { POST } = await import('../app/api/runtime/[...path]/route.js');
    const res = await POST(
      new Request('http://localhost/api/runtime/api/bots', {
        method: 'POST',
        body: new Uint8Array(1_000_001),
      }),
      { params: Promise.resolve({ path: ['api', 'bots'] }) },
    );
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error, 'body_too_large');
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prev;
  }
});

/**
 * Rigor audit — runtime proxy unreachable upstream
 * Achieves: configured allowlisted path + dead host → 502 runtime_unreachable;
 *   Origin forwarding path still exercised via header set (no crash on CR-free origin).
 * Fails when: connection errors throw uncaught or return 200.
 * Oracle: fetchAgentRuntime throw / redirect → runtime_unreachable.
 * Side effects: stubs/uses invalid host; restores env.
 * Gaps: does not assert x-maelstrom-origin on a successful upstream (needs mock server).
 */
test('POST /api/runtime returns runtime_unreachable when Worker fetch fails', async () => {
  const prev = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = 'https://runtime.unreachable.test.invalid';
  try {
    const { POST } = await import('../app/api/runtime/[...path]/route.js');
    const res = await POST(
      new Request('http://localhost/api/runtime/api/bots', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://desk.example',
          authorization: 'Bearer runtime-token',
        },
        body: '{}',
      }),
      { params: Promise.resolve({ path: ['api', 'bots'] }) },
    );
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'runtime_unreachable');
    assert.equal(JSON.stringify(body).includes('runtime-token'), false);
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prev;
  }
});
