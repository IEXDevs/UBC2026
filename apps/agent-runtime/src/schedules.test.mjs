import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } from '@ubc2026/wallets/privy';
import { BotStateMachine } from './bot-do.mjs';
import {
  HOURLY_CRON,
  STREAM_DROP_AFTER_MS,
  STREAM_FALLBACK_CRON,
  assessPositions,
  isStreamDropped,
  listScheduledBotsFromSupabase,
  planScheduledWork,
  readDevnetUsdcBalance,
  readDevnetWalletBalances,
  parseTokenAccountsByMint,
  readStreamHealthFromSupabase,
  SPL_TOKEN_PROGRAM_ID,
} from './schedules.mjs';

const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const now = 1_700_000_000_000;
const secretUrl = 'https://example.invalid/quicknode-secret-path';

/**
 * Achieves: hourly plan includes trading bots and excludes shopping.
 * Fails when: shopping included or trading skipped.
 * Oracle: plan membership.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('the hourly plan checks trading bots and skips shopping', () => {
  const plan = planScheduledWork({
    cron: HOURLY_CRON,
    now,
    health: { lastEventAt: now, status: 'up' },
    bots: [
      { id: 'trade', type: 'trading', address },
      { id: 'desk', type: 'position-management', address },
      { id: 'shop', type: 'shopping', address },
      { id: 'off', type: 'trading', enabled: false, address },
    ],
  });
  assert.equal(plan.streamDropped, false);
  assert.deepEqual(plan.positionChecks.map(bot => bot.id), ['trade', 'desk']);
  assert.equal(plan.recheckBots.length, 0);
});

/**
 * Achieves: stale stream schedules exactly one RPC re-check per wallet.
 * Fails when: zero/many re-checks per wallet.
 * Oracle: one re-check entry per wallet.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('a stream older than an hour schedules one RPC re-check per wallet', () => {
  const fresh = isStreamDropped({ lastEventAt: now - STREAM_DROP_AFTER_MS, status: 'up' }, now);
  const stale = isStreamDropped({ lastEventAt: now - STREAM_DROP_AFTER_MS - 1, status: 'up' }, now);
  assert.equal(fresh, false);
  assert.equal(stale, true);
  const plan = planScheduledWork({
    cron: STREAM_FALLBACK_CRON,
    now,
    health: { lastEventAt: null, status: 'unknown' },
    bots: [
      { id: 'trade', type: 'trading', address },
      { id: 'shop', type: 'shopping', address },
      { id: 'other', type: 'trading', address: 'So11111111111111111111111111111111111111112' },
    ],
  });
  assert.equal(plan.hourly, false);
  assert.equal(plan.positionChecks.length, 0);
  assert.equal(plan.walletRechecks.length, 2);
  assert.deepEqual(plan.walletRechecks[0].botIds, ['trade', 'shop']);
});

/**
 * Achieves: paper loss raises max-loss without retaining provider-only fields.
 * Fails when: max-loss not flagged or extras retained.
 * Oracle: flag present; extras absent.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('paper loss flags max-loss without keeping provider extras', () => {
  const check = assessPositions({
    bot: { id: 'desk', maxLoss: '400000' },
    now,
    reason: 'cron-hourly',
    positions: [{ mint: address, amount: '1000000', decimals: 6, entryPriceUsd: '2.00' }],
    quotes: {
      [address]: { priceUsd: '1.50', quoteSource: 'dexscreener', pairUrl: secretUrl },
    },
  });
  assert.equal(check.flag, 'max-loss');
  assert.equal(check.unrealizedLossMicroUsd, '500000');
  assert.equal(check.positions[0].markMicroUsd, '1500000');
  assert.equal(JSON.stringify(check).includes(secretUrl), false);

  const held = assessPositions({
    bot: { id: 'desk', maxLoss: '500000' },
    now,
    positions: [{ mint: address, amount: '1000000', decimals: 6, entryPriceUsd: '2.00' }],
    quotes: { [address]: { priceUsd: '1.50' } },
  });
  assert.equal(held.flag, 'within-cap');
});

/**
 * Achieves: USDC read refuses non-devnet clusters and never echoes RPC URL.
 * Fails when: other cluster accepted or RPC URL in output.
 * Oracle: refusal + no URL leak.
 * Side effects / state checked: RPC mocks.
 * Gaps: none
 */
