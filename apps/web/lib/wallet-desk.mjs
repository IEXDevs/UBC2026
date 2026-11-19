/**
 * Wallet desk view model. No signing, no seed storage, no network.
 * Mainnet mints here are for price quotes only.
 */
import { parseRecipient } from '@ubc2026/contracts';
import { BIP39_ENGLISH } from './bip39-english.mjs';
import { formatBaseUnits, shortAddress } from './money-views.mjs';
import { platformBalance } from './platform-send.mjs';

const SYMBOL = /^[A-Z][A-Z0-9]{1,11}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SNS = /^[a-z0-9][a-z0-9-]{0,62}\.sol$/;
const UNITS = /^(0|[1-9][0-9]{0,39})$/;
const WORD = /^[a-z]{3,8}$/;

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export const PRICE_PAIRS = Object.freeze({
  SOL: 'SOLUSDT',
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  JUP: 'JUPUSDT',
});

export const CORE_TOKENS = Object.freeze([
  Object.freeze({ symbol: 'USDC', mint: USDC_MINT, decimals: 6, core: true }),
  Object.freeze({ symbol: 'SOL', mint: SOL_MINT, decimals: 9, core: true }),
]);

export function clipAddress(address) {
  return shortAddress(address);
}

export function emptyTokenPrefs() {
  return { hidden: [], restricted: [], extra: [], sns: '' };
}

function uniqueSymbols(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const symbol = typeof item === 'string' ? item.trim().toUpperCase() : '';
    if (!SYMBOL.test(symbol) || out.includes(symbol)) continue;
    out.push(symbol);
  }
  return out;
}

export function normalizeTokenPrefs(input) {
  const hidden = uniqueSymbols(input?.hidden).filter(symbol => symbol !== 'USDC');
  const restricted = uniqueSymbols(input?.restricted).filter(symbol => symbol !== 'USDC');
  const extra = [];
  const seen = new Set(['USDC', 'SOL']);
  if (Array.isArray(input?.extra)) {
    for (const row of input.extra) {
      const symbol = typeof row?.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
      const mint = typeof row?.mint === 'string' ? row.mint.trim() : '';
      const decimals = Number(row?.decimals);
      if (!SYMBOL.test(symbol) || seen.has(symbol) || !MINT.test(mint)) continue;
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) continue;
      seen.add(symbol);
      extra.push({ symbol, mint, decimals });
      if (extra.length >= 24) break;
    }
  }
  const known = new Set(['SOL', ...extra.map(token => token.symbol)]);
  const snsText = typeof input?.sns === 'string' ? input.sns.trim().toLowerCase() : '';
  return {
    hidden: hidden.filter(symbol => known.has(symbol)),
    restricted: restricted.filter(symbol => known.has(symbol)),
    extra,
    sns: SNS.test(snsText) ? snsText : '',
  };
}

export function tokenStorageKey(ownerId) {
  return typeof ownerId === 'string' && ownerId.trim() ? `maelstrom.tokens.${ownerId.trim()}` : '';
}

export function recoveryStorageKey(ownerId) {
  return typeof ownerId === 'string' && ownerId.trim() ? `maelstrom.recovery.${ownerId.trim()}` : '';
}

/** Ack records store flags only. A phrase in the blob is rejected. */
export function recoveryAcknowledged(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const secret = ['words', 'phrase', 'mnemonic', 'seed', 'passphrase', 'seedPhrase'];
    if (secret.some(key => key in body)) return false;
    return body.downloaded === true && body.confirmed === true;
  } catch {
    return false;
  }
}

export function recoveryAckRecord() {
  return JSON.stringify({ downloaded: true, confirmed: true });
}

function safeUnits(value) {
  return typeof value === 'string' && UNITS.test(value) ? value : '0';
}

function positionUnits(positions, asset) {
  let sum = 0n;
  for (const position of positions) {
    if (!position || position.asset !== asset || position.side === 'borrow') continue;
    if (typeof position.amount !== 'string' || !UNITS.test(position.amount)) continue;
    sum += BigInt(position.amount);
  }
  return sum.toString();
}

export function usdcUnits({ positions = [], transfers = [] } = {}) {
  if (Array.isArray(transfers) && transfers.some(row => row && row.asset === 'USDC' && UNITS.test(row.amount))) {
    return platformBalance(transfers);
  }
  return positionUnits(positions, 'USDC');
}

export function deskTokens({ positions = [], transfers = [], prefs } = {}) {
  const clean = normalizeTokenPrefs(prefs);
  const book = usdcUnits({ positions, transfers });
  const rows = [
    ...CORE_TOKENS.map(token => ({ ...token })),
    ...clean.extra.map(token => ({ ...token, core: false })),
  ];
  return rows.map(token => {
    const amount = token.symbol === 'USDC' ? book : positionUnits(positions, token.symbol);
    return {
      ...token,
      amount,
      amountLabel: `${formatBaseUnits(amount, token.decimals)} ${token.symbol}`,
      hidden: clean.hidden.includes(token.symbol),
      tradeable: !clean.restricted.includes(token.symbol),
    };
  });
}

