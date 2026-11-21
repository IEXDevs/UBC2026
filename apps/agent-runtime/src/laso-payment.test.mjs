import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { issueLasoTicket, prepareLasoPayment, readLasoTicket, settleLasoPayment } from './laso-payment.mjs';
import worker from './owner-auth.fixture.mjs';
import { sha256Hex } from './desk-grant.mjs';

const now = 1_700_000_000_000;
const accepted = { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: '10000000',
  payTo: '3MZVk97x9SeRxbYpc3jhzRfU2fyA3emYutnqfn9kNfYX', maxTimeoutSeconds: 300,
  extra: { feePayer: 'BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP' } };
const resource = { url: 'https://laso.finance/get-card?amount=10' };
const result = { challenge: { accepted }, resource };

test('Laso payment spends the USDC token account that holds the balance', async () => {
  const walletAddress = Keypair.generate().publicKey.toBase58();
  const funded = Keypair.generate().publicKey.toBase58();
  let seen;
  const env = { transferClient: {
    getSolanaBlockhash: async () => ({ cluster: 'mainnet-beta', blockhash: Keypair.generate().publicKey.toBase58() }),
    listSolanaUsdcAccounts: async ({ address }) => {
      assert.equal(address, walletAddress);
      return [{ address: funded, amount: '5000000' }];
    },
    prepareSolanaX402Payment: async input => {
      seen = input.sourceTokenAccount;
      return { transaction: input.transaction };
    },
  } };
  const ticket = { accepted: { ...accepted, amount: '5000000' } };
  await prepareLasoPayment(env, { wallet: { address: walletAddress } }, ticket);
  assert.equal(seen, funded);
  env.transferClient.listSolanaUsdcAccounts = async () => [{ address: funded, amount: '4999999' }];
  await assert.rejects(
    prepareLasoPayment(env, { wallet: { address: walletAddress } }, ticket),
    error => error.code === 'simulation_failed' && error.simulationReason === 'source_account_not_found',
  );
});

test('Laso HMAC tickets bind every payment term, identity, URL and timeout', () => {
  for (const timeout of [30, 300, 600]) {
    const ticket = issueLasoTicket({ ...result, challenge: { accepted: { ...accepted, maxTimeoutSeconds: timeout } } }, 'user_1', 'bot_1', 'offline-key', now);
    const state = readLasoTicket(ticket, 'user_1', 'bot_1', 'offline-key', now);
    assert.equal(state.expiresAt, now + Math.min(300, timeout) * 1000);
    assert.deepEqual(state.resource, resource);
    assert.equal(state.amount, '10000000');
    assert.equal(state.accepted.extra.feePayer, accepted.extra.feePayer);
    for (const [owner, bot, key, time] of [['other', 'bot_1', 'offline-key', now], ['user_1', 'other', 'offline-key', now],
      ['user_1', 'bot_1', 'wrong-key', now], ['user_1', 'bot_1', 'offline-key', state.expiresAt]]) {
      assert.equal(readLasoTicket(ticket, owner, bot, key, time), null);
    }
    for (const patch of [{ amount: '5000000' }, { resource: { url: 'https://attacker.invalid' } }, { accepted: { ...accepted, payTo: accepted.extra.feePayer } }]) {
      const payload = Buffer.from(JSON.stringify({ ...state, ...patch })).toString('base64url');
      assert.equal(readLasoTicket(`${payload}.${ticket.split('.')[1]}`, 'user_1', 'bot_1', 'offline-key', now), null);
    }
  }
  for (const ticket of [null, '', 'bad', 'a'.repeat(6000)]) assert.equal(readLasoTicket(ticket, 'user_1', 'bot_1', 'offline-key', now), null);
});

