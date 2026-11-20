import { shortAddress } from './money-views.mjs';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Recognize a 32-byte public key, not a signature or a clipped lookalike. */
export function isWalletAddress(value) {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(BASE58.indexOf(char));
  let bytes = 0;
  while (number > 0n) { bytes += 1; number >>= 8n; }
  return bytes + (value.match(/^1*/)?.[0].length || 0) === 32;
}

/** Keep the full copy payload separate from its display. Never guess a clipped address. */
export function addressParts(text, addresses = []) {
  const source = typeof text === 'string' ? text : '';
  const known = new Map();
  for (const address of new Set(addresses.filter(isWalletAddress))) {
    const key = shortAddress(address);
    known.set(key, known.has(key) ? null : address);
  }
  // Consume URLs and longer tokens whole: a signature must not become a public key.
  const tokens = /https?:\/\/[^\s<>]+|[A-Za-z0-9]+(?:\.{3}|…)[A-Za-z0-9]+|[A-Za-z0-9]+/g;
  const parts = [];
  let end = 0;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    const address = isWalletAddress(token) ? token : known.get(token.replace('…', '...'));
    if (!address) continue;
    if (match.index > end) parts.push({ text: source.slice(end, match.index) });
    parts.push({ address });
    end = match.index + token.length;
  }
  if (end < source.length) parts.push({ text: source.slice(end) });
  return parts;
}
