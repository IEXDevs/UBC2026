import test from 'node:test';
import assert from 'node:assert/strict';
import { swapFailure } from './swap-failure.mjs';
import { spendFailureMessage } from './chat-activity.mjs';
import { createChatToolInvoker } from './chat-tools.mjs';

test('swap failures identify each failed step without exposing raw errors', () => {
  for (const [code, step] of [
    ['swap_quote_expired', 'quote'], ['trust-confirmation-required', 'trust'],
    ['invalid_auto_swap', 'permission'], ['approval-needed', 'approval'], ['desk_locked', 'desk lock'],
    ['per-transaction', 'budget'], ['privy_failed', 'Privy signing'], ['simulation_failed', 'simulation'],
    ['rpc_rejected', 'broadcast'], ['confirmation_failed', 'confirmation'], ['plugin_load_failed', 'Jupiter plugin'],
  ]) {
    const failure = swapFailure({ error: code });
    assert.equal(failure.step, step);
    assert.match(failure.message, new RegExp(`\\[${code}\\]`));
    assert.equal(spendFailureMessage({ error: code, failure }), failure.message);
  }
  for (const value of [undefined, null, {}, { error: 'https://provider.invalid/secret-key', message: 'secret-token' }]) {
    const failure = swapFailure(value);
    assert.equal(failure.code, 'swap_failed');
    assert.doesNotMatch(failure.message, /secret|provider.invalid/);
  }
  assert.equal(swapFailure({ error: 'jupiter_http_401' }).step, 'quote');
  assert.equal(swapFailure({ error: 'simulation_failed', simulationReason: 'instruction_3_custom_6001' }).code, 'instruction_3_custom_6001');
});

test('swap diagnostics survive a failed runtime response and appear in plain chat text', async () => {
  const invoke = createChatToolInvoker({ ownerId: 'user_1', botId: 'bot_1', runtimeBase: 'https://runtime.invalid',
    fetcher: async () => Response.json({ error: 'swap_quote_expired', signed: false, failure: swapFailure({ error: 'swap_quote_expired' }) }, { status: 409 }),
  });
  const result = await invoke('request_spend', { botId: 'bot_1', action: 'swap', asset: 'USDC', outputAsset: 'SOL', amount: '1' });
  assert.match(spendFailureMessage(result), /Swap — quote:.*\[swap_quote_expired\]/);
});
