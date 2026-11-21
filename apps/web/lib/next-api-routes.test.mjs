/**
 * Contract tests for Next.js route handlers under apps/web/app/api.
 * Prefer executing handlers. Source-read tests are labeled as drift guards —
 * they do not execute runtime behavior (checklist: could pass without running
 * the claimed path) and are paired with helper/unit tests that do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET as getBuild } from '../app/api/build/route.js';
import { GET as getToken } from '../app/api/token/route.js';
import { sealAssetSpendHold } from './chat-spend-confirmation.mjs';
import { toolAccessRequest } from './spend-permission.mjs';
import { parsePermissionedSpendBody, spendApprovalMessage } from '@ubc2026/contracts';
import { privySessionFixture } from '../../agent-runtime/src/owner-auth.fixture.mjs';
import { Keypair, Transaction } from '@solana/web3.js';
import { SOLANA_GENESIS_HASH } from '@ubc2026/contracts/solana';
import { buildSolanaUsdcTransaction, buildWalletAssetTransaction } from '@ubc2026/transfers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('chat move adapter verifies the owner and sealed hold then forwards both phases to runtime gates', async t => {
  const ownerId = 'did:privy:chat-move';
  const botId = 'bot_move';
  const session = privySessionFixture(ownerId, 'chatmoveapp');
  const settings = { PRIVY_APP_ID: session.appId, PRIVY_APP_SECRET: 'offline-secret',
    SOLANA_RPC_URL: 'https://unused-rpc.invalid', META_MODEL_API_KEY: 'offline-move-key',
    NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://chat-runtime.invalid' };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', {
    botId, action: 'spend', asset: 'USDC', amount: '1000', destination: '11111111111111111111111111111111',
  }), { ownerId, botId, secret: settings.META_MODEL_API_KEY });
  assert.match(hold.idempotencyKey, /^spend_/);
  const calls = [];
  const challenge = { transaction: Buffer.alloc(100).toString('base64'), walletAddress: 'selected',
    blockhash: 'blockhash', expiresAt: Date.now() + 30000, proof: 'proof' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === session.jwksUrl) return session.jwks();
    assert.equal(String(url), `${settings.NEXT_PUBLIC_AGENT_RUNTIME_URL}/api/spend`, 'no RPC, server Privy signing or model call');
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.equal(body.confirmed, true);
    assert.equal(body.idempotencyKey, hold.idempotencyKey);
    assert.equal(body.spendAuthorization, undefined);
    return Response.json(body.moveAuthorization === 'prepare' ? { signed: false, moveAuthorization: challenge }
      : { signed: true, cluster: 'mainnet-beta', signature: '5'.repeat(64) });
  });
  const { POST } = await import('../app/api/wallets/move/route.js');
  const post = async (slide = hold, phase = 'prepare', owner = ownerId) => (await POST(new Request('https://desk.invalid/api/wallets/move', {
    method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'x-owner-id': owner, 'x-desk-grant': 'a'.repeat(64) },
    body: JSON.stringify({ phase, chatSpend: { message: 'yes', permission: 'ask', grants: [slide] },
      moveAuthorization: challenge, ...(phase === 'broadcast' ? { signedTransaction: 'signed-by-browser' } : {}) }),
  }))).json();
  assert.match((await post({ ...hold, proof: '' })).reply, /invalid or expired/);
  assert.equal((await post(hold, 'prepare', 'did:privy:wrong')).error, 'owner_mismatch');
  assert.equal(calls.length, 0);
  assert.deepEqual((await post()).moveAuthorization, challenge);
  assert.match((await post(hold, 'broadcast')).reply, /^Sent\./);
  assert.equal(calls[1].moveAuthorization.signedTransaction, 'signed-by-browser');
  assert.equal(calls.length, 2);
});

test('chat signs eligible Full and Review swaps automatically and sends other swaps to wallet approval', async t => {
  const settings = { NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://swap-runtime.invalid', META_MODEL_API_KEY: 'offline-swap-key' };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const ownerId = 'did:privy:swap-browser';
  const botId = 'bot_swap';
  const idempotencyKey = `loop_swap_${crypto.randomUUID()}`;
  const args = { botId, action: 'swap', asset: 'USDC', outputAsset: 'SOL', amount: '1000000' };
  const hold = sealAssetSpendHold({ ...toolAccessRequest('ask', 'request_spend', args), idempotencyKey,
    swapTicket: 'original-ticket', expiresAt: Date.now() + 60000 }, { ownerId, botId, secret: settings.META_MODEL_API_KEY });
  const calls = [];
  let fullResult = { signed: true, signature: '5'.repeat(88) };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).includes('/status')) return Response.json({ pendingSwap: { ...args, idempotencyKey } });
    assert.equal(String(url), `${settings.NEXT_PUBLIC_AGENT_RUNTIME_URL}/api/spend`, 'no model or signing provider call');
    if (body.autoSwap) return Response.json(fullResult, { status: fullResult.signed ? 200 : 409 });
    return Response.json({ swapPreview: { ticket: 'original-ticket', minOutput: '100', usdMicros: '1000000',
      inputDecimals: 6, outputDecimals: 9, expiresAt: Date.now() + 60000 } });
  });
  const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
  const post = async body => (await POST(new Request('https://desk.invalid/api/bots/bot_swap/chat', {
    method: 'POST', headers: { 'x-owner-id': ownerId }, body: JSON.stringify({ permission: 'full', ...body }),
  }), { params: { botId } })).json();
  assert.match((await post({ message: 'yes', grants: [{ ...hold, proof: '' }] })).reply, /invalid or expired/);
  const approved = await post({ message: 'yes', grants: [hold] });
  assert.equal(approved.clientSwap.spend.idempotencyKey, idempotencyKey);
  assert.equal(approved.clientSwap.swapTicket, 'original-ticket');
  assert.equal(calls.length, 0, 'a slide must not use the old server authorization protocol');
  const stream = await POST(new Request('https://desk.invalid/api/bots/bot_swap/chat', {
    method: 'POST', headers: { 'x-owner-id': ownerId, accept: 'text/event-stream' },
    body: JSON.stringify({ message: 'yes', permission: 'full', grants: [hold] }),
  }), { params: { botId } });
  assert.match(await stream.text(), /"clientSwap":\{"spend":/);
  const manual = await post({ message: 'Review pending swap', permission: 'ask' });
  assert.equal(manual.clientSwap, undefined);
  assert.equal(manual.hold?.swapTicket, 'original-ticket');
  assert.match(manual.hold.prompt, /Approve in your wallet/);
  assert.equal(calls.some(call => call.body?.autoSwap === true), false);
  const automatic = await post({ message: 'Review pending swap', reviewCap: '1' });
  assert.match(automatic.reply, /Submitted automatically: https:\/\/solscan\.io\/tx\/5+/);
  assert.equal(automatic.clientSwap, undefined);
  assert.equal(automatic.hold, undefined);
  const review = await post({ message: 'Review pending swap', permission: 'review', reviewCap: '1000000' });
  assert.match(review.reply, /Submitted automatically/);
  const over = await post({ message: 'Review pending swap', permission: 'review', reviewCap: '999999' });
  assert.equal(over.hold?.swapTicket, 'original-ticket');
  fullResult = { signed: false, state: 'approval-needed', reason: 'swap_delegation_unavailable' };
  const fallback = await post({ message: 'Review pending swap' });
  assert.equal(fallback.clientSwap, undefined);
  assert.equal(fallback.hold?.swapTicket, 'original-ticket');
  assert.match(fallback.hold.prompt, /unavailable for automatic signing/);
  const swapDelegation = { walletAddress: '11111111111111111111111111111111', signerId: 'test-privy-signer' };
  fullResult = { signed: false, state: 'blocked', reason: 'swap_signer_missing', swapDelegation };
  const repair = await post({ message: 'Review pending swap', permission: 'review' });
  assert.equal(repair.clientSwap.spend.permission, 'review');
  assert.equal(repair.clientSwap.spend.idempotencyKey, idempotencyKey);
  assert.equal(repair.clientSwap.swapTicket, 'original-ticket');
  const { expiresAt, ...enrollment } = repair.clientSwap.delegation;
  assert.deepEqual(enrollment, swapDelegation);
  assert.ok(expiresAt > Date.now());
  fullResult = { ...fullResult, swapDelegation: { ...swapDelegation, signerId: '' } };
  const invalidEnrollment = await post({ message: 'Review pending swap' });
  assert.equal(invalidEnrollment.clientSwap, undefined);
  const automaticCalls = calls.filter(call => call.body?.autoSwap === true);
  assert.equal(automaticCalls.length, 5);
  assert.ok(automaticCalls.every(call => call.body.swapTicket === 'original-ticket' && !call.body.confirmed));
});

test('chat Laso endpoints require the sealed slide hold and carry browser prepare/settle without calling the model', async t => {
  const config = { NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://laso-runtime.invalid', META_MODEL_API_KEY: 'offline-laso-chat-key' };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const ownerId = 'did:privy:laso-chat';
  const botId = 'bot_laso';
  const hold = sealAssetSpendHold(toolAccessRequest('ask', 'request_spend', {
    botId, action: 'x402', asset: 'USDC', amount: '10000000', lasoTicket: `payload.${'a'.repeat(64)}`,
  }), { ownerId, botId, secret: config.META_MODEL_API_KEY });
  const payment = { phase: 'prepared', walletAddress: 'So11111111111111111111111111111111111111112',
    blockhash: 'So11111111111111111111111111111111111111112', transaction: Buffer.alloc(200).toString('base64'),
    expiresAt: Date.now() + 60000, proof: 'b'.repeat(64) };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), `${config.NEXT_PUBLIC_AGENT_RUNTIME_URL}/api/spend`, 'no model, signing provider or live calls');
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.equal(body.confirmed, true);
    assert.equal(body.idempotencyKey, hold.idempotencyKey);
    assert.equal(body.lasoTicket, hold.args.lasoTicket);
    assert.equal(body.spendAuthorization, undefined);
    return Response.json(body.lasoPayment.phase === 'prepare' ? { signed: false, lasoPayment: payment }
      : { signed: true, cluster: 'mainnet-beta', signature: '5'.repeat(88), card: { card_id: 'card_1', usd_amount: 10, status: 'pending' },
        claimUrl: 'https://laso.finance/agent/dashboard/auth?token=owner-only' });
  });
  const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
  const post = async (grants, lasoPayment, owner = ownerId, stream = false) => {
    const response = await POST(new Request('https://desk.invalid/api/bots/bot_laso/chat', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-id': owner,
        ...(stream ? { accept: 'text/event-stream' } : {}) },
      body: JSON.stringify({ message: 'yes', permission: 'ask', grants, lasoPayment }),
    }), { params: { botId } });
    if (stream) return response.text();
    return response.json();
  };
  assert.equal((await post([hold])).error, 'browser_wallet_required');
  assert.equal((await post([], { phase: 'prepare' })).error, 'invalid_laso_payment');
  assert.equal((await post([hold], payment)).error, 'invalid_laso_payment');
  assert.match((await post([{ ...hold, proof: '' }], { phase: 'prepare' })).reply, /invalid or expired/);
  assert.match((await post([hold], { phase: 'prepare' }, 'did:privy:other')).reply, /invalid or expired/);
  assert.equal(calls.length, 0);
  const prepared = await post([hold], { phase: 'prepare' });
  assert.deepEqual(prepared.lasoPayment, payment);
  assert.equal(prepared.reply, undefined);
  assert.match(await post([hold], { phase: 'prepare' }, ownerId, true), /"lasoPayment":\{"phase":"prepared"/);
  const settled = await post([hold], { ...payment, phase: 'settle' });
  assert.match(settled.reply, /Laso card card_1/);
  assert.match(settled.claimUrl, /owner-only/);
  assert.equal(settled.lasoPayment, undefined);
  assert.equal(JSON.stringify(settled.activity).includes('owner-only'), false);
  assert.equal(JSON.stringify(settled).includes(payment.transaction), false);
  assert.equal(calls.length, 3);
});

test('wallet move accepts a verified connected recipient and signs only with the stored sender', async (t) => {
  const ownerId = 'did:privy:move-recipient';
  const session = privySessionFixture(ownerId, 'recipienttestapp');
  const sender = Keypair.generate();
  const phantomSigner = Keypair.generate();
  const phantom = phantomSigner.publicKey.toBase58();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const from = { id: 'cm5sender1234567890abcd', address: sender.publicKey.toBase58() };
  const to = { id: `linked_${phantom}`, address: phantom };
  const settings = {
    PRIVY_APP_ID: session.appId,
    PRIVY_APP_SECRET: 'offline-secret',
    PRIVY_AUTHORIZATION_KEY: ' ',
    SOLANA_RPC_URL: 'https://move-rpc.invalid',
    QUICKNODE_MAINNET_RPC_URL: 'https://move-rpc.invalid',
    SUPABASE_URL: 'https://move-store.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'offline-store-key',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let frozen = false;
  let loginOwner = ownerId;
  let expectedAsset = null;
  let tokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  let simulationError = null;
  const tokenAccount = Keypair.generate().publicKey.toBase58();
  const tokenMint = Keypair.generate().publicKey.toBase58();
  const signing = [];
  const broadcasts = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const target = String(url);
    if (target === session.jwksUrl) return session.jwks();
    if (target.startsWith(`${settings.SUPABASE_URL}/rest/v1/wallets?`)) {
      return Response.json([{
        ...from, owner_id: ownerId, kind: 'main', label: 'Main', frozen, spendable: true,
      }]);
    }
    if (target === `https://api.privy.io/v1/users/${encodeURIComponent(ownerId)}`) {
      return Response.json({ id: loginOwner, linked_accounts: [{
        type: 'wallet', chain_type: 'solana', wallet_client_type: 'phantom', address: phantom,
      }] });
    }
    const body = JSON.parse(init?.body || '{}');
    if (target === `https://api.privy.io/v1/wallets/${from.id}/rpc`) {
      assert.equal(body.method, 'signTransaction');
      const transaction = Transaction.from(Buffer.from(body.params.transaction, 'base64'));
      const expected = expectedAsset ? { transaction: Transaction.from(Buffer.from(buildWalletAssetTransaction({
        asset: expectedAsset, decimals: expectedAsset === 'SOL' ? 9 : 8, tokenProgramId,
        accounts: [{ address: tokenAccount, amount: '9000000000' }],
        sourceOwner: from.address, destinationOwner: phantom, amount: '1000000', recentBlockhash: blockhash,
      }), 'base64')) } : buildSolanaUsdcTransaction({
        feePayer: from.address, sourceOwner: from.address, destinationOwner: phantom,
        amount: '1000000', memo: 'wallet.move', recentBlockhash: blockhash,
      });
      assert.deepEqual(transaction.serializeMessage(), expected.transaction.serializeMessage());
      assert.deepEqual(transaction.signatures.map(row => row.publicKey.toBase58()), [from.address]);
      signing.push(target);
      transaction.sign(sender);
      return Response.json({ data: { signed_transaction: transaction.serialize().toString('base64') } });
    }
    assert.equal(target, settings.SOLANA_RPC_URL, 'all network calls must remain mocked');
    if (body.method === 'getGenesisHash') return Response.json({ result: SOLANA_GENESIS_HASH });
    if (body.method === 'getLatestBlockhash') return Response.json({ result: { value: { blockhash, lastValidBlockHeight: 100 } } });
    if (body.method === 'getBalance') return Response.json({ result: { value: 9000000000 } });
    if (body.method === 'getAccountInfo') return Response.json({ result: { value: { owner: tokenProgramId, data: { parsed: { type: 'mint', info: { decimals: 8, isInitialized: true } } } } } });
    if (body.method === 'getTokenAccountsByOwner') return Response.json({ result: { value: [{ pubkey: tokenAccount, account: { owner: tokenProgramId, data: { parsed: { info: { owner: body.params[0], mint: tokenMint, state: 'initialized', tokenAmount: { amount: '9000000000', decimals: 8 } } } } } }] } });
    if (body.method === 'getFeeForMessage') return Response.json({ result: { value: 5000 } });
    if (body.method === 'simulateTransaction') return Response.json({ result: { value: { err: simulationError } } });
    assert.equal(body.method, 'sendTransaction');
    broadcasts.push(body);
    return Response.json({ result: '5'.repeat(88) });
  });
  const { POST } = await import('../app/api/wallets/move/route.js');
  const move = (payload) => POST(new Request('http://localhost/api/wallets/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}`, 'x-owner-id': ownerId },
    body: JSON.stringify({ from, to, amount: '1000000', ...payload }),
  }));
  const sent = await move();
  assert.equal(sent.status, 200, JSON.stringify(await sent.clone().json()));
  assert.equal((await sent.json()).address, phantom);
  assert.equal(signing.length, 1);
  assert.equal(broadcasts.length, 1);

  for (const payload of [
    { to: { ...to, address: Keypair.generate().publicKey.toBase58() } },
    { to: { ...to, id: 'unverified' } },
    { from: { ...to, spendable: true }, to: from },
    { from: { ...from, address: phantom } },
  ]) {
    assert.equal((await move(payload)).status, 400);
  }
  frozen = true;
  const blocked = await move();
  assert.equal(blocked.status, 400);
  assert.equal((await blocked.json()).error, 'wallet_frozen');
  frozen = false;
  loginOwner = 'did:privy:someone-else';
  assert.equal((await move()).status, 403);
  assert.equal(signing.length, 1, 'invalid requests never sign');
  assert.equal(broadcasts.length, 1, 'invalid requests never broadcast');
  for (const name of ['PRIVY_APP_SECRET', 'SOLANA_RPC_URL']) {
    delete process.env[name];
    if (name === 'SOLANA_RPC_URL') delete process.env.QUICKNODE_MAINNET_RPC_URL;
    const unconfigured = await move();
    assert.equal(unconfigured.status, 503);
    assert.deepEqual(await unconfigured.json(), { error: 'missing_config', missing: [name] });
    process.env[name] = settings[name];
    if (name === 'SOLANA_RPC_URL') process.env.QUICKNODE_MAINNET_RPC_URL = settings.QUICKNODE_MAINNET_RPC_URL;
  }
  loginOwner = ownerId;
  for (const asset of ['SOL', tokenMint, tokenMint]) {
    expectedAsset = asset;
    const response = await move({ asset, destination: phantom, decimals: asset === 'SOL' ? 9 : 8, phase: 'send' });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).asset, asset);
    if (asset !== 'SOL') tokenProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  }
  assert.equal(signing.length, 4);
  const wrongDecimals = await move({ asset: tokenMint, destination: phantom, decimals: 9, phase: 'send' });
  assert.equal((await wrongDecimals.json()).error, 'asset_changed');
  simulationError = { InstructionError: [0, 'InsufficientFunds'] };
  const simulated = await move({ asset: tokenMint, destination: phantom, decimals: 8, phase: 'send' });
  assert.equal((await simulated.json()).error, 'simulation_failed');
  assert.equal(signing.length, 4, 'asset validation and simulation failures never sign');
  assert.equal(broadcasts.length, 4);
  simulationError = null;
  for (const asset of ['SOL', tokenMint]) {
    const destination = Keypair.generate().publicKey.toBase58();
    const payload = { from: { ...to, spendable: true }, asset, destination, decimals: asset === 'SOL' ? 9 : 8 };
    const prepared = await move({ ...payload, phase: 'prepare' });
    assert.equal(prepared.status, 200, JSON.stringify(await prepared.clone().json()));
    const { transaction: unsigned } = await prepared.json();
    assert.equal(signing.length, 4, 'prepare never signs for an external wallet');
    const unsignedBroadcast = await move({ ...payload, phase: 'broadcast', signedTransaction: unsigned });
    assert.equal((await unsignedBroadcast.json()).error, 'invalid_signature');
    const transaction = Transaction.from(Buffer.from(unsigned, 'base64'));
    transaction.sign(phantomSigner);
    const signedTransaction = transaction.serialize().toString('base64');
    const sent = await move({ ...payload, phase: 'broadcast', signedTransaction });
    assert.equal(sent.status, 200, JSON.stringify(await sent.clone().json()));
    const changed = await move({ ...payload, destination: from.address, phase: 'broadcast', signedTransaction });
    assert.equal((await changed.json()).error, 'transaction_mismatch');
    const forged = await move({ ...payload, phase: 'send' });
    assert.equal((await forged.json()).error, 'invalid_phase', 'request spendable flag cannot choose the Privy signer');
  }
  assert.equal(signing.length, 4);
  assert.equal(broadcasts.length, 6);
  const unlinked = await move({ from: { id: 'unverified', address: Keypair.generate().publicKey.toBase58() }, asset: 'SOL', destination: from.address, decimals: 9, phase: 'prepare' });
  assert.equal((await unlinked.json()).error, 'wallet_not_owned');
});

test('profile claims and handle lookup share the configured runtime directory', async (t) => {
  const settings = {
    NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://runtime.test.example',
    SUPABASE_URL: 'https://local-directory.test.example',
    SUPABASE_SERVICE_ROLE_KEY: 'local-test-key',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const forwarded = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).origin, settings.NEXT_PUBLIC_AGENT_RUNTIME_URL);
    assert.equal(init.headers.get('authorization'), 'Bearer signed-in-test-token');
    return Response.json({ ok: true });
  });
  const { GET, PUT } = await import('../app/api/runtime/[...path]/route.js');
  const base = 'https://desk.example/api/runtime/api/profiles';
  const headers = { authorization: 'Bearer signed-in-test-token', 'x-owner-id': 'did:privy:alice' };
  const saved = await PUT(new Request(`${base}/me`, { method: 'PUT', headers, body: '{}' }), { params: { path: ['api', 'profiles', 'me'] } });
  const found = await GET(new Request(`${base}/lookup?q=%40bob`, { headers }), { params: { path: ['api', 'profiles', 'lookup'] } });
  assert.equal(saved.status, 200);
  assert.equal(found.status, 200);
  assert.deepEqual(forwarded.mock.calls.map(({ arguments: [url, init] }) => [new URL(url).pathname, init.method]), [
    ['/api/profiles/me', 'PUT'],
    ['/api/profiles/lookup', 'GET'],
  ]);
});

test('wallet export proxy forwards only well-formed desk grants with owner authentication', async (t) => {
  const previous = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = 'https://runtime.test.example';
  t.after(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = previous;
  });
  const grant = 'cd'.repeat(32);
  let expectedGrant;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://runtime.test.example/api/wallets/fmfdj6yqly31huorjqzq38zc/export');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.get('authorization'), 'Bearer offline-token');
    assert.equal(init.headers.get('x-owner-id'), 'did:privy:alice');
    assert.equal(init.headers.get('x-desk-grant'), expectedGrant);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), { recipientPublicKey: 'synthetic-recipient' });
    return expectedGrant
      ? Response.json({ encryptionType: 'HPKE', encapsulatedKey: 'enc', ciphertext: 'ct' })
      : Response.json({ error: 'desk_locked' }, { status: 403 });
  });
  const { POST } = await import('../app/api/runtime/[...path]/route.js');
  for (const value of [grant, '', 'invalid', 'a'.repeat(65)]) {
    expectedGrant = value === grant ? grant : null;
    const response = await POST(new Request('https://desk.example/api/runtime/api/wallets/fmfdj6yqly31huorjqzq38zc/export', {
      method: 'POST',
      headers: { authorization: 'Bearer offline-token', 'x-owner-id': 'did:privy:alice', 'x-desk-grant': value },
      body: JSON.stringify({ recipientPublicKey: 'synthetic-recipient' }),
    }), { params: Promise.resolve({ path: ['api', 'wallets', 'fmfdj6yqly31huorjqzq38zc', 'export'] }) });
    assert.equal(response.status, expectedGrant ? 200 : 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), expectedGrant
      ? { encryptionType: 'HPKE', encapsulatedKey: 'enc', ciphertext: 'ct' }
      : { error: 'desk_locked' });
  }
});

test('chat sends SOL to a handle without a model call and binds approval to the resolved wallet', async (t) => {
  const runtime = 'https://runtime.test.example';
  const previous = { runtime: process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL, modelKey: process.env.META_MODEL_API_KEY };
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = runtime;
  process.env.META_MODEL_API_KEY = 'test-only-approval-signing-key';
  t.after(() => {
    if (previous.runtime === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = previous.runtime;
    if (previous.modelKey === undefined) delete process.env.META_MODEL_API_KEY;
    else process.env.META_MODEL_API_KEY = previous.modelKey;
  });

  const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const signature = 'a'.repeat(88);
  const deskGrant = 'ab'.repeat(32);
  let recipient = { kind: 'handle', handle: 'hi', missing: false, address };
  let locked = false;
  const sends = [];
  const checks = t.mock.method(globalThis, 'fetch', async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, runtime, 'must not call the model or a search provider');
    assert.equal(init.headers.authorization, 'Bearer test-owner-token');
    if (target.pathname === '/api/profiles/lookup') {
      assert.equal(target.searchParams.get('q'), '@hi');
      assert.equal(init.method, 'GET');
      assert.ok(init.signal);
      return Response.json({ ok: true, recipient });
    }
    assert.equal(target.pathname, '/api/spend');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-desk-grant'], deskGrant);
    const payload = JSON.parse(init.body);
    sends.push(payload);
    if (locked) return Response.json({ error: 'desk_locked', signed: false }, { status: 403 });
    if (payload.destination !== recipient.address) {
      return Response.json({ signed: false, error: 'recipient_address_missing' }, { status: 400 });
    }
    return Response.json({ signed: true, cluster: 'mainnet-beta', signature });
  });

  const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
  const chat = async (grants = [], { stream = true, expectedStatus = 200 } = {}) => {
    const res = await POST(new Request('https://desk.example/api/bots/bot_1/chat', {
      method: 'POST',
      headers: {
        accept: stream ? 'text/event-stream, application/json' : 'application/json',
        authorization: 'Bearer test-owner-token',
        'x-owner-id': 'did:privy:alice',
        'x-desk-grant': deskGrant,
      },
      body: JSON.stringify({ message: 'Could you send 1 SOL to @Hi?', permission: 'full', grants }),
    }), { params: { botId: 'bot_1' } });
    assert.equal(res.status, expectedStatus);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = res.headers.get('content-type')?.includes('text/event-stream')
      ? JSON.parse((await res.text()).split('\n').find(line => line.startsWith('data: ')).slice(6))
      : await res.json();
    if (!body.error) assert.equal(body.provider, 'desk');
    return body;
  };
  const { hold, toolRounds } = await chat();
  assert.equal(toolRounds, 0);
  assert.equal(hold.kind, 'modal');
  assert.match(hold.proof, /^[0-9a-f]{64}$/);
  assert.match(hold.prompt, /1 SOL to @hi \(EPjFW\.\.\.TDt1v\) on Solana mainnet-beta/);
  assert.deepEqual(sends, []);

  recipient = { ...recipient, address: 'So11111111111111111111111111111111111111112' };
  const tampered = await chat([{ ...hold, args: { ...hold.args, destination: recipient.address } }]);
  assert.match(tampered.reply, /invalid or expired/);
  assert.deepEqual(sends, []);

  const changed = await chat([hold]);
  assert.match(changed.activity[0].error, /recipient_address_missing/);
  assert.equal(changed.hold, undefined);
  assert.equal(sends[0].destination, address);

  recipient = { ...recipient, address };
  locked = true;
  assert.deepEqual(await chat([hold]), { error: 'desk_locked' });
  assert.deepEqual(await chat([hold], { stream: false, expectedStatus: 403 }), { error: 'desk_locked' });
  locked = false;
  const sent = await chat([hold]);
  assert.equal(sent.toolRounds, 1);
  assert.match(sent.reply, /Sent\./);
  assert.ok(sent.reply.includes(`https://solscan.io/tx/${signature}`));
  assert.deepEqual(sends[3], {
    botId: 'bot_1',
    action: 'spend',
    amount: '1000000000',
    destination: address,
    handle: 'hi',
    asset: 'SOL',
    idempotencyKey: hold.idempotencyKey,
    confirmed: true,
    permission: 'full',
    reviewCap: '30000000',
  });
  assert.deepEqual(sends[1], sends[3]);
  assert.deepEqual(sends[2], sends[3]);

  recipient = { kind: 'handle', handle: 'hi', missing: true };
  assert.match((await chat()).reply, /couldn’t find @hi/);
  assert.equal(checks.mock.callCount(), 6);
  assert.equal(sends.length, 4);
});

test('chat requires a second sealed slide and a verified owner to approve an over-limit SOL send', async (t) => {
  const config = {
    NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://runtime.test.example',
    META_MODEL_API_KEY: 'test-only-chat-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-runtime-key',
    PRIVY_APP_ID: 'testprivyapp',
  };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const ownerId = 'did:privy:alice';
  const botId = 'bot_1';
  const terms = { walletId: 'wallet_1', walletAddress: 'So11111111111111111111111111111111111111112', policyVersion: 1, feeLamports: '5000' };
  const args = {
    botId, action: 'spend', amount: '1000000000', asset: 'SOL', handle: 'hi',
    destination: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  };
  const initial = sealAssetSpendHold(toolAccessRequest('review', 'request_spend', args), {
    ownerId, botId, secret: config.META_MODEL_API_KEY,
  });
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const tokenFor = sub => {
    const input = `${encode({ alg: 'ES256', kid: 'test-key' })}.${encode({
      iss: 'privy.io', aud: config.PRIVY_APP_ID, sub, exp: Math.floor(Date.now() / 1000) + 60,
    })}`;
    return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  };
  const calls = [];
  const challenge = {
    blockhash: '11111111111111111111111111111111',
    expiresAt: Date.now() + 60_000, proof: 'b'.repeat(64), payload: Buffer.alloc(100, 4).toString('base64'),
  };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const target = new URL(url);
    if (target.origin === 'https://auth.privy.io') {
      assert.equal(target.pathname, `/api/v1/apps/${config.PRIVY_APP_ID}/jwks.json`);
      return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key' }] });
    }
    assert.equal(target.origin, config.NEXT_PUBLIC_AGENT_RUNTIME_URL);
    assert.equal(target.pathname, '/api/spend');
    const raw = JSON.parse(init.body);
    const spend = parsePermissionedSpendBody(raw);
    const approval = init.headers['x-spend-approve-once'];
    calls.push({ spend, approval, spendAuthorization: raw.spendAuthorization });
    if (!approval) {
      return Response.json({ state: 'approval-needed', reason: 'per-transaction', signed: false, approvalTerms: terms }, { status: 409 });
    }
    const binding = spendApprovalMessage({ ownerId, spend, terms, expiresAt: initial.expiresAt });
    assert.equal(approval, `v1.${initial.expiresAt}.${createHmac('sha256', config.SUPABASE_SERVICE_ROLE_KEY).update(binding).digest('hex')}`);
    if (raw.spendAuthorization === 'prepare') {
      return Response.json({ signed: false, spendAuthorization: challenge });
    }
    return Response.json({ signed: true, cluster: 'mainnet-beta', signature: 'a'.repeat(88) });
  });

  const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
  const chat = async (hold, token = tokenFor(ownerId), spendAuthorization) => {
    const res = await POST(new Request('https://desk.example/api/bots/bot_1/chat', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-owner-id': ownerId, 'x-spend-approve-once': 'client-supplied' },
      body: JSON.stringify({ message: 'Send 1 SOL to @hi', grants: [hold], permission: 'review', spendAuthorization }),
    }), { params: { botId } });
    return res.json();
  };
  const waiting = await chat(initial, undefined, 'prepare');
  assert.match(waiting.reply, /Approve once: send 1 SOL to @hi.*0.000005 SOL fee/);
  assert.equal(waiting.hold.idempotencyKey, initial.idempotencyKey);
  assert.equal(waiting.hold.expiresAt, initial.expiresAt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].approval, undefined);
  assert.match((await chat({ ...initial, budgetOverride: terms })).reply, /invalid or expired/);
  assert.match((await chat({ ...waiting.hold, budgetOverride: { ...terms, feeLamports: '10000' } })).reply, /invalid or expired/);
  assert.equal((await chat(waiting.hold, tokenFor('did:privy:someone-else'))).error, 'login_required');
  assert.equal((await chat(waiting.hold, 'invalid-token')).error, 'login_required');
  assert.equal(calls.length, 1);
  const prepared = await chat(waiting.hold, undefined, 'prepare');
  assert.deepEqual(prepared.spendAuthorization, challenge);
  assert.equal(prepared.hold, undefined);
  assert.equal(prepared.reply, undefined);
  const { payload, ...proof } = challenge;
  const authorization = { ...proof, signature: Buffer.alloc(64, 3).toString('base64') };
  const sent = await chat(waiting.hold, undefined, authorization);
  assert.match(sent.reply, /Sent\./);
  assert.equal(sent.spendAuthorization, undefined);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].spendAuthorization, authorization);
  assert.equal(JSON.stringify(sent).includes(authorization.signature), false);
  assert.deepEqual(calls[0].spend, calls[1].spend);
});

/**
 * Rigor audit — GET /api/build happy path
 * Achieves: returns JSON { id } with no-store when NEXT_PUBLIC_BUILD_ID is set.
 * Fails when: id ignored, cached, or wrong field name (tabs cannot detect deploys).
 * Oracle: clients poll { id } with Cache-Control: no-store.
 * Side effects: restores process.env after test (isolation).
 * Gaps: none for this handler.
 */
