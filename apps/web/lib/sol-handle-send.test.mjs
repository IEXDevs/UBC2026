import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSolHandleSend, runSolHandleSend } from './sol-handle-send.mjs';

test('only standalone SOL-to-handle commands take the shortcut; lamports stay exact', () => {
  assert.deepEqual(parseSolHandleSend('send 1 SOL to @hi'), { handle: 'hi', amount: '1000000000' });
  assert.deepEqual(parseSolHandleSend('Could you please pay 0.000000001 SOL to @Hi_2 on solana?'), { handle: 'hi_2', amount: '1' });
  assert.deepEqual(parseSolHandleSend('transfer 18446744073.709551615 SOL to @hi'), { handle: 'hi', amount: '18446744073709551615' });
  for (const amount of ['0', '0.0000000001', '18446744073.709551616']) {
    assert.deepEqual(parseSolHandleSend(`send ${amount} SOL to @hi`), { handle: 'hi', amount: null });
  }
  for (const message of [
    'How do I send 1 SOL to @hi?',
    'Don’t send 1 SOL to @hi',
    'Send 1 SOL to @hi if SOL goes up',
    'Send 1 SOL to @hi on mainnet',
    'Send 1 SOL to @hi.sol',
    'Send 1 USDC to @hi',
  ]) assert.equal(parseSolHandleSend(message), null, message);
});

test('a missing wallet or lookup failure is not a spend proposal', async () => {
  for (const [lookup, message] of [
    [{ error: 'ambiguous_handle' }, /Several accounts match/],
    [{ error: 'tool_failed' }, /couldn’t look up/],
    [{ recipient: { kind: 'handle', handle: 'hi', address: null } }, /doesn’t have a wallet/],
  ]) {
    const result = await runSolHandleSend(parseSolHandleSend('send 1 SOL to @hi'), {
      botId: 'bot_1',
      invoke: (name) => {
        assert.equal(name, 'lookup_recipient');
        return lookup;
      },
      spend: { permissionMode: 'full', confirmSpend: true, grants: [] },
    });
    assert.match(result.reply, message);
    assert.equal(result.hold, undefined);
  }
});