test('Laso settles only via PAYMENT-SIGNATURE and exchanges then discards auth tokens', async () => {
  const transaction = Buffer.from('mock-partially-signed-transaction').toString('base64');
  const signature = '5'.repeat(88);
  const ticket = { ...result, accepted, amount: accepted.amount };
  let mode = 'ok';
  let calls = 0;
  const env = { fetch: async (url, init) => {
    calls++;
    if (url === 'https://laso.finance/get-auth-link') {
      assert.equal(init.headers.Authorization, 'Bearer private-id-token');
      return Response.json({ auth_url: mode === 'unsafe-link' ? 'https://attacker.invalid' : 'https://laso.finance/agent/dashboard/auth?token=owner-only' });
    }
    assert.equal(url, resource.url);
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(JSON.parse(Buffer.from(init.headers['PAYMENT-SIGNATURE'], 'base64')), {
      x402Version: 2, resource, accepted, payload: { transaction },
    });
    if (mode === 'network') throw new Error('secret transport error');
    if (mode === 'rejected') return Response.json({}, { status: 402 });
    if (mode === 'server-error') return Response.json({}, { status: 500 });
    return Response.json({ auth: { id_token: 'private-id-token', refresh_token: 'private-refresh-token' },
      card: { card_id: 'card_123', usd_amount: 10, status: 'pending', secret: 'not-returned' } }, {
      headers: mode === 'missing-receipt' ? {} : { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, network: accepted.network, transaction: signature })).toString('base64') },
    });
  } };
  const settled = await settleLasoPayment(env, ticket, transaction);
  assert.deepEqual(settled, { cluster: 'mainnet-beta', signature, card: { card_id: 'card_123', usd_amount: 10, status: 'pending' }, claimUrl: 'https://laso.finance/agent/dashboard/auth?token=owner-only' });
  assert.equal(JSON.stringify(settled).includes('private-'), false);
  mode = 'unsafe-link';
  assert.equal((await settleLasoPayment(env, ticket, transaction)).claimUrl, undefined);
  for (const failure of ['network', 'rejected', 'server-error', 'missing-receipt']) {
    mode = failure;
    const before = calls;
    await assert.rejects(settleLasoPayment(env, ticket, transaction), { message: failure === 'rejected' ? 'laso_payment_rejected' : 'laso_settlement_unknown' });
    assert.equal(calls, before + 1, 'never automatically retry an uncertain payment');
  }
});

