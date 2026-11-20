/**
 * Existing Privy client suite. Each test below carries a rigor audit comment.
 * Oracles: Privy HTTP shapes, Solana-mainnet-beta genesis, and wallet assignment rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { buildSolanaX402Transaction } from '../transfers/transfers.mjs';
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { ConfigError } from '@ubc2026/contracts';
import { formatRequestForAuthorizationSignature } from '@privy-io/node';
import { assignBotWallet, createMainWallet } from './wallets.mjs';
import { accountWriteBodies } from './wallets.mjs';
import { swapAccountSnapshot, verifySwapSimulation } from './swap-simulation.mjs';
import {
  SOLANA_GENESIS_HASH,
  WalletError,
  canonicalizeJson,
  privyAuthorizationSignature,
  createPrivyWalletClient,
  createPrivyWalletClientFromEnv,
  loginMethodsFromUser,
} from './privy.mjs';

const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('swap simulation checks exact wallet input, minimum output and SOL fee', () => {
  const sol = 'So11111111111111111111111111111111111111112';
  const token = (mint, amount) => ({ owner: address, mint, uiTokenAmount: { amount } });
  const simulation = {
    err: null, fee: 5000, preBalances: [1000000000], postBalances: [989995000],
    preTokenBalances: [token('output', '0'), token('other', '50')],
    postTokenBalances: [token('output', '1000000'), token('other', '50')],
  };
  const intent = { wallet: address, inputMint: sol, outputMint: 'output', amount: '10000000', minOutput: '950000' };
  assert.deepEqual(verifySwapSimulation(simulation, intent), { feeLamports: '5000', maxSolCost: '5000' });
  assert.equal(verifySwapSimulation(simulation, { ...intent, minOutput: '1000001' }), null);
  assert.equal(verifySwapSimulation(simulation, { ...intent, amount: '10000001' }), null);
  assert.equal(verifySwapSimulation({ ...simulation, postTokenBalances: [token('output', '1000000')] }, intent), null);
});
const appId = 'app_test';
const appSecret = 'app-secret-value';
const accessToken = 'privy-access-token-value';
const rpcUrl = 'https://example.invalid/quicknode-secret-path';
const privyUserId = 'did:privy:user1';
const walletId = 'fmfdj6yqly31huorjqzq38zc';
const otherWalletId = 'cm5addwallet1234567890abcd';
const txSignature = '5'.repeat(88);
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const authorizationKey = `wallet-auth:${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}`;

const baseBot = {
  id: 'bot_1',
  ownerId: 'user_1',
  name: 'APY hunter',
  goal: 'Find yield',
  type: 'trading',
  approvalMode: 'ask',
  walletId: 'placeholder',
  enabled: true,
  frozen: false,
  policyVersion: 1,
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50' },
};

function embedded(id, walletIndex) {
  return {
    id,
    type: 'wallet',
    address,
    chain_type: 'solana',
    wallet_client_type: 'privy',
    connector_type: 'embedded',
    wallet_index: walletIndex,
  };
}

function userWith(accounts) {
  return { id: privyUserId, linked_accounts: accounts };
}

function unsignedTx() {
  return Buffer.alloc(80, 3).toString('base64');
}

function signedTx() {
  return Buffer.alloc(180, 4).toString('base64');
}

function mockFetch(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    const match = routes.find(route => route.match(url, body, init));
    if (!match) return new Response(JSON.stringify({ error: 'unmocked' }), { status: 500 });
    return new Response(JSON.stringify(match.body), { status: match.status ?? 200 });
  };
  return { calls, fetcher };
}

function client(extra = {}) {
  return createPrivyWalletClient({
    appId,
    appSecret,
    rpcUrl,
    now: () => 1_700_000_000_000,
    ...extra,
  });
}

test('swap preparation derives balances from requested RPC account snapshots, not transaction metadata', async () => {
  const signer = Keypair.generate().publicKey;
  const tokenAccount = Keypair.generate().publicKey;
  const mint = new PublicKey(address);
  const transaction = Buffer.from(new VersionedTransaction(new TransactionMessage({
    payerKey: signer, recentBlockhash: SystemProgram.programId.toBase58(),
    instructions: [new TransactionInstruction({ programId: SystemProgram.programId,
      keys: [{ pubkey: signer, isSigner: true, isWritable: true }, { pubkey: tokenAccount, isSigner: false, isWritable: true }], data: Buffer.alloc(0) })],
  }).compileToV0Message()).serialize()).toString('base64');
  const account = amount => {
    const data = Buffer.alloc(165);
    data.set(mint.toBytes(), 0);
    data.set(signer.toBytes(), 32);
    data.writeBigUInt64LE(BigInt(amount), 64);
    return { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', lamports: 2039280, data: [data.toString('base64'), 'base64'] };
  };
  let missing = false;
  const calls = [];
  const fetcher = async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    calls.push(method);
    let result;
    if (method === 'getGenesisHash') result = SOLANA_GENESIS_HASH;
    else if (method === 'getMultipleAccounts') result = { context: { slot: 42 }, value: [{ lamports: 1000000000 }, account('0'), null] };
    else if (method === 'getFeeForMessage') result = { value: 5000 };
    else if (method === 'simulateTransaction') {
      assert.equal(params[1].minContextSlot, 42);
      assert.equal(params[1].accounts.addresses[0], signer.toBase58());
      result = { value: { err: null, accounts: missing ? null : [{ lamports: 989995000 }, account('1000000'), null] } };
    } else assert.fail(`unexpected RPC ${method}`);
    return Response.json({ jsonrpc: '2.0', id: 1, result });
  };
  const privy = client({ fetcher });
  const intent = { transaction, walletAddress: signer.toBase58(), inputMint: 'So11111111111111111111111111111111111111112', outputMint: address, amount: '10000000', minOutput: '950000' };
  const prepared = await privy.prepareSolanaSwap(intent);
  assert.equal(prepared.maxSolCost, '5000');
  assert.equal(calls.includes('sendTransaction'), false);
  missing = true;
  await assert.rejects(privy.prepareSolanaSwap(intent), { code: 'swap_simulation_unavailable' });
  assert.equal(swapAccountSnapshot(null, signer.toBase58()), null);
  assert.deepEqual(swapAccountSnapshot([{ lamports: 1 }, null], signer.toBase58()), { lamports: 1, tokens: [] });
  assert.equal(swapAccountSnapshot([{ lamports: 1 }, { ...account('1'), data: ['bad', 'base64'] }], signer.toBase58()), null);
});

test('x402 partial signing binds the simulated message and leaves the facilitator signature empty without broadcasting', async () => {
  const signer = Keypair.generate();
  const payer = Keypair.generate();
  const payTo = Keypair.generate().publicKey.toBase58();
  const accepted = { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: '10000000', payTo, extra: { feePayer: payer.publicKey.toBase58() } };
  const wallet = { id: walletId, privyWalletId: walletId, ownerId: 'user_1', kind: 'main', label: 'Main', address: signer.publicKey.toBase58(), provider: 'privy', frozen: false };
  const bot = { ...baseBot, walletId };
  const built = buildSolanaX402Transaction({ sourceOwner: wallet.address, accepted, recentBlockhash: Keypair.generate().publicKey.toBase58() });
  let mode = 'ok';
  let signing = 0;
  const privy = client({ fetcher: async (url, init) => {
    const req = JSON.parse(init.body);
    if (String(url).startsWith('https://api.privy.io/')) {
      signing++;
      assert.equal(req.method, 'signTransaction');
      const tx = VersionedTransaction.deserialize(Buffer.from(req.params.transaction, 'base64'));
      if (mode === 'changed') tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
      tx.sign(mode === 'sponsor-signed' ? [signer, payer] : [signer]);
      if (mode === 'invalid-signature') tx.signatures[1].fill(1);
      return Response.json({ data: { signed_transaction: Buffer.from(tx.serialize()).toString('base64'), encoding: 'base64' } });
    }
    if (req.method === 'getGenesisHash') return Response.json({ result: SOLANA_GENESIS_HASH });
    if (req.method === 'getAccountInfo') {
      const source = req.params[0] === built.sourceTokenAccount;
      return Response.json({ result: { value: mode === (source ? 'source-missing' : 'recipient-missing') ? null : {
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        data: { parsed: { type: 'account', info: { owner: source ? wallet.address : mode === 'wrong-recipient' ? wallet.address : payTo, mint: accepted.asset, state: 'initialized' } } },
      } } });
    }
    assert.equal(req.method, 'simulateTransaction', 'must never broadcast');
    assert.equal(req.params[1].sigVerify, false);
    assert.equal(req.params[1].replaceRecentBlockhash, false);
    return Response.json({ result: { value: { err: mode === 'simulation-error' ? { InstructionError: [2, { Custom: 1 }] } : null } } });
  } });
  const prepare = () => privy.prepareSolanaX402Payment({ ...built, walletAddress: wallet.address, accepted });
  const browser = VersionedTransaction.deserialize(Buffer.from(built.transaction, 'base64'));
  browser.sign([signer]);
  const browserTransaction = Buffer.from(browser.serialize()).toString('base64');
  const browserPrepared = await prepare();
  assert.deepEqual(await privy.verifyPreparedSolanaX402Payment({ bot, wallet, prepared: browserPrepared, signedTransaction: browserTransaction }), { transaction: browserTransaction });
  assert.equal(signing, 0, 'browser verification must never call Privy signing');
  await assert.rejects(privy.verifyPreparedSolanaX402Payment({ bot, wallet, prepared: browserPrepared, signedTransaction: browserTransaction }), { code: 'simulation_required' });
  for (const failure of ['unsigned', 'changed', 'sponsor-signed', 'invalid-signature']) {
    const bad = VersionedTransaction.deserialize(Buffer.from(built.transaction, 'base64'));
    if (failure === 'changed') bad.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
    if (failure !== 'unsigned') bad.sign(failure === 'sponsor-signed' ? [signer, payer] : [signer]);
    if (failure === 'invalid-signature') bad.signatures[1].fill(1);
    await assert.rejects(privy.verifyPreparedSolanaX402Payment({ bot, wallet, prepared: await prepare(), signedTransaction: Buffer.from(bad.serialize()).toString('base64') }), { code: 'transaction_mismatch' });
  }
  assert.equal(signing, 0);
  const prepared = await prepare();
  const signed = await privy.signPreparedSolanaX402Payment({ bot, wallet, prepared });
  const parsed = VersionedTransaction.deserialize(Buffer.from(signed.transaction, 'base64'));
  assert.equal(parsed.signatures[0].some(byte => byte !== 0), false);
  assert.equal(parsed.signatures[1].some(byte => byte !== 0), true);
  await assert.rejects(privy.signPreparedSolanaX402Payment({ bot, wallet, prepared }), { code: 'simulation_required' });
  for (mode of ['changed', 'sponsor-signed', 'invalid-signature']) {
    await assert.rejects(privy.signPreparedSolanaX402Payment({ bot, wallet, prepared: await prepare() }), { code: 'transaction_mismatch' });
  }
  const before = signing;
  for (const [bad, reason] of [['recipient-missing', 'recipient_account_not_found'], ['source-missing', 'source_account_not_found'],
    ['wrong-recipient', 'recipient_account_not_found'], ['simulation-error', 'instruction_2_custom_1']]) {
    mode = bad;
    await assert.rejects(prepare(), error => error.code === 'simulation_failed' && error.simulationReason === reason);
  }
  mode = 'ok';
  await assert.rejects(privy.signPreparedSolanaX402Payment({ bot, wallet: { ...wallet, frozen: true }, prepared: await prepare() }), /frozen/);
  await assert.rejects(privy.prepareSolanaX402Payment({ ...built, walletAddress: payer.publicKey.toBase58(), accepted }), { code: 'invalid_transaction' });
  await assert.rejects(privy.prepareSolanaX402Payment(), { code: 'invalid_transaction' });
  assert.equal(signing, before);
});

function assertNoSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(text.includes(appSecret), false);
  assert.equal(text.includes(accessToken), false);
  assert.equal(text.includes('quicknode-secret-path'), false);
  assert.equal(text.includes(authorizationKey), false);
  assert.equal(text.includes(authorizationKey.slice('wallet-auth:'.length)), false);
}

test('a prepared transfer binds the exact simulated message to its signature', async () => {
  const unsigned = Buffer.alloc(80, 0);
  unsigned[0] = 1;
  unsigned[65] = 1;
  const transaction = unsigned.toString('base64');
  const signed = Buffer.from(unsigned);
  signed.fill(4, 1, 65);
  let swapMessage = false;
  let verifyBrowserAuthorization = false;
  let broadcasts = 0;
  const wallet = { id: walletId, privyWalletId: walletId, ownerId: 'user_1', kind: 'main', label: 'Main', address, provider: 'privy', frozen: false };
  const bot = { ...baseBot, walletId };
  const privy = client({ fetcher: async (url, init) => {
    const req = JSON.parse(init.body);
    if (req.method === 'getGenesisHash') return Response.json({ result: SOLANA_GENESIS_HASH });
    if (req.method === 'getFeeForMessage') {
      assert.equal(req.params[0], unsigned.subarray(65).toString('base64'));
      return Response.json({ result: { value: 5000 } });
    }
    if (req.method === 'simulateTransaction') {
      assert.equal(req.params[0], transaction);
      assert.equal(req.params[1].replaceRecentBlockhash, false);
      return Response.json({ result: { value: { err: null } } });
    }
    if (req.method === 'signTransaction') {
      assert.equal(req.params.transaction, transaction);
      if (verifyBrowserAuthorization) {
        const headers = new Headers(init.headers);
        const decoded = formatRequestForAuthorizationSignature({
          version: 1, url, method: 'POST', body: req,
          headers: {
            'privy-app-id': appId,
            'privy-request-expiry': headers.get('privy-request-expiry'),
          },
        });
        assert.equal(req.chain_type, 'solana');
        assert.equal(verify('sha256', decoded, publicKey, Buffer.from(headers.get('privy-authorization-signature'), 'base64')), true);
      }
      const bytes = Buffer.from(signed);
      if (swapMessage) bytes[79] ^= 1;
      return Response.json({ data: { signed_transaction: bytes.toString('base64') } });
    }
    assert.equal(req.method, 'sendTransaction');
    assert.equal(req.params[0], signed.toString('base64'));
    broadcasts++;
    return Response.json({ result: txSignature });
  } });
  const prepared = await privy.prepareSolanaTransfer({ transaction });
  assert.equal(prepared.feeLamports, '5000');
  const input = { bot, wallet, prepared };
  await assert.rejects(privy.signPreparedSolanaTransfer({ ...input, prepared: { ...prepared } }), { code: 'simulation_required' });
  assert.equal((await privy.signPreparedSolanaTransfer(input)).signature, txSignature);
  await assert.rejects(privy.signPreparedSolanaTransfer(input), { code: 'simulation_required' });
  swapMessage = true;
  const again = await privy.prepareSolanaTransfer({ transaction });
  await assert.rejects(privy.signPreparedSolanaTransfer({ ...input, prepared: again }), { code: 'transaction_mismatch' });
  assert.equal(broadcasts, 1);

  const browserPrepared = await privy.prepareSolanaTransfer({ transaction });
  const expiresAt = 1_700_000_050_000;
  const challenge = privy.formatPreparedSpendAuthorization({ bot, wallet, prepared: browserPrepared, expiresAt });
  assertNoSecrets(Buffer.from(challenge, 'base64').toString());
  const signature = sign('sha256', Buffer.from(challenge, 'base64'), privateKey).toString('base64');
  const browserInput = { bot, wallet, prepared: browserPrepared, ownerAuthorization: { expiresAt, signature } };
  swapMessage = false;
  verifyBrowserAuthorization = true;
  assert.equal((await privy.signPreparedSolanaTransfer(browserInput)).signature, txSignature);
  await assert.rejects(privy.signPreparedSolanaTransfer(browserInput), { code: 'simulation_required' });
  assert.equal(broadcasts, 2);
});

test('a prepared send uses the wallet owner session only when Privy requires it', async () => {
  const unsigned = Buffer.alloc(80);
  unsigned[0] = 1;
  unsigned[65] = 1;
  const transaction = unsigned.toString('base64');
  const signed = Buffer.from(unsigned);
  signed.fill(4, 1, 65);
  const wallet = { ...createMainWallet({ ownerId: privyUserId, address, id: walletId }), privyWalletId: walletId };
  const bot = { ...baseBot, ownerId: wallet.ownerId, walletId };
  const token = sub => `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.test`;
  const suite = new CipherSuite({
    kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305(),
  });
  const sessionKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  let rejection = { error: { code: 'zero_correct_authorization_signatures' } };
  let signingStatus = 403;
  let exchangeRejection;
  let ownerRejection;
  let lookups = 0;
  let exchanged = 0;
  let broadcasts = 0;
  const privy = client({ authorizationKey, fetcher: async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === 'GET') {
      assert.equal(path, `/v1/wallets/${walletId}`);
      lookups++;
      return Response.json({ id: walletId, chain_type: 'solana', address });
    }
    const body = JSON.parse(init.body);
    if (path === '/v1/wallets/authenticate') {
      exchanged++;
      assert.equal(body.user_jwt, token(privyUserId));
      assert.equal(body.encryption_type, 'HPKE');
      if (exchangeRejection) return exchangeRejection;
      const recipientPublicKey = await crypto.subtle.importKey('spki', Buffer.from(body.recipient_public_key, 'base64'),
        { name: 'ECDH', namedCurve: 'P-256' }, true, []);
      const sessionPkcs8 = sessionKey.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
      const { enc, ct } = await suite.seal({ recipientPublicKey }, Buffer.from(sessionPkcs8));
      return Response.json({
        encrypted_authorization_key: {
          encryption_type: 'HPKE',
          encapsulated_key: Buffer.from(enc).toString('base64'),
          ciphertext: Buffer.from(ct).toString('base64'),
        },
        expires_at: Date.now() + 60000,
      });
    }
    if (path.endsWith('/rpc')) {
      assert.equal(path, `/v1/wallets/${walletId}/rpc`);
      assert.equal(body.method, 'signTransaction');
      assert.equal(body.params.transaction, transaction);
      const headers = new Headers(init.headers);
      const signedHeaders = {
        'privy-app-id': headers.get('privy-app-id'),
        'privy-request-expiry': headers.get('privy-request-expiry'),
      };
      const payload = Buffer.from(canonicalizeJson({ version: 1, method: 'POST', url: String(url), body, headers: signedHeaders }));
      const signature = Buffer.from(headers.get('privy-authorization-signature'), 'base64');
      if (verify('sha256', payload, publicKey, signature)) return Response.json(rejection, { status: signingStatus });
      assert.equal(verify('sha256', payload, sessionKey.publicKey, signature), true);
      if (ownerRejection) return ownerRejection;
      return Response.json({ method: 'signTransaction', data: { signed_transaction: signed.toString('base64'), encoding: 'base64' } });
    }
    if (body.method === 'getGenesisHash') return Response.json({ result: SOLANA_GENESIS_HASH });
    if (body.method === 'getFeeForMessage') return Response.json({ result: { value: 5000 } });
    if (body.method === 'simulateTransaction') return Response.json({ result: { value: { err: null } } });
    assert.equal(body.method, 'sendTransaction');
    assert.equal(body.params[0], signed.toString('base64'));
    broadcasts++;
    return Response.json({ result: txSignature });
  } });
  async function send(accessToken) {
    const prepared = await privy.prepareSolanaTransfer({ transaction });
    return privy.signPreparedSolanaTransfer({ bot, wallet, prepared, accessToken });
  }
  await assert.rejects(send(token('did:privy:other')), { code: 'wallet_owner_session_required' });
  assert.equal(exchanged, 0);
  assert.equal(broadcasts, 0);
  assert.equal((await send(token(privyUserId))).signature, txSignature);
  assert.equal(exchanged, 1);
  assert.equal(broadcasts, 1);
  assert.equal(lookups, 0);
  signingStatus = 401;
  rejection = { error: 'Unauthorized' };
  assert.equal((await send(token(privyUserId))).signature, txSignature);
  assert.equal(lookups, 1);
  assert.equal(exchanged, 2);
  assert.equal(broadcasts, 2);
  rejection = { code: 'zero_correct_authorization_signatures', error: { code: 'policy_violation' } };
  await assert.rejects(send(token(privyUserId)), { code: 'wallet_policy_rejected' });
  rejection = { error: 'provider detail', code: 'insufficient_app_secret_permissions', message: appSecret };
  await assert.rejects(send(token(privyUserId)), error => {
    assert.equal(error.code, 'privy_failed');
    assert.equal(error.privyFailure.status, 401);
    assert.equal(error.privyFailure.code, 'insufficient_app_secret_permissions');
    assert.deepEqual(error.privyFailure.requests.map(request => request.stage), ['app-sign']);
    assertNoSecrets(error.message);
    return true;
  });
  assert.equal(lookups, 1);
  assert.equal(exchanged, 2);
  assert.equal(broadcasts, 2);

  rejection = { error: 'Unauthorized' };
  exchangeRejection = Response.json({
    error: { code: 'mfa_required', message: `MFA required for token ${token(privyUserId)}` },
  }, {
    status: 400,
    headers: { 'x-request-id': 'req_privy123456', 'cf-ray': '1234567890abcdef-DFW' },
  });
  await assert.rejects(send(token(privyUserId)), error => {
    assert.equal(error.code, 'wallet_authorization_failed');
    assert.equal(error.privyFailure.status, 400);
    assert.equal(error.privyFailure.appSignature, true);
    assert.deepEqual(error.privyFailure.session, {
      check: 'owner-matched', audience: 'missing', issuer: 'missing', expiry: 'missing',
    });
    assert.deepEqual(error.privyFailure.requests, [
      { stage: 'app-sign', status: 401, detail: 'provider-detail' },
      { stage: 'wallet-lookup', status: 200, detail: 'wallet-matched' },
      {
        stage: 'session-exchange', status: 400, code: 'mfa_required', detail: 'mfa-required', requestId: 'req_privy123456',
        edgeId: '1234567890abcdef-DFW', mfaProof: false,
      },
    ]);
    assert.equal(JSON.stringify(error.privyFailure).includes(token(privyUserId)), false);
    return true;
  });
  exchangeRejection = null;
  ownerRejection = Response.json({ code: 'invalid_data', request_id: 'req_owner123456', message: appSecret }, { status: 400 });
  await assert.rejects(send(token(privyUserId)), error => {
    assert.equal(error.code, 'wallet_authorization_failed');
    assert.deepEqual(error.privyFailure.requests.slice(2), [
      { stage: 'session-exchange', status: 200, mfaProof: false },
      { stage: 'owner-sign', status: 400, code: 'invalid_data', detail: 'invalid-data', requestId: 'req_owner123456' },
    ]);
    assertNoSecrets(JSON.stringify(error.privyFailure));
    return true;
  });
  assert.equal(lookups, 3);
  assert.equal(exchanged, 4);
  assert.equal(broadcasts, 2);
});

test('an unexplained signing 401 checks wallet access with the same app credentials', async () => {
  const bytes = Buffer.alloc(80);
  bytes[0] = 1;
  const transaction = bytes.toString('base64');
  const wallet = { ...createMainWallet({ ownerId: privyUserId, address, id: walletId }), privyWalletId: walletId };
  const bot = { ...baseBot, ownerId: wallet.ownerId, walletId };
  const privyCalls = [];
  let lookupStatus = 200;
  let returnedWalletId = walletId;
  let returnedAddress = address;
  const privy = client({ authorizationKey, fetcher: async (url, init) => {
    const path = new URL(url).pathname;
    if (path.startsWith('/v1/wallets/')) {
      assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`);
      assert.equal(init.headers['privy-app-id'], appId);
      privyCalls.push([init.method, path]);
      if (init.method === 'GET') {
        assert.equal(init.headers['privy-authorization-signature'], undefined);
        return Response.json({ id: returnedWalletId, chain_type: 'solana', address: returnedAddress }, { status: lookupStatus });
      }
      return Response.json({ error: 'undocumented detail' }, { status: 401 });
    }
    const { method } = JSON.parse(init.body);
    if (method === 'getGenesisHash') return Response.json({ result: SOLANA_GENESIS_HASH });
    if (method === 'getFeeForMessage') return Response.json({ result: { value: 5000 } });
    assert.equal(method, 'simulateTransaction', 'the signing rejection must never broadcast');
    return Response.json({ result: { value: { err: null } } });
  } });

  const cases = [
    {
      status: 200, id: walletId, code: 'wallet_owner_session_required',
      diagnostic: { status: 401, walletLookupStatus: 200 },
    },
    { status: 401, id: walletId, diagnostic: { status: 401, walletLookupStatus: 401 } },
    { status: 404, id: walletId, diagnostic: { status: 401, walletLookupStatus: 404 } },
    { status: 200, id: otherWalletId, diagnostic: { status: 401 } },
    { status: 200, id: walletId, walletAddress: '11111111111111111111111111111111', diagnostic: { status: 401 } },
  ];
  for (const { status, id, walletAddress = address, code = 'privy_failed', diagnostic } of cases) {
    lookupStatus = status;
    returnedWalletId = id;
    returnedAddress = walletAddress;
    const prepared = await privy.prepareSolanaTransfer({ transaction });
    await assert.rejects(privy.signPreparedSolanaTransfer({ bot, wallet, prepared }), error => {
      assert.equal(error.code, code);
      const { status, walletLookupStatus, requests, session } = error.privyFailure;
      assert.equal(status, diagnostic.status);
      assert.equal(walletLookupStatus, diagnostic.walletLookupStatus);
      assert.equal(requests[1].status, lookupStatus);
      assert.equal(session?.check, code === 'wallet_owner_session_required' ? 'missing' : undefined);
      return true;
    });
  }
  assert.deepEqual(privyCalls, cases.flatMap(() => [
    ['POST', `/v1/wallets/${walletId}/rpc`],
    ['GET', `/v1/wallets/${walletId}`],
  ]));
});

/**
 * Rigor audit — missing server-signing names throw before any request
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('missing server-signing names throw before any request', () => {
  const { fetcher, calls } = mockFetch([]);
  assert.throws(
    () => createPrivyWalletClientFromEnv({ PRIVY_APP_SECRET: appSecret, fetcher }),
    error => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.missing, ['PRIVY_APP_ID', 'SOLANA_RPC_URL']);
      assertNoSecrets(error.message);
      return true;
    },
  );
  assert.equal(calls.length, 0);
  assert.throws(
    () => createPrivyWalletClient({ appId, appSecret, rpcUrl: 'http://example.invalid/quicknode-secret-path' }),
    error => error instanceof WalletError && error.code === 'invalid_rpc' && !error.message.includes('quicknode-secret-path'),
  );
});

/**
 * Rigor audit — readLoginUser returns linked wallets and does not create one
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('readLoginUser returns linked wallets and does not create one', async () => {
  const phantom = 'So11111111111111111111111111111111111111112';
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: {
        id: privyUserId,
        linked_accounts: [
          embedded(walletId, 0),
          {
            type: 'wallet',
            address: phantom,
            chain_type: 'solana',
            wallet_client_type: 'phantom',
            connector_type: 'solana_adapter',
          },
        ],
      },
    },
  ]);
  const user = await client({ fetcher }).readLoginUser({
    accessToken,
    origin: 'http://localhost:3000',
    ownerId: privyUserId,
  });
  assert.equal(user.id, privyUserId);
  assert.equal(user.linked_accounts[1].address, phantom);
  assert.equal(calls.some(call => call.init?.method === 'POST'), false);
  assert.equal(calls.some(call => String(call.url).includes('/v1/wallets')), false);
  assert.equal(calls.some(call => String(call.url).includes('/users/me')), false);
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
});

/**
 * Rigor audit — readLoginUser falls back to users/me only for an opaque local token
 * Achieves: no JWT sub and no owner id still reads /users/me when Origin is allowed.
 * Fails when: the local fallback is removed, or a Worker-style client calls /users/me.
 * Oracle: acceptLogin's users/me rule — Origin only off Cloudflare.
 * Side effects: mocked fetch call list.
 * Gaps: does not exercise a live Privy session.
 */
