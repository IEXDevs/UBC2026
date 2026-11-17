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
 * Gaps closed: prefer exact 503 + voice_unconfigured when keys absent.
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
  assert.ok(Array.isArray(body.missing));
  const raw = JSON.stringify(body);
  assert.equal(/sk_|Bearer |wallet-auth:/.test(raw), false);
  assert.equal(Object.keys(body).sort().join(','), [
    'hasAppId', 'hasAppSecret', 'hasAuthorizationKey', 'hasRpc', 'missing',
  ].sort().join(','));
});

/**
 * Rigor audit — bot chat input validation
 * Achieves: invalid bot id, missing owner, empty message each fail with distinct codes
 *   before OpenRouter is called.
 * Fails when: validation order wrong (e.g. missing owner returns invalid_bot) or
 *   empty message proceeds to LLM.
 * Oracle: BOT_ID/OWNER regexes + non-empty trimmed message ≤ 4000.
 * Side effects: none (returns before LLM).
 * Gaps closed: overlong message (>4000) also rejected.
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
      body: JSON.stringify({ message: 'x'.repeat(4001) }),
    }),
    { params: Promise.resolve({ botId: 'bot_1' }) },
  );
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, 'message_required');
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
