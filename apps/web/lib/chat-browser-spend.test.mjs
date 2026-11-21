import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { submitChatMove, completeChatSwap } from './chat-browser-spend.mjs';
import { executeClientSignedSwap } from './swap-client-sign.mjs';

const transaction = new Uint8Array(100).fill(1);
const challenge = () => ({ transaction: Buffer.from(transaction).toString('base64'), walletAddress: 'selected',
  expiresAt: Date.now() + 30000, blockhash: 'blockhash', proof: 'proof' });

function setup({ prepare, sign, broadcast, signal } = {}) {
  const calls = [];
  const signs = [];
  const run = () => submitChatMove({ hold: { name: 'request_spend', args: { action: 'spend' }, proof: 'sealed' },
    ownerId: 'owner', permission: 'ask', getAccessToken: async () => 'test-token', readGrant: () => 'test-grant', signal,
    sign: async input => { signs.push(input); return sign ? sign(input) : transaction; },
    fetchImpl: async (url, options) => {
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      if (calls.length === 1) return Response.json(prepare ?? { moveAuthorization: challenge() });
      if (broadcast instanceof Error) throw broadcast;
      return Response.json(broadcast ?? { ok: true, reply: 'Sent. https://solscan.io/tx/mock' });
    } });
  return { run, calls, signs };
}

test('approved sends use move prepare, shared browser signer, then move broadcast with the same sealed hold', async () => {
  const { run, calls, signs } = setup();
  assert.match((await run()).reply, /^Sent\./);
  assert.deepEqual(calls.map(call => [call.url, call.body.phase]), [
    ['/api/wallets/move', 'prepare'], ['/api/wallets/move', 'broadcast'],
  ]);
  assert.deepEqual(calls[0].body.chatSpend, calls[1].body.chatSpend);
  assert.equal(calls[1].body.signedTransaction, Buffer.from(transaction).toString('base64'));
  assert.equal(calls[0].headers.authorization, 'Bearer test-token');
  assert.equal(calls[1].headers['x-desk-grant'], 'test-grant');
  assert.deepEqual(signs, [{ walletAddress: 'selected', transaction, requireWalletApproval: true }]);
});

test('missing, expired and malformed preparations never sign; cancellation and empty signatures never broadcast', async () => {
  for (const prepare of [{}, { error: 'desk_locked' }, { reply: 'Trust rejected.' },
    { moveAuthorization: { ...challenge(), expiresAt: 1 } },
    { moveAuthorization: { ...challenge(), transaction: null } }]) {
    const fixture = setup({ prepare });
    assert.ok((await fixture.run()).reply);
    assert.equal(fixture.signs.length, 0);
    assert.equal(fixture.calls.length, 1);
  }
  for (const sign of [() => { throw new Error('private provider detail'); }, () => new Uint8Array()]) {
    const fixture = setup({ sign });
    assert.doesNotMatch(JSON.stringify(await fixture.run()), /private provider/);
    assert.equal(fixture.calls.length, 1);
  }
  const controller = new AbortController();
  controller.abort();
  const fixture = setup({ signal: controller.signal });
  assert.equal((await fixture.run()).error, 'aborted');
  assert.equal(fixture.calls.length, 0);
});

test('uncertain send broadcasts are not retried', async () => {
  const fixture = setup({ broadcast: new Error('private RPC URL') });
  assert.match((await fixture.run()).reply, /Check the spend details/);
  assert.equal(fixture.calls.length, 2);
});

for (const source of ['slide', 'auto']) test(`${source} swap descriptors call the existing swap helper and show its failure reply`, async () => {
  const spend = { botId: 'bot_1', action: 'swap', asset: 'USDC', outputAsset: 'SOL', amount: '100',
    idempotencyKey: 'original-key', permission: 'full' };
  const calls = [];
  const credentials = { ownerId: 'owner', accessToken: 'test-token', deskGrant: 'grant' };
  const execute = input => executeClientSignedSwap({ ...input, signer: { ready: true, wallets: [{ address: 'selected' }],
    signTransaction: async () => ({ signedTransaction: transaction }) }, fetchImpl: async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(calls.length === 1 ? { swapAuthorization: challenge() }
      : { signed: true, signature: '5'.repeat(64), cluster: 'mainnet-beta' });
  } });
  const result = await completeChatSwap({ ok: true, clientSwap: { spend, swapTicket: 'original-ticket' } }, execute, credentials);
  assert.match(result.reply, /^Swap submitted\. https:\/\/solscan.io\/tx\//);
  for (const call of calls) {
    assert.equal(call.idempotencyKey, spend.idempotencyKey);
    assert.equal(call.swapTicket, 'original-ticket');
    assert.equal(call.outputAsset, 'SOL');
    assert.equal(call.confirmed, true);
    assert.equal(call.spendAuthorization, undefined);
  }
  const failed = await completeChatSwap({ clientSwap: { spend, swapTicket: 'ticket' } }, async () => ({
    ok: false, reply: 'Swap — client signing: rejected [client_sign_rejected]',
  }), credentials);
  assert.equal(failed.reply, 'Swap — client signing: rejected [client_sign_rejected]');
});

test('empty results and aborted swap runs do not call the signer', async () => {
  assert.equal(await completeChatSwap(null, () => assert.fail(), {}), null);
  assert.equal((await completeChatSwap({ clientSwap: {} }, () => assert.fail(), { signal: { aborted: true } })).error, 'aborted');
});

test('Composer and page drift guard: use the shared adapters and #328 signer readiness instead of server authorization', () => {
  const composer = readFileSync(new URL('../components/Composer.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.match(composer, /await submitChatMove\(/);
  assert.match(composer, /await completeChatSwap\(result, executeChatSwap/);
  assert.match(page, /executeClientSignedSwap\(\{ \.\.\.input, signer: depositSignerRef.current/);
  assert.match(page, /readSigner: \(\) => depositSignerRef.current/);
  assert.match(page, /signer: await waitForBrowserSigner/);
});