test('readLoginUser uses users/me only when the token has no user id', async () => {
  const { fetcher, calls } = mockFetch([
    { match: url => url.endsWith('/api/v1/users/me'), body: { id: privyUserId, linked_accounts: [] } },
  ]);
  const user = await client({ fetcher }).readLoginUser({
    accessToken,
    origin: 'http://localhost:3000',
  });
  assert.equal(user.id, privyUserId);
  assert.equal(calls.some(call => String(call.url).includes('/users/me')), true);
  assert.equal(calls.some(call => call.init?.method === 'POST'), false);
});

/**
 * Rigor audit — hosted portfolio read does not call users/me
 * Achieves: a JWT sub loads GET /v1/users/:id and never sets Origin or creates a wallet.
 * Fails when: Workers fall through to /users/me (the portfolio 502).
 * Oracle: same identity path as acceptLogin, without syncWallets.
 * Side effects: mocked fetch call list.
 * Gaps: signature of the JWT is not verified, matching acceptLogin.
 */
test('readLoginUser on Workers loads by JWT sub and does not call users/me', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: privyUserId })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`),
      body: { id: privyUserId, linked_accounts: [embedded(walletId, 0)] },
    },
  ]);
  const user = await client({ fetcher, allowUsersMeFallback: false }).readLoginUser({
    accessToken: token,
  });
  assert.equal(user.id, privyUserId);
  assert.equal(user.linked_accounts[0].id, walletId);
  assert.equal(calls.length, 1);
  assert.equal(calls.some(call => String(call.url).includes('/users/me')), false);
  assert.equal(calls.some(call => call.init?.method === 'POST'), false);
  assert.equal(calls[0].init.headers.Origin, undefined);
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
});

/**
 * Rigor audit — login recovers owner id from JWT sub without users/me (Worker-safe)
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login recovers owner id from JWT sub without users/me (Worker-safe)', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: privyUserId })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const { fetcher, calls } = mockFetch([
    { match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`), body: { id: privyUserId, linked_accounts: [] } },
    { match: url => url.includes('/v1/wallets?'), body: { data: [] } },
    {
      match: (url, reqBody) => url.endsWith('/v1/wallets') && reqBody?.display_name === 'Main',
      body: { id: walletId, address, chain_type: 'solana' },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken: token,
    ownerId: privyUserId,
    // No origin — Cloudflare Workers strip it on outbound Privy calls.
  });
  assert.equal(result.created, true);
  assert.equal(result.main.ownerId, privyUserId);
  assert.equal(calls.some(call => String(call.url).includes('/users/me')), false);
  assert.equal(calls[2].body.owner.user_id, privyUserId);
});

