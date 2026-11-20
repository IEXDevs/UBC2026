import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import worker from './index.mjs';
import { enrichEnv } from './runtime-env.mjs';
import { mapBotRow, mapWalletRow, mapLedgerRow } from './supabase-rest.mjs';
import { sha256Hex } from './desk-grant.mjs';

function fakeEnv(extra = {}) {
  return {
    PRODUCT: 'Maelstrom',
    CLUSTER: 'devnet',
    BOT: {
      idFromName: name => name,
      get: () => ({
        fetch: async request => Response.json({ forwarded: new URL(request.url).pathname }),
      }),
    },
    ...extra,
  };
}

/**
 * Achieves: enrichEnv returns the same object on re-entry and preserves injected transferClient/loadLoopContext.
 * Fails when: second enrichEnv allocates a new env, or injectables are overwritten/dropped.
 * Oracle: identity equality once===twice; reference equality for transferClient and loadLoopContext.
 * Side effects / state checked: N/A (pure enrich).
 * Gaps: none
 */
test('enrichEnv is idempotent and leaves injectables alone', () => {
  const transferClient = { signAndBroadcastDevnet: async () => ({}) };
  const loadLoopContext = async () => ({});
  const once = enrichEnv(fakeEnv({ transferClient, loadLoopContext }));
  const twice = enrichEnv(once);
  assert.equal(once, twice);
  assert.equal(once.transferClient, transferClient);
  assert.equal(once.loadLoopContext, loadLoopContext);
});

/**
 * Achieves: metrics without x-owner-id is 401; with owner and no Supabase returns empty unconfigured items (not stubs).
 * Fails when: ownerless call succeeds, or unconfigured path invents stub data / non-empty items.
 * Oracle: 401 then 200 with source='unconfigured', items=[], stub undefined.
 * Side effects / state checked: N/A (no Supabase write).
 * Gaps: none for metrics auth; other data routes covered elsewhere
 */
test('data routes require an owner and stay empty without Supabase', async () => {
  const env = fakeEnv();
  const denied = await worker.fetch(new Request('https://runtime/api/metrics'), env);
  assert.equal(denied.status, 401);

  const empty = await worker.fetch(new Request('https://runtime/api/metrics', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(empty.status, 200);
  const body = await empty.json();
  assert.equal(body.source, 'unconfigured');
  assert.deepEqual(body.items, []);
  assert.equal(body.stub, undefined);
});

/**
 * Achieves: POST /api/wallets with bearer but no Privy/transferClient returns 503 signer_not_configured.
 * Fails when: missing signer returns 200/401 or a different error code.
 * Oracle: status 503 and error==='signer_not_configured'.
 * Side effects / state checked: N/A (no Privy/Supabase calls).
 * Gaps: none for this path; missing-bearer covered in sibling test
 */
test('wallet create reports signer_not_configured without Privy secrets', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    method: 'POST',
    headers: { authorization: 'Bearer tok_1', 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'signer_not_configured');
});

/**
 * Achieves: POST /api/wallets without Authorization returns login_required before touching Privy.
 * Fails when: missing bearer is treated as signer_not_configured, or acceptLogin is invoked.
 * Oracle: 401 + error login_required; transferClient.acceptLogin throws if called (must not).
 * Side effects / state checked: acceptLogin must not run (enforced by throwing mock).
 * Gaps: none
 */
test('wallet create requires bearer and returns login_required without it', async () => {
  const env = fakeEnv({
    transferClient: {
      acceptLogin: async () => {
        throw new Error('should not call Privy without a bearer');
      },
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    method: 'POST',
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'login_required');
});

/**
 * Achieves: persist upserts wallet rows via Supabase and never calls Privy acceptLogin.
 * Fails when: acceptLogin is invoked, wrote!=1, or no POST to /rest/v1/wallets.
 * Oracle: 200 ok/wrote=1/wallets[0].id; acceptCalls===0; wallet POST observed.
 * Side effects / state checked: Supabase write POST recorded; Privy call count.
 * Gaps: none for happy path; idempotent/malformed covered in sibling tests
 */
test('wallets.persist writes rows without calling Privy acceptLogin', async () => {
  const writes = [];
  let acceptCalls = 0;
  const env = fakeEnv({
    transferClient: {
      acceptLogin: async () => {
        acceptCalls += 1;
        throw new Error('should not call Privy');
      },
    },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url, init = {}) => {
      const href = String(url);
      writes.push({ href, method: init.method || 'GET', body: init.body });
      if (href.includes('/rest/v1/wallets?') && (!init.method || init.method === 'GET')) {
        return Response.json([{
          id: 'w1',
          owner_id: 'user_1',
          kind: 'main',
          label: 'Main',
          address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          provider: 'privy',
          frozen: false,
        }]);
      }
      return new Response(null, { status: 201 });
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'x-owner-id': 'user_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      wallets: [{
        id: 'w1',
        ownerId: 'user_1',
        kind: 'main',
        label: 'Main',
        address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        provider: 'privy',
        frozen: false,
      }],
    }),
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.wrote, 1);
  assert.equal(body.wallets[0].id, 'w1');
  assert.equal(acceptCalls, 0);
  assert.equal(writes.some((entry) => entry.href.includes('/rest/v1/wallets') && entry.method === 'POST'), true);
});

/**
 * Achieves: a second identical persist POST succeeds again using merge-duplicates Prefer.
 * Fails when: second POST 4xx/5xx, Prefer omits merge-duplicates, or only one write occurs when two are sent.
 * Oracle: both responses 200 with wrote=1; two wallet POSTs each Prefer includes merge-duplicates.
 * Side effects / state checked: two Supabase wallet POSTs with same id.
 * Gaps: none — concurrency of parallel POSTs not asserted
 */
test('wallets.persist is idempotent on a duplicate second POST', async () => {
  const walletPosts = [];
  const wallet = {
    id: 'w1',
    ownerId: 'user_1',
    kind: 'main',
    label: 'Main',
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    provider: 'privy',
    frozen: false,
  };
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/rest/v1/wallets') && init.method === 'POST') {
        walletPosts.push({
          prefer: init.headers?.Prefer || init.headers?.prefer || '',
          body: JSON.parse(init.body),
        });
        return new Response(null, { status: 201 });
      }
      if (href.includes('/rest/v1/wallets?') && (!init.method || init.method === 'GET')) {
        return Response.json([{
          id: 'w1',
          owner_id: 'user_1',
          kind: 'main',
          label: 'Main',
          address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          provider: 'privy',
          frozen: false,
        }]);
      }
      return new Response(null, { status: 201 });
    },
  });
  const headers = {
    authorization: 'Bearer tok_1',
    'x-owner-id': 'user_1',
    'content-type': 'application/json',
  };
  const body = JSON.stringify({ wallets: [wallet] });
  const first = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers,
    body,
  }), env);
  const second = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers,
    body,
  }), env);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).wrote, 1);
  assert.equal((await second.json()).wrote, 1);
  assert.equal(walletPosts.length, 2);
  assert.ok(walletPosts.every((entry) => String(entry.prefer).includes('merge-duplicates')));
  assert.equal(walletPosts[0].body[0]?.id || walletPosts[0].body.id, 'w1');
  assert.equal(walletPosts[1].body[0]?.id || walletPosts[1].body.id, 'w1');
});

