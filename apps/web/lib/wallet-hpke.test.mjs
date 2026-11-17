import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExportRecipient, sealForRecipient } from './wallet-hpke.mjs';

/**
 * Achieves: verifies HPKE seal/open round-trip and that a different recipient cannot open.
 * Fails when: sealed plaintext mismatches, or a foreign recipient successfully decrypts.
 * Oracle: independent seal of known plaintext; reject open by a second createExportRecipient().
 * Side effects / state checked: N/A (ephemeral keys only).
 * Gaps: none for the unit contract; live Privy export path is covered elsewhere.
 */
test('a recipient opens only the key sealed to it', async () => {
  const recipient = await createExportRecipient();
  const sealed = await sealForRecipient(recipient.publicKey, 'agent-key-material');
  assert.equal(await recipient.open(sealed.encapsulatedKey, sealed.ciphertext), 'agent-key-material');
  const other = await createExportRecipient();
  await assert.rejects(() => other.open(sealed.encapsulatedKey, sealed.ciphertext));
});