/**
 * Rigor audit — login prefers JWT sub over a stale x-owner-id header
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login prefers JWT sub over a stale x-owner-id header', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: privyUserId })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const { fetcher, calls } = mockFetch([
    { match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`), body: { id: privyUserId, linked_accounts: [embedded(walletId, 0)] } },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken: token,
    ownerId: 'did:privy:other',
  });
  assert.equal(result.main.ownerId, privyUserId);
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].url).includes(encodeURIComponent(privyUserId)), true);
});

/**
 * Rigor audit — Worker-safe login loads the user with app secret and no authorization signature
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('Worker-safe login loads the user with app secret and no authorization signature', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: privyUserId })).toString('base64url');
  const token = `${header}.${body}.sig`;
  const { fetcher, calls } = mockFetch([
    { match: url => url.includes(`/v1/users/${encodeURIComponent(privyUserId)}`), body: { id: privyUserId, linked_accounts: [embedded(walletId, 0)] } },
  ]);
  await client({ fetcher, authorizationKey }).acceptLogin({ accessToken: token, ownerId: privyUserId });
  const userCall = calls[0];
  assert.equal(userCall.init.headers.Authorization.startsWith('Basic '), true);
  assert.equal(userCall.init.headers['privy-authorization-signature'], undefined);
});

/**
 * Rigor audit — login keeps linked wallets and sign-in methods on the same owner
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login keeps linked wallets and sign-in methods on the same owner', async () => {
  const phantom = 'So11111111111111111111111111111111111111112';
  const { fetcher } = mockFetch([
    {
      match: url => url.endsWith('/api/v1/users/me'),
      body: {
        id: privyUserId,
        linked_accounts: [
          { type: 'email', address: 'a@example.com' },
          { type: 'google_oauth', email: 'g@example.com' },
          embedded(walletId, 0),
          {
            type: 'wallet',
            address: phantom,
            chain_type: 'solana',
            wallet_client_type: 'phantom',
            connector_type: 'solana_adapter',
          },
        ],
      },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken,
    ownerId: privyUserId,
    origin: 'http://localhost:3000',
  });
  assert.equal(result.main.address, address);
  assert.equal(result.main.spendable, true);
  assert.equal(result.additional.length, 1);
  assert.equal(result.additional[0].id, `linked_${phantom}`);
  assert.equal(result.additional[0].spendable, false);
  assert.equal(result.additional[0].privyWalletId, undefined);
  assert.deepEqual(result.loginMethods.map(method => method.method), ['email', 'google', 'wallet', 'wallet']);
  const stored = accountWriteBodies(result, privyUserId);
  assert.equal(stored.user.privy_user_id, privyUserId);
  assert.equal(stored.user.login_methods.length, 4);
  assert.equal(stored.wallets[1].spendable, false);
  assert.equal(stored.wallets[1].owner_id, privyUserId);
  assert.equal(loginMethodsFromUser({ linked_accounts: [] }).length, 0);
});

/**
 * Rigor audit — login creates the main Solana wallet when Privy has none
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login creates the main Solana wallet when Privy has none', async () => {
  const { fetcher, calls } = mockFetch([
    { match: url => url.includes('/v1/users/'), body: userWith([]) },
    { match: url => url.includes('/v1/wallets?'), body: { data: [] } },
    {
      match: (url, body) => url.endsWith('/v1/wallets') && body?.display_name === 'Main',
      body: { id: walletId, address, chain_type: 'solana' },
    },
  ]);
  const result = await client({ fetcher, authorizationKey }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, true);
  assert.equal(result.main.kind, 'main');
  assert.equal(result.main.provider, 'privy');
  assert.equal(result.main.address, address);
  assert.equal(result.main.privyWalletId, walletId);
  assert.equal(result.main.ownerId, 'user_1');
  assert.deepEqual(result.additional, []);

  const login = calls[0];
  assert.equal(login.url, `https://api.privy.io/v1/users/${encodeURIComponent('user_1')}`);
  assert.equal(login.init.headers.Authorization.startsWith('Basic '), true);
  assert.equal(login.init.headers['privy-authorization-signature'], undefined);
  assert.equal(login.url.includes(accessToken), false);
  assert.equal(login.init.headers.Authorization.includes(appSecret), false);

  assert.equal(calls[1].url.includes('/v1/wallets?'), true);
  assert.equal(calls[1].url.includes(encodeURIComponent(privyUserId)), true);

  const create = calls[2];
  assert.equal(create.url, 'https://api.privy.io/v1/wallets');
  assert.equal(create.body.chain_type, 'solana');
  assert.deepEqual(create.body.owner, { user_id: privyUserId });
  assert.equal(create.init.headers['privy-idempotency-key'], 'main-solana_did_privy_user1');
  assert.equal(create.url.includes(appSecret), false);
  const payload = canonicalizeJson({
    version: 1,
    method: 'POST',
    url: create.url,
    body: create.body,
    headers: {
      'privy-app-id': appId,
      'privy-idempotency-key': create.init.headers['privy-idempotency-key'],
      'privy-request-expiry': create.init.headers['privy-request-expiry'],
    },
  });
  assert.equal(
    verify('sha256', Buffer.from(payload), publicKey, Buffer.from(create.init.headers['privy-authorization-signature'], 'base64')),
    true,
  );
  assert.equal(calls.length, 3);
});

/**
 * Rigor audit — login recovers when createOnLogin linked a Solana wallet with null server id
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login recovers when createOnLogin linked a Solana wallet with null server id', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.endsWith('/api/v1/users/me'),
      body: userWith([
        {
          id: null,
          type: 'wallet',
          address,
          chain_type: 'solana',
          wallet_client_type: 'privy',
          connector_type: 'embedded',
          wallet_index: 0,
        },
      ]),
    },
    {
      match: url => url.includes('/v1/wallets?'),
      body: { data: [{ id: walletId, address, chain_type: 'solana' }] },
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, false);
  assert.equal(result.main.privyWalletId, walletId);
  assert.equal(result.main.address, address);
  assert.equal(calls.some(call => call.body?.display_name === 'Main'), false);
});

/**
 * Rigor audit — login retries list after create fails when a server wallet already exists
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login retries list after create fails when a server wallet already exists', async () => {
  const calls = [];
  let listCount = 0;
  const dynamic = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    if (url.endsWith('/api/v1/users/me')) {
      return new Response(JSON.stringify(userWith([])), { status: 200 });
    }
    if (url.includes('/v1/wallets?')) {
      listCount += 1;
      const data = listCount === 1 ? [] : [{ id: walletId, address, chain_type: 'solana' }];
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    if (url.endsWith('/v1/wallets') && body?.display_name === 'Main') {
      return new Response(JSON.stringify({ error: 'wallet_already_exists' }), { status: 400 });
    }
    return new Response(JSON.stringify({ error: 'unmocked' }), { status: 500 });
  };
  const result = await client({ fetcher: dynamic }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, false);
  assert.equal(result.main.privyWalletId, walletId);
  assert.equal(listCount, 2);
  assert.equal(calls.some(call => call.body?.display_name === 'Main'), true);
});

/**
 * Rigor audit — login keeps an existing main wallet and maps later embedded wallets as additional
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login keeps an existing main wallet and maps later embedded wallets as additional', async () => {
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes('/v1/users/'),
      body: userWith([
        { type: 'wallet', address, chain_type: 'solana', wallet_client_type: 'phantom', connector_type: 'solana_adapter', id: 'phantomwalletid1234567890' },
        embedded(otherWalletId, 1),
        embedded(walletId, 0),
      ]),
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, false);
  assert.equal(result.main.id, walletId);
  assert.equal(result.main.kind, 'main');
  assert.equal(result.additional.length, 1);
  assert.equal(result.additional[0].kind, 'additional');
  assert.equal(result.additional[0].id, otherWalletId);
  assert.equal(result.additional[0].label, 'Additional 1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['privy-authorization-signature'], undefined);
});

/**
 * Rigor audit — additional wallets require a main wallet and a label
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('login treats a privy-v2 embedded wallet as the spendable main wallet', async () => {
  const phantom = 'So11111111111111111111111111111111111111112';
  const { fetcher, calls } = mockFetch([
    {
      match: url => url.includes('/v1/users/'),
      body: userWith([
        { ...embedded(walletId, 0), wallet_client_type: 'privy-v2' },
        { type: 'wallet', address: phantom, chain_type: 'solana', wallet_client_type: 'phantom', connector_type: 'solana_adapter', id: 'phantomwalletid1234567890' },
      ]),
    },
  ]);
  const result = await client({ fetcher }).acceptLogin({
    accessToken,
    ownerId: 'user_1',
    origin: 'http://localhost:3000',
  });
  assert.equal(result.created, false);
  assert.equal(result.main.id, walletId);
  assert.equal(result.main.spendable, true);
  assert.equal(result.additional.length, 1);
  assert.equal(result.additional[0].address, phantom);
  assert.equal(result.additional[0].spendable, false);
  assert.equal(calls.some(call => call.init.method === 'POST'), false);
});

test('additional wallets require a main wallet and a label', async () => {
  const empty = mockFetch([
    { match: url => url.includes('/v1/users/'), body: userWith([]) },
  ]);
  await assert.rejects(
    () => client({ fetcher: empty.fetcher }).createAdditional({ privyUserId, ownerId: 'user_1', label: 'Trading' }),
    error => error instanceof WalletError && error.code === 'main_wallet_required',
  );
  assert.equal(empty.calls.some(call => call.body?.chain_type === 'solana'), false);

  const labeled = mockFetch([]);
  await assert.rejects(
    () => client({ fetcher: labeled.fetcher }).createAdditional({ privyUserId, ownerId: 'user_1', label: ' ' }),
    WalletError,
  );
  assert.equal(labeled.calls.length, 0);

  const ready = mockFetch([
    { match: url => url.includes('/v1/users/'), body: userWith([embedded(walletId, 0)]) },
    {
      match: (url, body) => url.endsWith('/v1/wallets') && body?.display_name === 'Trading',
      body: { id: otherWalletId, address, chain_type: 'solana' },
    },
  ]);
  const created = await client({ fetcher: ready.fetcher }).createAdditional({
    privyUserId,
    ownerId: 'user_1',
    label: 'Trading',
  });
  assert.equal(created.kind, 'additional');
  assert.equal(created.label, 'Trading');
  assert.equal(created.privyWalletId, otherWalletId);
  assert.equal(ready.calls[1].init.headers['privy-idempotency-key'], 'add_did_privy_user1_trading');
  assert.equal(ready.calls[1].init.headers.Authorization.startsWith('Basic '), true);
  assert.equal(ready.calls[1].body.additional_signers, undefined);

  const signed = mockFetch([
    { match: url => url.includes('/v1/users/'), body: userWith([embedded(walletId, 0)]) },
    { match: url => url.endsWith('/v1/wallets'), body: { id: otherWalletId, address, chain_type: 'solana' } },
  ]);
  await client({ fetcher: signed.fetcher, signerId: 'keyquorum12345678' }).createAdditional({
    privyUserId,
    ownerId: 'user_1',
    label: 'Trading',
  });
  assert.deepEqual(signed.calls[1].body.additional_signers, [{ signer_id: 'keyquorum12345678' }]);
});

/**
 * Rigor audit — server signing broadcasts only after mainnet-beta genesis matches
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('server signing broadcasts only after mainnet-beta genesis matches', async () => {
  const wallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
    privyUserId,
  };
  const bot = assignBotWallet({ ...baseBot, walletId: wallet.id }, wallet);
  const transaction = unsignedTx();
  const signed = signedTx();
  const { fetcher, calls } = mockFetch([
    {
      match: (url, body) => url.endsWith('/rpc') && body?.method === 'signTransaction',
      body: { method: 'signTransaction', data: { signed_transaction: signed, encoding: 'base64' } },
    },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash',
      body: { jsonrpc: '2.0', id: 1, result: SOLANA_GENESIS_HASH },
    },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'sendTransaction',
      body: { jsonrpc: '2.0', id: 1, result: txSignature },
    },
  ]);
  const sent = await client({ fetcher }).signAndBroadcastSolana({ bot, wallet, transaction });
  assert.equal(sent.cluster, 'mainnet-beta');
  assert.equal(sent.signature, txSignature);
  assert.equal(sent.botId, bot.id);
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(calls[1].init.headers['privy-app-id'], undefined);
  assert.equal(calls[2].body.params[0], signed);
  assert.equal(calls[2].body.params[1].encoding, 'base64');
  assert.equal(calls[0].url.includes(appSecret), false);
  assert.equal(calls[0].url.includes('quicknode-secret-path'), false);
  assert.equal(calls[1].url, rpcUrl);
  assert.equal(calls[2].url, rpcUrl);
});

/**
 * Rigor audit — a non-mainnet-beta QuickNode genesis hash never sends the transaction
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('a non-mainnet-beta QuickNode genesis hash never sends the transaction', async () => {
  const wallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
  };
  const bot = assignBotWallet({ ...baseBot, walletId: wallet.id }, wallet);
  const { fetcher, calls } = mockFetch([
    {
      match: (url, body) => url.endsWith('/rpc') && body?.method === 'signTransaction',
      body: { data: { signed_transaction: signedTx() } },
    },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash',
      body: { result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher }).signAndBroadcastSolana({ bot, wallet, transaction: unsignedTx() }),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  assert.equal(calls.some(call => call.body?.method === 'sendTransaction'), false);
});

/**
 * Rigor audit — freeze and provider failures do not reveal secrets or broadcast
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('freeze and provider failures do not reveal secrets or broadcast', async () => {
  const openWallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
  };
  const openBot = assignBotWallet({ ...baseBot, walletId: openWallet.id }, openWallet);
  const wallet = { ...openWallet, frozen: true };
  const frozenFetch = mockFetch([]);
  await assert.rejects(
    () => client({ fetcher: frozenFetch.fetcher }).signAndBroadcastSolana({
      bot: openBot,
      wallet,
      transaction: unsignedTx(),
    }),
    WalletError,
  );
  assert.equal(frozenFetch.calls.length, 0);

  const raw = mockFetch([
    {
      match: url => url.endsWith('/rpc'),
      body: { data: { signed_transaction: Buffer.alloc(64, 9).toString('base64') } },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher: raw.fetcher }).signAndBroadcastSolana({
      bot: openBot,
      wallet: openWallet,
      transaction: unsignedTx(),
    }),
    error => error instanceof WalletError && error.code === 'invalid_signature',
  );
  assert.equal(raw.calls.some(call => call.body?.method === 'getGenesisHash'), false);

  const liveWallet = openWallet;
  const liveBot = openBot;
  const leaky = mockFetch([
    {
      match: url => url.endsWith('/rpc'),
      status: 401,
      body: { error: appSecret, message: `${rpcUrl} ${accessToken}` },
    },
  ]);
  await assert.rejects(
    () => client({ fetcher: leaky.fetcher }).signAndBroadcastSolana({
      bot: liveBot,
      wallet: liveWallet,
      transaction: unsignedTx(),
    }),
    error => {
      assert.ok(error instanceof WalletError);
      assertNoSecrets(error.message);
      return true;
    },
  );

  await assert.rejects(
    () => client({
      fetcher: async () => { throw new Error(rpcUrl); },
    }).signAndBroadcastSolana({ bot: liveBot, wallet: liveWallet, transaction: unsignedTx() }),
    error => error instanceof WalletError && error.code === 'privy_failed' && !error.message.includes('quicknode-secret-path'),
  );
});

/**
 * Rigor audit — mainnet-beta reads and owner sweeps stay off the public client surface and off mainnet
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('mainnet-beta reads and owner sweeps stay off the public client surface and off mainnet', async () => {
  const live = client();
  assert.equal(live.rpc, undefined);
  assert.equal(live.sendSigned, undefined);
  assert.equal(live.signWithPrivy, undefined);

  const owner = 'So11111111111111111111111111111111111111112';
  const blockhash = '3'.repeat(32);
  const mainnet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  const wallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
    frozen: true,
  };

  const blocked = mockFetch([
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: mainnet } },
  ]);
  const blockedClient = client({ fetcher: blocked.fetcher });
  await assert.rejects(
    () => blockedClient.getSolanaBlockhash(),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  await assert.rejects(
    () => blockedClient.getSolanaUsdcBalance({ address: owner }),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  await assert.rejects(
    () => blockedClient.broadcastSignedSolana({ signedTransaction: signedTx() }),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  assert.equal(blocked.calls.some(call => call.body?.method === 'getLatestBlockhash'), false);
  assert.equal(blocked.calls.some(call => call.body?.method === 'getTokenAccountsByOwner'), false);
  assert.equal(blocked.calls.some(call => call.body?.method === 'sendTransaction'), false);

  const read = mockFetch([
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: SOLANA_GENESIS_HASH } },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'getLatestBlockhash',
      body: { result: { value: { blockhash, lastValidBlockHeight: 42 } } },
    },
    {
      match: (url, body) => url === rpcUrl && body?.method === 'getTokenAccountsByOwner',
      body: {
        result: {
          value: [
            { account: { data: { parsed: { info: { mint: address, tokenAmount: { amount: '1000', decimals: 6 } } } } } },
            { account: { data: { parsed: { info: { mint: address, tokenAmount: { amount: '2500', decimals: 6 } } } } } },
          ],
        },
      },
    },
  ]);
  const reader = client({ fetcher: read.fetcher });
  const hash = await reader.getSolanaBlockhash();
  assert.equal(hash.cluster, 'mainnet-beta');
  assert.equal(hash.blockhash, blockhash);
  const balance = await reader.getSolanaUsdcBalance({ address: owner });
  assert.equal(balance.amount, '3500');
  assert.equal(balance.mint, address);
  const balanceCall = read.calls.find(call => call.body?.method === 'getTokenAccountsByOwner');
  assert.deepEqual(balanceCall.body.params[1], { mint: address });
  assert.equal(balanceCall.body.params[0], owner);

  const mismatch = mockFetch([]);
  await assert.rejects(
    () => client({ fetcher: mismatch.fetcher }).signAndBroadcastOwnerSolana({
      ownerId: 'user_2',
      wallet,
      transaction: unsignedTx(),
    }),
    error => error instanceof WalletError && error.code === 'owner_mismatch',
  );
  assert.equal(mismatch.calls.length, 0);

  const sweep = mockFetch([
    {
      match: (url, body) => url.endsWith('/rpc') && body?.method === 'signTransaction',
      body: { data: { signed_transaction: signedTx() } },
    },
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: SOLANA_GENESIS_HASH } },
    { match: (url, body) => url === rpcUrl && body?.method === 'sendTransaction', body: { result: txSignature } },
  ]);
  const swept = await client({ fetcher: sweep.fetcher }).signAndBroadcastOwnerSolana({
    ownerId: 'user_1',
    wallet,
    transaction: unsignedTx(),
  });
  assert.equal(swept.signature, txSignature);
  assert.equal(swept.botId, undefined);
  assert.equal(wallet.frozen, true);
  assert.equal(sweep.calls.at(-1).body.method, 'sendTransaction');
});

/**
 * Rigor audit — an owner export returns HPKE ciphertext and refuses a plaintext key
 * Achieves: behavior named in the test title (see assertions).
 * Fails when: assertions below would not hold for a plausible defective impl.
 * Oracle: Privy/mainnet-beta contracts and prior product decisions (not control-flow mirrors).
 * Side effects: mocked fetch call list inspected where present.
 * Gaps: see assertion strength in body; strengthen if a defect could still pass.
 */
