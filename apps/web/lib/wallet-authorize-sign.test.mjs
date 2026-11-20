import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { privySessionFixture } from '../../agent-runtime/src/owner-auth.fixture.mjs';
import { POST } from '../app/api/wallets/authorize-sign/route.js';

test('owner signing route authenticates, loads stored identity, and never broadcasts', async t => {
  const ownerId = 'did:privy:authorize-route';
  const session = privySessionFixture(ownerId, 'authorizeroutetest');
  const key = Keypair.generate();
  const address = key.publicKey.toBase58();
  const id = 'cm5authorize1234567890abcd';
  const settings = { PRIVY_APP_ID: session.appId, PRIVY_APP_SECRET: 'offline-secret', SOLANA_RPC_URL: 'https://authorize-rpc.invalid',
    SUPABASE_URL: 'https://authorize-store.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline-store' };
  const previous = Object.fromEntries(Object.keys(settings).map(name => [name, process.env[name]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  let frozen = false;
  let signingCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) === session.jwksUrl) return session.jwks();
    if (String(url).startsWith(`${settings.SUPABASE_URL}/rest/v1/wallets?`)) return Response.json([
      { id, address, owner_id: ownerId, kind: 'additional', label: 'Agent', frozen },
    ]);
    assert.equal(String(url), `https://api.privy.io/v1/wallets/${id}/rpc`);
    signingCalls++;
    assert.equal(init.headers['privy-authorization-signature'], 'A'.repeat(88));
    const tx = Transaction.from(Buffer.from(JSON.parse(init.body).params.transaction, 'base64'));
    tx.partialSign(key);
    return Response.json({ data: { signed_transaction: tx.serialize().toString('base64') } });
  });
  const tx = new Transaction({ feePayer: key.publicKey, recentBlockhash: SystemProgram.programId.toBase58() })
    .add(SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  const transaction = tx.serialize({ requireAllSignatures: false }).toString('base64');
  const post = (body, token = session.token, owner = ownerId) => POST(new Request('https://desk.invalid/api/wallets/authorize-sign', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-owner-id': owner },
    body: JSON.stringify(body),
  }));
  assert.equal((await post({}, null)).status, 401);
  assert.equal((await post({}, session.token, 'other')).status, 403);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ phase: 'request', address: 'unknown', transaction })).status, 403);
  const response = await post({ phase: 'request', address, transaction });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const prepared = await response.json();
  assert.equal(JSON.parse(Buffer.from(prepared.payload, 'base64').toString()).body.params.transaction, transaction);
  const signed = await post({ phase: 'sign', address, transaction, expiresAt: prepared.expiresAt, signature: 'A'.repeat(88) });
  assert.equal(signed.status, 200);
  assert.equal(Transaction.from(Buffer.from((await signed.json()).signedTransaction, 'base64')).verifySignatures(), true);
  frozen = true;
  assert.equal((await (await post({ phase: 'request', address, transaction })).json()).error, 'wallet_frozen');
  assert.equal(signingCalls, 1);
});
