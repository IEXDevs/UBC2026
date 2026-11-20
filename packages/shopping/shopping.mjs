import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
/**
 * Shopping bot helpers (Isaac / chunk 6B).
 * Sandbox catalog → proposal → approval → settle 402 buy.
 * Laso: tiny mainnet USDC card challenge (owner settles — Worker never auto-signs mainnet).
 */
import {
  createSandboxStoreClient,
  SOLANA_USDC_MINT,
  MAINNET_USDC_MINT,
  NETWORKS,
  buildPaymentSignature,
  paymentFeedEntry,
} from '@ubc2026/x402';
import { evaluateProposal, proposalDigest } from '@ubc2026/bot-policy';

export class ShoppingError extends Error {}
const fail = message => { throw new ShoppingError(message); };

export const LASO_BASE_URL = 'https://laso.finance';
/** Tiny Laso prepaid card face value in USD (API minimum is $5). */
export const LASO_TINY_CARD_USD = 5;

const QUALITY_PATTERN = /^(0|[1-9][0-9]{0,3})$/;

function catalogQuality(item) {
  if (item?.quality == null && item?.qualityScore == null) return null;
  const raw = item.quality ?? item.qualityScore;
  const text = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : raw;
  if (typeof text !== 'string' || !QUALITY_PATTERN.test(text) || BigInt(text) > 1000n) {
    fail('Quality score must be an integer from 0 to 1000');
  }
  return BigInt(text);
}

function rankByPrice(items, preferCheapest) {
  const ranked = [...items].sort((a, b) => {
    const left = BigInt(a.price);
    const right = BigInt(b.price);
    if (preferCheapest) return left < right ? -1 : left > right ? 1 : 0;
    return left > right ? -1 : left < right ? 1 : 0;
  });
  return {
    best: ranked[0],
    ranked,
    reason: preferCheapest ? 'lowest sandbox price' : 'highest sandbox price',
    comparison: 'price',
  };
}

/**
 * Lowest price when the catalog has no quality scores.
 * With a score (0–1000), pick the best quality per sandbox price.
 * A higher score can beat a cheaper item. Nothing here signs or buys.
 */
export function rankCatalogItems(items, { preferCheapest = true, compareQuality = true } = {}) {
  if (!Array.isArray(items) || items.length < 1) fail('Catalog items are required');
  if (!compareQuality || preferCheapest === false) return rankByPrice(items, preferCheapest);
  const scored = items.map((item) => ({ item, quality: catalogQuality(item) }));
  if (!scored.some((row) => row.quality != null)) return rankByPrice(items, true);

  const ranked = [...scored].sort((a, b) => {
    const aScored = a.quality != null;
    const bScored = b.quality != null;
    if (aScored !== bScored) return aScored ? -1 : 1;
    if (aScored) {
      const left = a.quality * BigInt(b.item.price);
      const right = b.quality * BigInt(a.item.price);
      if (left !== right) return left > right ? -1 : 1;
    }
    const priceOrder = BigInt(a.item.price) < BigInt(b.item.price) ? -1 : BigInt(a.item.price) > BigInt(b.item.price) ? 1 : 0;
    if (priceOrder !== 0) return priceOrder;
    return String(a.item.id).localeCompare(String(b.item.id));
  }).map((row) => ({ ...row.item, quality: row.quality == null ? null : String(row.quality) }));

  const winner = ranked[0];
  const shown = `${winner.quality}/1000`;
  return {
    best: winner,
    ranked,
    reason: `best quality per sandbox price (${shown})`,
    comparison: 'price-and-quality',
  };
}

