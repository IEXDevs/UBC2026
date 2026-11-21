import { dollarsToBaseUnits, needsBoundSpend, toolAccessRequest } from './spend-permission.mjs';

export const isLasoCardRequest = message => /\blaso\b|\b(?:prepaid|reloadable) card\b/i.test(message ?? '');

export function requestedLasoAmount(message) {
  const text = typeof message === 'string' ? message : '';
  const price = /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:USDC|USD|dollars?)\b/gi;
  const explicit = /\b(?:for|worth)\s+\$?\s*(\d+(?:\.\d+)?)(?:\s*(?:USDC|USD|dollars?)\b|(?=\s|$))/i.exec(text);
  if (explicit) return explicit[1];
  const prices = [...text.matchAll(price)];
  return prices.length === 1 ? prices[0][1] ?? prices[0][2] : null;
}

export function lasoPreparationArgs(args, message) {
  const text = message ?? '';
  if (/\blaso\b/i.test(text)) args = { ...args, provider: 'laso' };
  if (/\b(top up|add funds|modify the card)\b/i.test(text)) {
    args = { ...args, provider: 'laso', lasoAction: 'modify' };
  }
  const amount = requestedLasoAmount(text);
  return args?.provider === 'laso' && amount != null ? { ...args, amountUsd: amount } : args;
}

export function lasoPurchaseHold(args, result) {
  let parsed = result;
  if (typeof result === 'string') {
    try { parsed = JSON.parse(result); } catch { return null; }
  }
  if (args?.provider !== 'laso' || parsed?.provider !== 'laso' || parsed.error
      || typeof parsed.lasoTicket !== 'string' || !/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(parsed.lasoTicket)
      || !/^[1-9][0-9]{0,9}$/.test(parsed.proposal?.outflow ?? '')) return null;
  const botId = args.botId || parsed.botId;
  if (typeof botId !== 'string' || !botId) return null;
  if (args.amountUsd != null && dollarsToBaseUnits(String(args.amountUsd)) !== parsed.proposal.outflow) return null;
  return toolAccessRequest('ask', 'request_spend', {
    botId, action: 'x402', asset: 'USDC', amount: parsed.proposal.outflow, lasoTicket: parsed.lasoTicket,
  });
}

export function cacheSpendConfirmation(pending, hold, context, now = Date.now()) {
  const next = pending?.hold === hold ? pending : {
    ownerId: context.ownerId, botId: context.botId, hold,
    expiresAt: hold?.expiresAt ?? now + 5 * 60 * 1000,
  };
  return pendingSpendConfirmation(next, 'yes', context, now) ? next : null;
}

export function pendingSpendConfirmation(pending, message, { ownerId, botId }, now = Date.now()) {
  const hold = pending?.hold;
  const expiresAt = hold?.expiresAt === undefined ? pending?.expiresAt : hold.expiresAt;
  if (!ownerId || !botId || pending?.ownerId !== ownerId || pending?.botId !== botId
      || hold?.name !== 'request_spend' || hold.kind !== 'modal' || hold.args?.botId !== botId
      || !['spend', 'pay', 'swap', 'x402'].includes(hold.args.action ?? 'spend')
      || !Number.isSafeInteger(expiresAt) || expiresAt <= now
      || ((needsBoundSpend(hold.name, hold.args) || hold.proof !== undefined)
        && (!Number.isSafeInteger(hold.expiresAt) || !/^[0-9a-f]{64}$/.test(hold.proof ?? '')))) return null;
  return typeof message === 'string' && /^(?:(?:yes|yeah|yep|ok(?:ay)?|sure|approved?|confirm(?:ed)?|proceed|go ahead|do it)[\s,!.]*)+$/i.test(message.trim())
    ? hold : null;
}