/**
 * Achieves: non-JSON body yields invalid_wallets and does not write wallets.
 * Fails when: malformed body returns 200 or still POSTs wallet rows.
 * Oracle: 400 + invalid_wallets; wrote flag stays false.
 * Side effects / state checked: no Supabase wallet POST.
 * Gaps: none
 */
test('wallets.persist rejects malformed JSON body', async () => {
  let wrote = false;
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url, init = {}) => {
      if (String(url).includes('/rest/v1/wallets') && init.method === 'POST') {
        wrote = true;
      }
      return new Response(null, { status: 201 });
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'x-owner-id': 'user_1',
      'content-type': 'application/json',
    },
    body: '{not-json',
  }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_wallets');
  assert.equal(wrote, false);
});

/**
 * Achieves: list enriches wallet with USDC/SOL/token balances from configured RPC without leaking RPC URL.
 * Fails when: usdcBalance wrong, balanceStatus not ok, or response includes example.invalid.
 * Oracle: usdcBalance '1234500', label '1.2345 USDC', solLamports '0', balances.onchainUsdc match; no RPC host in JSON.
 * Side effects / state checked: RPC getGenesisHash/getBalance/getTokenAccountsByOwner mocked.
 * Gaps: RPC failure path not covered here
 */
test('wallets.list attaches usdcBalance from QuickNode when configured', async () => {
  const { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } = await import('@ubc2026/wallets/privy');
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/rpc',
    fetch: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/rest/v1/wallets')) {
        return Response.json([{
          id: 'w1',
          owner_id: 'user_1',
          kind: 'main',
          label: 'Main',
          address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          provider: 'privy',
          frozen: false,
        }]);
      }
      if (href.includes('/rpc') || href === 'https://example.invalid/rpc') {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'getGenesisHash') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH });
        }
        if (body.method === 'getBalance') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 0 } });
        }
        if (body.method === 'getTokenAccountsByOwner') {
          if (body.params?.[1]?.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') {
            return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
          }
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [{
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: DEVNET_USDC_MINT,
                        tokenAmount: { amount: '1234500', decimals: 6 },
                      },
                    },
                  },
                },
              }],
            },
          });
        }
      }
      return new Response('nope', { status: 404 });
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items[0].usdcBalance, '1234500');
  assert.equal(body.items[0].usdcBalanceLabel, '1.2345 USDC');
  assert.equal(body.items[0].solLamports, '0');
  assert.equal(body.items[0].tokens[0].symbol, 'USDC');
  assert.equal(body.items[0].balanceStatus, 'ok');
  assert.equal(body.items[0].cluster, 'devnet');
  assert.equal(body.balances.onchainUsdc, '1234500');
  assert.equal(body.balances.displayUsdcLabel, '1.2345 USDC');
  assert.equal(JSON.stringify(body).includes('example.invalid'), false);
});

/**
 * Achieves: list surfaces SOL lamports and each SPL token with a combined displayBalanceLabel.
 * Fails when: tokens truncated to USDC-only, SOL missing, or display label omits amounts.
 * Oracle: solLamports 1500000000; tokens length 2; displayBalanceLabel matches 1.5 SOL / 2.5 USDC / 7 So11.
 * Side effects / state checked: RPC mocks only.
 * Gaps: Token-2022 accounts empty-path only
 */
test('wallets.list reports SOL and every SPL token in the wallet', async () => {
  const { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } = await import('@ubc2026/wallets/privy');
  const otherMint = 'So11111111111111111111111111111111111111112';
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/rpc',
    fetch: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/rest/v1/wallets')) {
        return Response.json([{
          id: 'w1',
          owner_id: 'user_1',
          kind: 'main',
          label: 'Main',
          address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          provider: 'privy',
          frozen: false,
        }]);
      }
      if (href.includes('/rest/v1/platform_transfers')) return Response.json([]);
      if (href.includes('/rpc') || href === 'https://example.invalid/rpc') {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'getGenesisHash') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH });
        }
        if (body.method === 'getBalance') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 1_500_000_000 } });
        }
        if (body.method === 'getTokenAccountsByOwner') {
          const programId = body.params?.[1]?.programId;
          if (programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') {
            return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
          }
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [
                {
                  account: {
                    data: {
                      parsed: {
                        info: {
                          mint: DEVNET_USDC_MINT,
                          tokenAmount: { amount: '2500000', decimals: 6 },
                        },
                      },
                    },
                  },
                },
                {
                  account: {
                    data: {
                      parsed: {
                        info: {
                          mint: otherMint,
                          tokenAmount: { amount: '7000000000', decimals: 9 },
                        },
                      },
                    },
                  },
                },
              ],
            },
          });
        }
      }
      return new Response('nope', { status: 404 });
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items[0].solLamports, '1500000000');
  assert.equal(body.items[0].tokens.length, 2);
  assert.equal(body.items[0].tokens[0].symbol, 'USDC');
  assert.match(body.items[0].tokens[1].symbol, /So11/);
  assert.match(body.balances.displayBalanceLabel, /1\.5 SOL/);
  assert.match(body.balances.displayBalanceLabel, /2\.5 USDC/);
  assert.match(body.balances.displayBalanceLabel, /7 So11/);
  assert.ok(Array.isArray(body.items[0].holdings));
  assert.ok(body.items[0].holdings.length >= 2);
});

/**
 * Achieves: when platform transfers exist, displayUsdcLabel/displaySource prefer platform net over on-chain USDC.
 * Fails when: displaySource stays onchain despite transfers, or displayUsdcLabel uses on-chain 0 incorrectly as primary display.
 * Oracle: displaySource 'platform', displayUsdcLabel '5 USDC', item.usdcBalance still '0' on-chain.
 * Side effects / state checked: platform_transfers + RPC mocks.
 * Gaps: mixed platform+onchain edge not asserted
 */
