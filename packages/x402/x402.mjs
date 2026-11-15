export class X402Error extends Error {}
const fail = message => { throw new X402Error(message); };

export const NETWORKS = Object.freeze({
  mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
});

// Hackathon execution stays on Solana devnet; mainnet reads remain separate.
export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const amount = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) fail('Amounts must be unsigned integer strings in base units');
  return value;
};
const required = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
function optionalQuality(item) {
  const raw = item?.quality ?? item?.qualityScore;
  if (raw == null || raw === '') return null;
  const text = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : raw;
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]{0,3})$/.test(text) || BigInt(text) > 1000n) return null;
  return text;
}
const pubkey = value => {
  if (!required(value) || !base58.test(value)) fail('Invalid Solana pubkey');
  return value;
};

function encode(object) {
  return Buffer.from(JSON.stringify(object), 'utf8').toString('base64');
}
function decode(header, label) {
  if (typeof header !== 'string' || !header.trim()) fail(`Missing ${label}`);
  let json;
  try { json = Buffer.from(header, 'base64').toString('utf8'); } catch { fail(`Invalid ${label}`); }
  try { return JSON.parse(json); } catch { fail(`Invalid ${label}`); }
}

export function buildPaymentRequired({
  resourceUrl,
  description,
  amount: payAmount,
  payTo,
  feePayer,
  network = NETWORKS.devnet,
  asset = DEVNET_USDC_MINT,
  maxTimeoutSeconds = 60,
  serviceName = 'UBC2026 agent payment',
  error = 'PAYMENT-SIGNATURE header is required',
}) {
  if (!required(resourceUrl) || !required(description) || !required(serviceName)) fail('Resource metadata is required');
  try { const url = new URL(resourceUrl); if (!['https:', 'http:'].includes(url.protocol)) fail('Resource URL must be http(s)'); }
  catch { fail('Resource URL must be absolute'); }
  if (!Number.isSafeInteger(maxTimeoutSeconds) || maxTimeoutSeconds < 1 || maxTimeoutSeconds > 600) fail('Invalid payment timeout');
  if (network !== NETWORKS.devnet && network !== NETWORKS.mainnet) fail('Unsupported CAIP-2 Solana network');
  // Hackathon policy: never emit mainnet payment challenges from this package.
  if (network === NETWORKS.mainnet) fail('Hackathon x402 challenges must use Solana devnet');
  const accepts = [{
    scheme: 'exact',
    network,
    amount: amount(payAmount),
    asset: pubkey(asset),
    payTo: pubkey(payTo),
    maxTimeoutSeconds,
    extra: { feePayer: pubkey(feePayer), name: 'USDC', version: '2' },
  }];
  const body = {
    x402Version: 2,
    error,
    resource: { url: resourceUrl, description, mimeType: 'application/json', serviceName },
    accepts,
    extensions: {},
  };
  return {
    status: 402,
    headers: { 'PAYMENT-REQUIRED': encode(body), 'Cache-Control': 'no-store' },
    body,
  };
}

export function parsePaymentSignature(header) {
  const payload = decode(header, 'PAYMENT-SIGNATURE');
  if (!payload || payload.x402Version !== 2) fail('Unsupported payment payload version');
  if (!payload.payload || typeof payload.payload !== 'object') fail('Incomplete payment payload');
  const accepted = payload.accepted;
  if (!accepted || accepted.scheme !== 'exact' || accepted.network !== NETWORKS.devnet) fail('Hackathon payments must use exact scheme on Solana devnet');
  amount(accepted.amount); pubkey(accepted.asset); pubkey(accepted.payTo);
  if (!required(payload.payload.signature) || payload.payload.signature.length > 2048) fail('Payment signature is required');
  return payload;
}

/** PAYMENT-SIGNATURE header for a devnet exact-scheme challenge. Does not sign or broadcast. */
export function buildPaymentSignature({ accepted, signature } = {}) {
  if (!accepted || typeof accepted !== 'object') fail('Accepted payment terms are required');
  const header = encode({ x402Version: 2, accepted, payload: { signature } });
  parsePaymentSignature(header);
  return header;
}