test('an owner export returns HPKE ciphertext and refuses a plaintext key', async () => {
  const wallet = {
    ...createMainWallet({ ownerId: 'user_1', address, id: walletId }),
    privyWalletId: walletId,
  };
  const recipient = Buffer.alloc(65, 7).toString('base64');
  const encapsulated = Buffer.alloc(65, 8).toString('base64');
  const ciphertext = Buffer.alloc(48, 9).toString('base64');
  const leaked = mockFetch([{
    match: (url) => url.endsWith(`/v1/wallets/${walletId}/export`),
    body: { encryption_type: 'HPKE', encapsulated_key: encapsulated, ciphertext, private_key: 'do-not-return' },
  }]);
  await assert.rejects(
    () => client({ fetcher: leaked.fetcher }).exportOwnerWallet({
      ownerId: 'user_1',
      wallet,
      recipientPublicKey: recipient,
    }),
    (error) => error instanceof WalletError && error.code === 'plaintext_key',
  );
  const clean = mockFetch([{
    match: (url, body) => url.endsWith(`/v1/wallets/${walletId}/export`)
      && body?.encryption_type === 'HPKE'
      && body?.recipient_public_key === recipient,
    body: { encryption_type: 'HPKE', encapsulated_key: encapsulated, ciphertext },
  }]);
  const exported = await client({ fetcher: clean.fetcher }).exportOwnerWallet({
    ownerId: 'user_1',
    wallet,
    recipientPublicKey: recipient,
  });
  assert.equal(exported.encryptionType, 'HPKE');
  assert.equal(exported.ciphertext, ciphertext);
  assert.equal(exported.encapsulatedKey, encapsulated);
  assert.equal(exported.privateKey, undefined);
  assert.equal(JSON.stringify(exported).includes('do-not-return'), false);
});

