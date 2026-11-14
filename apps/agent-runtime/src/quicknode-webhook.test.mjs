import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { processQuickNodeWebhook } from './quicknode-webhook.mjs';

const secret = 'qn_secret';
const wallet = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

test('runtime webhook verifies HMAC and wakes the bot stub', async () => {
  const body = JSON.stringify({
    signature: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd',
    wallet,
    type: 'deposit',
    amount: '10',
    botId: 'bot_1',
  });
  const nonce = 'n';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(nonce + timestamp + body).digest('hex');
  const wakes = [];
  const env = {
    QUICKNODE_WEBHOOK_SECRET: secret,
  };
  const botStub = (_env, botId) => ({
    fetch: async (request) => {
      wakes.push({ botId, body: await request.json() });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const response = await processQuickNodeWebhook(new Request('https://runtime/webhooks/quicknode', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qn-nonce': nonce,
      'x-qn-timestamp': timestamp,
      'x-qn-signature': signature,
    },
    body,
  }), env, botStub);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.accepted, 1);
  assert.equal(wakes[0].botId, 'bot_1');
  assert.equal(wakes[0].body.reason, 'quicknode-stream');
});