test('wallets.list prefers platform transfer net for displayUsdcLabel', async () => {
  const { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } = await import('@ubc2026/wallets/privy');
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/rpc',
    fetch: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/rest/v1/wallets')) {
        return Response.json([{
          id: 'w1',
          owner_id: 'user_1',
          kind: 'main',
          label: 'Main',
          address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          provider: 'privy',
          frozen: false,
        }]);
      }
      if (href.includes('/rest/v1/platform_transfers')) {
        return Response.json([{
          id: 't1',
          from_owner_id: 'user_2',
          to_owner_id: 'user_1',
          amount: 5000000,
          asset: 'USDC',
          handle: 'bob',
        }]);
      }
      if (href.includes('/rpc') || href === 'https://example.invalid/rpc') {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'getGenesisHash') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH });
        }
        if (body.method === 'getBalance') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 0 } });
        }
        if (body.method === 'getTokenAccountsByOwner') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
        }
      }
      return new Response('nope', { status: 404 });
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.balances.displaySource, 'platform');
  assert.equal(body.balances.displayUsdcLabel, '5 USDC');
  assert.equal(body.items[0].displayUsdcLabel, '5 USDC');
  assert.equal(body.items[0].usdcBalance, '0');
});

/**
 * Achieves: persist fails closed for no bearer, no owner, empty wallets[], and missing Supabase config.
 * Fails when: any of those paths return 200 or wrong error codes.
 * Oracle: 401 login_required; 401 owner_required; 400 invalid_wallets; 503 unconfigured.
 * Side effects / state checked: N/A (no successful writes).
 * Gaps: none for listed failures; malformed JSON in sibling test
 */
test('wallets.persist rejects missing auth, owner, empty wallets, and unconfigured supabase', async () => {
  const envConfigured = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => new Response(null, { status: 201 }),
  });
  const noAuth = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ wallets: [{ id: 'w1' }] }),
  }), envConfigured);
  assert.equal(noAuth.status, 401);
  assert.equal((await noAuth.json()).error, 'login_required');

  const noOwner = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ wallets: [{ id: 'w1' }] }),
  }), envConfigured);
  assert.equal(noOwner.status, 401);
  assert.equal((await noOwner.json()).error, 'owner_required');

  const empty = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'x-owner-id': 'user_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ wallets: [] }),
  }), envConfigured);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'invalid_wallets');

  const unconfigured = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'x-owner-id': 'user_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      wallets: [{
        id: 'w1',
        ownerId: 'user_1',
        kind: 'main',
        label: 'Main',
        address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        provider: 'privy',
        frozen: false,
      }],
    }),
  }), fakeEnv({}));
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).error, 'unconfigured');
});

/**
 * Achieves: posted wallet.ownerId is overwritten by x-owner-id before Supabase write.
 * Fails when: attacker ownerId is persisted as owner_id.
 * Oracle: written row.owner_id === 'user_1' despite body ownerId 'attacker'.
 * Side effects / state checked: captured POST body owner_id.
 * Gaps: none
 */
test('wallets.persist ignores foreign-owner wallet rows (owner header wins)', async () => {
  const writes = [];
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/rest/v1/wallets') && init.method === 'POST') {
        writes.push(JSON.parse(init.body));
        return new Response(null, { status: 201 });
      }
      if (href.includes('/rest/v1/wallets?') && (!init.method || init.method === 'GET')) {
        return Response.json([{
          id: 'w1',
          owner_id: 'user_1',
          kind: 'main',
          label: 'Main',
          address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          provider: 'privy',
          frozen: false,
        }]);
      }
      return new Response(null, { status: 201 });
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets/persist', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'x-owner-id': 'user_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      wallets: [{
        id: 'w1',
        ownerId: 'attacker',
        kind: 'main',
        label: 'Main',
        address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        provider: 'privy',
        frozen: false,
      }],
    }),
  }), env);
  assert.equal(res.status, 200);
  assert.ok(writes.length >= 1);
  const row = Array.isArray(writes[0]) ? writes[0][0] : writes[0];
  assert.equal(row.owner_id, 'user_1');
});

/**
 * Achieves: Worker Privy failure returns privy_failed with the WalletError detail.
 * Fails when: detail is dropped or replaced with a generic secrets hint only.
 * Oracle: 502 + privy_failed; detail includes the upstream message (401).
 * Side effects / state checked: acceptLogin throws WalletError (no network).
 * Gaps: none for this failure mode
 */
test('wallet create surfaces runtime Privy guidance when acceptLogin fails on the Worker', async () => {
  const { WalletError } = await import('@ubc2026/wallets');
  const env = fakeEnv({
    transferClient: {
      acceptLogin: async () => {
        const error = new WalletError('Privy users failed (401)', 'privy_failed');
        throw error;
      },
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'x-owner-id': 'user_1',
    },
  }), env);
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'privy_failed');
  assert.match(body.detail || '', /Privy users failed \(401\)/);
});

/**
 * Achieves: wallet create does not pass Origin into acceptLogin on Workers.
 * Fails when: origin is still forwarded (forbidden outbound header on workerd).
 * Oracle: seen[0].origin is undefined for both Origin and x-maelstrom-origin headers.
 * Side effects / state checked: acceptLogin args captured; Supabase write stubbed.
 * Gaps: none for the no-Origin contract
 */
/**
 * Achieves: JWT access tokens resolve owner via sub without calling acceptLogin.
 * Fails when: events poll still runs full wallet sync for every Bearer JWT.
 * Oracle: readPrivyAccessTokenSub + resolveOwner JWT fast path.
 * Side effects / state checked: acceptLogin must not run.
 */
test('events list uses JWT sub without calling acceptLogin', async () => {
  let called = false;
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'did:privy:user_1' })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const env = fakeEnv({
    PRIVY_APP_ID: 'app_test',
    PRIVY_APP_SECRET: 'secret_test',
    transferClient: {
      acceptLogin: async () => {
        called = true;
        throw new Error('acceptLogin should not run for JWT sub');
      },
    },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => Response.json([]),
  });
  const res = await worker.fetch(new Request('https://runtime/api/events?botId=bot_1', {
    headers: {
      authorization: `Bearer ${token}`,
      'x-owner-id': 'did:privy:user_1',
    },
  }), env);
  assert.equal(res.status, 200);
  assert.equal(called, false);
});

test('wallet create does not forward Origin into Privy acceptLogin', async () => {
  const seen = [];
  const env = fakeEnv({
    transferClient: {
      acceptLogin: async (args) => {
        seen.push(args);
        return {
          created: false,
          main: {
            id: 'w1',
            ownerId: 'user_1',
            kind: 'main',
            label: 'Main',
            address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            frozen: false,
            provider: 'privy',
          },
          additional: [],
        };
      },
    },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => new Response(null, { status: 201 }),
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'x-owner-id': 'user_1',
      origin: 'http://localhost:3000',
    },
  }), env);
  assert.equal(res.status, 200);
  assert.equal(seen[0].origin, undefined);

  seen.length = 0;
  const viaProxy = await worker.fetch(new Request('https://runtime/api/wallets', {
    method: 'POST',
    headers: {
      authorization: 'Bearer tok_1',
      'x-owner-id': 'user_1',
      'x-maelstrom-origin': 'http://localhost:3000',
    },
  }), env);
  assert.equal(viaProxy.status, 200);
  assert.equal(seen[0].origin, undefined);
});