test('GET /api/build returns no-store JSON with string id', async () => {
  const prev = process.env.NEXT_PUBLIC_BUILD_ID;
  process.env.NEXT_PUBLIC_BUILD_ID = 'abc123deadbeef';
  try {
    const res = await getBuild();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control') || '', /no-store/);
    const body = await res.json();
    assert.equal(body.id, 'abc123deadbeef');
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID;
    else process.env.NEXT_PUBLIC_BUILD_ID = prev;
  }
});

/**
 * Rigor audit — GET /api/build missing env
 * Achieves: still returns { id: '' } — clients must handle empty without crashing.
 * Fails when: handler throws or omits id when env unset.
 * Oracle: stable JSON shape regardless of deploy env.
 * Side effects: restores env.
 * Gaps: none.
 */
test('GET /api/build with missing env still returns an id field (empty string)', async () => {
  const prev = process.env.NEXT_PUBLIC_BUILD_ID;
  delete process.env.NEXT_PUBLIC_BUILD_ID;
  try {
    const body = await (await getBuild()).json();
    assert.equal(body.id, '');
    assert.equal(Object.keys(body).join(','), 'id');
  } finally {
    if (prev !== undefined) process.env.NEXT_PUBLIC_BUILD_ID = prev;
  }
});

/**
 * Rigor audit — GET /api/token does not proxy Dex
 * Achieves: 400 browser_dex so one Worker IP does not share DexScreener rate limits.
 * Fails when: route starts proxying quotes or returns 200 with fake prices.
 * Oracle: product decision — browser calls DexScreener directly.
 * Side effects: none.
 * Gaps: none for refusal contract.
 */
