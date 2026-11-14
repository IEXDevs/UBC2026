import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnsResolver, buildSnsTransferIntent, SnsError } from './sns.mjs';

const dest = 'So11111111111111111111111111111111111111112';
const from = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

test('resolves .sol names through an injected resolver', async () => {
  const resolve = createSnsResolver({
    resolveFn: async domain => {
      assert.equal(domain, 'alex.sol');
      return dest;
    },
  });
  const result = await resolve('Alex.sol');
  assert.equal(result.address, dest);
  assert.equal(result.executionCluster, 'devnet');
});

test('builds an unsigned SNS transfer intent', () => {
  const intent = buildSnsTransferIntent({
    from, to: dest, domain: 'alex.sol', amount: '5000000', botId: 'bot_1',
  });
  assert.equal(intent.type, 'sns-transfer');
  assert.equal(intent.status, 'unsigned');
  assert.throws(() => buildSnsTransferIntent({
    from, to: dest, domain: 'not-a-domain', amount: '1', botId: 'bot_1',
  }), SnsError);
});
