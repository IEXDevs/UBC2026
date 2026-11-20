import { dollarsToBaseUnits, toolAccessRequest } from './spend-permission.mjs';

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
  if (/\blaso\b/i.test(message ?? '')) args = { ...args, provider: 'laso' };
  const amount = requestedLasoAmount(message);
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

export function pendingLasoConfirmation(pending, message, { ownerId, botId }, now = Date.now()) {
  if (pending?.ownerId !== ownerId || pending?.botId !== botId || pending.hold?.args?.action !== 'x402'
      || !Number.isSafeInteger(pending.hold.expiresAt) || pending.hold.expiresAt <= now
      || !/^[0-9a-f]{64}$/.test(pending.hold.proof ?? '')) return null;
  return typeof message === 'string' && /^(?:(?:yes|yeah|yep|ok(?:ay)?|sure|approved?|confirm(?:ed)?|proceed|go ahead|do it)[\s,!.]*)+$/i.test(message.trim())
    ? pending.hold : null;
}
