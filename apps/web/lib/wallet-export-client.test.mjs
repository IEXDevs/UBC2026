import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestWalletExport } from './wallet-export-client.mjs';

/**
 * Achieves: verifies export POSTs HPKE recipient key and returns ciphertext without private key fields.
 * Fails when: URL/headers/body wrong, private_key leaks into result, or ciphertext dropped.
 * Oracle: shellRuntimeUrl export path; body is only { recipientPublicKey }; result omits private_key.
 * Side effects / state checked: fetchImpl saw url, grant header, and body shape.
 * Gaps: none for happy path; failure paths covered below.
 */
test('the export client returns ciphertext and drops extra fields', async () => {
  let seen = null;
  const result = await requestWalletExport(async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      ok: true,
      encryptionType: 'HPKE',
      encapsulatedKey: 'aa',
      ciphertext: 'bb',
      private_key: 'nope',
    }), { status: 200 });
  }, {
    ownerId: 'user_1',
    walletId: 'fmfdj6yqly31huorjqzq38zc',
    token: 'token',
    grant: 'ab'.repeat(32),
    recipientPublicKey: 'cA==',
  });
  assert.equal(result.ok, true);
  assert.equal(result.ciphertext, 'bb');
  assert.equal(result.private_key, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'private_key'), false);
  assert.equal(seen.url, '/api/runtime/api/wallets/fmfdj6yqly31huorjqzq38zc/export');
  assert.equal(seen.init.headers['x-desk-grant'], 'ab'.repeat(32));
  assert.equal(seen.init.headers.authorization, 'Bearer token');
  assert.equal(seen.init.headers['x-owner-id'], 'user_1');
  assert.equal(seen.body.recipientPublicKey, 'cA==');
  assert.equal(JSON.stringify(seen.body).includes('private'), false);
});

/**
 * Achieves: verifies missing inputs and non-HPKE / HTTP failures fail closed without calling a bad path.
 * Fails when: missing walletId still fetches, or HTTP 500 / wrong encryptionType returns ok:true.
 * Oracle: missing required fields → { ok:false, error:'runtime' }; bad body → export_failed or body.error.
 * Side effects / state checked: fetch not invoked when inputs incomplete.
 * Gaps: none.
 */
test('export client fails closed on missing inputs and bad responses', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'denied' }), { status: 403 });
  };
  assert.deepEqual(
    await requestWalletExport(fetchImpl, { ownerId: 'u', walletId: 'w' }),
    { ok: false, error: 'runtime' },
  );
  assert.equal(calls, 0);

  // Wallet ids must satisfy the runtime allowlist (10+ chars); short ids never fetch.
  assert.deepEqual(
    await requestWalletExport(fetchImpl, {
      ownerId: 'u',
      walletId: 'short',
      recipientPublicKey: 'cA==',
    }),
    { ok: false, error: 'runtime' },
  );
  assert.equal(calls, 0);

  const walletId = 'fmfdj6yqly31huorjqzq38zc';
  const failed = await requestWalletExport(fetchImpl, {
    ownerId: 'u',
    walletId,
    recipientPublicKey: 'cA==',
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'denied');
  assert.equal(calls, 1);

  const wrongType = await requestWalletExport(async () => new Response(JSON.stringify({
    encryptionType: 'AES',
    ciphertext: 'bb',
  }), { status: 200 }), {
    ownerId: 'u',
    walletId,
    recipientPublicKey: 'cA==',
  });
  assert.deepEqual(wrongType, { ok: false, error: 'export_failed' });
});
