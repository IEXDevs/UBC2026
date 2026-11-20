import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSnsResolver,
  buildSnsTransferIntent,
  prepareSnsSend,
  resolveSnsOwner,
  normalizeSnsName,
  SnsError,
} from './sns.mjs';

const dest = 'So11111111111111111111111111111111111111112';
const from = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Achieves: resolveSnsOwner hits sdk-proxy.sns.id, returns the proxy pubkey with mainnet-read/mainnet-beta-exec labels, and maps errors to SnsError.
 * Fails when: Wrong host is called, proxy errors succeed, or executionCluster becomes mainnet.
 * Oracle: SNS proxy JSON {s,result} contract.
 * Side effects: Injected fetcher.
 * Gaps: Does not validate that the returned pubkey owns the domain on-chain.
 */
test('safe-resolve returns whichever owner the SNS proxy sends', async () => {
  const richclub = 'Hp6Qyx3K9McpE1w2V7LbNU1NpwjwpqRiiggrcveNrtHF';
  const other = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
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

/**
 * Achieves: createSnsResolver normalizes case and returns executionCluster=solana; invalid pubkeys throw.
 * Fails when: Case folding fails, executionCluster is mainnet, or junk resolver returns are accepted.
 * Oracle: Injectable resolver contract for tests/runtime.
 * Side effects: none
 * Gaps: none meaningful
 */
test('resolves .sol names through an injected resolver', async () => {
  const resolve = createSnsResolver({
    resolveFn: async domain => {
      assert.equal(domain, 'alex.sol');
      return dest;
    },
  });
  const result = await resolve('Alex.sol');
  assert.equal(result.address, dest);
  assert.equal(result.executionCluster, 'mainnet-beta');
  const bad = createSnsResolver({ resolveFn: async () => 'not-a-pubkey' });
  await assert.rejects(() => bad('alex.sol'), SnsError);
});

/**
 * Achieves: buildSnsTransferIntent returns unsigned sns-transfer on solana; bad domains/amounts/pubkeys throw.
 * Fails when: Intent is marked signed/submitted, or invalid domains/amounts/pubkeys are accepted.
 * Oracle: Unsigned intent shape before owner/signer approval.
 * Side effects: none
 * Gaps: none meaningful
 */
test('builds an unsigned SNS transfer intent', () => {
  const intent = buildSnsTransferIntent({
    from, to: dest, domain: 'alex.sol', amount: '5000000', botId: 'bot_1',
  });
  assert.equal(intent.type, 'sns-transfer');
  assert.equal(intent.status, 'unsigned');
  assert.equal(intent.cluster, 'mainnet-beta');
  assert.throws(() => buildSnsTransferIntent({
    from, to: dest, domain: 'not-a-domain', amount: '1', botId: 'bot_1',
  }), SnsError);
  assert.throws(() => buildSnsTransferIntent({
    from, to: dest, domain: 'alex.sol', amount: '1.5', botId: 'bot_1',
  }), SnsError);
  assert.throws(() => buildSnsTransferIntent({
    from: 'bad', to: dest, domain: 'alex.sol', amount: '1', botId: 'bot_1',
  }), SnsError);
});

/**
 * Achieves: Without executeTransfer → await-owner-or-signer; with mainnet-beta signature → submitted; mainnet execute refused.
 * Fails when: Mainnet execute is accepted, or unsigned path claims submitted.
 * Oracle: prepareSnsSend next-state + cluster===mainnet-beta execute gate.
 * Side effects: Injected resolver/executeTransfer.
 * Gaps: none meaningful
 */
test('prepareSnsSend resolves and optionally executes on mainnet-beta', async () => {
  const resolver = createSnsResolver({ resolveFn: async () => dest });
  const unsigned = await prepareSnsSend({
    from, domain: 'alex.sol', amount: '1000', botId: 'bot_1', resolver,
  });
  assert.equal(unsigned.next, 'await-owner-or-signer');
  assert.equal(unsigned.intent.to, dest);

  const submitted = await prepareSnsSend({
    from, domain: 'alex.sol', amount: '1000', botId: 'bot_1', resolver,
    executeTransfer: async () => ({ signature: 'sig_sns_1', cluster: 'mainnet-beta' }),
  });
  assert.equal(submitted.next, 'submitted');
  assert.equal(submitted.intent.signature, 'sig_sns_1');

  await assert.rejects(
    () => prepareSnsSend({
      from, domain: 'alex.sol', amount: '1000', botId: 'bot_1', resolver,
      executeTransfer: async () => ({ signature: 'sig_main', cluster: 'mainnet' }),
    }),
    SnsError,
  );
});

/**
 * Achieves: normalizeSnsName lowercases valid .sol names and rejects junk / empty / non-.sol.
 * Fails when: Uppercase kept, or spaces/javascript: names accepted.
 * Oracle: /^[a-z0-9][a-z0-9-]{0,62}\.sol$/i domain rule.
 * Side effects: none.
 * Gaps: does not prove on-chain ownership of the name.
 */
test('normalizeSnsName lowercases valid domains and rejects invalid names', () => {
  assert.equal(normalizeSnsName('Alex.sol'), 'alex.sol');
  assert.equal(normalizeSnsName('richclub.sol'), 'richclub.sol');
  assert.throws(() => normalizeSnsName(''), SnsError);
  assert.throws(() => normalizeSnsName('alex'), SnsError);
  assert.throws(() => normalizeSnsName('.sol'), SnsError);
  assert.throws(() => normalizeSnsName('alex.eth'), SnsError);
  assert.throws(() => normalizeSnsName(' alex.sol '), SnsError);
  assert.throws(() => normalizeSnsName('@alex.sol'), SnsError);
});
