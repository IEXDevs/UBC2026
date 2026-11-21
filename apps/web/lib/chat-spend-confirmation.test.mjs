import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeActivity } from './chat-activity.mjs';
import { createChatToolInvoker } from './chat-tools.mjs';
import { resumeAssetSpend, sealAssetSpendHold, swapHoldFromPreview } from './chat-spend-confirmation.mjs';
import { stampSpendPermission } from './harness-run.mjs';
import { toolAccessRequest } from './spend-permission.mjs';

const ownerId = 'did:privy:owner1';
const botId = 'bot_sol';
const context = { ownerId, botId, secret: 'test-only-chat-key' };
const args = {
  action: 'pay', amount: '1000000000', asset: 'SOL', botId,
  destination: '11111111111111111111111111111111', handle: 'hi', quoteCluster: 'mainnet-beta',
};
const signature = '5'.repeat(64);

for (const action of ['spend', 'pay', undefined]) test(`ordinary USDC ${action ?? 'default'} slides bind a stable browser-send key`, async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', {
    botId, action, asset: 'USDC', amount: '1000', destination: '11111111111111111111111111111111',
  }), context, 1000);
  assert.match(hold.idempotencyKey, /^spend_/);
  const challenge = { transaction: 'unsigned' };
  const result = await resumeAssetSpend(hold, context, async () => ({ signed: false, moveAuthorization: challenge }), 2000);
  assert.deepEqual(result.moveAuthorization, challenge);
  assert.equal(result.text, undefined);
  assert.match((await resumeAssetSpend({ ...hold, idempotencyKey: `spend_${crypto.randomUUID()}` }, context,
    () => assert.fail('changed key must not invoke runtime'), 2000)).text, /invalid or expired/);
});

test('sealed Laso confirmations forward browser phases outside model args and return unsigned payloads only to the owner', async () => {
  const args = { botId, action: 'x402', amount: '10000000', asset: 'USDC', lasoTicket: `payload.${'a'.repeat(64)}` };
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  const payment = { phase: 'prepared', transaction: Buffer.alloc(200).toString('base64'),
    walletAddress: 'So11111111111111111111111111111111111111112', blockhash: 'So11111111111111111111111111111111111111112',
    expiresAt: 3000, proof: 'b'.repeat(64) };
  const invoke = createChatToolInvoker({ ownerId, botId, runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      assert.equal(url, 'https://runtime.example/api/spend');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.lasoPayment, { phase: 'prepare' });
      assert.equal(body.confirmed, true);
      assert.equal(body.lasoTicket, args.lasoTicket);
      assert.equal(body.spendAuthorization, undefined);
      return Response.json({ signed: false, lasoPayment: payment });
    } });
  const reply = await resumeAssetSpend(hold, context, (name, inputs) => invoke(name,
    stampSpendPermission(name, inputs, { permissionMode: 'ask', confirmSpend: true, grants: [hold] }),
    { lasoPayment: { phase: 'prepare' } }), 2000);
  assert.deepEqual(reply.lasoPayment, payment);
  assert.equal(reply.text, undefined);
  assert.equal(reply.activity, undefined);
  await resumeAssetSpend({ ...hold, proof: '' }, context, () => assert.fail('invalid hold must not prepare'), 2000);
});

test('sealing binds an omitted bot ID to the current bot without accepting its later removal', async () => {
  const { botId: _botId, ...omitted } = args;
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', omitted), context, 1000);
  assert.equal(hold.args.botId, botId);
  const reply = await resumeAssetSpend(hold, context, async (_name, inputs) => {
    assert.deepEqual(inputs, args);
    return { error: 'simulation_failed', signed: false };
  }, 2000);
  assert.equal(reply.hold, undefined);
  const tampered = await resumeAssetSpend({ ...hold, args: omitted }, context, () => assert.fail('removed bot ID must invalidate the proof'), 2000);
  assert.match(tampered.text, /invalid or expired/);
});

