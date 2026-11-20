import { shortAddress } from './money-views.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Only resolve a shortened label when its full address is known and unambiguous. */
export function addressForLabel(label, addresses = []) {
  const matches = [...new Set(addresses.filter(address => (
    typeof address === 'string' && ADDRESS.test(address) && shortAddress(address) === label
  )))];
  return matches.length === 1 ? matches[0] : null;
}

export function addressTextParts(text, addresses = []) {
  const value = typeof text === 'string' ? text : '';
  const parts = [];
  let end = 0;
  for (const match of value.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{5}\.\.\.[1-9A-HJ-NP-Za-km-z]{5}\b/g)) {
    const address = addressForLabel(match[0], addresses);
    if (!address) continue;
    if (match.index > end) parts.push({ text: value.slice(end, match.index) });
    parts.push({ text: match[0], address });
    end = match.index + match[0].length;
  }
  if (end < value.length) parts.push({ text: value.slice(end) });
  return parts;
}