/**
 * Achieves: privyAuthorizationSignature produces a verifiable P-256 signature over the canonical payload.
 * Fails when: Wrong payload verifies, or junk/empty authorization keys succeed.
 * Oracle: node:crypto verify against independently generated public key + canonicalizeJson payload.
 * Side effects: none (local keypair fixture).
 * Gaps: does not call live Privy HTTP.
 */
test('privyAuthorizationSignature signs the canonical payload and rejects bad keys', () => {
  const url = 'https://api.privy.io/v1/wallets';
  const body = { chain_type: 'solana', owner: { user_id: privyUserId } };
  const signature = privyAuthorizationSignature({
    appId,
    authorizationKey,
    method: 'POST',
    url,
    body,
    idempotencyKey: 'idem_1',
    expiresAt: 1_700_000_000,
  });
  const payload = canonicalizeJson({
    version: 1,
    method: 'POST',
    url,
    body,
    headers: {
      'privy-app-id': appId,
      'privy-idempotency-key': 'idem_1',
      'privy-request-expiry': '1700000000',
    },
  });
  assert.equal(verify('sha256', Buffer.from(payload), publicKey, Buffer.from(signature, 'base64')), true);
  const withoutPrefix = privyAuthorizationSignature({
    appId,
    authorizationKey: authorizationKey.slice('wallet-auth:'.length),
    method: 'POST',
    url,
    body,
  });
  assert.equal(typeof withoutPrefix, 'string');
  assert.notEqual(withoutPrefix, '');
  assert.throws(
    () => privyAuthorizationSignature({ appId, authorizationKey: 'not-a-key', method: 'POST', url, body }),
    WalletError,
  );
  assert.throws(
    () => privyAuthorizationSignature({ appId, authorizationKey: '', method: 'POST', url, body }),
    WalletError,
  );
});