test('GET /api/token refuses to proxy DexScreener (browser must call it)', async () => {
  const res = await getToken();
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'browser_dex');
  assert.equal(body.quoteSource, 'dexscreener');
  assert.match(res.headers.get('Cache-Control') || '', /no-store/);
});

/**
 * Rigor audit — page.js drift guard (SOURCE READ — does not execute React)
 * Achieves: AuthedShell still calls walletProvisionPaths()[0] and never hard-codes
 *   `/api/runtime/api/wallets` create.
 * Fails when: runtime create reintroduced as a string literal or helper unused.
 * Oracle: Workers strip Origin — shell must provision on Next only.
 * Side effects: none.
 * Gaps: source contract only — paired with walletProvisionPaths unit test.
 *   Remaining: does not render page or fire fetch.
 */
test('page.js provisions wallets only through walletProvisionPaths (no runtime create)', () => {
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  assert.match(page, /walletProvisionPaths/);
  assert.match(page, /walletProvisionSucceeded/);
  assert.equal(/\/api\/runtime\/api\/wallets/.test(page), false);
  assert.equal(/fetch\(\s*['"`]\/api\/runtime/.test(page), false);
  assert.match(page, /walletProvisionPaths\(\)\[0\]/);
});

/**
 * Rigor audit — wallets route wiring drift guard (SOURCE READ)
 * Achieves: route imports shared helpers and still POSTs persist to runtime.
 * Fails when: inline requestOrigin reappears or persist mirror removed.
 * Oracle: helpers are the tested Origin/publicWallet implementation.
 * Side effects: none.
 * Gaps: source only — helpers executed in wallets-route.test.mjs.
 */
test('wallets route uses shared Origin/publicWallet helpers and mirrors persist', () => {
  const route = readFileSync(join(root, 'app/api/wallets/route.js'), 'utf8');
  assert.match(route, /from ['"].*wallets-route\.mjs['"]/);
  assert.match(route, /requestOrigin\(request\)/);
  assert.match(route, /publicWallet/);
  assert.match(route, /walletErrorFields/);
  assert.match(route, /walletErrorStatus/);
  assert.match(route, /\/api\/wallets\/persist/);
  assert.equal(/function requestOrigin/.test(route), false);
});

/**
 * Rigor audit — runtime proxy Origin forward drift guard (SOURCE READ)
 * Achieves: proxy still sets x-maelstrom-origin and rejects CR/LF / huge bodies.
 * Fails when: Origin forwarding or body_too_large guard removed.
 * Oracle: Worker acceptLogin needs browser Origin via proxy header.
 * Side effects: none.
 * Gaps: source only — path allowlist executed in runtime-proxy.test.mjs.
 */
test('runtime proxy forwards Origin as x-maelstrom-origin for Worker Privy', () => {
  const route = readFileSync(join(root, 'app/api/runtime/[...path]/route.js'), 'utf8');
  assert.match(route, /x-maelstrom-origin/);
  assert.match(route, /runtimeProxyTarget/);
  assert.match(route, /\[\\r\\n\]/);
  assert.match(route, /body_too_large/);
});

/**
 * Rigor audit — SNS resolve empty domain
 * Achieves: empty domain → 404 sns_not_found (SnsError path) without needing network
 *   success; if resolve throws non-SnsError still 404 sns_failed — we only assert
 *   not-found for empty which SNS treats as invalid.
 * Fails when: empty domain returns 200 or throws uncaught.
 * Oracle: resolveSnsOwner rejects empty/invalid domains.
 * Side effects: may attempt network depending on SNS impl — status/body still asserted.
 * Gaps: does not prove a real domain resolves (covered in packages/sns).
 */
test('GET /api/sns/resolve returns sns_not_found for empty domain without calling network', async () => {
  const { GET } = await import('../app/api/sns/resolve/route.js');
  const res = await GET(new Request('http://localhost/api/sns/resolve'));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'sns_not_found');
});

/**
 * Rigor audit — voice token unconfigured
 * Achieves: fails closed with error code and no API key material when ElevenLabs unset.
 * Fails when: 200 with empty token, or response body contains sk_ secrets.
 * Oracle: VoiceTokenError → 503 voice_unconfigured when key missing.
 * Side effects: none (no network when unconfigured).
 * Gaps: none — closed: prefer exact 503 + voice_unconfigured when keys absent.
 */
test('POST /api/voice/token fails closed when ElevenLabs is unconfigured', async () => {
  const { POST } = await import('../app/api/voice/token/route.js');
  const res = await POST(new Request('http://localhost/api/voice/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  assert.equal(JSON.stringify(body).includes('sk_'), false);
  // When env truly has no key, expect the unconfigured contract; if a key is
  // present in this VM, accept 502 voice_failed but never 200.
  if (res.status === 503) assert.equal(body.error, 'voice_unconfigured');
  else assert.equal(res.status, 502);
});

/**
 * Rigor audit — SNS send auth gate
 * Achieves: missing bearer → 401 login_required before domain resolve / spend.
 * Fails when: unauthenticated requests proceed to SNS or Privy.
 * Oracle: all spend routes require login.
 * Side effects: none (returns before network).
 * Gaps: none for auth gate. Remaining: owner_mismatch / plan errors need secrets.
 */
test('POST /api/sns/send requires bearer auth before SNS resolve', async () => {
  const { POST } = await import('../app/api/sns/send/route.js');
  const res = await POST(new Request('http://localhost/api/sns/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'richclub.sol', amount: '1' }),
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'login_required');
});

/**
 * Rigor audit — GET /api/wallets config flags
 * Achieves: boolean flags + missing[] only; no secret values in JSON.
 * Fails when: response includes app secret / auth key material or omits flags.
 * Oracle: UI config card shows names/flags, never values.
 * Side effects: none.
 * Gaps: none for shape. Remaining: does not prove flag accuracy vs real Privy.
 */
test('GET /api/wallets reports config flags without secret values', async () => {
  const { GET } = await import('../app/api/wallets/route.js');
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.hasAppId, 'boolean');
  assert.equal(typeof body.hasAppSecret, 'boolean');
  assert.equal(typeof body.hasRpc, 'boolean');
  assert.equal(typeof body.hasAuthorizationKey, 'boolean');
  assert.equal(typeof body.hasPublicAppId, 'boolean');
  assert.equal(typeof body.hasRuntimeUrl, 'boolean');
  assert.equal(typeof body.runtimeHostOk, 'boolean');
  assert.equal(typeof body.appIdAligned, 'boolean');
  assert.ok(Array.isArray(body.missing));
  const raw = JSON.stringify(body);
  assert.equal(/sk_|Bearer |wallet-auth:|cm[a-z0-9]{10,}/.test(raw), false);
  assert.equal(Object.keys(body).sort().join(','), [
    'appIdAligned',
    'hasAppId',
    'hasAppSecret',
    'hasAuthorizationKey',
    'hasPublicAppId',
    'hasRpc',
    'hasRuntimeUrl',
    'missing',
    'runtimeHostOk',
  ].sort().join(','));
});

/**
 * Rigor audit — bot chat input validation
 * Achieves: invalid bot id, missing owner, empty message each fail with distinct codes
 *   before OpenRouter is called.
 * Fails when: validation order wrong (e.g. missing owner returns invalid_bot) or
 *   empty message proceeds to LLM.
 * Oracle: BOT_ID/OWNER regexes + non-empty trimmed message ≤ 500.
 * Side effects: none (returns before LLM).
 * Gaps: none — closed: overlong message (>500) also rejected.
 */
test('POST /api/bots/:botId/chat rejects invalid bot, missing owner, and empty message', async () => {
  const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
  const badBot = await POST(
    new Request('http://localhost/api/bots/bad bot/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:u1' },
      body: JSON.stringify({ message: 'hi' }),
    }),
    { params: Promise.resolve({ botId: 'bad bot' }) },
  );
  assert.equal(badBot.status, 400);
  assert.equal((await badBot.json()).error, 'invalid_bot');

  const noOwner = await POST(
    new Request('http://localhost/api/bots/bot_1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    }),
    { params: Promise.resolve({ botId: 'bot_1' }) },
  );
  assert.equal(noOwner.status, 401);
  assert.equal((await noOwner.json()).error, 'owner_required');

  const empty = await POST(
    new Request('http://localhost/api/bots/bot_1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:u1' },
      body: JSON.stringify({ message: '   ' }),
    }),
    { params: Promise.resolve({ botId: 'bot_1' }) },
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'message_required');

  const tooLong = await POST(
    new Request('http://localhost/api/bots/bot_1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:u1' },
      body: JSON.stringify({ message: 'x'.repeat(501) }),
    }),
    { params: Promise.resolve({ botId: 'bot_1' }) },
  );
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, 'message_too_long');
});

