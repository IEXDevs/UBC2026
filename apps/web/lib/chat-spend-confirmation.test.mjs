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