export function visibleTokens(rows) {
  return rows.filter(row => !row.hidden);
}

export function tradeableTokens(rows) {
  return rows.filter(row => row.tradeable && !row.hidden);
}

export function parseSendTarget(value) {
  const parsed = parseRecipient(value);
  if (parsed) return parsed;
  const token = typeof value === 'string' ? value.trim() : '';
  if (MINT.test(token)) return { kind: 'address', address: token };
  return null;
}

export function displayToUnits(text, decimals = 6) {
  if (typeof text !== 'string' || !Number.isInteger(decimals) || decimals < 0 || decimals > 9) return null;
  const value = text.trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) return null;
  const scale = 10n ** BigInt(decimals);
  const padded = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  const units = (BigInt(whole) * scale) + BigInt(padded || '0');
  if (units <= 0n) return null;
  const asString = units.toString();
  return UNITS.test(asString) ? asString : null;
}

export function chartLine(values, width = 320, height = 96) {
  const nums = Array.isArray(values)
    ? values.filter(value => typeof value === 'number' && Number.isFinite(value))
    : [];
  if (nums.length < 2 || width < 16 || height < 16) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pad = 6;
  const coords = nums.map((value, index) => {
    const x = pad + (index / (nums.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });
  const d = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0]} ${point[1]}`).join(' ');
  const last = coords[coords.length - 1];
  const area = `${d} L${last[0]} ${height - pad} L${coords[0][0]} ${height - pad} Z`;
  return {
    d,
    area,
    up: nums[nums.length - 1] >= nums[0],
    last: nums[nums.length - 1],
  };
}

export function quoteUrl(venue, { inputMint, outputMint, amount } = {}) {
  if (!MINT.test(inputMint) || !MINT.test(outputMint) || inputMint === outputMint) return null;
  if (typeof amount !== 'string' || !/^[1-9][0-9]{0,39}$/.test(amount)) return null;
  const host = venue === 'dflow'
    ? 'https://quote-api.dflow.net/quote'
    : venue === 'jupiter'
      ? 'https://lite-api.jup.ag/swap/v1/quote'
      : '';
  if (!host) return null;
  const url = new URL(host);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amount);
  url.searchParams.set('slippageBps', '50');
  return url.toString();
}

export function readQuoteOut(body) {
  const out = body?.outAmount ?? body?.outputAmount;
  return typeof out === 'string' && UNITS.test(out) ? out : null;
}

export function recoveryWords(value) {
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.trim().split(/\s+/) : null);
  if (!list || (list.length !== 12 && list.length !== 24)) return null;
  const words = list.map(word => (typeof word === 'string' ? word.trim().toLowerCase() : ''));
  if (words.some(word => !WORD.test(word))) return null;
  return words;
}

export function wordsFromWallets(wallets) {
  if (!Array.isArray(wallets)) return null;
  for (const wallet of wallets) {
    const words = recoveryWords(wallet?.recoveryWords ?? wallet?.mnemonic ?? wallet?.seedPhrase);
    if (words) return words;
  }
  return null;
}

export function shuffledPhrase(words, random = Math.random) {
  const phrase = recoveryWords(words);
  if (!phrase) return [];
  const items = phrase.map((word, index) => ({ word, index }));
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
}

const WORD_INDEX = new Map(BIP39_ENGLISH.map((word, index) => [word, index]));

function bitsFromBytes(bytes, bitCount) {
  const bits = [];
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0 && bits.length < bitCount; shift -= 1) {
      bits.push((byte >> shift) & 1);
    }
  }
  return bits;
}

function rotr(n, value) {
  return (value >>> n) | (value << (32 - n));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Software(bytes) {
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

async function sha256Bytes(bytes) {
  const digest = globalThis.crypto?.subtle?.digest;
  if (typeof digest === 'function') {
    try {
      return new Uint8Array(await digest.call(globalThis.crypto.subtle, 'SHA-256', bytes));
    } catch {
      // Some hosted WebViews expose crypto.subtle but reject digest.
    }
  }
  return sha256Software(bytes);
}

export function normalizePassphrase(value) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFKC');
  if (text.length < 8 || text.length > 64 || /[\r\n]/.test(text)) return null;
  return text;
}

export async function phraseFromEntropy(entropy) {
  if (!(entropy instanceof Uint8Array) || entropy.length !== 16) throw new Error('entropy');
  const hash = await sha256Bytes(entropy);
  const bits = [...bitsFromBytes(entropy, 128), ...bitsFromBytes(hash, 4)];
  const words = [];
  for (let i = 0; i < bits.length; i += 11) {
    let index = 0;
    for (let bit = 0; bit < 11; bit += 1) index = (index << 1) | bits[i + bit];
    const word = BIP39_ENGLISH[index];
    if (!word) throw new Error('phrase');
    words.push(word);
  }
  if (words.length !== 12) throw new Error('phrase');
  return words;
}

export async function createRecoveryPhrase(fillRandom = bytes => crypto.getRandomValues(bytes)) {
  const entropy = new Uint8Array(16);
  fillRandom(entropy);
  return phraseFromEntropy(entropy);
}

export async function verifyRecoveryPhrase(words) {
  const phrase = recoveryWords(words);
  if (!phrase || phrase.length !== 12) return false;
  const bits = [];
  for (const word of phrase) {
    const index = WORD_INDEX.get(word);
    if (index == null) return false;
    for (let shift = 10; shift >= 0; shift -= 1) bits.push((index >> shift) & 1);
  }
  const entropy = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | bits[(i * 8) + bit];
    entropy[i] = byte;
  }
  const hash = await sha256Bytes(entropy);
  const checksum = bitsFromBytes(hash, 4);
  return checksum.every((bit, index) => bit === bits[128 + index]);
}

export function readRecoveryAck(storage, ownerId) {
  const key = recoveryStorageKey(ownerId);
  if (!storage || !key) return false;
  try {
    return recoveryAcknowledged(storage.getItem(key));
  } catch {
    return false;
  }
}

export function writeRecoveryAck(storage, ownerId) {
  const key = recoveryStorageKey(ownerId);
  if (!storage || !key) throw new Error('owner');
  storage.setItem(key, recoveryAckRecord());
}

/** Write the ack, then read it back. Never stores the phrase. */
export function persistRecoveryAck(storage, ownerId) {
  try {
    writeRecoveryAck(storage, ownerId);
    return readRecoveryAck(storage, ownerId) === true;
  } catch {
    return false;
  }
}

export function readTokenPrefs(storage, ownerId) {
  const key = tokenStorageKey(ownerId);
  if (!storage || !key) return emptyTokenPrefs();
  try {
    return normalizeTokenPrefs(JSON.parse(storage.getItem(key) || 'null'));
  } catch {
    return emptyTokenPrefs();
  }
}

export function writeTokenPrefs(storage, ownerId, prefs) {
  const key = tokenStorageKey(ownerId);
  if (!storage || !key) throw new Error('owner');
  const clean = normalizeTokenPrefs(prefs);
  storage.setItem(key, JSON.stringify(clean));
  return clean;
}

export function swapQuoteUrl(venue, rows, { inputSymbol, outputSymbol, amount } = {}) {
  const input = (rows || []).find(row => row.symbol === inputSymbol);
  const output = (rows || []).find(row => row.symbol === outputSymbol);
  if (!input || !output || input.symbol === output.symbol) return { error: 'invalid_quote' };
  if (!input.tradeable || !output.tradeable || input.hidden || output.hidden) return { error: 'not_tradeable' };
  const url = quoteUrl(venue, { inputMint: input.mint, outputMint: output.mint, amount });
  if (!url) return { error: 'invalid_quote' };
  return { url, broadcast: false, cluster: 'devnet', pricing: 'mainnet', label: 'devnet execution, mainnet pricing' };
}

export const SETUP_CARD_MS = 4000;

export function setupCardVisible(step) {
  if (step === 'loading') return null;
  return step ?? null;
}

export function accountSetupStep({
  signedIn,
  profileReady,
  handle,
  walletsReady,
  walletCount,
  recoveryConfirmed,
} = {}) {
  if (signedIn !== true) return null;
  if (profileReady !== true || walletsReady !== true) return 'loading';
  if (typeof handle !== 'string' || !handle.trim()) return 'handle';
  if (!walletCount) return null;
  if (recoveryConfirmed !== true) return 'recovery';
  return null;
}

export function phraseComplete(picked, length) {
  return Array.isArray(picked)
    && picked.length === length
    && picked.every((index, position) => index === position);
}

export function recoveryCard({ words, wallets = [], handle = '', passphrase = '', at = '' } = {}) {
  const phrase = recoveryWords(words);
  const lines = ['Maelstrom recovery', 'devnet execution, mainnet pricing', ''];
  if (typeof handle === 'string' && handle.trim()) lines.push(`Handle: @${handle.trim().replace(/^@/, '')}`, '');
  if (phrase) {
    lines.push('Seed phrase:', phrase.join(' '), '');
    const pass = normalizePassphrase(passphrase);
    if (pass) lines.push('Passphrase:', pass, '');
    lines.push('Maelstrom does not keep a copy of this phrase.', 'Privy still signs. This phrase is the backup you save on this device.', '');
  } else {
    lines.push('Signing keys stay in Privy. This card lists addresses. It is not a seed phrase.', '');
  }
  for (const wallet of wallets) {
    if (typeof wallet?.address !== 'string' || !wallet.address.trim()) continue;
    const label = wallet.label || wallet.kind || 'Wallet';
    lines.push(`${label}: ${wallet.address.trim()}`);
  }
  if (typeof at === 'string' && at.trim()) lines.push('', `Saved: ${at.trim()}`);
  return `${lines.join('\n')}\n`;
}