test('a devnet USDC read refuses other clusters and hides the RPC URL', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    const body = JSON.parse(init.body);
    if (body.method === 'getGenesisHash') {
      return Response.json({ jsonrpc: '2.0', id: 1, result: 'mainnet-genesis-not-devnet' });
    }
    throw new Error('balance should not be read');
  };
  const refused = await readDevnetUsdcBalance({ rpcUrl: secretUrl, address, fetcher });
  assert.equal(refused.code, 'wrong_cluster');
  assert.equal(JSON.stringify(refused).includes('quicknode-secret-path'), false);
  assert.equal(calls[0], secretUrl);

  const ok = await readDevnetUsdcBalance({
    rpcUrl: secretUrl,
    address,
    fetcher: async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH });
      }
      if (body.method === 'getBalance') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 9 } });
      }
      assert.equal(body.method, 'getTokenAccountsByOwner');
      assert.equal(body.params[1].programId, SPL_TOKEN_PROGRAM_ID);
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: [{
            account: {
              data: { parsed: { info: { mint: DEVNET_USDC_MINT, tokenAmount: { amount: '42', decimals: 6 } } } },
            },
          }],
        },
      });
    },
  });
  assert.equal(ok.amount, '42');
  assert.equal(ok.mint, DEVNET_USDC_MINT);
  assert.equal(JSON.stringify(ok).includes(secretUrl), false);

  const both = await readDevnetWalletBalances({
    rpcUrl: secretUrl,
    address,
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH });
      }
      if (body.method === 'getBalance') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 2_000_000_000 } });
      }
      return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
    },
  });
  assert.equal(both.ok, true);
  assert.equal(both.solLamports, '2000000000');
  assert.equal(both.usdcAmount, '0');
  assert.deepEqual(both.tokens, []);

  const otherMint = 'So11111111111111111111111111111111111111112';
  const parsed = parseTokenAccountsByMint([
    {
      account: {
        data: {
          parsed: {
            info: { mint: DEVNET_USDC_MINT, tokenAmount: { amount: '10', decimals: 6 } },
          },
        },
      },
    },
    {
      account: {
        data: {
          parsed: {
            info: { mint: otherMint, tokenAmount: { amount: '5000000000', decimals: 9 } },
          },
        },
      },
    },
    {
      account: {
        data: {
          parsed: {
            info: { mint: otherMint, tokenAmount: { amount: '0', decimals: 9 } },
          },
        },
      },
    },
  ]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tokens.length, 2);
  assert.equal(parsed.tokens[0].symbol, 'USDC');
  assert.equal(parsed.tokens[0].amount, '10');
  assert.equal(parsed.tokens[1].amount, '5000000000');

  const missing = await readDevnetUsdcBalance({ address, fetcher: async () => { throw new Error('no'); } });
  assert.equal(missing.code, 'rpc_not_configured');
});

/**
 * Achieves: schedule Supabase reads return empty without service key.
 * Fails when: invented rows without key.
 * Oracle: empty result.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('supabase schedule reads stay empty without a service key', async () => {
  let called = false;
  const bots = await listScheduledBotsFromSupabase({ SUPABASE_URL: 'https://db.example' }, async () => {
    called = true;
    return Response.json([]);
  });
  const health = await readStreamHealthFromSupabase({}, async () => {
    called = true;
    return Response.json([]);
  });
  assert.equal(called, false);
  assert.deepEqual(bots, []);
  assert.equal(health.source, 'unconfigured');
});

/**
 * Achieves: configured reads map bots and latest stream delivery fields.
 * Fails when: mapping wrong or stale delivery chosen.
 * Oracle: mapped bot/stream fields.
 * Side effects / state checked: Supabase fixtures.
 * Gaps: none
 */
test('supabase schedule reads map bots and the latest stream delivery', async () => {
  const key = 'service-role-test';
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url, apikey: init.headers.apikey });
    if (String(url).includes('stream_events')) {
      return Response.json([{ processed_at: '2026-11-14T04:00:00.000Z' }]);
    }
    return Response.json([{
      id: 'bot_1',
      goal: 'watch',
      type: 'position-management',
      enabled: true,
      max_loss: '100',
      wallets: { address },
    }]);
  };
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: key };
  const bots = await listScheduledBotsFromSupabase(env, fetcher);
  const health = await readStreamHealthFromSupabase(env, fetcher);
  assert.equal(bots[0].address, address);
  assert.equal(bots[0].maxLoss, '100');
  assert.equal(health.lastEventAt, Date.parse('2026-11-14T04:00:00.000Z'));
  assert.equal(seen.every(call => call.apikey === key), true);
  assert.equal(seen.every(call => !String(call.url).includes(key)), true);
});

/**
 * Achieves: position check leaves paused runs unmoved.
 * Fails when: paused run advances.
 * Oracle: run state unchanged.
 * Side effects / state checked: machine state.
 * Gaps: none
 */
test('a position check does not move a paused run', async () => {
  const machine = new BotStateMachine();
  await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1', goal: 'watch' }),
  }));
  await machine.handle(new Request('https://bot/pause', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'owner' }),
  }));
  const checked = await machine.handle(new Request('https://bot/position-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      botId: 'bot_1',
      now,
      reason: 'stream-drop-recheck',
      maxLoss: '10',
      balance: { ok: true, amount: '7', address, rpcUrl: secretUrl, cluster: 'devnet' },
    }),
  }));
  assert.equal(checked.status, 200);
  const body = await checked.json();
  assert.equal(body.check.flag, 'stream-fallback');
  assert.equal(body.check.balance.amount, '7');
  assert.equal(JSON.stringify(body).includes(secretUrl), false);
  const status = await machine.handle(new Request('https://bot/status'));
  const saved = await status.json();
  assert.equal(saved.run.paused, true);
  assert.equal(saved.run.step, 'research');
  assert.equal(saved.positionCheck.balance.amount, '7');
});
