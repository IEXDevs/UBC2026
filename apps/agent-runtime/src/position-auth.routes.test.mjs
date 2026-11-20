/**
 * Rigor audit — Worker edge ownership gate for bot status / positions.list
 * Achieves: GET /bots/:id/status without x-owner-id is 401; wrong owner against
 *   Supabase bots table is 404; matching owner reaches the DO; /api/positions
 *   requires owner and never returns another owner's rows from the mock.
 * Fails when: status stays auth:none at the edge, or botId query alone bypasses owner_id.
 * Oracle: assertBotOwner + resolveOwner; service-role reads always include owner_id eq filter.
 * Side effects: mocked fetch / BOT stub only.
 * Gaps: hosted Supabase JWT RLS is in supabase/paper-positions.test.mjs (PGlite).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './owner-auth.fixture.mjs';

function envWithBots(rows, extras = {}) {
  const stubStore = new Map();
  return {
    CLUSTER: 'devnet',
    PRODUCT: 'Maelstrom',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    BOT: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/status') {
            const owner = request.headers.get('x-owner-id');
            return Response.json({
              ok: true,
              meta: { botId: id, ownerId: owner },
              positionCheck: { botId: id, flag: 'within-cap', positions: [] },
            });
          }
          return Response.json({ ok: true });
        },
      }),
    },
    fetch: async (url) => {
      const target = String(url);
      if (target.includes('/rest/v1/bots?')) {
        const ownerMatch = /owner_id=eq\.([^&]+)/.exec(target);
        const idMatch = /id=eq\.([^&]+)/.exec(target);
        const owner = ownerMatch ? decodeURIComponent(ownerMatch[1]) : null;
        const botId = idMatch ? decodeURIComponent(idMatch[1]) : null;
        const hit = rows.filter(row => row.id === botId && row.owner_id === owner);
        return new Response(JSON.stringify(hit), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.includes('/rest/v1/paper_positions?')) {
        assert.match(target, /owner_id=eq\./);
        const ownerMatch = /owner_id=eq\.([^&]+)/.exec(target);
        const owner = decodeURIComponent(ownerMatch[1]);
        const items = (extras.positions || []).filter(row => row.owner_id === owner);
        return new Response(JSON.stringify(items), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.includes('/rest/v1/position_checks?')) {
        assert.match(target, /owner_id=eq\./);
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    ...extras,
    _stubStore: stubStore,
  };
}

test('GET /bots/:id/status requires owner and hides foreign bots', async () => {
  const env = envWithBots([
    { id: 'bot_alice', owner_id: 'alice' },
    { id: 'bot_bob', owner_id: 'bob' },
  ]);

  const anon = await worker.fetch(new Request('https://runtime/bots/bot_alice/status'), env);
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).error, 'owner_required');

  const cross = await worker.fetch(new Request('https://runtime/bots/bot_bob/status', {
    headers: { 'x-owner-id': 'alice' },
  }), env);
  assert.equal(cross.status, 404);
  const crossBody = await cross.json();
  assert.equal(crossBody.error, 'bot_not_found');
  assert.equal(crossBody.positionCheck, undefined);

  const ok = await worker.fetch(new Request('https://runtime/bots/bot_alice/status', {
    headers: { 'x-owner-id': 'alice' },
  }), env);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.positionCheck.flag, 'within-cap');
  assert.equal(body.meta.ownerId, 'alice');
});

test('browser sessions distinguish directory failures from an unowned bot', async () => {
  const request = new Request('https://runtime/bots/bot_alice/browser/sessions', {
    headers: { 'x-owner-id': 'alice' },
  });
  const directoryDown = envWithBots([], {
    fetch: async () => Response.json({ code: 'PGRST002' }, { status: 503 }),
    BOT: { idFromName: () => assert.fail('unverified owner reached the browser') },
  });
  const unavailable = await worker.fetch(request.clone(), directoryDown);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error, 'bot_directory_unavailable');

  const missing = await worker.fetch(request, envWithBots([{ id: 'bot_alice', owner_id: 'bob' }]));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'bot_not_found');
});

test('GET /api/positions scopes by verified owner even when botId is attacker-controlled', async () => {
  const env = envWithBots(
    [{ id: 'bot_alice', owner_id: 'alice' }, { id: 'bot_bob', owner_id: 'bob' }],
    {
      positions: [
        { id: 'pos:a', owner_id: 'alice', bot_id: 'bot_alice', mint: 'So11111111111111111111111111111111111111112', quantity: '1', entry_micro_usdc: '1', realized_micro_usdc: '0', status: 'open', mode: 'paper', cluster: 'devnet', updated_at: 1 },
        { id: 'pos:b', owner_id: 'bob', bot_id: 'bot_bob', mint: 'So11111111111111111111111111111111111111112', quantity: '9', entry_micro_usdc: '9', realized_micro_usdc: '0', status: 'open', mode: 'paper', cluster: 'devnet', updated_at: 1 },
      ],
    },
  );

  const denied = await worker.fetch(new Request('https://runtime/api/positions'), env);
  assert.equal(denied.status, 401);

  const listed = await worker.fetch(new Request('https://runtime/api/positions?botId=bot_bob', {
    headers: { 'x-owner-id': 'alice' },
  }), env);
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.equal(body.items.every(row => row.ownerId === 'alice'), true);
  assert.equal(body.items.some(row => row.ownerId === 'bob'), false);
});

/**
 * Rigor audit — spoofed x-owner-id rejected when Privy secrets exist
 * Achieves: with PRIVY_APP_ID/SECRET set, status/positions require a bearer; a
 *   bare victim owner header alone cannot read positionCheck.
 * Fails when: header-only IDOR still works once Privy is configured.
 * Oracle: resolveOwner returns login_required without Bearer when secrets present.
 * Side effects: none (no Privy network — client construction fails closed to login_required).
 * Gaps: does not mint a real Privy JWT; success path covered by wallets Privy tests.
 */
