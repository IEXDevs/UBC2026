import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executeClientSignedSwap } from './swap-client-sign.mjs';
import { withLinkedSolanaWallets } from './wallet-signing.mjs';

const transaction = new Uint8Array(100).fill(1);
const challenge = () => ({ transaction: Buffer.from(transaction).toString('base64'), walletAddress: 'selected',
  expiresAt: Date.now() + 30_000, blockhash: 'blockhash', proof: 'proof' });

test('a missing signer is attached to the exact wallet before retrying the original swap once', async () => {
  const walletAddress = 'So11111111111111111111111111111111111111112';
  const signerId = 'test-privy-signer';
  const spend = { botId: 'bot_1', action: 'swap', permission: 'full', idempotencyKey: 'original', amount: '123' };
  const calls = [];
  const input = {
    spend, swapTicket: 'original-ticket', accessToken: 'test-token', deskGrant: 'test-grant',
    delegation: { walletAddress, signerId, expiresAt: Date.now() + 30_000 },
    attachSwapSigner: async grant => calls.push(grant),
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return Response.json({ signed: true, signature: 'mock-signature' });
    },
  };
  assert.equal((await executeClientSignedSwap(input)).signed, true);
  assert.deepEqual(calls, [{ address: walletAddress, signerId },
    { ...spend, swapTicket: 'original-ticket', autoSwap: true, confirmed: false }]);
  assert.equal((await executeClientSignedSwap({ ...input, delegation: { ...input.delegation, expiresAt: 1 } })).failure.code, 'swap_quote_expired');
  const refused = await executeClientSignedSwap({ ...input, attachSwapSigner: async () => {
    throw new Error('Specifying signers requires TEE execution. Provider private detail');
  } });
  assert.match(refused.reply, /on-device execution/);
  assert.doesNotMatch(refused.reply, /private detail/);
  assert.equal(calls.length, 2);
});

function setup({ signerError, wallets = [{ address: 'selected' }], prepare, broadcast, signal, readSigner } = {}) {
  const calls = [];
  const signCalls = [];
  const connectCalls = [];
  const run = () => executeClientSignedSwap({
    spend: { botId: 'bot_1', action: 'swap', amount: '100', permission: 'ask', confirmed: false },
    swapTicket: 'ticket', ownerId: 'owner', accessToken: 'test-token', deskGrant: 'test-grant', signal,
    readSigner,
    signer: { ready: true, wallets, connectWallet: options => connectCalls.push(options), signTransaction: async args => {
      signCalls.push(args);
      if (signerError) throw signerError;
      return { signedTransaction: new Uint8Array(120).fill(2) };
    } },
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      if (calls.length === 1) return Response.json(prepare ?? { signed: false, swapAuthorization: challenge() });
      if (broadcast instanceof Error) throw broadcast;
      return Response.json(broadcast ?? { signed: true, signature: 'mock-signature' });
    },
  });
  return { run, calls, signCalls, connectCalls };
}

test('approved swaps prepare, sign the exact selected browser wallet with the shared helper, then request server broadcast', async () => {
  const { run, calls, signCalls } = setup();
  assert.equal((await run()).signature, 'mock-signature');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/runtime/api/spend');
  assert.equal(calls[0].body.swapAuthorization, 'prepare');
  assert.equal(calls[0].body.confirmed, true);
  assert.equal(calls[0].headers.authorization, 'Bearer test-token');
  assert.equal(calls[1].headers['x-desk-grant'], 'test-grant');
  assert.equal(calls[1].body.swapAuthorization.proof, 'proof');
  assert.equal(calls[1].body.swapAuthorization.signedTransaction, Buffer.from(new Uint8Array(120).fill(2)).toString('base64'));
  assert.deepEqual(signCalls[0].transaction, transaction);
  assert.equal(signCalls[0].wallet.address, 'selected');
});

test('unavailable agent wallets never fall back to signing the Main wallet', async () => {
  const { run, calls, signCalls, connectCalls } = setup({ wallets: [{ address: 'main' }] });
  const result = await run();
  assert.equal(result.failure.code, 'wallet_connection_required');
  assert.equal(calls.length, 1);
  assert.equal(signCalls.length, 0);
  assert.equal(connectCalls.length, 1);
});

test('client signing rejection is a safe plain reason and never broadcasts', async () => {
  const { run, calls } = setup({ signerError: new Error('private provider response') });
  const result = await run();
  assert.equal(result.failure.code, 'client_sign_rejected');
  assert.match(result.reply, /Swap — client signing:.*\[client_sign_rejected\]/);
  assert.equal(JSON.stringify(result).includes('private provider'), false);
  assert.equal(calls.length, 1);
});

