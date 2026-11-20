import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentRunCall, signalOfferView } from './owner-actions.mjs';

test('wake and run use the bot routes and skip the placeholder goal', () => {
  const wake = agentRunCall('wake', { id: 'bot_1', goal: 'Watch SOL' });
  assert.equal(wake.method, 'POST');
  assert.equal(wake.path, '/bots/bot_1/wake');
  assert.equal(wake.body.goal, 'Watch SOL');
  const loop = agentRunCall('loop', { id: 'bot_1', goal: 'Waiting for a goal.' });
  assert.equal(loop.path, '/bots/bot_1/loop');
  assert.deepEqual(loop.body, {});
  assert.equal(agentRunCall('resume', { id: 'bot_1' }), null);
  assert.equal(agentRunCall('wake', { id: '../evil' }), null);
});

test('a signal line needs an id, a price, and a runtime origin', () => {
  const previous = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = 'https://runtime.example/agent';
  try {
    const view = signalOfferView({
      id: 'bot_1',
      record: { signalId: 'apy-1', signalAmount: '1000000' },
    });
    assert.equal(view.signalId, 'apy-1');
    assert.equal(view.amountLabel, '1');
    assert.equal(view.href, 'https://runtime.example/agent/bots/bot_1/commerce/signals/apy-1');
    assert.equal(signalOfferView({ id: 'bot_1' }), null);
    assert.equal(signalOfferView({ id: 'bot_1', signalId: 'apy-1', signalAmount: '0' }), null);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = previous;
  }
});