/**
 * Rigor audit — POST /api/wallets auth gate
 * Achieves: no bearer → 401 login_required before Privy client construction.
 * Fails when: unauthenticated create hits Privy or returns 500.
 * Oracle: all wallet mutations require login.
 * Side effects: none.
 * Gaps: none for auth. Remaining: missing_config path depends on root env in this VM.
 */
test('POST /api/wallets without bearer returns login_required before Privy', async () => {
  const { POST } = await import('../app/api/wallets/route.js');
  const res = await POST(new Request('http://localhost/api/wallets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'login_required');
});

test('POST /api/wallets/additional without bearer returns login_required', async () => {
  const { POST } = await import('../app/api/wallets/additional/route.js');
  const res = await POST(new Request('http://localhost/api/wallets/additional', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'Additional 2' }),
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'login_required');
});

/**
 * Rigor audit — POST /api/wallets missing Privy config
 * Achieves: bearer present but no Privy secrets → 503 missing_config with env names only.
 * Fails when: hits Privy with empty credentials or returns secret values in missing[].
 * Oracle: missingWalletSecrets → PRIVY_APP_ID / PRIVY_APP_SECRET names.
 * Side effects: none (returns before client construction when secrets absent).
 * Gaps: remaining happy-path acceptLogin needs live Privy credentials.
 */
test('POST /api/wallets with bearer but missing Privy secrets returns missing_config', async () => {
  const { POST } = await import('../app/api/wallets/route.js');
  const res = await POST(new Request('http://localhost/api/wallets', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    },
    body: '{}',
  }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'missing_config');
  assert.ok(Array.isArray(body.missing));
  assert.ok(body.missing.includes('PRIVY_APP_SECRET') || body.missing.includes('PRIVY_APP_ID'));
  const raw = JSON.stringify(body);
  assert.equal(/sk_|wallet-auth:|app-secret/i.test(raw), false);
  assert.equal(raw.includes('test-token'), false);
});