test('empty, failed, expired or malformed preparations never sign or broadcast', async () => {
  for (const prepare of [{}, { error: 'desk_locked' },
    { swapAuthorization: { ...challenge(), expiresAt: 1 } },
    { swapAuthorization: { ...challenge(), transaction: '' } }]) {
    const { run, calls, signCalls } = setup({ prepare });
    assert.equal((await run()).ok, false);
    assert.equal(calls.length, 1);
    assert.equal(signCalls.length, 0);
  }
  assert.equal((await executeClientSignedSwap()).failure.code, 'invalid_spend');
});

test('broadcast transport failures are distinct from policy and simulation failures', async () => {
  const result = await setup({ broadcast: new Error('private RPC endpoint') }).run();
  assert.equal(result.failure.code, 'broadcast_failed');
  assert.match(result.reply, /\[broadcast_failed\]/);
  const blocked = await setup({ broadcast: { signed: false, reason: 'per-transaction' } }).run();
  assert.equal(blocked.failure.code, 'per-transaction');
  const simulation = await setup({ prepare: { error: 'simulation_failed' } }).run();
  assert.equal(simulation.failure.step, 'simulation');
});

test('cancellation before signing never sends a broadcast', async () => {
  const controller = new AbortController();
  controller.abort();
  const { run, calls, signCalls } = setup({ signal: controller.signal });
  assert.equal((await run()).failure.code, 'aborted');
  assert.equal(calls.length, 1);
  assert.equal(signCalls.length, 0);
});

test('manual Jupiter merges the same linked Solana accounts used by sends', () => {
  const source = readFileSync(new URL('../components/JupiterSwap.js', import.meta.url), 'utf8');
  assert.match(source, /useStandardWallets\(\)/);
  assert.match(source, /usePrivy\(\)/);
  assert.match(source, /withLinkedSolanaWallets\(wallets, standardWallets, user\)/);
  assert.match(source, /linkedWallets\.find\(wallet => wallet\?\.address === address\)/);
});

test('a reader waits for the exact swap wallet and signs its linked-account adapter, not the snapshot Main wallet', async () => {
  let reads = 0;
  const adapterCalls = [];
  const standard = { features: { 'privy:': { privy: { signTransaction: async args => {
    adapterCalls.push(args);
    return { signedTransaction: new Uint8Array(120).fill(2) };
  } } } } };
  const linked = withLinkedSolanaWallets([{ address: 'main' }], [standard], {
    linkedAccounts: [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: 'selected' }],
  });
  const readSigner = () => ({ ready: true, wallets: ++reads > 1 ? linked : [{ address: 'main' }],
    signTransaction: () => assert.fail('the linked wallet must use its own adapter'),
  });
  const { run, calls, signCalls } = setup({ wallets: [{ address: 'main' }], readSigner });
  assert.equal((await run()).ok, true);
  assert.ok(reads > 1);
  assert.equal(calls.length, 2);
  assert.equal(signCalls.length, 0);
  assert.equal(adapterCalls[0].address, 'selected');
  assert.deepEqual(adapterCalls[0].transaction, transaction);
});

test('an empty reader falls back to the supplied signer snapshot', async () => {
  const { run, signCalls } = setup({ readSigner: () => null });
  assert.equal((await run()).ok, true);
  assert.equal(signCalls[0].wallet.address, 'selected');
});

test('reader failures remain safe and never sign or broadcast', async () => {
  const { run, calls, signCalls } = setup({ readSigner: () => { throw new Error('private provider details'); } });
  const result = await run();
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('private provider details'), false);
  assert.equal(calls.length, 1);
  assert.equal(signCalls.length, 0);
});

test('an expired quote or cancellation during wallet discovery never signs or broadcasts', async () => {
  for (const cancelled of [false, true]) {
    const controller = new AbortController();
    let reads = 0;
    const readSigner = () => {
      if (++reads === 2 && cancelled) controller.abort();
      return { ready: true, wallets: reads > 1 ? [{ address: 'selected' }] : [],
        signTransaction: () => assert.fail('never sign after discovery expired or was cancelled'),
      };
    };
    const { run, calls } = setup({ readSigner, signal: controller.signal,
      prepare: { swapAuthorization: { ...challenge(), expiresAt: Date.now() + (cancelled ? 30_000 : 50) } },
    });
    assert.equal((await run()).failure.code, cancelled ? 'aborted' : 'spend_authorization_expired');
    assert.equal(calls.length, 1);
  }
});
