/**
 * View model for the shopping panel's ranked proposal.
 * Prepare may return a 402 challenge. Settlement is a separate confirm.
 */
import { SOLANA_CLUSTER, SOLANA_CAIP2 } from '@ubc2026/contracts/solana';

function acceptedTerms(result) {
  const fromBody = result?.challenge?.body?.accepts?.[0];
  const direct = result?.challenge?.accepts?.[0];
  return fromBody || direct || null;
}

/**
 * Body for POST /bots/:id/shopping/settle. Null hides the approve control.
 * Laso and mainnet terms never settle from this panel.
 */
export function sandboxSettleBody(result, bot) {
  if (SOLANA_CLUSTER === 'mainnet-beta') return null;
  if (!result || result.provider === 'laso' || result.next === 'blocked') return null;
  if (!bot || typeof bot.id !== 'string' || !bot.id) return null;
  const itemId = result.pick?.item?.id;
  if (typeof itemId !== 'string' || !itemId) return null;
  const accepted = acceptedTerms(result);
  if (!accepted || accepted.scheme !== 'exact') return null;
  if (accepted.network !== SOLANA_CAIP2) return null;
  const walletId = bot.walletId || bot.record?.walletId || null;
  return {
    itemId,
    accepted,
    bot: {
      id: bot.id,
      ownerId: bot.ownerId || null,
      name: bot.name || bot.id,
      type: 'shopping',
      walletId,
    },
    wallet: walletId ? { id: walletId } : null,
  };
}

export function shoppingComparisonView(result) {
  if (!result || result.provider === 'laso' || !Array.isArray(result.ranked)) return null;
  const comparison = result.pick?.comparison === 'price-and-quality' ? 'price-and-quality' : 'price';
  return {
    comparison,
    title: comparison === 'price-and-quality' ? 'Price and quality' : 'Lowest price',
    reason: typeof result.pick?.reason === 'string' ? result.pick.reason : '',
    ask: 'Ask before buy. Nothing is purchased until you approve.',
    proposalId: result.proposal?.id ?? null,
    outflow: result.proposal?.outflow ?? null,
    next: result.next ?? null,
    rows: result.ranked.map((item, index) => ({
      id: String(item?.id ?? index),
      role: index === 0 ? 'proposal' : 'compared',
      name: item?.name || item?.id || 'Item',
      price: item?.price == null ? '' : String(item.price),
      quality: item?.quality == null || item.quality === '' ? null : String(item.quality),
    })),
  };
}