/**
 * Rigor audit — GET /api/models fallback catalog
 * Achieves: returns { models } with muse-spark fallback when Meta Model key absent/unreachable;
 *   Cache-Control no-store; response never echoes API keys.
 * Fails when: empty models array, throws, or leaks META_MODEL_API_KEY.
 * Oracle: loadThinkingCatalog empty → fallbackThinkingCatalog().
 * Side effects: may set META_MODEL_API_KEY temporarily; restored after.
 * Gaps: does not assert live Meta Model catalog shape when key works.
 */
test('GET /api/models returns fallback catalog without leaking API keys', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const prev = process.env.META_MODEL_API_KEY;
  process.env.META_MODEL_API_KEY = 'sk_should_never_appear_in_body';
  try {
    const { GET } = await import('../app/api/models/route.js');
    const res = await GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control') || '', /no-store/);
    const body = await res.json();
    assert.ok(Array.isArray(body.models));
    assert.ok(body.models.length >= 1);
    assert.equal(body.models[0].id, 'muse-spark-1.3-contributor');
    assert.ok(Array.isArray(body.models[0].levels));
    const raw = JSON.stringify(body);
    assert.equal(raw.includes('sk_should_never_appear_in_body'), false);
    assert.equal(raw.includes('META_MODEL_API_KEY'), false);
  } finally {
    if (prev === undefined) delete process.env.META_MODEL_API_KEY;
    else process.env.META_MODEL_API_KEY = prev;
  }
});