export function buildShoppingProposal({
  bot,
  item,
  recipient,
  quoteId = `shop_${item.id}`,
  maxFee = '0',
  expiresInMs = 120_000,
  now = Date.now(),
  cluster = SOLANA_CLUSTER,
}) {
  if (!bot?.id) fail('Bot is required');
  if (!item?.id || !item?.price) fail('Catalog item is required');
  if (typeof recipient !== 'string' || !recipient) fail('Payment recipient is required');
  const proposal = {
    id: `prop_${bot.id}_${item.id}`,
    botId: bot.id,
    cluster,
    asset: bot.cap?.asset === 'USDC' ? 'USDC' : (bot.cap?.asset ?? SOLANA_USDC_MINT),
    recipient,
    quoteId,
    outflow: String(item.price),
    expectedReceive: '1',
    expectedReceiveAsset: `sandbox:${item.id}`,
    maxFee,
    expiresAt: now + expiresInMs,
  };
  return { proposal, digest: proposalDigest(proposal), item };
}

/**
 * End-to-end shopping decision prep against the x402 sandbox store.
 */
export async function prepareSandboxPurchase({
  bot,
  ledger,
  recipient,
  storeClient = null,
  fetcher = fetch,
  baseUrl,
  now = Date.now(),
  preferCheapest = true,
  compareQuality = true,
}) {
  const client = storeClient ?? createSandboxStoreClient({ baseUrl, fetcher });
  const items = await client.listCatalog();
  const { best, ranked, reason, comparison } = rankCatalogItems(items, { preferCheapest, compareQuality });
  const { proposal, digest, item } = buildShoppingProposal({ bot, item: best, recipient, now });
  const policy = evaluateProposal(bot, proposal, ledger, now);
  const challenge = await client.buy({ itemId: item.id });
  return {
    ranked,
    pick: { item, reason, comparison },
    proposal,
    digest,
    policy,
    challenge,
    next: policy.state === 'approval-needed' || policy.state === 'over-budget'
      ? 'await-owner-approval'
      : policy.state === 'blocked'
        ? 'blocked'
        : 'ready-for-payment-signature',
  };
}

/**
 * After owner approval + bot-policy reserve, settle the sandbox 402 with a PAYMENT-SIGNATURE.
 * `signPayment` must return a Solana tx signature string (Privy/mainnet-beta transfer outside this package).
 */
export async function settleSandboxPurchase({
  bot,
  itemId,
  accepted,
  signPayment,
  storeClient = null,
  fetcher = fetch,
  baseUrl,
  paymentId = `pay_${bot?.id}_${itemId}`,
  now = Date.now(),
} = {}) {
  if (!bot?.id) fail('Bot is required');
  if (!itemId) fail('itemId is required');
  if (!accepted || accepted.scheme !== 'exact') fail('Accepted sandbox payment terms are required');
  if (accepted.network && accepted.network !== NETWORKS.solana) fail('Sandbox settlement must stay on Solana mainnet-beta');
  if (typeof signPayment !== 'function') fail('signPayment is required');

  const signature = await signPayment({
    amount: String(accepted.amount),
    payTo: accepted.payTo,
    asset: accepted.asset || SOLANA_USDC_MINT,
    memo: `maelstrom:shop:${itemId}`,
  });
  if (typeof signature !== 'string' || !signature) fail('Payment signature is required');

  const paymentSignature = buildPaymentSignature({ accepted, signature });
  const client = storeClient ?? createSandboxStoreClient({ baseUrl, fetcher });
  const order = await client.buy({ itemId, paymentSignature });
  if (order.state !== 'ordered') fail('Sandbox buy did not confirm an order');

  return {
    order,
    payment: paymentFeedEntry({
      id: paymentId,
      botId: bot.id,
      recipient: accepted.payTo,
      amount: String(accepted.amount),
      asset: accepted.asset || SOLANA_USDC_MINT,
      resourceUrl: `sandbox:buy:${itemId}`,
      transaction: signature,
      status: 'paid',
      createdAt: now,
    }),
    next: 'settled',
  };
}

