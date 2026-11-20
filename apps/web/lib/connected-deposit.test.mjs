import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { buildSolanaUsdcTransaction } from '@ubc2026/transfers';
import { postConnectedDeposit, signedDepositMatches, walletsForDeposit } from './connected-deposit.mjs';
import { privyJwksUrl } from './privy-access-token.mjs';

const appId = 'cmwfmn2ue01n70hjygl8zyidx';
const ownerId = 'did:privy:abc';
const env = {
  PRIVY_APP_ID: appId,
  PRIVY_APP_SECRET: 'secret',
  SOLANA_RPC_URL: 'https://example.invalid/rpc',
};
const now = 1_700_000_000_000;
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'ES256', use: 'sig' };
const sourceKey = Keypair.generate();
const mainKey = Keypair.generate();
const otherKey = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();

function signJwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  const signer = createSign('SHA256');
  signer.update(input);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

const token = signJwt({
  iss: 'privy.io',
  aud: appId,
  sub: ownerId,
  exp: Math.floor(now / 1000) + 600,
});

function wallet(id, address, extra = {}) {
  return {
    id,
    ownerId,
    kind: id === 'w_main' ? 'main' : 'additional',
    label: id,
    address,
    frozen: false,
    provider: 'privy',
    spendable: id === 'w_main',
    ...extra,
  };
}

const connected = wallet('linked_phantom', sourceKey.publicKey.toBase58(), { spendable: false });
const main = wallet('w_main', mainKey.publicKey.toBase58(), { kind: 'main', spendable: true });

function depositBytes({ amount = '2500000', destination = main.address, memo = 'deposit', payer = sourceKey } = {}) {
  const built = buildSolanaUsdcTransaction({
    feePayer: payer.publicKey.toBase58(),
    sourceOwner: payer.publicKey.toBase58(),
    destinationOwner: destination,
    amount,
    memo,
    recentBlockhash: blockhash,
  });
  built.transaction.sign(payer);
  return built.transaction.serialize({ requireAllSignatures: true, verifySignatures: false }).toString('base64');
}

function jwksFetcher() {
  return async (url) => {
    assert.equal(url, privyJwksUrl(appId));
    return { ok: true, json: async () => ({ keys: [jwk] }) };
  };
}

function request(body, { authorization = `Bearer ${token}`, owner } = {}) {
  return new Request('http://localhost/api/wallets/deposit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
      ...(owner ? { 'x-owner-id': owner } : {}),
    },
    body: JSON.stringify(body),
  });
}

function harness(wallets, { loads = [] } = {}) {
  const broadcasts = [];
  return {
    broadcasts,
    loads,
    deps: {
      env,
      now: () => now,
      jwksFetcher: jwksFetcher(),
      loadWallets: async (id) => {
        loads.push(id);
        return wallets;
      },
      chain: {
        async blockhash() { return blockhash; },
        async assertSolana() {},
        async broadcast(signed) {
          broadcasts.push(signed);
          return 'sig_deposit';
        },
      },
    },
  };
}

/**
 * Achieves: the JWKS URL is the Privy app endpoint, and a signed deposit message matches only that plan.
 * Fails when: the URL is invented, or a different amount still counts as the deposit.
 * Oracle: https://auth.privy.io/api/v1/apps/<app-id>/jwks.json and the prepared memo, amount, and accounts.
 * Side effects / state checked: N/A.
 * Gaps: does not fetch the live JWKS.
 */
test('a signed blob matches only the prepared deposit', () => {
  assert.equal(
    privyJwksUrl(appId),
    'https://auth.privy.io/api/v1/apps/cmwfmn2ue01n70hjygl8zyidx/jwks.json',
  );
  const plan = { from: connected, to: main, amount: '2500000', memo: 'deposit' };
  const signed = depositBytes();
  assert.equal(signedDepositMatches(signed, plan), true);
  assert.equal(signedDepositMatches(depositBytes({ amount: '1' }), plan), false);
  assert.equal(signedDepositMatches(depositBytes({ destination: otherKey.publicKey.toBase58() }), plan), false);
  assert.equal(signedDepositMatches(depositBytes({ memo: 'wallet.move' }), plan), false);
  assert.equal(signedDepositMatches(depositBytes({ payer: otherKey }), plan), false);
});

/**
 * Achieves: broadcast submits the prepared deposit and rejects a different signed transaction.
 * Fails when: any base64 blob is sent, or the owner is taken from x-owner-id or the body.
 * Oracle: one broadcast of the prepared bytes; transaction_mismatch does not broadcast; load uses the JWT sub.
 * Side effects / state checked: injected chain.broadcast and loadWallets.
 * Gaps: does not call QuickNode.
 */
