import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  botChatUrl,
  deleteBotUrl,
  emptyMoneyState,
  fetchOwnerLists,
  firstAssignableWalletId,
  positionsFromBook,
  positionsFromStatus,
  runtimeBaseUrl,
  sendBotChat,
  shellBotFromRemote,
  shellRuntimeUrl,
  upsertOwnerBot,
} from './runtime-data.mjs';

/**
 * Achieves: verifies runtime base rejects junk and keeps origin.
 * Fails when: runtime base rejects junk and keeps origin breaks (e.g. expected '', '', 'https://maelstrom-agent-runtime.example.workers.dev').
 * Oracle: assert.equal(runtimeBaseUrl(''), ''); assert.equal(runtimeBaseUrl('not a url'), ''); assert.equal(runtimeBaseUrl('https://maelstrom-agent-runtime.example.workers.dev/'), 'https://maelstrom-agent-
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('runtime base rejects junk and keeps origin', () => {
  assert.equal(runtimeBaseUrl(''), '');
  assert.equal(runtimeBaseUrl('not a url'), '');
  assert.equal(runtimeBaseUrl('https://maelstrom-agent-runtime.example.workers.dev/'), 'https://maelstrom-agent-runtime.example.workers.dev');
});

/**
 * Achieves: verifies shell bot mapping never invents preview experience.
 * Fails when: shell bot mapping never invents preview experience breaks (e.g. expected 'Renamed', 'hex', 'watching'); failure/null paths flip.
 * Oracle: assert.equal(bot.name, 'Renamed'); assert.equal(bot.shape, 'hex'); assert.equal(bot.status, 'watching'); assert.equal(bot.experience, undefined); assert.equal(shellBotFromRemote(null), null)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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
  assert.equal(bot.loop, null);
  assert.equal(shellBotFromRemote(null), null);
  const marked = shellBotFromRemote({
    id: 'bot_1',
    name: 'Live',
    loop: { active: true, purpose: 'Check positions', cooldownMinutes: 15, cooldownLabel: '15m', nextWakeAt: 1 },
  });
  assert.equal(marked.loop.purpose, 'Check positions');
  assert.equal(marked.loop.cooldownLabel, '15m');
  const short = shellBotFromRemote({
    id: 'bot_1',
    name: 'Live',
    loop: { active: true, purpose: 'Check positions', cooldownMinutes: 10, cooldownLabel: '10m' },
  });
  assert.equal(short.loop, null);
});

/**
 * Achieves: verifies empty money state has no fake rows.
 * Fails when: structured result drifts from expected shape.
 * Oracle: assert.deepEqual(emptyMoneyState(), { bots: [], wallets: [], payments: [], positions: [], paymentCrossCheck: [
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('empty money state has no fake rows', () => {
  assert.deepEqual(emptyMoneyState(), {
    bots: [],
    wallets: [],
    payments: [],
    positions: [],
    paymentCrossCheck: [],
  });
});

/**
 * Achieves: verifies delete bot URL stays on the runtime origin.
 * Fails when: delete bot URL stays on the runtime origin breaks (e.g. expected 'bot_1', '../evil', 'bot_1'); failure/null paths flip.
 * Oracle: assert.equal( deleteBotUrl('https://runtime.example/agent/', 'bot_1'); assert.equal(deleteBotUrl('https://runtime.example', '../evil'); assert.equal(deleteBotUrl('', 'bot_1')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('delete bot URL stays on the runtime origin', () => {
  assert.equal(
    deleteBotUrl('https://runtime.example/agent/', 'bot_1'),
    'https://runtime.example/agent/api/bots/bot_1',
  );
  assert.equal(deleteBotUrl('https://runtime.example', '../evil'), null);
  assert.equal(deleteBotUrl('', 'bot_1'), null);
});

/**
 * Achieves: verifies shell runtime URLs stay on the same-origin proxy.
 * Fails when: shell runtime URLs stay on the same-origin proxy breaks (e.g. expected '/api/runtime/api/bots', '/api/runtime/api/payments', '/api/runtime/api/wallets'); failure/null paths flip.
 * Oracle: assert.equal(shellRuntimeUrl('/api/bots'), '/api/runtime/api/bots'); assert.equal(shellRuntimeUrl('/api/payments'), '/api/runtime/api/payments'); assert.equal(shellRuntimeUrl('/api/wallets'), '/api/runtime/api/wallets'); assert.equal(shellRuntimeUrl('/api/profiles/me'), '/api/runtime/api/profiles/me'); assert.equal(shellRuntimeUrl('/api/transfers'), '/api/runtime/api/transfers'); assert.equal(shellRuntimeUrl('/api/metrics'), '/api/runtime/api/metrics')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies owner lists load bots, wallets, payments, and paper positions from the proxy.
 * Fails when: owner lists load bots, wallets, payments, and paper positions from the proxy breaks (e.g. expected 'supabase', 1, 1).
 * Oracle: assert.equal(lists.source, 'supabase'); assert.equal(lists.bots.length, 1); assert.equal(lists.wallets.length, 1); assert.equal(lists.payments.length, 1); assert.equal(lists.paymentCrossCheck.length, 1); assert.equal(lists.paymentCrossCheck[0].walletId, 'w1')
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
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
          { id: 'p2', botId: 'bot_live', direction: 'paid', protocol: 'x402', amount: '10', asset: 'USDC', counterparty: 'desk', cluster: 'mainnet-beta' },
        ],
        crossCheck: [
          { walletId: 'w1', alert: 'unapproved_spend', freeze: true, excess: '10', asset: 'USDC' },
          { walletId: 'w2', alert: 'other', freeze: false, excess: '1' },
        ],
      });
    }
    if (url.endsWith('/api/positions')) {
      return jsonResponse({
        items: [
          {
            id: 'pos_1',
            botId: 'bot_live',
            mint: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            quantity: '25000000',
            entryMicroUsdc: '2000',
            realizedMicroUsdc: '0',
            cluster: 'mainnet-beta',
            mode: 'supply',
          },
          { id: 'pos_zero', botId: 'bot_live', quantity: '0', mint: 'mint' },
          { id: 'bad' },
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
  assert.ok(calls.some(url => url.endsWith('/api/positions')));
  assert.equal(lists.positions.length, 1);
  assert.equal(lists.positions[0].id, 'pos_1');
  assert.equal(lists.positions[0].amount, '25000000');
  assert.equal(lists.positions[0].asset, 'SOL');
  assert.equal(lists.positions[0].pnlMicroUsdc, '-500');
  assert.equal(lists.positions[0].botId, 'bot_live');
  assert.equal(lists.positions[0].market, undefined);
  assert.deepEqual(positionsFromBook([{ id: 'x', botId: 'bot_live', quantity: 'nope' }], []), []);
  assert.deepEqual(positionsFromStatus('bot_live', { positionCheck: { positions: [{ amount: 'nope' }] } }), []);
  const unsigned = await fetchOwnerLists('');
  assert.equal(unsigned.source, 'unsigned');
  assert.deepEqual(unsigned.positions, []);
  assert.deepEqual(unsigned.bots, []);
});

/**
 * Achieves: verifies bot chat URL uses the same-origin Next route.
 * Fails when: bot chat URL uses the same-origin Next route breaks (e.g. expected 'bot_1', 'bot_1', '../evil'); failure/null paths flip.
 * Oracle: assert.equal(botChatUrl('https://runtime.example/agent/', 'bot_1'); assert.equal(botChatUrl('', 'bot_1'); assert.equal(botChatUrl('https://runtime.example', '../evil')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('bot chat URL uses the same-origin Next route', () => {
  assert.equal(botChatUrl('https://runtime.example/agent/', 'bot_1'), '/api/bots/bot_1/chat');
  assert.equal(botChatUrl('', 'bot_1'), '/api/bots/bot_1/chat');
  assert.equal(botChatUrl('https://runtime.example', '../evil'), null);
});

/**
 * Achieves: verifies sendBotChat forwards Privy Bearer to the chat route.
 * Fails when: Authorization is omitted while accessToken is provided.
 * Oracle: headers.authorization === Bearer tok; reply ok.
 * Side effects / state checked: global fetch double.
 * Gaps: none.
 */