/**
 * Achieves: mapBotRow/mapWalletRow/mapLedgerRow map snake_case rows into public records including linked spendable=false.
 * Fails when: cap amounts wrong type, linked privyWalletId set, or ledger fields mismatched.
 * Oracle: bot.cap.maxOutflow '100'; linked.spendable false and privyWalletId undefined; ledger deepEqual.
 * Side effects / state checked: N/A.
 * Gaps: none for mapper happy path
 */
test('supabase mappers turn rows into bot/wallet/ledger records', () => {
  const bot = mapBotRow({
    id: 'bot_1',
    owner_id: 'user_1',
    wallet_id: 'wal_1',
    name: 'Shop',
    goal: 'buy',
    type: 'shopping',
    approval_mode: 'ask',
    enabled: true,
    frozen: false,
    policy_version: 2,
    cap_mode: 'limited',
    cap_asset: 'USDC',
    max_outflow: 100,
    max_per_transaction: 50,
  });
  assert.equal(bot.walletId, 'wal_1');
  assert.equal(bot.cap.maxOutflow, '100');
  assert.equal(mapWalletRow({
    id: 'wal_1',
    owner_id: 'user_1',
    kind: 'main',
    label: 'Main',
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    provider: 'privy',
    frozen: false,
  }).privyWalletId, 'wal_1');
  const linked = mapWalletRow({
    id: 'linked_So11111111111111111111111111111111111111112',
    owner_id: 'user_1',
    kind: 'additional',
    label: 'Phantom',
    address: 'So11111111111111111111111111111111111111112',
    provider: 'privy',
    frozen: false,
    spendable: false,
  });
  assert.equal(linked.spendable, false);
  assert.equal(linked.privyWalletId, undefined);
  assert.deepEqual(mapLedgerRow({ asset: 'USDC', spent: 1, reserved: 2, realized_loss: 3 }, 'bot_1'), {
    botId: 'bot_1',
    asset: 'USDC',
    spent: '1',
    reserved: '2',
    realizedLoss: '3',
  });
});