test('Laso preparation needs no slide; its ticket-bound purchase does, and returns only the owner login link separately', async () => {
  assert.equal(toolAccessRequest('ask', 'prepare_shopping', { provider: 'laso', amountUsd: 10 }), null);
  const ticket = `payload.${'a'.repeat(64)}`;
  const args = { botId, action: 'x402', amount: '10000000', asset: 'USDC', lasoTicket: ticket };
  const hold = sealAssetSpendHold(toolAccessRequest('full', 'request_spend', args), context, 1000);
  assert.match(hold.label, /Buy a Laso.*\$10/);
  assert.equal(hold.args.lasoTicket, ticket);
  const changed = await resumeAssetSpend({ ...hold, args: { ...args, lasoTicket: 'changed' } }, context, () => assert.fail('changed ticket invoked'), 2000);
  assert.match(changed.text, /invalid or expired/);
  const claimUrl = 'https://laso.finance/agent/dashboard/auth?token=owner-only';
  const reply = await resumeAssetSpend(hold, context, async (name, inputs) => {
    assert.equal(name, 'request_spend');
    assert.equal(inputs.lasoTicket, ticket);
    return { signed: true, cluster: 'mainnet-beta', signature, card: { card_id: 'card_123', usd_amount: 10, status: 'pending' }, claimUrl };
  }, 2000);
  assert.match(reply.text, /Laso card card_123: \$10, pending/);
  assert.equal(reply.claimUrl, claimUrl);
  assert.equal(reply.lasoCard.id, 'card_123');
  assert.equal(reply.lasoCard.number, '•••• •••• •••• ••••');
  assert.equal(reply.lasoCard.cvv, '•••');
  assert.equal(reply.lasoCard.revealed, false);
  assert.equal(JSON.stringify(reply.activity).includes('owner-only'), false);
  assert.equal(reply.text.includes('owner-only'), false);
  const failed = await resumeAssetSpend(hold, context, async () => ({ error: 'simulation_failed', signed: false, simulationReason: 'insufficient_funds' }), 2000);
  assert.match(failed.text, /insufficient_funds/);
});

test('USDC swaps display confirmed minimum output and bind the quote ticket to the slide', async () => {
  const args = { botId, action: 'swap', asset: 'USDC', outputAsset: 'SOL', amount: '1000000' };
  const hold = toolAccessRequest('full', 'request_spend', args);
  assert.match(hold.idempotencyKey, /^spend_/);
  const quoted = swapHoldFromPreview(hold, {
    inputDecimals: 6, outputDecimals: 9, minOutput: '9950000',
    usdMicros: '1015000', expiresAt: 2500, ticket: 'fixture-swap-ticket',
  });
  assert.match(quoted.label, /Swap 1 USDC for at least 0\.00995 SOL/);
  assert.match(quoted.label, /\$1\.015/);
  const sealed = sealAssetSpendHold(quoted, context, 1000);
  assert.equal(sealed.expiresAt, 2500);
  const changed = await resumeAssetSpend({ ...sealed, swapTicket: 'changed' }, context, () => assert.fail('unexpected spend'), 2000);
  assert.match(changed.text, /invalid or expired/);
  const confirmed = stampSpendPermission('request_spend', args, { permissionMode: 'full', confirmSpend: true, grants: [sealed] });
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.idempotencyKey, sealed.idempotencyKey);
  const failed = await resumeAssetSpend(sealed, context, async () => ({ error: 'simulation_failed', simulationReason: 'insufficient_funds' }), 2000);
  assert.match(failed.text, /Swap — simulation:.*\[insufficient_funds\]/);
});

test('a reduced SOL quote binds a fresh slide to the displayed smaller amount', async () => {
  const args = { botId, action: 'swap', asset: 'SOL', outputAsset: 'USDC', amount: '100000000' };
  const hold = toolAccessRequest('full', 'request_spend', args);
  const preview = { inputDecimals: 9, outputDecimals: 6, inputAmount: '95970720', minOutput: '9000000',
    usdMicros: '9801500', expiresAt: 2500, ticket: 'reduced-swap-ticket' };
  const quoted = swapHoldFromPreview(hold, preview);
  assert.match(quoted.label, /fees and account setup.*Swap 0\.09597072 SOL/);
  assert.equal(quoted.args.amount, preview.inputAmount);
  assert.equal(swapHoldFromPreview(hold, { ...preview, inputAmount: '100000001' }), null);
  assert.equal(swapHoldFromPreview({ ...hold, idempotencyKey: 'loop_swap_test' }, preview), null);
  const sealed = sealAssetSpendHold(quoted, context, 1000);
  const edited = await resumeAssetSpend({ ...sealed, args }, context, () => assert.fail('unexpected spend'), 2000);
  assert.match(edited.text, /invalid or expired/);
  await resumeAssetSpend(sealed, context, async (_tool, terms) => {
    assert.equal(terms.amount, preview.inputAmount);
    return { signed: false, error: 'desk_lock_unavailable' };
  }, 2000);
});