export function buildPaymentResponse({ success, transaction, network = NETWORKS.devnet, errorMessage }) {
  if (typeof success !== 'boolean') fail('Settlement success flag is required');
  if (network !== NETWORKS.devnet) fail('Hackathon settlements must report Solana devnet');
  const body = success
    ? { success: true, transaction: required(transaction) ? transaction : fail('Confirmed transaction signature is required'), network, payer: undefined }
    : { success: false, errorReason: required(errorMessage) ? errorMessage : 'settlement_failed', network };
  return {
    headers: { 'PAYMENT-RESPONSE': encode(body), 'Cache-Control': 'no-store' },
    body,
  };
}

/** UI payment-feed row. Does not authorize spending; pair with bot-policy + verify-consensus first. */
export function paymentFeedEntry({
  id, botId, recipient, amount: payAmount, asset = DEVNET_USDC_MINT, resourceUrl, transaction, status, createdAt,
}) {
  if (![id, botId, recipient, resourceUrl, status].every(required)) fail('Incomplete payment feed entry');
  if (!['requested', 'paid', 'verified', 'failed'].includes(status)) fail('Invalid payment feed status');
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) fail('Invalid createdAt');
  return {
    id, botId, recipient: pubkey(recipient), amount: amount(payAmount), asset: pubkey(asset),
    resourceUrl, transaction: transaction == null ? null : required(transaction) ? transaction : fail('Invalid transaction'),
    status, createdAt, network: NETWORKS.devnet, protocol: 'x402-v2',
  };
}

/**
 * x402 agent sandbox shopping client (devnet).
 * Catalog/buy helpers only — signing/settlement stay outside this package.
 * Default base: https://x402-agent-sandbox.vercel.app (override when the team confirms the live host).
 */
export function createSandboxStoreClient({
  baseUrl = 'https://x402-agent-sandbox.vercel.app',
  fetcher = fetch,
} = {}) {
  let catalogUrl;
  let buyUrl;
  try {
    catalogUrl = new URL('/store/catalog', baseUrl);
    buyUrl = new URL('/store/buy', baseUrl);
  } catch {
    fail('Sandbox base URL must be absolute');
  }
  if (!['https:', 'http:'].includes(catalogUrl.protocol)) fail('Sandbox base URL must be http(s)');

  async function readJson(response) {
    if (response.status === 402) {
      const paymentRequired = response.headers.get('PAYMENT-REQUIRED') ?? response.headers.get('payment-required');
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: 402, paymentRequired, body };
    }
    if (!response.ok) fail(`Sandbox request failed with status ${response.status}`);
    try { return await response.json(); } catch { fail('Invalid sandbox JSON response'); }
  }

  return {
    async listCatalog() {
      let response;
      try {
        response = await fetcher(catalogUrl.href, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        fail('Sandbox catalog unavailable');
      }
      const data = await readJson(response);
      if (!data || !Array.isArray(data.items ?? data)) fail('Sandbox catalog must include items');
      const items = Array.isArray(data.items) ? data.items : data;
      return items.map(item => {
        if (!item || !required(item.id) || !required(item.name)) fail('Invalid catalog item');
        const row = {
          id: item.id,
          name: item.name,
          price: amount(String(item.price ?? item.amount ?? '')),
          description: typeof item.description === 'string' ? item.description.slice(0, 500) : '',
        };
        const quality = optionalQuality(item);
        if (quality) row.quality = quality;
        return row;
      });
    },

    /**
     * Start a buy. Without a PAYMENT-SIGNATURE this should return a 402 challenge.
     * Pass `paymentSignature` only after bot-policy + verify-consensus + owner approval.
     */
    async buy({ itemId, paymentSignature = null }) {
      if (!required(itemId)) fail('itemId is required');
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (paymentSignature) headers['PAYMENT-SIGNATURE'] = paymentSignature;
      let response;
      try {
        response = await fetcher(buyUrl.href, {
          method: 'POST',
          headers,
          body: JSON.stringify({ itemId }),
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        fail('Sandbox buy unavailable');
      }
      if (response.status === 402) {
        const challenge = await readJson(response);
        return { state: 'payment-required', ...challenge };
      }
      const order = await readJson(response);
      if (!order || !required(order.orderId ?? order.id)) fail('Sandbox buy must return an order id');
      return {
        state: 'ordered',
        orderId: order.orderId ?? order.id,
        itemId,
        confirmation: typeof order.confirmation === 'string' ? order.confirmation : null,
        raw: order,
      };
    },
  };
}
