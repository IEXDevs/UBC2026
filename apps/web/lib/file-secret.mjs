import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function fileSecretFromBytes(bytes) {
  let out = '';
  for (const value of bytes) {
    if (value >= 252) continue;
    out += ALPHABET[value % 36];
    if (out.length === 128) return out;
  }
  return out;
}

export function createFileSecret(read = () => randomBytes(256)) {
  let secret = '';
  while (secret.length < 128) secret += fileSecretFromBytes(read());
  return secret.slice(0, 128);
}

export function hashFileSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex');
}

export function hashOwnerId(ownerId) {
  return createHash('sha256').update(String(ownerId)).digest('hex');
}
