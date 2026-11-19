/**
 * Browser-only secret drafts for the create screens.
 * Callers show the value. This module does not log it.
 */
import { BIP39_ENGLISH } from './bip39-english.mjs';
import { passwordProblem } from './desk-lock.mjs';
import { normalizePassphrase } from './wallet-desk.mjs';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomBytes(length, random) {
  const bytes = new Uint8Array(length);
  if (typeof random === 'function') random(bytes);
  else crypto.getRandomValues(bytes);
  return bytes;
}

export function generatePassword(random) {
  const bytes = randomBytes(20, random);
  let text = '';
  for (const byte of bytes) text += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  if (passwordProblem(text)) throw new Error('password');
  return text;
}

export function generatePassphrase(random) {
  const bytes = randomBytes(8, random);
  const words = [];
  for (let index = 0; index < 4; index += 1) {
    const pick = ((bytes[index * 2] << 8) | bytes[index * 2 + 1]) % BIP39_ENGLISH.length;
    words.push(BIP39_ENGLISH[pick]);
  }
  const text = words.join(' ');
  if (!normalizePassphrase(text)) throw new Error('passphrase');
  return text;
}

/** A typed secret can be accepted. A generated one needs the copy icon. */
export function secretAcceptAllowed({ generated = false, copied = false } = {}) {
  if (!generated) return true;
  return copied === true;
}

/**
 * Recovery passphrase step. Copy is preferred; matching confirm still
 * proves they have the value when the clipboard is denied.
 */
export function recoveryPassStepReady({
  generated = false,
  copied = false,
  passphrase = '',
  again = '',
} = {}) {
  if (secretAcceptAllowed({ generated, copied })) return true;
  const left = normalizePassphrase(passphrase);
  const right = normalizePassphrase(again);
  return Boolean(generated && left && left === right);
}
