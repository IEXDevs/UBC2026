/**
 * Owner activity log. Writes through the Supabase service role when it is configured.
 * Private keys, seed phrases, API keys, bearer tokens, and Live View URLs are removed
 * before the row is sent. The database trigger removes them again.
 */
import { BIP39_ENGLISH } from './bip39-english.mjs';
import { supabaseConfig, supabaseWrite } from './supabase-rest.mjs';

const BIP39 = new Set(BIP39_ENGLISH);
const SECRET_KEY = /^(privatekey|privkey|secretkey|seed|seedphrase|mnemonic|mnemonicphrase|authorizationkey|password|apikey|accesstoken|refreshtoken|servicerole|servicerolekey|authorization|cookie|viewerurl|liveview|liveviewurl|grant|granthash|salt|hash|ciphertext|encapsulatedkey|recipientpublickey)$/;
const PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const WALLET_AUTH = /wallet-auth:[A-Za-z0-9+/=_-]+/gi;
const LIVE_VIEW = /https:\/\/live\.browser\.run\S*/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g;
const TOKENISH = /\b(?:sk|xai|rk|pk)_[A-Za-z0-9_-]{8,}\b/g;
const ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|SEED|MNEMONIC)[A-Z0-9_]*)=[^\s'"]+/g;
const BASE58_SECRET = /\b[1-9A-HJ-NP-Za-km-z]{87,88}\b/g;
const HEX_SECRET = /\b[0-9a-fA-F]{128}\b/g;
const BYTE_ARRAY = /\[(?:\s*(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\s*,){63}\s*(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\s*\]/g;
const OWNER_ID = /^[a-zA-Z0-9:_-]{1,128}$/;

function secretKey(key) {
  return SECRET_KEY.test(String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase());
}

function redactSeeds(text) {
  const matches = [...text.matchAll(/[A-Za-z]+/g)];
  const ranges = [];
  let index = 0;
  while (index < matches.length) {
    let taken = 0;
    for (const width of [24, 12]) {
      if (index + width > matches.length) continue;
      const slice = matches.slice(index, index + width);
      const start = slice[0].index;
      const end = slice[width - 1].index + slice[width - 1][0].length;
      const span = text.slice(start, end);
      if (!/^[A-Za-z]+(?:\s+[A-Za-z]+)*$/.test(span)) continue;
      if (span.split(/\s+/).length !== width) continue;
      if (slice.some(match => !BIP39.has(match[0].toLowerCase()))) continue;
      ranges.push([start, end]);
      taken = width;
      break;
    }
    index += taken || 1;
  }
  let out = text;
  for (const [start, end] of ranges.reverse()) {
    out = `${out.slice(0, start)}[redacted]${out.slice(end)}`;
  }
  return out;
}

export function redactLogText(value) {
  if (typeof value !== 'string' || value === '') return value;
  const redacted = redactSeeds(
    value
      .replace(PEM, '[redacted]')
      .replace(WALLET_AUTH, '[redacted]')
      .replace(LIVE_VIEW, '[redacted]')
      .replace(BEARER, 'Bearer [redacted]')
      .replace(JWT, '[redacted]')
      .replace(TOKENISH, '[redacted]')
      .replace(ASSIGNMENT, '$1=[redacted]')
      .replace(BASE58_SECRET, '[redacted]')
      .replace(HEX_SECRET, '[redacted]')
      .replace(BYTE_ARRAY, '[redacted]'),
  );
  return redacted.length > 8000 ? `${redacted.slice(0, 8000)}…` : redacted;
}

function isSecretByteArray(value) {
  return Array.isArray(value)
    && value.length === 64
    && value.every(item => Number.isInteger(item) && item >= 0 && item <= 255);
}

export function redactForLog(value, depth = 0) {
  if (value == null || depth > 12) return depth > 12 ? '[truncated]' : value;
  if (typeof value === 'string') return redactLogText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (isSecretByteArray(value)) return '[redacted]';
  if (Array.isArray(value)) return value.slice(0, 80).map(item => redactForLog(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      out[key] = secretKey(key) ? '[redacted]' : redactForLog(item, depth + 1);
    }
    return out;
  }
  return null;
}

function ownerIdOf(value) {
  return typeof value === 'string' && OWNER_ID.test(value) ? value : null;
}

function botIdFromPath(pathname) {
  const match = /^\/bots\/([^/]+)/.exec(pathname);
  return match ? ownerIdOf(decodeURIComponent(match[1])) : null;
}

function parseLoggedBody(text) {
  if (typeof text !== 'string' || text === '') return null;
  const clipped = text.length > 24000 ? text.slice(0, 24000) : text;
  try {
    return JSON.parse(clipped);
  } catch {
    return clipped;
  }
}

function fitDetail(detail) {
  if (JSON.stringify(detail).length <= 24000) return detail;
  const withoutResponse = { ...detail, response: '[truncated]', truncated: true };
  if (JSON.stringify(withoutResponse).length <= 24000) return withoutResponse;
  return { ...withoutResponse, request: '[truncated]' };
}

export async function captureRequest(request) {
  const url = new URL(request.url);
  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      body = parseLoggedBody(await request.clone().text());
    } catch {
      body = null;
    }
  }
  return {
    method: request.method,
    path: url.pathname,
    query: redactLogText(url.search.startsWith('?') ? url.search.slice(1) : url.search) || '',
    botId: botIdFromPath(url.pathname),
    contentType: request.headers.get('content-type')?.slice(0, 80) ?? null,
    body: redactForLog(body),
  };
}

export async function persistActivity(env, row, fetcher = env?.fetch ?? fetch) {
  if (!supabaseConfig(env)) return { configured: false };
  const detail = fitDetail(redactForLog(row?.detail ?? {}));
  const action = redactLogText(String(row?.action ?? 'log')).slice(0, 200) || 'log';
  const body = {
    id: `log_${crypto.randomUUID()}`,
    owner_id: ownerIdOf(row?.ownerId),
    bot_id: ownerIdOf(row?.botId),
    source: typeof row?.source === 'string' && /^[a-z0-9_:-]{1,32}$/.test(row.source) ? row.source : 'http',
    action,
    status: Number.isInteger(row?.status) ? row.status : null,
    detail: detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {},
  };
  try {
    return await supabaseWrite(env, {
      path: 'activity_logs',
      method: 'POST',
      body,
      prefer: 'return=minimal',
      fetcher,
    });
  } catch {
    return { configured: true, ok: false };
  }
}

function isSensitiveBotPath(path) {
  if (typeof path !== 'string') return false;
  if (path.includes('/api/positions')) return true;
  return /\/bots\/[^/]+(?:\/(?:status|wake|pause|resume|advance|decide|loop))?$/.test(path)
    || /\/bots\/[^/]+\/(?:status|wake|pause|resume|advance|decide|loop)$/.test(path);
}

function slimLoggedResponse(path, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  // Status / control / position endpoints: keep flags, drop full run + paper books.
  if (isSensitiveBotPath(path)) {
    const check = body.positionCheck && typeof body.positionCheck === 'object'
      ? {
        flag: body.positionCheck.flag ?? null,
        status: body.positionCheck.status ?? null,
        positionCount: Array.isArray(body.positionCheck.positions) ? body.positionCheck.positions.length : 0,
      }
      : null;
    return {
      ok: body.ok === true,
      error: typeof body.error === 'string' ? body.error.slice(0, 64) : null,
      auth: body.auth ?? null,
      itemCount: Array.isArray(body.items) ? body.items.length : undefined,
      positionCheck: check,
      // Never persist checkpoint / gate payloads in activity_logs.
      run: body.run ? { present: true } : undefined,
      gate: body.gate ? { decision: body.gate?.decision ?? null } : undefined,
    };
  }
  return body;
}

export async function persistHttpActivity(env, { captured, response, started } = {}) {
  if (!supabaseConfig(env)) return { configured: false };
  let responseBody = null;
  if (response && typeof response.clone === 'function') {
    try {
      responseBody = parseLoggedBody(await response.clone().text());
    } catch {
      responseBody = null;
    }
  }
  return persistActivity(env, {
    ownerId: captured?.ownerId ?? null,
    botId: captured?.botId ?? null,
    source: 'http',
    action: `${captured?.method ?? 'HTTP'} ${captured?.path ?? '/'}`,
    status: Number.isInteger(response?.status) ? response.status : null,
    detail: {
      method: captured?.method ?? null,
      path: captured?.path ?? null,
      query: captured?.query ?? '',
      ms: Math.max(0, Date.now() - (Number.isFinite(started) ? started : Date.now())),
      contentType: captured?.contentType ?? null,
      request: captured?.body ?? null,
      response: slimLoggedResponse(captured?.path, responseBody),
    },
  }, env?.fetch ?? fetch);
}