function decodePaymentRequiredHeader(header) {
  if (typeof header !== 'string' || !header.trim()) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Laso Finance tiny-card challenge on Solana mainnet USDC.
 * Returns a proposal for owner approval. Does not sign or broadcast —
 * mainnet settlement stays with the owner / managed Laso agent wallet.
 */
export async function prepareLasoTinyCardPurchase({
  bot,
  ledger,
  amountUsd = LASO_TINY_CARD_USD,
  fetcher = fetch,
  baseUrl = LASO_BASE_URL,
  now = Date.now(),
} = {}) {
  if (!bot?.id) fail('Bot is required');
  const usd = Number(amountUsd);
  const units = Math.round(usd * 1_000_000);
  if (!['number', 'string'].includes(typeof amountUsd) || !Number.isFinite(usd) || usd < 5 || usd > 1000
      || Math.abs(units / 1_000_000 - usd) > Number.EPSILON * usd) fail('Laso card amount must be $5–$1000 with at most 6 decimals');

  const url = new URL('/get-card', baseUrl);
  url.searchParams.set('amount', String(usd));

  let response;
  try {
    response = await fetcher(url.href, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    fail('Laso get-card unavailable');
  }

  if (response.status !== 402) {
    fail(`Laso get-card expected 402, got ${response.status}`);
  }

  const header = response.headers.get('PAYMENT-REQUIRED')
    ?? response.headers.get('payment-required');
  const body = await response.json().catch(() => null);
  const decoded = decodePaymentRequiredHeader(header) || body;
  const accepts = decoded?.accepts;
  const validPubkey = value => {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
    let n = 0n;
    for (const c of value) n = n * 58n + BigInt(alphabet.indexOf(c));
    const bytes = n === 0n ? 0 : Math.ceil(n.toString(16).length / 2);
    return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
  };
  const solana = Array.isArray(accepts) && accepts.find(a => a?.scheme === 'exact'
    && a.network === NETWORKS.mainnet && a.asset === MAINNET_USDC_MINT && a.amount === String(units)
    && validPubkey(a.payTo) && validPubkey(a.extra?.feePayer)
    && Number.isSafeInteger(a.maxTimeoutSeconds) && a.maxTimeoutSeconds > 0
    && a.extra?.memo == null);
  if (decoded?.x402Version !== 2 || !solana) fail('Laso 402 has no supported exact mainnet USDC payment terms');

  const outflow = solana.amount;
  const recipient = solana.payTo;

  const proposal = {
    id: `prop_${bot.id}_laso_${units}`,
    botId: bot.id,
    cluster: 'mainnet-read',
    asset: 'USDC',
    recipient,
    quoteId: `laso:get-card:${usd}`,
    outflow,
    expectedReceive: '1',
    expectedReceiveAsset: `laso:card:${usd}`,
    maxFee: '0',
    expiresAt: now + 120_000,
    network: NETWORKS.mainnet,
    mint: MAINNET_USDC_MINT,
    executionNote: 'Owner-approved mainnet USDC only; Worker does not auto-sign mainnet',
  };

  // Bot-policy rejects mainnet clusters. Laso is an explicit owner-gated mainnet path.
  const policy = {
    state: 'approval-needed',
    reason: 'laso-mainnet-owner-gate',
    cluster: 'mainnet',
    outflow,
  };
  if (bot.frozen === true) {
    policy.state = 'blocked';
    policy.reason = 'bot-frozen';
  } else if (bot.enabled === false) {
    policy.state = 'blocked';
    policy.reason = 'bot-disabled';
  } else if (ledger && bot.cap?.mode === 'limited' && bot.cap.maxPerTransaction) {
    try {
      if (BigInt(outflow) > BigInt(bot.cap.maxPerTransaction)) {
        policy.state = 'blocked';
        policy.reason = 'over-per-tx-cap';
      }
    } catch {
      policy.state = 'blocked';
      policy.reason = 'invalid-amount';
    }
  }

  return {
    provider: 'laso',
    amountUsd: usd,
    resource: { url: url.href, description: 'Laso USA prepaid card', mimeType: 'application/json' },
    proposal,
    digest: proposalDigest({
      ...proposal,
      cluster: SOLANA_CLUSTER,
      expectedReceiveAsset: proposal.expectedReceiveAsset,
    }),
    policy,
    challenge: {
      state: 'payment-required',
      status: 402,
      paymentRequired: header,
      body: decoded,
      accepted: solana,
    },
    next: policy.state === 'blocked' ? 'blocked' : 'await-owner-mainnet-approval',
  };
}
