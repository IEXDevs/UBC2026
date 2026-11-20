import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { createExportRecipient, sealForRecipient } from './wallet-hpke.mjs';

/**
 * Achieves: verifies HPKE seal/open round-trip and that a different recipient cannot open.
 * Fails when: sealed plaintext mismatches, or a foreign recipient successfully decrypts.
 * Oracle: independent seal of known plaintext; reject open by a second createExportRecipient().
 * Side effects / state checked: N/A (ephemeral keys only).
 * Gaps: live Privy exports are not exercised.
 */
test('a recipient opens only the key sealed to it', async () => {
  const recipient = await createExportRecipient();
  const sealed = await sealForRecipient(recipient.publicKey, 'agent-key-material');
  assert.equal(await recipient.open(sealed.encapsulatedKey, sealed.ciphertext), 'agent-key-material');
  const other = await createExportRecipient();
  await assert.rejects(() => other.open(sealed.encapsulatedKey, sealed.ciphertext));
});

test('export recipient uses Privy SPKI encoding and opens an independently sealed response', async () => {
  const recipient = await createExportRecipient();
  const publicKey = await crypto.subtle.importKey('spki', Buffer.from(recipient.publicKey, 'base64'),
    { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const suite = new CipherSuite({
    kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305(),
  });
  for (const text of ['synthetic-export-material', '']) {
    const { enc, ct } = await suite.seal({ recipientPublicKey: publicKey }, new TextEncoder().encode(text));
    assert.equal(await recipient.open(Buffer.from(enc).toString('base64'), Buffer.from(ct).toString('base64')), text);
  }
  await assert.rejects(() => recipient.open('not-base64!', 'not-base64!'));
});