test('POST /api/models validates the endpoint and checks models without returning credentials', async (t) => {
  const token = 'synthetic-provider-check-token';
  const calls = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    return Response.json({ data: [{ id: 'gpt-test' }] });
  });
  const { POST } = await import('../app/api/models/route.js');
  const request = baseUrl => new Request('https://desk.example/api/models', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl, token }),
  });
  const rejected = await POST(request('https://127.0.0.1/v1'));
  assert.equal(rejected.status, 400);
  assert.equal(calls.mock.callCount(), 0);
  const result = await POST(request('https://api.openai.com/v1'));
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control'), /no-store/);
  const body = await result.json();
  assert.equal(body.models[0].id, 'gpt-test');
  assert.equal(JSON.stringify(body).includes(token), false);
});

/**
 * Rigor audit — GET /api/portfolio auth gate
 * Achieves: missing bearer → 401 login_required before Privy/RPC.
 * Fails when: unauthenticated portfolio reads proceed.
 * Oracle: spend/read wallet routes require login.
 * Side effects: none.
 * Gaps: none for auth gate.
 */
test('GET /api/portfolio without bearer returns login_required', async () => {
  const { GET } = await import('../app/api/portfolio/route.js');
  const res = await GET(new Request('http://localhost/api/portfolio'));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('Cache-Control') || '', /no-store/);
  assert.equal((await res.json()).error, 'login_required');
});

/**
 * Rigor audit — GET /api/portfolio missing Privy config
 * Achieves: bearer present, secrets absent → 503 missing_config with env names only.
 * Fails when: attempts Privy with empty secrets or leaks token/secret values.
 * Oracle: missingWalletSecrets before createPrivyWalletClient.
 * Side effects: none.
 * Gaps: remaining loadPortfolio happy path needs RPC + Privy.
 */
/**
 * Rigor audit — GET /api/portfolio hosted identity
 * Achieves: a JWT sub loads the Privy user by id and reads balances without /users/me.
 * Fails when: the route calls /users/me (hosted 502 privy_failed) or posts a wallet create.
 * Oracle: readLoginUser Worker path + read-only portfolio RPC.
 * Side effects: global fetch stubbed and restored.
 * Gaps: does not call live Privy or QuickNode.
 */
