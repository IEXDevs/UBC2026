import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExportRecipient, sealForRecipient } from './wallet-hpke.mjs';

test('a recipient opens only the key sealed to it', async () => {
  const recipient = await createExportRecipient();
  const sealed = await sealForRecipient(recipient.publicKey, 'agent-key-material');
  assert.equal(await recipient.open(sealed.encapsulatedKey, sealed.ciphertext), 'agent-key-material');
  const other = await createExportRecipient();
  await assert.rejects(() => other.open(sealed.encapsulatedKey, sealed.ciphertext));
});
