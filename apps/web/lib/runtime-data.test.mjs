import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  botChatUrl,
  deleteBotUrl,
  emptyMoneyState,
  fetchOwnerLists,
  firstAssignableWalletId,
  positionsFromStatus,
  runtimeBaseUrl,
  shellBotFromRemote,
  shellRuntimeUrl,
  upsertOwnerBot,
} from './runtime-data.mjs';

test('runtime base rejects junk and keeps origin', () => {
  assert.equal(runtimeBaseUrl(''), '');
  assert.equal(runtimeBaseUrl('not a url'), '');
  assert.equal(runtimeBaseUrl('https://maelstrom-agent-runtime.example.workers.dev/'), 'https://maelstrom-agent-runtime.example.workers.dev');
});

test('shell bot mapping never invents preview experience', () => {
  const bot = shellBotFromRemote({
    id: 'bot_1',
    name: 'Live',
    goal: 'Trade carefully',
    type: 'trading',
    walletId: 'w_main',
    ownerId: 'did:privy:x',
    enabled: true,
    frozen: false,
  }, { bot_1: { shape: 'hex', color: '#112233', name: 'Renamed' } });
  assert.equal(bot.name, 'Renamed');
  assert.equal(bot.shape, 'hex');
  assert.equal(bot.status, 'watching');
  assert.equal(bot.experience, undefined);
  assert.equal(shellBotFromRemote(null), null);
});

test('empty money state has no fake rows', () => {
  assert.deepEqual(emptyMoneyState(), {
    bots: [],
    wallets: [],
    payments: [],
    positions: [],
    paymentCrossCheck: [],
  });
});

test('delete bot URL stays on the runtime origin', () => {
  assert.equal(
    deleteBotUrl('https://runtime.example/agent/', 'bot_1'),
    'https://runtime.example/agent/api/bots/bot_1',
  );
  assert.equal(deleteBotUrl('https://runtime.example', '../evil'), null);
  assert.equal(deleteBotUrl('', 'bot_1'), null);
});

test('shell runtime URLs stay on the same-origin proxy', () => {
  assert.equal(shellRuntimeUrl('/api/bots'), '/api/runtime/api/bots');
  assert.equal(shellRuntimeUrl('/api/payments'), '/api/runtime/api/payments');
  assert.equal(shellRuntimeUrl('/api/wallets'), '/api/runtime/api/wallets');
  assert.equal(shellRuntimeUrl('/api/profiles/me'), '/api/runtime/api/profiles/me');
  assert.equal(shellRuntimeUrl('/api/transfers'), '/api/runtime/api/transfers');
  assert.equal(shellRuntimeUrl('/api/metrics'), '/api/runtime/api/metrics');
  assert.equal(shellRuntimeUrl('/api/logs'), '/api/runtime/api/logs');
  assert.equal(shellRuntimeUrl('/api/events?botId=bot_1'), '/api/runtime/api/events?botId=bot_1');
  assert.equal(shellRuntimeUrl('/api/decisions?botId=bot_1'), '/api/runtime/api/decisions?botId=bot_1');
  assert.equal(shellRuntimeUrl('/bots/bot_1/status'), '/api/runtime/bots/bot_1/status');
  assert.equal(shellRuntimeUrl('/api/routes'), null);
  assert.equal(shellRuntimeUrl('/api/events?token=secret'), null);
});

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

test('owner lists load bots, wallets, payments, and paper positions from the proxy', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith('/api/bots')) {
      return jsonResponse({ source: 'supabase', items: [{ id: 'bot_live', name: 'Live', type: 'trading' }] });
    }
    if (url.endsWith('/api/wallets')) {
      return jsonResponse({ items: [{ id: 'w1', address: 'Addr1111111111111111111111111111111111', kind: 'main', label: 'Main' }, { id: 'bad' }] });
    }
    if (url.endsWith('/api/payments')) {
      return jsonResponse({
        items: [
          { id: 'bad', amount: 'nope', asset: 'USDC' },
          { id: 'p2', botId: 'bot_live', direction: 'paid', protocol: 'x402', amount: '10', asset: 'USDC', counterparty: 'desk', cluster: 'devnet' },
        ],
        crossCheck: [
          { walletId: 'w1', alert: 'unapproved_spend', freeze: true, excess: '10', asset: 'USDC' },
          { walletId: 'w2', alert: 'other', freeze: false, excess: '1' },
        ],
      });
    }
    if (url.endsWith('/status')) {
      return jsonResponse({
        positionCheck: {
          positions: [{
            mint: 'So11111111111111111111111111111111111111112',
            amount: '1000',
            decimals: 9,
            entryMicroUsd: '2000',
            markMicroUsd: '1500',
            priceUsd: '1.5',
            quoteSource: 'jupiter',
            pricingCluster: 'mainnet',
          }],
        },
      });
    }
    return jsonResponse({});
  };
  const lists = await fetchOwnerLists('did:privy:abc', { fetcher });
  assert.ok(calls.every(url => url.startsWith('/api/runtime/')));
  assert.equal(lists.source, 'supabase');
  assert.equal(lists.bots.length, 1);
  assert.equal(lists.wallets.length, 1);
  assert.equal(lists.payments.length, 1);
  assert.equal(lists.paymentCrossCheck.length, 1);
  assert.equal(lists.paymentCrossCheck[0].walletId, 'w1');
  assert.equal(lists.positions.length, 1);
  assert.equal(lists.positions[0].pnlMicroUsdc, '-500');
  assert.equal(lists.positions[0].botId, 'bot_live');
  assert.equal(lists.positions[0].market, 'mainnet price');
  assert.deepEqual(positionsFromStatus('bot_live', { positionCheck: { positions: [{ amount: 'nope' }] } }), []);
  const unsigned = await fetchOwnerLists('');
  assert.equal(unsigned.source, 'unsigned');
  assert.deepEqual(unsigned.positions, []);
  assert.deepEqual(unsigned.bots, []);
});

test('bot chat URL uses the same-origin Next route', () => {
  assert.equal(botChatUrl('https://runtime.example/agent/', 'bot_1'), '/api/bots/bot_1/chat');
  assert.equal(botChatUrl('', 'bot_1'), '/api/bots/bot_1/chat');
  assert.equal(botChatUrl('https://runtime.example', '../evil'), null);
});

test('firstAssignableWalletId skips frozen wallets', () => {
  assert.equal(firstAssignableWalletId([]), '');
  assert.equal(firstAssignableWalletId([{ id: 'w_frozen', frozen: true }, { id: 'w_ok' }]), 'w_ok');
});

test('upsertOwnerBot posts the shell bot to the runtime proxy', async () => {
  const calls = [];
  const result = await upsertOwnerBot(
    'did:privy:abc',
    { id: 'bot_local', name: 'Local', goal: 'Watch', type: 'trading' },
    {
      walletId: 'w_main',
      accessToken: 'tok',
      fetcher: async (url, init) => {
        calls.push({ url, method: init.method, body: JSON.parse(init.body), owner: init.headers['x-owner-id'] });
        return {
          ok: true,
          json: async () => ({ ok: true, source: 'supabase', bot: { id: 'bot_local', walletId: 'w_main' } }),
        };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, '/api/runtime/api/bots');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].owner, 'did:privy:abc');
  assert.equal(calls[0].body.walletId, 'w_main');
  assert.equal(calls[0].body.id, 'bot_local');
  const missingWallet = await upsertOwnerBot('did:privy:abc', { id: 'bot_x', name: 'X' }, { fetcher: async () => ({}) });
  assert.equal(missingWallet.error, 'wallet_required');
});
