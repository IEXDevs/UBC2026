import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitLasoChatPayment } from './laso-payment-client.mjs';
import { signSelectedWalletTransaction } from './wallet-signing.mjs';
import { sendBotChat } from './runtime-data.mjs';
import { parseLasoBrowserPayment } from '../../agent-runtime/src/laso-browser-payment.mjs';

const payment = { phase: 'prepared', transaction: Buffer.alloc(200, 1).toString('base64'),
  walletAddress: 'So11111111111111111111111111111111111111112', blockhash: 'So11111111111111111111111111111111111111112',
  expiresAt: 2000, proof: 'a'.repeat(64) };

test('Laso chat uses the shared wallet signer between prepare and settle, never broadcasting in the browser', async t => {
  const calls = [];
  const signed = new Uint8Array(200).fill(2);
  const wallet = { address: payment.walletAddress };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/bots/bot_1/chat');
    const body = JSON.parse(options.body);
    assert.equal(body.grants[0].args.action, 'x402');
    assert.equal(body.spendAuthorization, undefined);
    calls.push(body.lasoPayment.phase);
    return Response.json(body.lasoPayment.phase === 'prepare' ? { lasoPayment: payment }
      : { reply: 'Laso card payment submitted.', claimUrl: 'https://laso.finance/agent/dashboard/auth?token=owner-only' });
  });
  const result = await submitLasoChatPayment({
    signal: new AbortController().signal, now: () => 1000,
    send: (spendAuthorization, lasoPayment) => sendBotChat({ ownerId: 'owner_1', botId: 'bot_1', message: 'yes',
      grants: [{ name: 'request_spend', args: { action: 'x402' } }], spendAuthorization, lasoPayment }),
    sign: ({ transaction, walletAddress }) => signSelectedWalletTransaction({ from: { address: walletAddress }, transaction,
      signer: { wallets: [wallet], signTransaction: async input => {
        calls.push('sign');
        assert.equal(input.wallet, wallet);
        assert.deepEqual(input.transaction, new Uint8Array(Buffer.from(payment.transaction, 'base64')));
        return { signedTransaction: signed };
      } } }),
  });
  assert.deepEqual(calls, ['prepare', 'sign', 'settle']);
  assert.equal(result.ok, true);
});

test('Laso browser preparation errors, empty results and missing wallets never settle', async () => {
  for (const response of [{ ok: false, error: 'desk_locked' }, { ok: false, error: 'simulation_failed' }, {},
    { lasoPayment: { ...payment, proof: '' } }, { lasoPayment: { ...payment, transaction: '' } }]) {
    let calls = 0;
    const result = await submitLasoChatPayment({ signal: new AbortController().signal, now: () => 1000,
      send: async () => { calls++; return response; }, sign: () => assert.fail('must not sign') });
    if (response.lasoPayment) assert.equal(result.error, 'invalid_laso_payment');
    else assert.equal(result, response);
    assert.equal(calls, 1);
  }
  const result = await submitLasoChatPayment({ signal: new AbortController().signal,
    send: () => assert.fail('no server fallback') });
  assert.equal(result.error, 'browser_wallet_required');
});

test('Laso cancellation, expiry, abort and empty signatures cannot submit a settlement', async () => {
  for (const mode of ['cancel', 'expired', 'aborted', 'empty', 'expiry-after-sign']) {
    const controller = new AbortController();
    let calls = 0;
    let time = mode === 'expired' ? 2000 : 1000;
    const result = await submitLasoChatPayment({ signal: controller.signal, now: () => time,
      send: async () => { calls++; return { lasoPayment: payment }; },
      sign: async () => {
        if (mode === 'cancel') throw new Error('private wallet details');
        if (mode === 'aborted') controller.abort();
        if (mode === 'expiry-after-sign') time = 2000;
        return mode === 'empty' ? null : new Uint8Array(200);
      } });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  const controller = new AbortController();
  controller.abort();
  assert.equal((await submitLasoChatPayment({ signal: controller.signal, send: () => assert.fail('aborted') })).error, 'aborted');
});

test('Laso unlock retries only the locked request; uncertain settlement is not retried', async () => {
  let calls = 0;
  let unlocks = 0;
  let signatures = 0;
  const result = await submitLasoChatPayment({ signal: new AbortController().signal, now: () => 1000,
    unlock: async () => { unlocks++; return true; },
    sign: async () => { signatures++; return new Uint8Array(200); },
    send: async (_, input) => {
      calls++;
      return calls === 1 ? { error: 'desk_locked' } : input.phase === 'prepare' ? { lasoPayment: payment }
        : { ok: false, error: 'laso_settlement_unknown' };
    } });
  assert.equal(result.error, 'laso_settlement_unknown');
  assert.equal(calls, 3);
  assert.equal(unlocks, 1);
  assert.equal(signatures, 1);
  for (const bad of [null, [], {}, { phase: 'settle' }, { ...payment, expiresAt: '2000' }, { ...payment, walletAddress: '' }]) {
    assert.equal(parseLasoBrowserPayment(bad), null);
  }
});