test('status rejects spoofed x-owner-id when Privy secrets are configured', async () => {
  const env = envWithBots(
    [{ id: 'bot_alice', owner_id: 'alice' }],
    {
      PRIVY_APP_ID: 'app_test',
      PRIVY_APP_SECRET: 'secret_test',
    },
  );
  const spoof = await worker.fetch(new Request('https://runtime/bots/bot_alice/status', {
    headers: { 'x-owner-id': 'alice' },
  }), env);
  assert.equal(spoof.status, 401);
  assert.equal((await spoof.json()).error, 'login_required');
});

test('/api/positions rejects spoofed x-owner-id when Privy secrets are configured', async () => {
  const env = envWithBots(
    [{ id: 'bot_alice', owner_id: 'alice' }],
    {
      PRIVY_APP_ID: 'app_test',
      PRIVY_APP_SECRET: 'secret_test',
      positions: [
        { id: 'pos:a', owner_id: 'alice', bot_id: 'bot_alice', mint: 'So11111111111111111111111111111111111111112', quantity: '1', entry_micro_usdc: '1', realized_micro_usdc: '0', status: 'open', mode: 'paper', cluster: 'devnet', updated_at: 1 },
      ],
    },
  );
  const spoof = await worker.fetch(new Request('https://runtime/api/positions', {
    headers: { 'x-owner-id': 'alice' },
  }), env);
  assert.equal(spoof.status, 401);
  assert.equal((await spoof.json()).error, 'login_required');
});

test('alice and bob each list only their own positions when authorized', async () => {
  const env = envWithBots(
    [{ id: 'bot_alice', owner_id: 'alice' }, { id: 'bot_bob', owner_id: 'bob' }],
    {
      positions: [
        { id: 'pos:a', owner_id: 'alice', bot_id: 'bot_alice', mint: 'So11111111111111111111111111111111111111112', quantity: '1', entry_micro_usdc: '1', realized_micro_usdc: '0', status: 'open', mode: 'paper', cluster: 'devnet', updated_at: 1 },
        { id: 'pos:b', owner_id: 'bob', bot_id: 'bot_bob', mint: 'So11111111111111111111111111111111111111112', quantity: '9', entry_micro_usdc: '9', realized_micro_usdc: '0', status: 'open', mode: 'paper', cluster: 'devnet', updated_at: 1 },
      ],
    },
  );
  const alice = await worker.fetch(new Request('https://runtime/api/positions', {
    headers: { 'x-owner-id': 'alice' },
  }), env);
  assert.equal(alice.status, 200);
  const aliceBody = await alice.json();
  assert.deepEqual(aliceBody.items.map(row => row.id), ['pos:a']);

  const bob = await worker.fetch(new Request('https://runtime/api/positions', {
    headers: { 'x-owner-id': 'bob' },
  }), env);
  assert.equal(bob.status, 200);
  const bobBody = await bob.json();
  assert.deepEqual(bobBody.items.map(row => row.id), ['pos:b']);
});

test('wake/pause/loop require owner and strip smuggled internal position headers', async () => {
  const seen = [];
  const env = envWithBots(
    [{ id: 'bot_alice', owner_id: 'alice' }, { id: 'bot_bob', owner_id: 'bob' }],
    {
      BOT: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (request) => {
            seen.push({
              id,
              path: new URL(request.url).pathname,
              owner: request.headers.get('x-owner-id'),
              internal: request.headers.get('x-maelstrom-internal'),
            });
            return Response.json({ ok: true, forwarded: new URL(request.url).pathname });
          },
        }),
      },
    },
  );

  const anonPause = await worker.fetch(new Request('https://runtime/bots/bot_alice/pause', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(anonPause.status, 401);

  const crossWake = await worker.fetch(new Request('https://runtime/bots/bot_bob/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'alice' },
    body: JSON.stringify({ botId: 'bot_bob', goal: 'steal' }),
  }), env);
  assert.equal(crossWake.status, 404);
  assert.equal((await crossWake.json()).run, undefined);

  const ok = await worker.fetch(new Request('https://runtime/bots/bot_alice/pause', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-owner-id': 'alice',
      'x-maelstrom-internal': 'position-check',
    },
    body: '{}',
  }), env);
  assert.equal(ok.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/pause');
  assert.equal(seen[0].owner, 'alice');
  assert.equal(seen[0].internal, null);
});