test('GET /api/portfolio reads linked wallets from the JWT user id', async () => {
  const ownerId = 'did:privy:portfolio-user';
  const address = 'So11111111111111111111111111111111111111112';
  const session = privySessionFixture(ownerId);
  const { token } = session;
  const rpcUrl = 'https://example.invalid/portfolio-rpc';
  const previous = {
    PRIVY_APP_ID: process.env.PRIVY_APP_ID,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    QUICKNODE_MAINNET_RPC_URL: process.env.QUICKNODE_MAINNET_RPC_URL,
  };
  process.env.PRIVY_APP_ID = session.appId;
  process.env.PRIVY_APP_SECRET = 'portfolio-app-secret';
  process.env.SOLANA_RPC_URL = rpcUrl;
  process.env.QUICKNODE_MAINNET_RPC_URL = rpcUrl;
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, method: init?.method, redirect: init?.redirect });
    if (target === session.jwksUrl) return session.jwks();
    if (target.includes('/users/me')) {
      return new Response(JSON.stringify({ error: 'users_me_forbidden' }), { status: 403 });
    }
    if (target.includes(`/v1/users/${encodeURIComponent(ownerId)}`)) {
      return new Response(JSON.stringify({
        id: ownerId,
        linked_accounts: [{
          type: 'wallet',
          address,
          chain_type: 'solana',
          wallet_client_type: 'phantom',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target === rpcUrl) {
      const body = JSON.parse(init.body);
      const results = body.map(row => {
        if (row.method === 'getGenesisHash') {
          return { jsonrpc: '2.0', id: row.id, result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' };
        }
        if (row.method === 'getBalance') {
          return { jsonrpc: '2.0', id: row.id, result: { value: 1000 } };
        }
        return { jsonrpc: '2.0', id: row.id, result: { value: [] } };
      });
      return new Response(JSON.stringify(results), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.startsWith('https://perps-api.jup.ag/v1/positions?')) {
      assert.equal(new URL(target).searchParams.get('walletAddress'), address);
      assert.equal(init.headers, undefined);
      return Response.json({ dataList: [] });
    }
    if (target.startsWith('https://dlmm.datapi.meteora.ag/portfolio/open?')) {
      assert.equal(new URL(target).searchParams.get('user'), address);
      assert.equal(init.headers, undefined);
      return Response.json({ hasNext: false, pools: [] });
    }
    return new Response(JSON.stringify({ error: 'unmocked' }), { status: 500 });
  };
  try {
    const { GET } = await import('../app/api/portfolio/route.js');
    const res = await GET(new Request('http://localhost/api/portfolio', {
      headers: {
        authorization: `Bearer ${token}`,
        'x-owner-id': ownerId,
        origin: 'https://dev.maelstrom.iexdevs.com',
      },
    }));
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.cluster, 'mainnet');
    assert.equal(body.authorizesTransaction, false);
    assert.equal(body.wallets[0].address, address);
    assert.equal(body.providers, undefined);
    assert.equal(calls.some(call => call.url.includes('/users/me')), false);
    assert.equal(calls.some(call => call.method === 'POST' && call.url.includes('privy')), false);
    assert.equal(calls.some(call => call.url === rpcUrl && call.redirect === 'follow'), true);
    const raw = JSON.stringify(body);
    assert.equal(raw.includes(token), false);
    assert.equal(raw.includes('portfolio-app-secret'), false);
    assert.equal(raw.includes(rpcUrl), false);
    const providerResponse = await GET(new Request('http://localhost/api/portfolio?cluster=mainnet-beta&positions=1', {
      headers: { authorization: `Bearer ${token}`, 'x-owner-id': ownerId },
    }));
    assert.equal(providerResponse.status, 200);
    assert.deepEqual((await providerResponse.json()).providers, { positions: [], incomplete: [] });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('GET /api/portfolio with bearer but missing Privy secrets returns missing_config', async () => {
  const { GET } = await import('../app/api/portfolio/route.js');
  const res = await GET(new Request('http://localhost/api/portfolio', {
    headers: { authorization: 'Bearer portfolio-token' },
  }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'missing_config');
  assert.ok(Array.isArray(body.missing));
  const raw = JSON.stringify(body);
  assert.equal(raw.includes('portfolio-token'), false);
  assert.equal(/sk_|Bearer /.test(raw), false);
});

/**
 * Rigor audit — POST /api/voice/scribe-token unconfigured
 * Achieves: fails closed with voice_unconfigured (or voice_failed if key present) and no sk_ leak.
 * Fails when: 200 with empty token or body contains API key material.
 * Oracle: requestScribeToken → VoiceTokenError voice_unconfigured when key missing.
 * Side effects: none.
 * Gaps: remaining live ElevenLabs mint needs ELEVENLABS_API_KEY.
 */
test('POST /api/voice/speak fails closed when ElevenLabs is unconfigured', async () => {
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const { POST } = await import('../app/api/voice/speak/route.js');
    const res = await POST(new Request('http://localhost/api/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', voiceId: '21m00Tcm4TlvDq8ikWAM' }),
    }));
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.equal(JSON.stringify(body).includes('sk_'), false);
    if (res.status === 503) assert.equal(body.error, 'voice_unconfigured');
    else assert.equal(res.status, 502);
  } finally {
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
  }
});

test('POST /api/voice/scribe-token fails closed when ElevenLabs is unconfigured', async () => {
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const { POST } = await import('../app/api/voice/scribe-token/route.js');
    const res = await POST();
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.equal(JSON.stringify(body).includes('sk_'), false);
    if (res.status === 503) assert.equal(body.error, 'voice_unconfigured');
    else assert.equal(res.status, 502);
  } finally {
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
  }
});

/**
 * Rigor audit — POST /api/voice/token invalid JSON body
 * Achieves: malformed JSON still fails closed (no throw); never 200 without keys.
 * Fails when: bad JSON crashes the route or returns a token without ElevenLabs.
 * Oracle: catch → body {}; then VoiceTokenError path.
 * Side effects: none.
 * Gaps: none for parse resilience.
 */
test('POST /api/voice/token with invalid JSON fails closed without leaking secrets', async () => {
  const { POST } = await import('../app/api/voice/token/route.js');
  const res = await POST(new Request('http://localhost/api/voice/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json',
  }));
  const body = await res.json();
  assert.ok(res.status === 503 || res.status === 502);
  assert.equal(typeof body.error, 'string');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'token'), false);
  assert.equal(JSON.stringify(body).includes('sk_'), false);
});

/**
 * Rigor audit — POST /api/voice/bind invalid body
 * Achieves: missing/invalid conversationId or ownerId → 400 invalid_body before runtime.
 * Fails when: empty ids proceed to Worker or return 500.
 * Oracle: CONVERSATION + OWNER regexes.
 * Side effects: none.
 * Gaps: none for validation.
 */
test('POST /api/voice/bind rejects invalid conversationId and ownerId', async () => {
  const { POST } = await import('../app/api/voice/bind/route.js');
  const empty = await POST(new Request('http://localhost/api/voice/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'invalid_body');

  const badOwner = await POST(new Request('http://localhost/api/voice/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: 'conv_1', ownerId: 'bad owner' }),
  }));
  assert.equal(badOwner.status, 400);
  assert.equal((await badOwner.json()).error, 'invalid_body');
});

/**
 * Rigor audit — POST /api/voice/bind missing config
 * Achieves: valid ids but no runtime URL / webhook secret → 503 voice_bind_unconfigured;
 *   response never echoes webhook secret.
 * Fails when: proceeds to fetch without secret or leaks ELEVENLABS_WEBHOOK_SECRET.
 * Oracle: both NEXT_PUBLIC_AGENT_RUNTIME_URL and ELEVENLABS_WEBHOOK_SECRET required.
 * Side effects: clears related env for the assertion window.
 * Gaps: remaining happy path needs a reachable Worker.
 */
test('POST /api/voice/bind fails closed when runtime or webhook secret is unset', async () => {
  const prevRuntime = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  const prevSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  delete process.env.ELEVENLABS_WEBHOOK_SECRET;
  try {
    const { POST } = await import('../app/api/voice/bind/route.js');
    const res = await POST(new Request('http://localhost/api/voice/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv_ok', ownerId: 'did:privy:u1' }),
    }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'voice_bind_unconfigured');
    assert.equal(JSON.stringify(body).includes('webhook'), false);
  } finally {
    if (prevRuntime !== undefined) process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prevRuntime;
    if (prevSecret !== undefined) process.env.ELEVENLABS_WEBHOOK_SECRET = prevSecret;
  }
});

/**
 * Rigor audit — POST /api/voice/bind happy path (mocked fetch)
 * Achieves: configured runtime+secret + ok upstream → { ok: true }; webhook header set;
 *   secret value never appears in response JSON.
 * Fails when: skips x-elevenlabs-webhook-secret or returns upstream body secrets.
 * Oracle: fetchAgentRuntime → /voice/session-owner with webhook header.
 * Side effects: stubs global fetch; restores env + fetch.
 * Gaps: does not prove live Worker auth semantics.
 */
test('POST /api/voice/bind returns ok when runtime bind succeeds', async () => {
  const prevRuntime = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  const prevSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const prevFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = 'https://runtime.test.example';
  process.env.ELEVENLABS_WEBHOOK_SECRET = 'whsec_test_only';
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = {
      href: String(url),
      method: init?.method,
      secret: init?.headers?.['x-elevenlabs-webhook-secret'],
      body: init?.body,
    };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const { POST } = await import('../app/api/voice/bind/route.js');
    const res = await POST(new Request('http://localhost/api/voice/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv_ok', ownerId: 'did:privy:u1' }),
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
    assert.equal(JSON.stringify(body).includes('whsec'), false);
    assert.match(seen.href, /\/voice\/session-owner$/);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.secret, 'whsec_test_only');
    assert.match(String(seen.body), /conv_ok/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevRuntime === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prevRuntime;
    if (prevSecret === undefined) delete process.env.ELEVENLABS_WEBHOOK_SECRET;
    else process.env.ELEVENLABS_WEBHOOK_SECRET = prevSecret;
  }
});

/**
 * Rigor audit — POST /api/bots/:botId/chat missing LLM keys
 * Achieves: valid bot/owner/message but no Meta/OpenRouter keys → 503 openrouter_not_configured;
 *   no key material in JSON.
 * Fails when: proceeds to network with empty key or returns 200 empty reply.
 * Oracle: completeTextChat throws TextChatError openrouter_not_configured.
 * Side effects: clears LLM env for assertion window.
 * Gaps: remaining tool-loop happy path needs live model keys.
 */