function deletionSession() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const appId = 'testapp1';
  const ownerId = 'did:privy:alice';
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({
    sub: ownerId, iss: 'privy.io', aud: appId, exp: Math.floor(Date.now() / 1000) + 600,
  })}`;
  const signature = sign('sha256', Buffer.from(jwt), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    appId,
    ownerId,
    headers: { authorization: `Bearer ${jwt}.${signature.toString('base64url')}`, 'x-owner-id': ownerId },
    fetchWithJwks: fetcher => async (url, init) => {
      if (new URL(url).hostname === 'auth.privy.io') {
        assert.equal(new URL(url).pathname, `/api/v1/apps/${appId}/jwks.json`);
        return Response.json({ keys: [publicKey.export({ format: 'jwk' })] });
      }
      return fetcher(url, init);
    },
  };
}

test('agent deletion verifies the caller, passes that owner to the RPC and does not hide a storage failure', async () => {
  const session = deletionSession();
  const remove = (status) => worker.fetch(new Request('https://runtime/api/bots/bot_1', {
    method: 'DELETE',
    headers: session.headers,
  }), fakeEnv({
    PRIVY_APP_ID: session.appId,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: session.fetchWithJwks(async (url, init) => {
      if (new URL(url).pathname.endsWith('/activity_logs')) return new Response(null, { status: 204 });
      assert.equal(init.method, 'POST');
      assert.equal(new URL(url).pathname, '/rest/v1/rpc/delete_owner_agent');
      assert.deepEqual(JSON.parse(init.body), { p_owner_id: session.ownerId, p_bot_id: 'bot_1' });
      return new Response(null, { status });
    }),
  }));
  const deleted = await remove(204);
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true, deleted: 'bot_1', source: 'supabase' });
  const failure = await remove(503);
  assert.equal(failure.status, 502);
  assert.deepEqual(await failure.json(), { error: 'delete_failed' });

  const deny = (headers) => worker.fetch(new Request('https://runtime/api/bots/bot_1', {
    method: 'DELETE',
    headers,
  }), fakeEnv({
    PRIVY_APP_ID: session.appId,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: session.fetchWithJwks(async () => new Response(null, { status: 500 })),
  }));
  for (const [headers, error] of [
    [{ 'x-owner-id': session.ownerId }, 'login_required'],
    [{ ...session.headers, 'x-owner-id': 'did:privy:bob' }, 'owner_mismatch'],
  ]) {
    const denied = await deny(headers);
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error });
  }

  const unverified = await worker.fetch(new Request('https://runtime/api/bots/bot_1', {
    method: 'DELETE',
    headers: session.headers,
  }), fakeEnv({
    PRIVY_APP_ID: session.appId,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => Response.json({ keys: [] }),
  }));
  assert.equal(unverified.status, 401);
  assert.deepEqual(await unverified.json(), { error: 'login_required' });
});

test('agents can still be deleted from an older database without the deletion RPC', async () => {
  const session = deletionSession();
  const calls = [];
  const fetcher = async (url, init) => {
    const target = new URL(url);
    calls.push([init.method, target.pathname]);
    if (target.pathname.endsWith('/rpc/delete_owner_agent')) {
      return Response.json({ code: 'PGRST202' }, { status: 404 });
    }
    if (target.pathname.endsWith('/bots') || target.pathname.endsWith('/activity_logs')) {
      assert.equal(target.searchParams.get('owner_id'), `eq.${session.ownerId}`);
    }
    if (init.method === 'GET') return Response.json([{ id: 'bot_1' }]);
    return new Response(null, { status: 204 });
  };
  const response = await worker.fetch(new Request('https://runtime/api/bots/bot_1', {
    method: 'DELETE',
    headers: session.headers,
  }), fakeEnv({
    PRIVY_APP_ID: session.appId,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: session.fetchWithJwks(fetcher),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.slice(0, 2), [
    ['POST', '/rest/v1/rpc/delete_owner_agent'],
    ['GET', '/rest/v1/bots'],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === 'DELETE').slice(-2), [
    ['DELETE', '/rest/v1/activity_logs'],
    ['DELETE', '/rest/v1/bots'],
  ]);
});

test('deletion on a migrated database fails closed when Privy verification is unconfigured', async () => {
  const calls = [];
  const response = await worker.fetch(new Request('https://runtime/api/bots/bot_1', {
    method: 'DELETE',
    headers: { 'x-owner-id': 'user_1' },
  }), fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url, { method }) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/activity_logs')) return new Response(null, { status: 204 });
      calls.push([method, path]);
      return Response.json([{ ids: [] }]);
    },
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'agent_delete_auth_unconfigured' });
  assert.deepEqual(calls, [['GET', '/rest/v1/rpc/list_deleted_owner_agents']]);
});

/**
 * Achieves: logs route requires owner and returns empty unconfigured without Supabase.
 * Fails when: ownerless 200 or invented log rows.
 * Oracle: 401 then 200 source unconfigured items=[].
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('activity logs require an owner and stay empty without Supabase', async () => {
  const env = fakeEnv();
  const denied = await worker.fetch(new Request('https://runtime/api/logs'), env);
  assert.equal(denied.status, 401);
  const empty = await worker.fetch(new Request('https://runtime/api/logs', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(empty.status, 200);
  const body = await empty.json();
  assert.equal(body.source, 'unconfigured');
  assert.deepEqual(body.items, []);
});

/**
 * Achieves: lookup resolves @handle via profiles+wallets and .sol via SNS demo map.
 * Fails when: handle/sns kinds wrong, address missing, or self flagged incorrectly.
 * Oracle: handle recipient kind/displayName/address; sns kind/domain/address.
 * Side effects / state checked: Supabase + SNS_DEMO_MAP reads.
 * Gaps: missing-profile / SNS miss paths not asserted here
 */
test('profile lookup sends a handle to its owner and a .sol name through SNS', async () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const fetcher = async (url) => {
    const href = String(url);
    if (new URL(href).searchParams.get('handle') === 'eq.alex') {
      return Response.json([{ owner_id: 'user_2', handle: 'alex', display_name: 'Alex', avatar_url: null }]);
    }
    if (href.includes('wallets?')) return Response.json([{ address }]);
    return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: fetcher,
    SNS_DEMO_MAP: { 'richclub.sol': address },
  });
  const handle = await worker.fetch(new Request('https://runtime/api/profiles/lookup?q=%40Alex', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  const handleBody = await handle.json();
  assert.equal(handleBody.recipient.kind, 'handle');
  assert.equal(handleBody.recipient.displayName, 'Alex');
  assert.equal(handleBody.recipient.address, address);
  assert.equal(handleBody.recipient.missing, false);
  assert.equal(handleBody.recipient.self, false);

  const sns = await worker.fetch(new Request('https://runtime/api/profiles/lookup?q=%40richclub.sol', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  const snsBody = await sns.json();
  assert.equal(snsBody.recipient.kind, 'sns');
  assert.equal(snsBody.recipient.domain, 'richclub.sol');
  assert.equal(snsBody.recipient.address, address);
});

test('handle lookup chooses the exact stored handle and refuses ambiguous spoken matches', async () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url) => {
      const target = new URL(url);
      const filter = target.searchParams.get('handle');
      if (filter === 'eq.wallet_1') return Response.json([{ owner_id: 'did:privy:bob', handle: 'wallet_1' }]);
      if (filter === 'eq.janedoe') return Response.json([]);
      if (target.searchParams.has('or')) {
        return Response.json([{ handle: 'jane_doe' }, { handle: 'jan_edoe' }]);
      }
      assert.equal(target.pathname, '/rest/v1/wallets');
      assert.equal(target.searchParams.get('owner_id'), 'eq.did:privy:bob');
      assert.equal(target.searchParams.get('kind'), 'eq.main');
      return Response.json([{ address }]);
    },
  });
  const lookup = (q) => worker.fetch(new Request(`https://runtime/api/profiles/lookup?q=${encodeURIComponent(q)}`, {
    headers: { 'x-owner-id': 'did:privy:alice' },
  }), env);
  const exact = await lookup('@Wallet_1');
  assert.equal(exact.status, 200);
  const { recipient } = await exact.json();
  assert.equal(recipient.handle, 'wallet_1');
  assert.equal(recipient.address, address);
  assert.equal(recipient.self, false);
  const ambiguous = await lookup('find Jane Doe');
  assert.equal(ambiguous.status, 409);
  assert.deepEqual(await ambiguous.json(), { error: 'ambiguous_handle' });
});

/**
 * Achieves: create requires walletId belonging to owner; successful create upserts bot + spend_ledgers.
 * Fails when: missing/foreign wallet accepted, or writes skip bots/ledgers.
 * Oracle: 400 without wallet; 404 wallet_not_found for foreign id; 200 ok with bot id/walletId; writes include bots and spend_ledgers.
 * Side effects / state checked: Supabase POST bodies recorded; foreign attempt must not POST bots.
 * Gaps: none for ownership boundary on create
 */
test('bots.create upserts a shell bot when the wallet belongs to the owner', async () => {
  const writes = [];
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    if (init.method === 'POST') {
      writes.push({ href, body: JSON.parse(init.body), prefer: init.headers?.prefer });
      if (href.includes('/rest/v1/bots')) {
        if (JSON.parse(init.body).id === 'bot_deleted') return Response.json({ code: 'PT410' }, { status: 410 });
        return new Response(JSON.stringify([JSON.parse(init.body)]), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 201 });
    }
    if (href.includes('/rest/v1/wallets?')) {
      // Owner-scoped query: only w_main exists for this owner.
      if (href.includes('id=eq.w_main')) {
        return Response.json([{ id: 'w_main', frozen: false }]);
      }
      return Response.json([]);
    }
    return Response.json([]);
  };
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: fetcher,
  });
  const missingWallet = await worker.fetch(new Request('https://runtime/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ id: 'bot_local', name: 'Local' }),
  }), env);
  assert.equal(missingWallet.status, 400);

  const foreignWallet = await worker.fetch(new Request('https://runtime/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({
      id: 'bot_steal',
      name: 'Steal',
      goal: 'Watch',
      type: 'trading',
      walletId: 'w_other',
    }),
  }), env);
  assert.equal(foreignWallet.status, 404);
  assert.equal((await foreignWallet.json()).error, 'wallet_not_found');
  assert.equal(writes.some((entry) => entry.href.includes('/rest/v1/bots')), false);

  const created = await worker.fetch(new Request('https://runtime/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({
      id: 'bot_local',
      name: 'Local',
      goal: 'Watch',
      type: 'trading',
      walletId: 'w_main',
    }),
  }), env);
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.ok, true);
  assert.equal(body.bot.id, 'bot_local');
  assert.equal(body.bot.walletId, 'w_main');
  assert.equal(writes.some((entry) => entry.href.includes('/rest/v1/bots')), true);
  assert.equal(writes.some((entry) => entry.href.includes('/rest/v1/spend_ledgers')), true);

  writes.length = 0;
  const deleted = await worker.fetch(new Request('https://runtime/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ id: 'bot_deleted', name: 'Deleted', walletId: 'w_main' }),
  }), env);
  assert.equal(deleted.status, 410);
  assert.deepEqual(await deleted.json(), { error: 'agent_deleted' });
  assert.equal(writes.some((entry) => entry.href.includes('/rest/v1/spend_ledgers')), false);
});