for (const asset of ['USDC', 'USD']) for (const browser of [false, true]) test(`Laso ${browser ? 'browser' : 'server'} purchase uses the shared ${asset} gates and a single reservation`, async () => {
  const grant = '12'.repeat(32);
  const grantHash = await sha256Hex(grant);
  const wallet = { id: 'wallet_laso', ownerId: 'user_1', kind: 'main', label: 'Main',
    address: 'So11111111111111111111111111111111111111112', provider: 'privy', frozen: false };
  const bot = { id: 'bot_1', ownerId: 'user_1', walletId: wallet.id, name: 'Cards', goal: 'Buy a card',
    type: 'shopping', enabled: true, frozen: false, policyVersion: 1, approvalMode: 'ask',
    cap: { mode: 'limited', asset, maxOutflow: '50000000', maxPerTransaction: '20000000' } };
  const ledger = { botId: bot.id, asset, spent: '0', reserved: '0', realizedLoss: '0' };
  const reservations = new Set();
  let signs = 0;
  let paid = 0;
  let simulationError = false;
  const signature = '5'.repeat(88);
  const env = {
    spendNow: now, trustLookup: null, SUPABASE_URL: 'https://laso-store.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline-key',
    loadSpendContext: async () => ({ bot, wallet, ledger }),
    lookupSpendPrice: async mint => ({ mint, priceUsd: '1', fetchedAt: new Date(now).toISOString(), pricingCluster: 'mainnet', executionCluster: 'mainnet-beta' }),
    transferClient: {
      getSolanaBlockhash: async () => ({ cluster: 'mainnet-beta', blockhash: wallet.address }),
      prepareSolanaX402Payment: async input => {
        assert.equal(input.accepted.extra.feePayer, accepted.extra.feePayer);
        assert.ok(input.sourceTokenAccount);
        assert.ok(input.destinationTokenAccount);
        if (simulationError) throw Object.assign(new Error('private RPC details'), { code: 'simulation_failed', simulationReason: simulationError === true ? 'insufficient_funds' : simulationError });
        return { transaction: input.transaction, feeLamports: '0', maxSolCost: '0' };
      },
      signPreparedSolanaX402Payment: async ({ prepared }) => { signs++; return { transaction: prepared.transaction }; },
      verifyPreparedSolanaX402Payment: async ({ prepared, signedTransaction }) => {
        assert.equal(browser, true);
        assert.equal(signedTransaction, prepared.transaction);
        return { transaction: signedTransaction };
      },
    },
    ledgerApi: { reserveBudget: async ({ proposal, idempotencyKey, approvalId }) => {
      assert.ok(approvalId);
      assert.equal(proposal.asset, asset);
      assert.equal(proposal.outflow, '10000000');
      assert.equal(proposal.expectedReceive, '1');
      const replay = reservations.has(idempotencyKey);
      reservations.add(idempotencyKey);
      return { state: 'reserved', replay };
    } },
    fetch: async (url, init) => {
      const target = new URL(url);
      if (target.origin === 'https://laso.finance') {
        assert.equal(target.searchParams.get('amount'), '10');
        assert.equal(target.pathname, '/get-card');
        if (!init.headers['PAYMENT-SIGNATURE']) return Response.json({ x402Version: 2, accepts: [accepted] }, { status: 402 });
        paid++;
        const payload = JSON.parse(Buffer.from(init.headers['PAYMENT-SIGNATURE'], 'base64'));
        assert.equal(payload.payload.transaction.length > 0, true);
        assert.deepEqual(payload.accepted, accepted);
        return Response.json({ card: { card_id: 'card_123', usd_amount: 10, status: 'pending' }, auth: { refresh_token: 'never-returned' } }, {
          headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, transaction: signature, network: accepted.network })).toString('base64') },
        });
      }
      assert.equal(target.origin, 'https://laso-store.invalid', 'all requests must remain mocked');
      if (target.pathname.endsWith('/desk_locks')) return Response.json([{ grant_hash: grantHash, grant_until: new Date(now + 60_000).toISOString() }]);
      if (target.pathname.endsWith('/bots')) return Response.json([{ ...bot, owner_id: bot.ownerId, wallet_id: wallet.id,
        policy_version: 1, approval_mode: 'ask', cap_mode: 'limited', cap_asset: asset, max_outflow: '50000000', max_per_transaction: '20000000' }]);
      if (target.pathname.endsWith('/wallets')) return Response.json([{ ...wallet, owner_id: wallet.ownerId }]);
      if (target.pathname.endsWith('/spend_ledgers')) return Response.json([ledger]);
      if (target.pathname.endsWith('/approvals')) return new Response(null, { status: 201 });
      return Response.json([]);
    },
  };
  const headers = { 'x-owner-id': 'user_1', 'x-desk-grant': grant, 'content-type': 'application/json' };
  const prep = await worker.fetch(new Request('https://runtime/bots/bot_1/shopping/prepare', { method: 'POST', headers, body: JSON.stringify({ provider: 'laso', amountUsd: 10 }) }), env);
  assert.equal(prep.status, 200);
  const offer = await prep.json();
  assert.match(offer.instruction, /NOT a purchase/);
  assert.equal(readLasoTicket(offer.lasoTicket, 'user_1', 'bot_1', 'offline-key', now).amount, '10000000');
  const body = { permission: 'full', botId: 'bot_1', action: 'x402', asset: 'USDC', amount: '10000000', lasoTicket: offer.lasoTicket, idempotencyKey: 'test_laso' };
  const request = async (patch = {}, grantHeader = grant) => {
    const response = await worker.fetch(new Request('https://runtime/api/spend', { method: 'POST', headers: { ...headers, 'x-desk-grant': grantHeader }, body: JSON.stringify({ ...body,
      ...(browser && patch.confirmed ? { lasoPayment: { phase: 'prepare' } } : {}), ...patch }) }), env);
    return response.json();
  };
  assert.equal((await request()).state, 'approval-needed');
  assert.equal(signs, 0);
  assert.equal(reservations.size, 0);
  assert.equal((await request({ confirmed: true }, '')).error, 'desk_locked');
  assert.equal((await request({ amount: '5000000', confirmed: true })).error, 'laso_ticket_invalid');
  bot.frozen = true;
  assert.equal((await request({ confirmed: true })).signed, false);
  bot.frozen = false;
  env.spendTrustScore = '0';
  assert.equal((await request({ confirmed: true })).signed, false);
  env.spendTrustScore = '800';
  bot.cap.maxPerTransaction = '5000000';
  assert.equal((await request({ confirmed: true })).signed, false);
  bot.cap.maxPerTransaction = '20000000';
  simulationError = true;
  assert.deepEqual(await request({ confirmed: true }), { error: 'simulation_failed', signed: false, simulationReason: 'insufficient_funds' });
  simulationError = 'source_account_not_found';
  const missingSource = await request({ confirmed: true });
  assert.equal(missingSource.signed, false);
  assert.equal(missingSource.simulationReason, 'source_account_not_found');
  assert.match(missingSource.hint, new RegExp(wallet.address));
  simulationError = false;
  assert.equal(signs, 0);
  assert.equal(reservations.size, 0);
  let lasoPayment;
  if (browser) {
    const prepared = await request({ confirmed: true });
    assert.equal(prepared.signed, false);
    assert.equal(prepared.lasoPayment.phase, 'prepared');
    assert.equal(signs, 0);
    assert.equal(paid, 0);
    assert.equal(reservations.size, 0, 'preparing must not reserve or settle');
    lasoPayment = { ...prepared.lasoPayment, phase: 'settle' };
    assert.equal((await request({ confirmed: true, lasoPayment: { ...lasoPayment, proof: '0'.repeat(64) } })).signed, false);
    bot.policyVersion++;
    assert.equal((await request({ confirmed: true, lasoPayment })).reason, 'laso_payment_changed');
    bot.policyVersion--;
    bot.frozen = true;
    assert.equal((await request({ confirmed: true, lasoPayment })).signed, false);
    bot.frozen = false;
    env.spendTrustScore = '0';
    assert.equal((await request({ confirmed: true, lasoPayment })).signed, false);
    env.spendTrustScore = '800';
    bot.cap.maxPerTransaction = '5000000';
    assert.equal((await request({ confirmed: true, lasoPayment })).signed, false);
    bot.cap.maxPerTransaction = '20000000';
    env.spendVerifyFn = async () => ({});
    assert.equal((await request({ confirmed: true, lasoPayment })).signed, false);
    delete env.spendVerifyFn;
    assert.equal((await request({ confirmed: true, lasoPayment: { ...lasoPayment, expiresAt: now } })).error, 'laso_payment_expired');
    assert.equal((await request({ confirmed: true, lasoPayment: { ...lasoPayment, transaction: Buffer.alloc(200, 1).toString('base64') } })).signed, false);
    assert.equal((await request({ confirmed: true, lasoPayment }, '')).error, 'desk_locked');
    assert.equal(reservations.size, 0);
    assert.equal(paid, 0);
  }
  const purchased = await request({ confirmed: true, ...(lasoPayment ? { lasoPayment } : {}) });
  assert.equal(purchased.signed, true, JSON.stringify(purchased));
  assert.equal(purchased.signature, signature);
  assert.deepEqual(purchased.card, { card_id: 'card_123', usd_amount: 10, status: 'pending' });
  assert.equal(JSON.stringify(purchased).includes('never-returned'), false);
  assert.equal((await request({ confirmed: true, idempotencyKey: 'different_client_key', ...(lasoPayment ? { lasoPayment } : {}) })).signed, false);
  if (browser) assert.equal(signs, 0, 'browser payments must never call Privy server signing');
  assert.equal(signs, browser ? 0 : 1);
  assert.equal(paid, 1);
  assert.equal(reservations.size, 1);
});