test('broadcast rejects a signed blob that is not the prepared deposit', async () => {
  const ok = harness([connected, main]);
  const prepared = await postConnectedDeposit(request({
    phase: 'prepare',
    fromId: connected.id,
    toId: main.id,
    amount: '2500000',
    from: wallet('attacker', otherKey.publicKey.toBase58()),
    to: wallet('attacker_main', otherKey.publicKey.toBase58(), { kind: 'main' }),
  }, { owner: 'did:privy:other' }), ok.deps);
  assert.equal(prepared.status, 200);
  assert.equal(ok.loads[0], ownerId);
  const body = await prepared.json();
  assert.equal(typeof body.transaction, 'string');
  assert.equal(ok.broadcasts.length, 0);

  const sent = await postConnectedDeposit(request({
    phase: 'broadcast',
    fromId: connected.id,
    toId: main.id,
    amount: '2500000',
    signedTransaction: depositBytes(),
  }, { owner: 'did:privy:other' }), ok.deps);
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).signature, 'sig_deposit');
  assert.equal(ok.broadcasts.length, 1);
  assert.equal(ok.broadcasts[0], depositBytes());

  const mismatch = harness([connected, main]);
  const rejected = await postConnectedDeposit(request({
    phase: 'broadcast',
    fromId: connected.id,
    toId: main.id,
    amount: '2500000',
    signedTransaction: depositBytes({ amount: '9' }),
  }), mismatch.deps);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, 'transaction_mismatch');
  assert.equal(mismatch.broadcasts.length, 0);

  const renamed = harness([{ ...connected, id: 'privy_phantom' }, main]);
  const byAddress = await postConnectedDeposit(request({
    phase: 'broadcast',
    fromId: 'linked_phantom',
    toId: 'not_the_server_id',
    fromAddress: connected.address,
    toAddress: main.address,
    amount: '2500000',
    signedTransaction: depositBytes(),
    from: { ...connected, address: otherKey.publicKey.toBase58(), frozen: false },
  }), renamed.deps);
  assert.equal(byAddress.status, 200);
  assert.equal(renamed.broadcasts.length, 1);

  const foreign = harness([connected, main]);
  const outsider = await postConnectedDeposit(request({
    phase: 'broadcast',
    fromId: `linked_${otherKey.publicKey.toBase58()}`,
    toId: 'w_other',
    fromAddress: otherKey.publicKey.toBase58(),
    toAddress: otherKey.publicKey.toBase58(),
    amount: '2500000',
    signedTransaction: depositBytes(),
  }), foreign.deps);
  assert.equal(outsider.status, 400);
  assert.equal((await outsider.json()).error, 'invalid_wallet');
  assert.equal(foreign.broadcasts.length, 0);
});

/**
 * Achieves: a frozen source cannot broadcast, and the destination must be the loaded main wallet.
 * Fails when: freeze is only enforced while preparing.
 * Oracle: planConnectedDeposit wallet_frozen and invalid_destination, with no broadcast.
 * Side effects / state checked: injected chain.broadcast.
 * Gaps: does not read a live ledger.
 */
test('a frozen source cannot broadcast', async () => {
  const frozen = harness([{ ...connected, frozen: true }, main]);
  const response = await postConnectedDeposit(request({
    phase: 'broadcast',
    fromId: connected.id,
    toId: main.id,
    amount: '2500000',
    signedTransaction: depositBytes(),
  }), frozen.deps);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'wallet_frozen');
  assert.equal(frozen.broadcasts.length, 0);

  const wrongDest = harness([connected, { ...main, kind: 'additional' }]);
  const dest = await postConnectedDeposit(request({
    phase: 'broadcast',
    fromId: connected.id,
    toId: main.id,
    amount: '2500000',
    signedTransaction: depositBytes(),
  }), wrongDest.deps);
  assert.equal(dest.status, 400);
  assert.equal((await dest.json()).error, 'invalid_destination');
  assert.equal(wrongDest.broadcasts.length, 0);
});

/**
 * Achieves: an empty or unverified Authorization header never loads wallets or broadcasts.
 * Fails when: any non-empty bearer string is treated as a login.
 * Oracle: 401 login_required and no loadWallets call.
 * Side effects / state checked: injected loadWallets.
 * Gaps: does not call auth.privy.io.
 */
test('broadcast requires a verified Privy token', async () => {
  const missing = harness([connected, main]);
  const anonymous = await postConnectedDeposit(request({
    phase: 'broadcast',
    fromId: connected.id,
    toId: main.id,
    amount: '2500000',
    signedTransaction: depositBytes(),
  }, { authorization: '' }), missing.deps);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, 'login_required');
  assert.equal(missing.loads.length, 0);
  assert.equal(missing.broadcasts.length, 0);

  const parts = token.split('.');
  const forged = `${parts[0]}.${parts[1]}.${parts[2].slice(0, 8)}${parts[2][8] === 'A' ? 'B' : 'A'}${parts[2].slice(9)}`;
  const bad = await postConnectedDeposit(request({
    phase: 'broadcast',
    signedTransaction: depositBytes(),
  }, { authorization: `Bearer ${forged}` }), missing.deps);
  assert.equal(bad.status, 401);
  assert.equal(missing.loads.length, 0);
});

/**
 * Achieves: stored freeze wins, and a Privy linked wallet stays the connected source.
 * Fails when: the body can mark a frozen wallet spendable, or a linked wallet becomes the main wallet.
 * Oracle: frozen true on the stored address; linked wallet spendable false and kind additional.
 * Side effects / state checked: N/A.
 * Gaps: does not call Supabase.
 */
test('deposit wallets come from the stored owner and the Privy user', () => {
  const user = {
    id: ownerId,
    linked_accounts: [
      { type: 'wallet', address: main.address, chain_type: 'solana', wallet_client_type: 'privy', id: 'privy_main' },
      { type: 'wallet', address: connected.address, chain_type: 'solana', wallet_client_type: 'phantom', id: 'privy_phantom' },
    ],
  };
  const wallets = walletsForDeposit([
    {
      id: 'w_main',
      owner_id: ownerId,
      kind: 'main',
      label: 'Main',
      address: main.address,
      frozen: false,
      provider: 'privy',
    },
    {
      id: 'linked_phantom',
      owner_id: ownerId,
      kind: 'additional',
      label: 'Phantom',
      address: connected.address,
      frozen: true,
      provider: 'privy',
      spendable: false,
    },
  ], user, ownerId);
  const source = wallets.find(item => item.address === connected.address);
  const dest = wallets.find(item => item.address === main.address);
  assert.equal(source.frozen, true);
  assert.equal(source.spendable, false);
  assert.equal(source.kind, 'additional');
  assert.equal(dest.kind, 'main');
  assert.equal(dest.frozen, false);
});
