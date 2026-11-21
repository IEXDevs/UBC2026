import test from 'node:test';
import assert from 'node:assert/strict';
import { swapFailure } from './swap-failure.mjs';
import { spendFailureMessage } from './chat-activity.mjs';
import { createChatToolInvoker } from './chat-tools.mjs';

test('swap failures identify each failed step without exposing raw errors', () => {
  for (const [code, step] of [
    ['swap_quote_expired', 'quote'], ['trust-confirmation-required', 'trust'],
    ['jupiter_quote_timeout', 'quote'], ['jupiter_quote_transport', 'quote'],
    ['jupiter_redirect_refused', 'quote'], ['jupiter_quote_invalid_response', 'quote'],
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
  assert.match(swapFailure({ error: 'simulation_failed', simulationReason: 'swap_output_below_minimum' }).message, /less than the quote’s minimum output/);
});

test('swap diagnostics survive a failed runtime response and appear in plain chat text', async () => {
  const program = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const log = `Program ${program} failed: custom program error: 0x1`;
  const error = 'instruction_3_custom_1';
  const invoke = createChatToolInvoker({ ownerId: 'user_1', botId: 'bot_1', runtimeBase: 'https://runtime.invalid',
    fetcher: async () => Response.json({ error, signed: false, failure: swapFailure({
      error, simulationDetails: { instructionProgram: program, logs: [log, 'Program data: secret'] },
    }) }, { status: 409 }),
  });
  const result = await invoke('request_spend', { botId: 'bot_1', action: 'swap', asset: 'USDC', outputAsset: 'SOL', amount: '1' });
  const message = spendFailureMessage(result);
  assert.match(message, /Swap — simulation:.*\[instruction_3_custom_1\]/);
  assert.ok(message.includes(`Instruction program ${program}.\n${log}`));
  assert.doesNotMatch(message, /secret/);
});

test('an ATA setup failure identifies a System Program SOL shortfall', () => {
  const instructionProgram = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const fundingLog = 'Program log: Transfer: insufficient lamports 1100000, need 2039280';
  const systemLog = 'Program 11111111111111111111111111111111 failed: custom program error: 0x1';
  const setupLog = `Program ${instructionProgram} failed: custom program error: 0x1`;
  const error = 'instruction_6_custom_1';
  const failure = swapFailure({ error, simulationDetails: { instructionProgram, logs: [fundingLog, systemLog, setupLog] } });
  assert.match(failure.message, /did not have enough SOL to create a token account/);
  assert.ok(failure.message.includes(fundingLog));
  assert.equal(spendFailureMessage({ error, failure }), failure.message);
  const ambiguous = swapFailure({ error, simulationDetails: { instructionProgram, logs: [fundingLog, setupLog] } });
  assert.doesNotMatch(ambiguous.message, /enough SOL|insufficient lamports/);
});

test('a direct System Program transfer reports the SOL shortfall and available lamports', () => {
  const instructionProgram = '11111111111111111111111111111111';
  const log = 'Program log: Transfer: insufficient lamports 97000000, need 100000000';
  const failure = swapFailure({ error: 'instruction_3_custom_1', simulationDetails: { instructionProgram, logs: [log] } });
  assert.match(failure.message, /ran short of SOL during swap setup/);
  assert.ok(failure.message.includes(log));
});
