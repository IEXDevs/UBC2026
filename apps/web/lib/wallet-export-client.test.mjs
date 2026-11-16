import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestWalletExport } from './wallet-export-client.mjs';

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
  assert.equal(seen.url, '/api/runtime/api/wallets/fmfdj6yqly31huorjqzq38zc/export');
  assert.equal(seen.init.headers['x-desk-grant'], 'ab'.repeat(32));
  assert.equal(seen.body.recipientPublicKey, 'cA==');
  assert.equal(JSON.stringify(seen.body).includes('private'), false);
});
