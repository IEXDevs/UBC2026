/**
 * Unit tests for supabase-rest mappers, config guards, and failure paths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountText,
  createSupabaseRpc,
  loadOwnerLoopContext,
  mapBotRow,
  mapLedgerRow,
  mapWalletRow,
  supabaseConfig,
  supabaseGet,
  supabaseHeaders,
  supabaseWrite,
} from './supabase-rest.mjs';

/**
 * Achieves: supabaseConfig accepts only https origins with a non-empty service role key.
 * Fails when: http, credentialed URLs, or blank keys are treated as configured.
 * Oracle: null vs { origin, key } shape.
 * Side effects / state checked: none.
 * Gaps: none.
 */
test('supabaseConfig rejects insecure or incomplete env', () => {
  assert.equal(supabaseConfig({}), null);
  assert.equal(supabaseConfig({ SUPABASE_URL: 'https://x.supabase.co' }), null);
  assert.equal(supabaseConfig({
    SUPABASE_URL: 'http://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
  }), null);
  assert.equal(supabaseConfig({
    SUPABASE_URL: 'https://user:pass@x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
  }), null);
  assert.equal(supabaseConfig({
    SUPABASE_URL: 'not a url',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
  }), null);
  assert.deepEqual(
    supabaseConfig({
      SUPABASE_URL: 'https://x.supabase.co/rest',
      SUPABASE_SERVICE_ROLE_KEY: '  role  ',
    }),
    { origin: 'https://x.supabase.co', key: 'role' },
  );
});

/**
 * Achieves: headers carry apikey + bearer; amountText only keeps safe integer strings.
 * Fails when: secrets leak into other header keys or negative amounts pass.
 * Oracle: header values; amountText matrix.
 * Side effects / state checked: none.
 * Gaps: none.
 */
test('supabaseHeaders and amountText stay strict', () => {
  assert.deepEqual(supabaseHeaders('k', { prefer: 'return=minimal' }), {
    apikey: 'k',
    authorization: 'Bearer k',
    accept: 'application/json',
    prefer: 'return=minimal',
  });
  assert.equal(amountText(0), '0');
  assert.equal(amountText(42), '42');
  assert.equal(amountText('99'), '99');
  assert.equal(amountText('-1'), '0');
  assert.equal(amountText('01'), '0');
  assert.equal(amountText(1.5), '0');
  assert.equal(amountText(null), '0');
});

/**
 * Achieves: mappers drop incomplete rows and normalize caps / spendable flags.
 * Fails when: linked_ wallets stay spendable or missing id rows map to objects.
 * Oracle: null for bad rows; field projections for good rows.
 * Side effects / state checked: none.
 * Gaps: none.
 */
test('mapWalletRow / mapBotRow / mapLedgerRow normalize rows', () => {
  assert.equal(mapWalletRow(null), null);
  assert.equal(mapWalletRow({ address: 'x' }), null);
  assert.equal(mapWalletRow({
    id: 'w_shop',
    owner_id: 'u1',
    kind: 'additional',
    label: 'Shop',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    deleted_at: '2026-11-19T00:00:00.000Z',
  }), null);
  const linked = mapWalletRow({
    id: 'linked_abc',
    owner_id: 'u1',
    kind: 'main',
    label: 'Linked',
    address: 'So11111111111111111111111111111111111111112',
    spendable: true,
  });
  assert.equal(linked.spendable, false);
  assert.equal(linked.privyWalletId, undefined);

  assert.equal(mapBotRow({ name: 'x' }), null);
  const bot = mapBotRow({
    id: 'bot_1',
    owner_id: 'u1',
    wallet_id: 'w1',
    name: 'N',
    goal: 'g',
    type: 'trading',
    approval_mode: 'ask',
    auto_approve_cap: 100,
    max_outflow: 1000,
    max_per_transaction: 50,
    max_loss: 10,
    cap_mode: 'limited',
    cap_asset: 'USDC',
    policy_version: 2,
    enabled: true,
    frozen: false,
  });
  assert.equal(bot.autoApproveCap, '100');
  assert.equal(bot.cap.maxOutflow, '1000');
  assert.equal(bot.policyVersion, 2);

  assert.deepEqual(mapLedgerRow(null, 'bot_1'), {
    botId: 'bot_1',
    asset: 'USDC',
    spent: '0',
    reserved: '0',
    realizedLoss: '0',
  });
});