test('a slide submits the original SOL payment directly and returns its Solscan receipt', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('full', 'request_spend', args), context, 1000);
  const confirmed = JSON.parse(JSON.stringify(hold));
  const calls = [];
  const invoke = createChatToolInvoker({
    ownerId, botId, runtimeBase: 'https://runtime.example',
    fetcher: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ ok: true, signed: true, cluster: 'mainnet-beta', signature });
    },
  });
  const reply = await resumeAssetSpend(confirmed, context, (name, inputs) => invoke(
    name,
    stampSpendPermission(name, inputs, { permissionMode: 'full', confirmSpend: true, grants: [confirmed] }),
  ), 2000);
  assert.deepEqual(calls, [{
    url: 'https://runtime.example/api/spend',
    body: { ...args, idempotencyKey: hold.idempotencyKey, confirmed: true, permission: 'full', reviewCap: '30000000' },
  }]);
  assert.equal(reply.hold, undefined);
  assert.equal(reply.text, `Sent. https://solscan.io/tx/${signature}`);
});

test('a changed, expired, or unsigned payment confirmation never invokes the spend tool', async () => {
  const unsigned = toolAccessRequest('ask', 'request_spend', args);
  const hold = sealAssetSpendHold(unsigned, context, 1000);
  const cases = [
    [unsigned, context, 2000],
    [hold, context, hold.expiresAt],
    [hold, { ...context, ownerId: 'did:privy:other' }, 2000],
    [hold, { ...context, botId: 'bot_other' }, 2000],
    [{ ...hold, args: { ...args, amount: '2000000000' } }, context, 2000],
    [{ ...hold, args: { ...args, handle: 'other' } }, context, 2000],
    [{ ...hold, args: { ...args, quoteCluster: undefined } }, context, 2000],
  ];
  let invoked = 0;
  for (const [candidate, scope, time] of cases) {
    const reply = await resumeAssetSpend(candidate, scope, () => { invoked += 1; }, time);
    assert.match(reply.text, /invalid or expired/i);
    assert.equal(reply.hold, undefined);
  }
  assert.equal(invoked, 0);
});

test('a runtime rejection ends the confirmed turn and shows the reason', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  const reply = await resumeAssetSpend(hold, context, async () => ({
    error: 'approval-needed', reason: 'per-transaction', signed: false,
  }), 2000);
  assert.equal(reply.hold, undefined);
  assert.match(reply.text, /per-transfer limit/);
  assert.match(reply.activity[0].error, /per-transfer limit/);
});

test('a locked desk returns an unlock error instead of a missing receipt', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  for (const code of ['desk_locked', 'desk_lock_required']) {
    const invoke = createChatToolInvoker({
      ownerId, botId, runtimeBase: 'https://runtime.example',
      fetcher: async () => Response.json({ error: code, signed: false }, { status: 403 }),
    });
    await assert.rejects(
      resumeAssetSpend(hold, context, async (...inputs) => JSON.stringify(await invoke(...inputs)), 2000),
      { code: 'desk_locked', status: 403 },
    );
  }
});

test('a blocked SOL send shows the runtime reason in the reply and the trace', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  const invoke = createChatToolInvoker({
    ownerId, botId, runtimeBase: 'https://runtime.example',
    fetcher: async () => Response.json({
      state: 'blocked', reason: 'accounting-asset-mismatch', signed: false,
    }, { status: 409 }),
  });
  const reply = await resumeAssetSpend(hold, context, invoke, 2000);
  assert.equal(reply.hold, undefined);
  assert.match(reply.text, /does not match the agent's spending asset/);
  assert.match(reply.activity[0].error, /^blocked\nThe payment asset/);
});

