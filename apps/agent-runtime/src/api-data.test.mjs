import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('enrichEnv is idempotent and leaves injectables alone', () => {
  const transferClient = { signAndBroadcastDevnet: async () => ({}) };
  const loadLoopContext = async () => ({});
  const once = enrichEnv(fakeEnv({ transferClient, loadLoopContext }));
  const twice = enrichEnv(once);
  assert.equal(once, twice);
  assert.equal(once.transferClient, transferClient);
  assert.equal(once.loadLoopContext, loadLoopContext);
});

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

test('wallet create reports signer_not_configured without Privy secrets', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(new Request('https://runtime/api/wallets', {
    method: 'POST',
    headers: { authorization: 'Bearer tok_1', 'x-owner-id': 'user_1' },
  }), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'signer_not_configured');
});

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

test('wallet create forwards browser origin into Privy acceptLogin', async () => {
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
  assert.equal(seen[0].origin, 'http://localhost:3000');

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
  assert.equal(seen[0].origin, 'http://localhost:3000');
});

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

test('profile lookup sends a handle to its owner and a .sol name through SNS', async () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const fetcher = async (url) => {
    const href = String(url);
    if (href.includes('profiles?handle=eq.alex')) {
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

test('bots.create upserts a shell bot when the wallet belongs to the owner', async () => {
  const writes = [];
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    if (init.method === 'POST') {
      writes.push({ href, body: JSON.parse(init.body), prefer: init.headers?.prefer });
      if (href.includes('/rest/v1/bots')) {
        return new Response(JSON.stringify([JSON.parse(init.body)]), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 201 });
    }
    if (href.includes('/rest/v1/wallets?')) {
      return Response.json([{ id: 'w_main', frozen: false }]);
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
});

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

test('bot text chat returns an OpenRouter reply for the owner', async () => {
  const env = fakeEnv({
    openRouter: {
      chat: async ({ message, botName }) => ({
        model: 'muse-spark-1.3-contributor',
        text: `${botName} heard: ${message}`,
      }),
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

test('bot delete is dispatched when Supabase is unconfigured', async () => {
  const res = await worker.fetch(new Request('https://runtime/api/bots/bot_1', {
    method: 'DELETE',
    headers: { 'x-owner-id': 'user_1' },
  }), fakeEnv());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'unconfigured');
});

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
});

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
  assert.equal((await failed.json()).error, 'profile_save_failed');

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

test('a claim for @alex quotes the Privy owner id on the confirm read', async () => {
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
      if (!filter.startsWith('eq."')) return Response.json({ code: 'PGRST100' }, { status: 400 });
      const owner = filter.slice(4, -1);
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
});

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