/**
 * Achieves: chat without owner is 401; with owner but no OpenRouter is 503 openrouter_not_configured.
 * Fails when: ownerless chat succeeds or missing key returns another code.
 * Oracle: 401 then 503 with openrouter_not_configured.
 * Side effects / state checked: N/A.
 * Gaps: none for gate paths
 */
test('bot text chat requires owner and OpenRouter', async () => {
  const denied = await worker.fetch(new Request('https://runtime/api/bots/bot_1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hi' }),
  }), fakeEnv());
  assert.equal(denied.status, 401);

  const missingKey = await worker.fetch(new Request('https://runtime/api/bots/bot_1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ message: 'hi', name: 'Nova', goal: 'watch' }),
  }), fakeEnv());
  assert.equal(missingKey.status, 503);
  assert.equal((await missingKey.json()).error, 'openrouter_not_configured');
});

/**
 * Achieves: configured openRouter.chat reply is returned with ok/botId.
 * Fails when: reply text wrong or ok false.
 * Oracle: 200 ok, reply 'Nova heard: status?', botId bot_1.
 * Side effects / state checked: openRouter.chat mock only.
 * Gaps: history truncation / model error paths not covered
 */
test('bot text chat returns an OpenRouter reply for the owner', async () => {
  const env = fakeEnv({
    openRouter: {
      chat: async ({ message, botName }) => ({
        model: 'muse-spark-1.3-contributor',
        text: `${botName} heard: ${message}`,
      }),
      complete: async () => ({ text: '{"allow":true}' }),
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/bots/bot_1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({
      message: 'status?',
      name: 'Nova',
      goal: 'Watch SOL',
      history: [{ role: 'user', text: 'hi' }, { role: 'agent', text: 'hello' }],
    }),
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.reply, 'Nova heard: status?');
  assert.equal(body.botId, 'bot_1');
});

/**
 * Achieves: DELETE bot without Supabase returns 503 unconfigured (route is wired).
 * Fails when: 404/405 or silent 200 without config.
 * Oracle: 503 + unconfigured.
 * Side effects / state checked: N/A.
 * Gaps: configured delete success path not covered
 */
test('bot delete is dispatched when Supabase is unconfigured', async () => {
  const res = await worker.fetch(new Request('https://runtime/api/bots/bot_1', {
    method: 'DELETE',
    headers: { 'x-owner-id': 'user_1' },
  }), fakeEnv());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'unconfigured');
});

/**
 * Achieves: desk-granted transfer posts platform_post_transfer and lists as out for sender / in for recipient.
 * Fails when: wrong handle/amount posted, or list direction wrong for bob.
 * Oracle: posted transfer direction out/handle bob; listed direction in/amount 5000000.
 * Side effects / state checked: RPC mocks for desk_locks, policy_reserve_budget, platform_post_transfer, platform_transfers.
 * Gaps: desk-denied / replay paths not covered here
 */
test('a platform send posts to the recipient handle and lists it on both wallets', async () => {
  const grant = 'ab'.repeat(32);
  const grantHash = await sha256Hex(grant);
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('desk_locks')) {
      return Response.json([{
        grant_hash: grantHash,
        grant_until: new Date(Date.now() + 60_000).toISOString(),
      }]);
    }
    if (href.includes('/rpc/policy_reserve_budget')) {
      return Response.json({ state: 'reserved' });
    }
    if (href.includes('/rpc/platform_post_transfer')) {
      const body = JSON.parse(init.body);
      assert.equal(body.payload.handle, 'bob');
      assert.equal(body.payload.amount, '5000000');
      return Response.json({
        replay: false,
        transfer: {
          id: body.payload.idempotencyKey,
          handle: 'bob',
          amount: '5000000',
          from_owner_id: 'alice',
          to_owner_id: 'bob',
          bot_id: 'bot_shop',
        },
      });
    }
    if (href.includes('bots?')) return Response.json([{ id: 'bot_shop' }]);
    if (href.includes('platform_transfers?')) {
      return Response.json([{
        id: 'send_bob_5000000',
        handle: 'bob',
        amount: '5000000',
        from_owner_id: 'alice',
        to_owner_id: 'bob',
        asset: 'USDC',
      }]);
    }
    return Response.json([]);
  };
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: fetcher,
  });
  const posted = await worker.fetch(new Request('https://runtime/api/transfers', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'alice', 'x-desk-grant': grant },
    body: JSON.stringify({
      handle: '@bob',
      amount: '5000000',
      idempotencyKey: 'send_bob_5000000',
      botId: 'bot_shop',
    }),
  }), env);
  const postedBody = await posted.json();
  assert.equal(posted.status, 200);
  assert.equal(postedBody.transfer.direction, 'out');
  assert.equal(postedBody.transfer.handle, 'bob');

  const listed = await worker.fetch(new Request('https://runtime/api/transfers', {
    headers: { 'x-owner-id': 'bob' },
  }), env);
  const listedBody = await listed.json();
  assert.equal(listedBody.items[0].direction, 'in');
  assert.equal(listedBody.items[0].amount, '5000000');
});

/**
 * Achieves: health reflects signing and supabase bound/set independently.
 * Fails when: empty SUPABASE_URL still reports supabase true, or secrets.set wrong.
 * Oracle: signing true; supabase false when URL empty; set/bound flags; then supabase true when configured.
 * Side effects / state checked: optional supabase probe fetch when URL set.
 * Gaps: none for these flags
 */
