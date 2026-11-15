/**
 * View model for the shopping panel's ranked proposal.
 * Prepare may return a 402 challenge. This view never settles a buy.
 */
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
