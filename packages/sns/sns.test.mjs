import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnsResolver, buildSnsTransferIntent, prepareSnsSend, resolveSnsOwner, SnsError } from './sns.mjs';

const dest = 'So11111111111111111111111111111111111111112';
const from = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

test('safe-resolve returns whichever owner the SNS proxy sends', async () => {
  const richclub = 'Hp6Qyx3K9McpE1w2V7LbNU1NpwjwpqRiiggrcveNrtHF';
  const other = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const calls = [];
  const fetcher = async (url) => {
    const href = String(url);
    calls.push(href);
    const result = href.endsWith('/richclub.sol') ? richclub : other;
    return new Response(JSON.stringify({ s: 'ok', result }), { status: 200 });
  };
  const resolved = await resolveSnsOwner('@richclub.sol', { fetcher });
  assert.equal(calls[0], 'https://sdk-proxy.sns.id/resolve/richclub.sol');
  assert.equal(resolved.address, richclub);
  assert.equal(resolved.clusterRead, 'mainnet-read');
  const alt = await resolveSnsOwner('other.sol', { fetcher });
  assert.equal(alt.address, other);
  await assert.rejects(
    () => resolveSnsOwner('missing.sol', {
      fetcher: async () => new Response(JSON.stringify({ s: 'error', result: null }), { status: 200 }),
    }),
    SnsError,
  );
  await assert.rejects(
    () => resolveSnsOwner('richclub.sol', {
      fetcher: async () => { throw new Error('proxy down'); },
    }),
    SnsError,
  );
});

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

test('prepareSnsSend resolves and optionally executes on devnet', async () => {
  const resolver = createSnsResolver({ resolveFn: async () => dest });
  const unsigned = await prepareSnsSend({
    from, domain: 'alex.sol', amount: '1000', botId: 'bot_1', resolver,
  });
  assert.equal(unsigned.next, 'await-owner-or-signer');
  assert.equal(unsigned.intent.to, dest);

  const submitted = await prepareSnsSend({
    from, domain: 'alex.sol', amount: '1000', botId: 'bot_1', resolver,
    executeTransfer: async () => ({ signature: 'sig_sns_1', cluster: 'devnet' }),
  });
  assert.equal(submitted.next, 'submitted');
  assert.equal(submitted.intent.signature, 'sig_sns_1');
});