test('sendBotChat forwards Bearer access token', async () => {
  const prior = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return Response.json({ reply: 'hello', usage: { total: 3 } });
  };
  try {
    const result = await sendBotChat({
      ownerId: 'did:privy:abc',
      botId: 'bot_1',
      message: 'show wallets',
      accessToken: 'tok',
      shellWallets: [{ id: 'w_main' }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.reply, 'hello');
    assert.equal(calls[0].url, '/api/bots/bot_1/chat');
    assert.equal(calls[0].headers.authorization, 'Bearer tok');
    assert.equal(calls[0].headers['x-owner-id'], 'did:privy:abc');
    assert.equal(calls[0].body.shellWallets[0].id, 'w_main');
    const grant = 'ab'.repeat(32);
    await sendBotChat({
      ownerId: 'did:privy:abc',
      botId: 'bot_1',
      message: 'buy',
      deskGrant: grant,
    });
    assert.equal(calls[1].headers['x-desk-grant'], grant);
    assert.equal(JSON.stringify(calls[1].body).includes(grant), false);
    await sendBotChat({
      ownerId: 'did:privy:abc',
      botId: 'bot_1',
      message: 'weather',
      situation: { timeZone: 'America/Chicago', place: 'Austin, Texas', locale: 'en-US', extra: 'nope' },
    });
    assert.equal(calls[2].body.situation.timeZone, 'America/Chicago');
    assert.equal(calls[2].body.situation.place, 'Austin, Texas');
    assert.equal(calls[2].body.situation.locale, 'en-US');
    assert.equal(calls[2].body.situation.extra, undefined);
  } finally {
    globalThis.fetch = prior;
  }
});

/**
 * Achieves: an aborted chat fetch stays quiet instead of looking like a network failure.
 * Fails when: AbortError is reported as network, or the signal is dropped.
 * Oracle: result.error === 'aborted' and fetch received the signal.
 * Side effects / state checked: global fetch double.
 * Gaps: none.
 */
test('sendBotChat maps an aborted fetch to aborted', async () => {
  const prior = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  };
  try {
    const result = await sendBotChat({
      ownerId: 'did:privy:abc',
      botId: 'bot_1',
      message: 'wait',
      signal: controller.signal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'aborted');
  } finally {
    globalThis.fetch = prior;
  }
});

/**
 * Achieves: a streamed send shows the Solscan line before the turn's closing payload.
 * Fails when: onReply waits for the done event, or the closing reply is dropped.
 * Oracle: onReply receives the Solscan line first; result.replies has both lines.
 */
test('sendBotChat delivers a streamed Solscan line before the turn finishes', async () => {
  const prior = globalThis.fetch;
  const seen = [];
  const signature = '5'.repeat(64);
  const url = `https://solscan.io/tx/${signature}`;
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: `Sent. ${url}` })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          done: true,
          ok: true,
          reply: '1 SOL is on the way to @hi.',
          replies: [`Sent. ${url}`, '1 SOL is on the way to @hi.'],
        })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const result = await sendBotChat({
      ownerId: 'did:privy:abc',
      botId: 'bot_1',
      message: 'send 1 SOL to @hi',
      onReply: (text) => seen.push(text),
    });
    assert.deepEqual(seen, [`Sent. ${url}`]);
    assert.equal(result.ok, true);
    assert.equal(result.reply, '1 SOL is on the way to @hi.');
    assert.deepEqual(result.replies, [`Sent. ${url}`, '1 SOL is on the way to @hi.']);
  } finally {
    globalThis.fetch = prior;
  }
});

/**
 * Achieves: verifies firstAssignableWalletId skips frozen wallets.
 * Fails when: firstAssignableWalletId skips frozen wallets breaks (e.g. expected '', frozen: true }, { id: 'w_ok' }]).
 * Oracle: assert.equal(firstAssignableWalletId([]), ''); assert.equal(firstAssignableWalletId([{ id: 'w_frozen', frozen: true }, { id: 'w_ok' }])
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('firstAssignableWalletId skips frozen wallets', () => {
  assert.equal(firstAssignableWalletId([]), '');
  assert.equal(firstAssignableWalletId([{ id: 'w_frozen', frozen: true }, { id: 'w_ok' }]), 'w_ok');
});

/**
 * Achieves: verifies upsertOwnerBot posts the shell bot to the runtime proxy.
 * Fails when: upsertOwnerBot posts the shell bot to the runtime proxy breaks (e.g. expected true, '/api/runtime/api/bots', 'POST').
 * Oracle: assert.equal(result.ok, true); assert.equal(calls[0].url, '/api/runtime/api/bots'); assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].owner, 'did:privy:abc'); assert.equal(calls[0].body.walletId, 'w_main'); assert.equal(calls[0].body.id, 'bot_local')
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
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