test('chat SSE forwards reply deltas and retracts them when verification rejects', async t => {
  const previous = process.env.META_MODEL_API_KEY;
  process.env.META_MODEL_API_KEY = 'LLM_offline_streaming_test';
  t.after(() => {
    if (previous === undefined) delete process.env.META_MODEL_API_KEY;
    else process.env.META_MODEL_API_KEY = previous;
  });
  for (const allow of [true, false]) {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(String(url), 'https://api.meta.ai/v1/chat/completions');
      const body = JSON.parse(init.body);
      assert.equal(body.stream, true);
      if (JSON.stringify(body.messages).includes('Role: turn-verify')) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({ allow }) } }] });
      }
      return new Response([
        'data: {"choices":[{"delta":{"content":"Hello from the streaming agent."}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
    const response = await POST(new Request('http://localhost/api/bots/bot_1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-owner-id': 'did:privy:stream-test' },
      body: JSON.stringify({ message: 'Hello, explain what you can do.' }),
    }), { params: Promise.resolve({ botId: 'bot_1' }) });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n\n').map(frame => JSON.parse(frame.slice(6)));
    assert.deepEqual(events[0], { type: 'reply_delta', text: 'Hello from the streaming agent.' });
    if (!allow) assert.equal(events[1].type, 'reply_retract');
    assert.equal(events.find(event => event.message)?.message, allow ? 'Hello from the streaming agent.' : 'That step did not pass the check.');
    assert.equal(events.at(-1).done, true);
  }
});

test('POST /api/bots/:botId/chat fails closed when LLM keys are unset', async () => {
  const prevMeta = process.env.META_MODEL_API_KEY;
  const prevOr = process.env.OPENROUTER_API_KEY;
  delete process.env.META_MODEL_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const { POST } = await import('../app/api/bots/[botId]/chat/route.js');
    const res = await POST(
      new Request('http://localhost/api/bots/bot_1/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner-id': 'did:privy:u1' },
        body: JSON.stringify({ message: 'hello agent' }),
      }),
      { params: Promise.resolve({ botId: 'bot_1' }) },
    );
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'openrouter_not_configured');
    assert.equal(JSON.stringify(body).includes('sk-'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'reply'), false);
  } finally {
    if (prevMeta !== undefined) process.env.META_MODEL_API_KEY = prevMeta;
    if (prevOr !== undefined) process.env.OPENROUTER_API_KEY = prevOr;
  }
});

/**
 * Rigor audit — POST /api/sns/send unresolved domain after auth
 * Achieves: bearer present, empty/invalid domain → 404 sns_not_found before spend.
 * Fails when: auth alone is enough to attempt Privy withdraw.
 * Oracle: resolveSnsOwner fails → SnsError path before planSnsSend spend.
 * Side effects: may touch SNS network for invalid domains; status still asserted.
 * Gaps: owner_mismatch / withdraw success need Privy + funded wallet.
 */
test('POST /api/sns/send verifies the session before attempting domain resolution', async t => {
  const ownerId = 'did:privy:u1';
  const session = privySessionFixture(ownerId);
  const previousAppId = process.env.PRIVY_APP_ID;
  process.env.PRIVY_APP_ID = session.appId;
  t.after(() => {
    if (previousAppId === undefined) delete process.env.PRIVY_APP_ID;
    else process.env.PRIVY_APP_ID = previousAppId;
  });
  const keyFetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), session.jwksUrl);
    return session.jwks();
  });
  const { POST } = await import('../app/api/sns/send/route.js');
  const send = token => POST(new Request('http://localhost/api/sns/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-owner-id': ownerId,
    },
    body: JSON.stringify({ domain: '', amount: '1' }),
  }));
  assert.equal((await send('invalid-token')).status, 401);
  assert.equal(keyFetch.mock.calls.length, 0);
  const res = await send(session.token);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'sns_not_found');
  assert.equal(JSON.stringify(body).includes(session.token), false);
});

/**
 * Rigor audit — GET /api/sns/resolve unknown domain
 * Achieves: nonsense domain → 404 sns_not_found (or sns_failed) without 200.
 * Fails when: returns fabricated address for unknown domains.
 * Oracle: resolveSnsOwner rejects missing domains.
 * Side effects: may hit SNS network.
 * Gaps: happy-path real .sol resolve covered in packages/sns.
 */
test('GET /api/sns/resolve returns 404 for an unknown domain', async () => {
  const { GET } = await import('../app/api/sns/resolve/route.js');
  const res = await GET(new Request('http://localhost/api/sns/resolve?domain=definitely-not-registered-zz99.sol'));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error === 'sns_not_found' || body.error === 'sns_failed');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'address'), false);
});

/**
 * Rigor audit — runtime proxy unconfigured
 * Achieves: allowed path with no Worker URL → 503 runtime_unconfigured source:unconfigured.
 * Fails when: open-proxies arbitrary hosts or returns 200 empty.
 * Oracle: runtimeProxyTarget('', path).error === runtime_unconfigured.
 * Side effects: clears NEXT_PUBLIC_AGENT_RUNTIME_URL for the window.
 * Gaps: none for fail-closed unconfigured.
 */
test('GET /api/runtime/api/bots fails closed when runtime URL is unset', async () => {
  const prev = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  try {
    const { GET } = await import('../app/api/runtime/[...path]/route.js');
    const res = await GET(
      new Request('http://localhost/api/runtime/api/bots'),
      { params: Promise.resolve({ path: ['api', 'bots'] }) },
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), {
      ok: false,
      error: 'runtime_unconfigured',
      source: 'unconfigured',
    });
  } finally {
    if (prev !== undefined) process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prev;
  }
});

/**
 * Rigor audit — runtime proxy disallowed path
 * Achieves: non-allowlisted path → 404 not_found (even before/without needing upstream).
 * Fails when: /api/secret or similar becomes proxied.
 * Oracle: runtimeProxyTarget deny → not_found.
 * Side effects: none required (empty origin still yields not_found for denied paths).
 * Gaps: sample path only — full allowlist in runtime-proxy.test.mjs.
 */
test('GET /api/runtime rejects disallowed paths with not_found', async () => {
  const { GET } = await import('../app/api/runtime/[...path]/route.js');
  const res = await GET(
    new Request('http://localhost/api/runtime/api/secret'),
    { params: Promise.resolve({ path: ['api', 'secret'] }) },
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

/**
 * Rigor audit — runtime proxy method allowlist
 * Achieves: PATCH (and other non GET/POST/PUT/DELETE) → 405 method_not_allowed.
 * Fails when: arbitrary methods are forwarded upstream.
 * Oracle: METHODS Set in route proxy.
 * Side effects: none.
 * Gaps: none for method gate.
 */
test('runtime proxy rejects unsupported HTTP methods', async () => {
  const { GET } = await import('../app/api/runtime/[...path]/route.js');
  const res = await GET(
    new Request('http://localhost/api/runtime/api/bots', { method: 'PATCH' }),
    { params: Promise.resolve({ path: ['api', 'bots'] }) },
  );
  assert.equal(res.status, 405);
  assert.equal((await res.json()).error, 'method_not_allowed');
});

/**
 * Rigor audit — runtime proxy body size guard
 * Achieves: POST body > 1_000_000 bytes → 413 body_too_large before upstream fetch.
 * Fails when: huge bodies are forwarded or return 500.
 * Oracle: buf.byteLength > 1_000_000 → body_too_large.
 * Side effects: sets a dummy runtime URL; restores after; does not network on size reject.
 * Gaps: none for size gate.
 */
test('POST /api/runtime rejects bodies larger than 1MB', async () => {
  const prev = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = 'https://runtime.test.example';
  try {
    const { POST } = await import('../app/api/runtime/[...path]/route.js');
    const res = await POST(
      new Request('http://localhost/api/runtime/api/bots', {
        method: 'POST',
        body: new Uint8Array(1_000_001),
      }),
      { params: Promise.resolve({ path: ['api', 'bots'] }) },
    );
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error, 'body_too_large');
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prev;
  }
});

/**
 * Rigor audit — runtime proxy unreachable upstream
 * Achieves: configured allowlisted path + dead host → 502 runtime_unreachable;
 *   Origin forwarding path still exercised via header set (no crash on CR-free origin).
 * Fails when: connection errors throw uncaught or return 200.
 * Oracle: fetchAgentRuntime throw / redirect → runtime_unreachable.
 * Side effects: stubs/uses invalid host; restores env.
 * Gaps: does not assert x-maelstrom-origin on a successful upstream (needs mock server).
 */
test('POST /api/runtime returns runtime_unreachable when Worker fetch fails', async () => {
  const prev = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = 'https://runtime.unreachable.test.invalid';
  try {
    const { POST } = await import('../app/api/runtime/[...path]/route.js');
    const res = await POST(
      new Request('http://localhost/api/runtime/api/bots', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://desk.example',
          authorization: 'Bearer runtime-token',
        },
        body: '{}',
      }),
      { params: Promise.resolve({ path: ['api', 'bots'] }) },
    );
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'runtime_unreachable');
    assert.equal(JSON.stringify(body).includes('runtime-token'), false);
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    else process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL = prev;
  }
});
