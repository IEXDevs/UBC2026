/**
 * The owner quote for a Laso card. The buy is still the x402 spend.
 */
export function shoppingBotForCards(bot, bots = []) {
  if (bot?.type === 'shopping') return bot;
  return bots.find(item => item?.type === 'shopping') || null;
}

export function lasoQuoteBody(bot, ownerId, { lasoAction = 'setup', amountUsd = 5, billing = null } = {}) {
  const walletId = bot?.record?.walletId || bot?.walletId || '';
  if (bot?.type !== 'shopping' || typeof bot.id !== 'string' || !bot.id || !ownerId || !walletId) return null;
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    provider: 'laso',
    lasoAction: lasoAction === 'modify' ? 'modify' : 'setup',
    amountUsd: amount,
    ...(billing ? { billing } : {}),
    bot: {
      id: bot.id,
      ownerId,
      name: bot.name,
      goal: bot.goal,
      type: 'shopping',
      enabled: true,
      frozen: false,
      policyVersion: 1,
      approvalMode: 'ask',
      walletId,
      cap: bot.record?.cap || { mode: 'limited', asset: 'USDC', maxOutflow: '20000000', maxPerTransaction: '10000000' },
    },
    ledger: { asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' },
  };
}