test('health reports signing and supabase readiness flags', async () => {
  const incomplete = await worker.fetch(new Request('https://runtime/health'), fakeEnv({
    transferClient: { ok: true },
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_URL: '',
  }));
  const incompleteBody = await incomplete.json();
  assert.equal(incompleteBody.signing, true);
  assert.equal(incompleteBody.supabase, false);
  assert.equal(incompleteBody.secrets.SUPABASE_SERVICE_ROLE_KEY.set, true);
  assert.equal(incompleteBody.secrets.SUPABASE_URL.bound, true);
  assert.equal(incompleteBody.secrets.SUPABASE_URL.set, false);

  const res = await worker.fetch(new Request('https://runtime/health'), fakeEnv({
    transferClient: { ok: true },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    fetch: async () => new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } }),
  }));
  const body = await res.json();
  assert.equal(body.signing, true);
  assert.equal(body.supabase, true);
  assert.equal(body.secrets.SUPABASE_URL.set, true);
  assert.equal(body.secrets.META_MODEL_API_KEY.set, false);
  assert.equal(body.secrets.ELEVENLABS_WEBHOOK_SECRET.set, false);

  const voiceReady = await worker.fetch(new Request('https://runtime/health'), fakeEnv({
    META_MODEL_API_KEY: 'LLM_test',
    ELEVENLABS_API_KEY: 'el_test',
    ELEVENLABS_AGENT_ID: 'agent_test',
    ELEVENLABS_WEBHOOK_SECRET: 'whsec_test',
  }));
  const voiceBody = await voiceReady.json();
  assert.equal(voiceBody.secrets.META_MODEL_API_KEY.set, true);
  assert.equal(voiceBody.secrets.ELEVENLABS_API_KEY.set, true);
  assert.equal(voiceBody.secrets.ELEVENLABS_AGENT_ID.set, true);
  assert.equal(voiceBody.secrets.ELEVENLABS_WEBHOOK_SECRET.set, true);
});

/**
 * Achieves: payments without Supabase returns empty unconfigured and never calls fetch.
 * Fails when: fetch invoked or stub/items invented.
 * Oracle: source unconfigured, items/crossCheck [], stub undefined, called false.
 * Side effects / state checked: fetch must not run.
 * Gaps: none
 */
test('payments feed stays empty without Supabase and does not pretend to read it', async () => {
  let called = false;
  const env = fakeEnv({
    fetch: async () => {
      called = true;
      return Response.json([]);
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/payments', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'unconfigured');
  assert.deepEqual(body.items, []);
  assert.deepEqual(body.crossCheck, []);
  assert.equal(body.stub, undefined);
  assert.equal(called, false);
});

/**
 * Achieves: payments prefer stream_events x402-out (not payments table) and flag unapproved_spend vs ledger.
 * Fails when: payments table consulted, deposit events listed as paid, or crossCheck missing/wrong excess.
 * Oracle: one confirmed item amount 12; crossCheck unapproved_spend excess 10; no service-role in JSON; no /payments URL.
 * Side effects / state checked: Supabase GETs recorded.
 * Gaps: none for this happy/cross-check path
 */
test('payments feed lists stream-confirmed x402 rows and cross-checks the ledger', async () => {
  const wallet = 'So11111111111111111111111111111111111111112';
  const signature = '5'.repeat(64);
  const urls = [];
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url) => {
      const href = String(url);
      urls.push(href);
      if (href.includes('/rest/v1/bots?')) {
        return Response.json([{ id: 'bot_1', wallet_id: 'w1' }]);
      }
      if (href.includes('/rest/v1/wallets?')) {
        return Response.json([{ id: 'w1', address: wallet, owner_id: 'user_1' }]);
      }
      if (href.includes('/rest/v1/stream_events?')) {
        return Response.json([
          {
            signature,
            wallet,
            bot_id: 'bot_1',
            event_type: 'x402-out',
            amount: '12',
            token: 'USDC',
            cluster: 'devnet',
          },
          {
            signature: '6'.repeat(64),
            wallet,
            bot_id: 'bot_1',
            event_type: 'deposit',
            amount: '99',
            token: 'USDC',
            cluster: 'devnet',
          },
        ]);
      }
      if (href.includes('/rest/v1/payments')) {
        return Response.json([{
          id: 'invented',
          bot_id: 'bot_1',
          direction: 'paid',
          protocol: 'x402',
          amount: '1',
          asset: 'USDC',
          counterparty: 'not-from-stream',
          cluster: 'devnet',
        }]);
      }
      if (href.includes('/rest/v1/spend_ledgers')) {
        return Response.json([{ bot_id: 'bot_1', asset: 'USDC', spent: '2', reserved: '0' }]);
      }
      return Response.json([]);
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/payments', {
    headers: { 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'supabase');
  assert.equal(body.stub, undefined);
  assert.equal(urls.some((href) => href.includes('/rest/v1/payments')), false);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].badge, 'confirmed');
  assert.equal(body.items[0].streamConfirmed, true);
  assert.equal(body.items[0].direction, 'paid');
  assert.equal(body.items[0].amount, '12');
  assert.equal(body.items[0].txSignature, signature);
  assert.equal(body.crossCheck.length, 1);
  assert.equal(body.crossCheck[0].alert, 'unapproved_spend');
  assert.equal(body.crossCheck[0].walletId, 'w1');
  assert.equal(body.crossCheck[0].excess, '10');
  assert.equal(JSON.stringify(body).includes('service-role-test'), false);
});

/**
 * Achieves: PUT profiles/me upserts users+profiles; unreachable/unauthorized failures are sanitized 502s.
 * Fails when: upserts skip users, or error bodies leak exception text/secrets.
 * Oracle: 200 handle alex01; writes include on_conflict; 502 profile_directory_unreachable without 'down'; 502 42501.
 * Side effects / state checked: write URL log; failure fetch mocks.
 * Gaps: none for listed paths
 */
test('a profile claim upserts the user and stays readable', async () => {
  const writes = [];
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url, init = {}) => {
      const href = String(url);
      const method = init.method || 'GET';
      writes.push({ href, method });
      if (href.includes('/rest/v1/users')) return new Response('', { status: 201 });
      if (method === 'POST' && href.includes('/rest/v1/profiles')) {
        return Response.json([{ owner_id: 'user_1', handle: 'alex01', display_name: 'Alex' }]);
      }
      if (method === 'GET' && href.includes('/rest/v1/profiles')) {
        return Response.json([{ handle: 'alex01', display_name: 'Alex', avatar_url: null }]);
      }
      return Response.json([]);
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/profiles/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ displayName: 'Alex', handle: 'Alex01' }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).profile.handle, 'alex01');
  assert.equal(writes.some(call => call.href.includes('users?on_conflict=id')), true);
  assert.equal(writes.some(call => call.href.includes('profiles?on_conflict=owner_id')), true);

  const failed = await worker.fetch(new Request('https://runtime/api/profiles/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ displayName: 'Alex', handle: 'alex01' }),
  }), fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => { throw new Error('down'); },
  }));
  assert.equal(failed.status, 502);
  const failedBody = await failed.json();
  assert.equal(failedBody.error, 'profile_directory_unreachable');
  assert.equal(JSON.stringify(failedBody).includes('down'), false);

  const unread = await worker.fetch(new Request('https://runtime/api/profiles/me', {
    headers: { 'x-owner-id': 'user_1' },
  }), fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => Response.json({ code: '42501' }, { status: 401 }),
  }));
  assert.equal(unread.status, 502);
  assert.equal((await unread.json()).error, '42501');
});