test('a signing rejection explains the wallet authorization failure', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  const reply = await resumeAssetSpend(hold, context, async () => ({
    state: 'sign-rejected', ok: false, reason: 'wallet_owner_session_required', signed: false,
  }), 2000);
  assert.match(reply.text, /Sign in again as the wallet owner/);
  assert.match(reply.activity[0].error, /^sign-rejected\nSign in again/);
});

test('a rejected signature shows the Privy status and safe code in chat', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  const invoke = createChatToolInvoker({
    ownerId, botId, runtimeBase: 'https://runtime.example',
    fetcher: async () => Response.json({
      state: 'sign-rejected', reason: 'privy_failed', signed: false,
      privyFailure: { status: 403, code: 'insufficient_app_secret_permissions', message: 'private diagnostics' },
    }, { status: 409 }),
  });
  const reply = await resumeAssetSpend(hold, context, invoke, 2000);
  assert.match(reply.text, /Privy reported HTTP 403, insufficient_app_secret_permissions/);
  assert.match(reply.activity[0].error, /Privy reported HTTP 403, insufficient_app_secret_permissions/);
  assert.doesNotMatch(JSON.stringify(reply), /private diagnostics/);
});

test('a signing 401 includes the read-only result from the signing Worker', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  const invoke = createChatToolInvoker({
    ownerId, botId, runtimeBase: 'https://runtime.example',
    fetcher: async () => Response.json({
      state: 'sign-rejected', reason: 'privy_failed', signed: false,
      privyFailure: { status: 401, walletLookupStatus: 200 },
    }, { status: 409 }),
  });
  const reply = await resumeAssetSpend(hold, context, invoke, 2000);
  assert.match(reply.text, /Privy reported HTTP 401/);
  assert.match(reply.text, /wallet lookup returned HTTP 200/);
  assert.match(reply.activity[0].error, /same app credentials could read this wallet/);
});

test('a failed owner session exchange shows the full provider trace in chat and stored activity', async () => {
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', args), context, 1000);
  const invoke = createChatToolInvoker({
    ownerId, botId, runtimeBase: 'https://runtime.example',
    fetcher: async () => Response.json({
      state: 'sign-rejected', reason: 'wallet_authorization_failed', signed: false,
      privyFailure: {
        status: 400, at: 1700000000000, appSignature: true,
        requests: [
          { stage: 'app-sign', status: 401 },
          { stage: 'wallet-lookup', status: 200, detail: 'wallet-matched' },
          {
            stage: 'session-exchange', status: 400, code: 'mfa_required', mfaProof: false,
            detail: 'mfa-required', requestId: 'req_privy123456', edgeId: '1234567890abcdef-DFW',
            body: 'private diagnostics',
          },
        ],
        session: { check: 'owner-matched', audience: 'match', issuer: 'match', expiry: 'current' },
      },
    }, { status: 409 }),
  });
  const reply = await resumeAssetSpend(hold, context, invoke, 2000);
  for (const output of [reply.text, sanitizeActivity(reply.activity)[0].error]) {
    assert.match(output, /app signing .* returned HTTP 401/i);
    assert.match(output, /wallet lookup .* returned HTTP 200/i);
    assert.match(output, /Owner session key exchange \(POST \/v1\/wallets\/authenticate, HPKE\) returned HTTP 400/);
    assert.match(output, /mfa_required/);
    assert.match(output, /MFA proof header absent/);
    assert.match(output, /Privy request ID req_privy123456/);
    assert.match(output, /Cloudflare Ray ID 1234567890abcdef-DFW/);
    assert.match(output, /Worker time 2023-11-14T22:13:20.000Z/);
    assert.match(output, /Token audience match. Token issuer match. Token expiry current/);
    assert.match(output, /The Worker did not send an owner-session signing request/);
    assert.match(output, /stopped before broadcast on Solana mainnet-beta/);
    assert.doesNotMatch(output, /private diagnostics/);
  }
});
