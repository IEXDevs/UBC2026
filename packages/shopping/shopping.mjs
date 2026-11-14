/**
 * Shopping bot helpers (Isaac / chunk 6B).
 * Compare sandbox catalog → propose best → require approval → 402 buy challenge.
 * Does not sign payments; pairs with bot-policy + verify + owner approval.
 */
import { createSandboxStoreClient, DEVNET_USDC_MINT } from '@ubc2026/x402';
import { evaluateProposal, proposalDigest } from '@ubc2026/bot-policy';

export class ShoppingError extends Error {}
const fail = message => { throw new ShoppingError(message); };

export function rankCatalogItems(items, { preferCheapest = true } = {}) {
  if (!Array.isArray(items) || items.length < 1) fail('Catalog items are required');
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
  cluster = 'devnet',
}) {
  if (!bot?.id) fail('Bot is required');
  if (!item?.id || !item?.price) fail('Catalog item is required');
  if (typeof recipient !== 'string' || !recipient) fail('Payment recipient is required');
  const proposal = {
    id: `prop_${bot.id}_${item.id}`,
    botId: bot.id,
    cluster,
    asset: bot.cap?.asset === 'USDC' ? 'USDC' : (bot.cap?.asset ?? DEVNET_USDC_MINT),
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
}) {
  const client = storeClient ?? createSandboxStoreClient({ baseUrl, fetcher });
  const items = await client.listCatalog();
  const { best, ranked, reason } = rankCatalogItems(items, { preferCheapest });
  const { proposal, digest, item } = buildShoppingProposal({ bot, item: best, recipient, now });
  const policy = evaluateProposal(bot, proposal, ledger, now);
  const challenge = await client.buy({ itemId: item.id });
  return {
    ranked,
    pick: { item, reason },
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