/**
 * Achieves: Privy DID owner_id is stored/read without PostgREST-breaking quotes; failures sanitize secrets.
 * Fails when: eq filter quotes DID (empty read), or 401/404/empty-confirm leak secrets/messages.
 * Oracle: 200 handle alex; profiles.get DID; rejected/missed/emptyConfirm/coded error codes without secrets.
 * Side effects / state checked: in-memory profiles map; filter inspection.
 * Gaps: none for these failure oracles
 */
test('a claim for @alex confirms the Privy owner without quoting the eq value', async () => {
  const profiles = new Map();
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url, init = {}) => {
      const href = String(url);
      const method = init.method || 'GET';
      if (href.includes('/rest/v1/users')) return new Response('', { status: 201 });
      if (method === 'POST' && href.includes('/rest/v1/profiles')) {
        const body = JSON.parse(init.body);
        profiles.set(body.owner_id, body);
        assert.match(href, /on_conflict=owner_id/);
        return Response.json([body], { status: 201 });
      }
      const filter = new URL(href).searchParams.get('owner_id') || '';
      // Real PostgREST eq keeps quotes as part of the value, so a quoted DID matches nothing.
      if (filter.includes('"')) return Response.json([]);
      const owner = filter.startsWith('eq.') ? filter.slice(3) : '';
      const row = profiles.get(owner);
      return Response.json(row ? [{ handle: row.handle, display_name: row.display_name, avatar_url: null }] : []);
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/profiles/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:ada' },
    body: JSON.stringify({ displayName: 'ada@example.com', handle: 'alex' }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).profile.handle, 'alex');
  assert.equal(profiles.get('did:privy:ada').display_name, 'ada@example.com');

  const rejected = await worker.fetch(new Request('https://runtime/api/profiles/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:ada' },
    body: JSON.stringify({ displayName: 'ada@example.com', handle: 'alex' }),
  }), fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => Response.json({ message: 'Invalid API key', hint: 'service-role-secret' }, { status: 401 }),
  }));
  assert.equal(rejected.status, 502);
  const body = await rejected.json();
  assert.equal(body.error, 'supabase_http_401');
  assert.equal(JSON.stringify(body).includes('service-role-secret'), false);

  const missed = await worker.fetch(new Request('https://runtime/api/profiles/lookup?q=%40alex', {
    headers: { 'x-owner-id': 'did:privy:ada' },
  }), fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => { throw new Error('down secret-value'); },
  }));
  assert.equal(missed.status, 502);
  const missedBody = await missed.json();
  assert.equal(missedBody.error, 'profile_directory_unreachable');
  assert.equal(missedBody.recipient, undefined);
  assert.equal(JSON.stringify(missedBody).includes('secret-value'), false);

  const emptyConfirm = await worker.fetch(new Request('https://runtime/api/profiles/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:ada' },
    body: JSON.stringify({ displayName: 'ada@example.com', handle: 'alex' }),
  }), fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url, init = {}) => {
      const href = String(url);
      if (href.includes('/rest/v1/users')) return new Response('', { status: 201 });
      if ((init.method || 'GET') === 'POST') return Response.json([{ handle: 'alex' }], { status: 201 });
      return Response.json([]);
    },
  }));
  assert.equal(emptyConfirm.status, 502);
  assert.equal((await emptyConfirm.json()).error, 'profile_not_confirmed');

  const coded = await worker.fetch(new Request('https://runtime/api/profiles/lookup?q=%40alex', {
    headers: { 'x-owner-id': 'did:privy:ada' },
  }), fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async () => Response.json({ code: 'PGRST205', message: 'hidden table', hint: 'secret-role' }, { status: 404 }),
  }));
  assert.equal(coded.status, 502);
  const codedBody = await coded.json();
  assert.equal(codedBody.error, 'PGRST205');
  assert.equal(JSON.stringify(codedBody).includes('secret-role'), false);
  assert.equal(JSON.stringify(codedBody).includes('hidden table'), false);
});

/**
 * Achieves: export requires signer+desk grant; returns HPKE ciphertext fields and strips privateKey.
 * Fails when: plaintext privateKey returned, or export proceeds without signer.
 * Oracle: 503 signer_not_configured; then 200 ciphertext ct, privateKey undefined, no do-not-return in JSON.
 * Side effects / state checked: exportOwnerWallet input (ownerId, recipientPublicKey, wallet.privyWalletId).
 * Gaps: desk-denied export path not covered
 */
test('a server wallet export returns HPKE fields and not a plaintext key', async () => {
  const missing = await worker.fetch(new Request('https://runtime/api/wallets/fmfdj6yqly31huorjqzq38zc/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1' },
    body: JSON.stringify({ recipientPublicKey: 'aa' }),
  }), fakeEnv());
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'signer_not_configured');

  const grant = 'cd'.repeat(32);
  const grantHash = await sha256Hex(grant);
  let exported = null;
  const env = fakeEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    transferClient: {
      exportOwnerWallet: async (input) => {
        exported = input;
        return {
          encryptionType: 'HPKE',
          encapsulatedKey: 'enc',
          ciphertext: 'ct',
          privateKey: 'do-not-return',
        };
      },
    },
    fetch: async (url) => {
      const href = String(url);
      if (href.includes('desk_locks')) {
        return Response.json([{
          grant_hash: grantHash,
          grant_until: new Date(Date.now() + 60_000).toISOString(),
        }]);
      }
      if (href.includes('/rest/v1/wallets')) {
        return Response.json([{
          id: 'fmfdj6yqly31huorjqzq38zc',
          owner_id: 'user_1',
          kind: 'main',
          label: 'Main',
          address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          provider: 'privy',
          frozen: false,
          spendable: true,
        }]);
      }
      return Response.json([]);
    },
  });
  const res = await worker.fetch(new Request('https://runtime/api/wallets/fmfdj6yqly31huorjqzq38zc/export', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-owner-id': 'user_1',
      'x-desk-grant': grant,
    },
    body: JSON.stringify({ recipientPublicKey: 'recipient' }),
  }), env);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ciphertext, 'ct');
  assert.equal(payload.privateKey, undefined);
  assert.equal(JSON.stringify(payload).includes('do-not-return'), false);
  assert.equal(exported.ownerId, 'user_1');
  assert.equal(exported.recipientPublicKey, 'recipient');
  assert.equal(exported.wallet.privyWalletId, 'fmfdj6yqly31huorjqzq38zc');
});