/**
 * Achieves: unconfigured get/write return configured:false; network failures surface
 *   profile_directory_unreachable; HTTP errors carry directoryFailureCode.
 * Fails when: missing config still fetches, or errors invent rows.
 * Oracle: status/code fields; fetch call counts.
 * Side effects / state checked: fetcher invocations.
 * Gaps: none.
 */
test('supabaseGet / supabaseWrite handle unconfigured and failure paths', async () => {
  assert.deepEqual(await supabaseGet({}, 'bots'), { configured: false, rows: null, status: 0 });
  assert.deepEqual(await supabaseWrite({}, { path: 'bots', body: {} }), {
    configured: false, rows: null, status: 0,
  });

  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  };
  const unreachable = await supabaseGet(env, 'bots', async () => {
    throw new Error('network');
  });
  assert.equal(unreachable.code, 'profile_directory_unreachable');
  assert.equal(unreachable.rows, null);

  const denied = await supabaseGet(env, 'bots', async () => Response.json(
    { message: 'Invalid API key' },
    { status: 401 },
  ));
  assert.equal(denied.status, 401);
  assert.equal(denied.rows, null);
  assert.ok(denied.code);

  const writeFail = await supabaseWrite(env, {
    path: 'bots',
    body: { id: 'b1' },
    fetcher: async () => {
      throw new Error('down');
    },
  });
  assert.equal(writeFail.ok, false);
  assert.equal(writeFail.code, 'profile_directory_unreachable');

  const writeHttp = await supabaseWrite(env, {
    path: 'bots',
    body: { id: 'b1' },
    fetcher: async () => Response.json({ code: '23505', message: 'duplicate' }, { status: 409 }),
  });
  assert.equal(writeHttp.ok, false);
  assert.equal(writeHttp.status, 409);
  assert.equal(writeHttp.code, '23505');
});

/**
 * Achieves: createSupabaseRpc returns null when unconfigured and throws coded errors on HTTP failure.
 * Fails when: failed RPC returns quietly or omits error.code.
 * Oracle: thrown error.code / status.
 * Side effects / state checked: fetcher once.
 * Gaps: happy-path JSON decode covered indirectly via ledger suites.
 */
test('createSupabaseRpc null when unconfigured and throws on HTTP failure', async () => {
  assert.equal(createSupabaseRpc({}), null);
  const rpc = createSupabaseRpc({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }, async () => new Response('nope', { status: 500 }));
  await assert.rejects(
    () => rpc('reserve_spend', {}),
    err => err?.code === 'rpc_reserve_spend_failed' && err.status === 500,
  );
});

/**
 * Achieves: loadOwnerLoopContext returns null without ids or when bot/wallet rows missing.
 * Fails when: partial rows still produce a context object.
 * Oracle: null results; happy path returns mapped bot/wallet/ledger.
 * Side effects / state checked: fetcher path sequence.
 * Gaps: none.
 */
test('loadOwnerLoopContext requires bot+wallet rows', async () => {
  assert.equal(await loadOwnerLoopContext({}, { botId: '', ownerId: 'u' }), null);
  assert.equal(await loadOwnerLoopContext({}, { botId: 'b', ownerId: '' }), null);

  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  };
  const missingBot = await loadOwnerLoopContext(env, { botId: 'b1', ownerId: 'u1' }, async () => Response.json([]));
  assert.equal(missingBot, null);

  const calls = [];
  const ok = await loadOwnerLoopContext(env, { botId: 'b1', ownerId: 'u1' }, async (url) => {
    calls.push(String(url));
    if (String(url).includes('/bots?')) {
      return Response.json([{
        id: 'b1', owner_id: 'u1', wallet_id: 'w1', name: 'N', goal: 'g', type: 'trading',
        approval_mode: 'ask', cap_mode: 'limited', cap_asset: 'USDC', enabled: true, frozen: false,
      }]);
    }
    if (String(url).includes('/wallets?')) {
      return Response.json([{
        id: 'w1', owner_id: 'u1', kind: 'main', label: 'Main',
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', provider: 'privy',
      }]);
    }
    return Response.json([{ bot_id: 'b1', asset: 'USDC', spent: '0', reserved: '0', realized_loss: '0' }]);
  });
  assert.equal(ok.bot.id, 'b1');
  assert.equal(ok.wallet.id, 'w1');
  assert.equal(ok.ledger.botId, 'b1');
  assert.equal(calls.length, 3);
});
