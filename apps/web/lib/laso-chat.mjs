import { chooseLasoCardKind, LASO_CARD_CHOICE_PROMPT, lasoCardChecklist } from '@ubc2026/shopping/laso-card.mjs';
import { resumeLasoFlow } from '@ubc2026/shopping/laso-flow.mjs';
import { dollarsToBaseUnits, needsBoundSpend, toolAccessRequest } from './spend-permission.mjs';

export const isLasoCardRequest = message => /\blaso\b|\blasso\b|\breloadable\b|\bnon[\s-]?reloadable\b|\bprepaid cards?\b|\bgift\s*cards?\b/i.test(message ?? '');

/** reloadable, non-reloadable-usa, top-up, or undecided. Undecided must ask, never guess. */
export const lasoCardKind = message => chooseLasoCardKind(message ?? '');

export { LASO_CARD_CHOICE_PROMPT };

/** Checklist the owner follows for a new reloadable card. Human steps stay human. */
export function lasoReloadableChecklist() {
  return lasoCardChecklist('reloadable');
}

/** Resume decision for an open Laso flow: verify-now, keep-waiting, restart, or no-open-flow. */
export function lasoResumeDecision(flow, message) {
  return resumeLasoFlow(flow, message).decision;
}

/** Owner-facing reply for a new reloadable card: their steps first, then creation. */
export function lasoReloadableReply() {
  return `A reloadable card needs you for three steps first, then I create it:\n${lasoCardChecklist('reloadable').map((step, index) => `${index + 1}. ${step}`).join('\n')}`;
}

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
  const kind = chooseLasoCardKind(text);
  if (/\blaso\b|\blasso\b/i.test(text)) args = { ...args, provider: 'laso' };
  if (kind === 'top-up') {
    args = { ...args, provider: 'laso', lasoAction: 'modify' };
  } else if (kind === 'non-reloadable-usa') {
    args = { ...args, provider: 'laso', lasoAction: 'setup' };
  } else if (kind === 'gift') {
    args = { ...args, provider: 'laso', lasoAction: 'gift' };
  } else if (kind === 'intl') {
    args = { ...args, provider: 'laso', lasoAction: 'intl' };
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
  // Fee-bearing quotes (intl, gift) exceed the requested face value: the owner
  // confirms the exact outflow, so only require it to cover the request.
  // Gift amounts are in the product currency, not USD, so they cannot be
  // compared to the USDC outflow; the owner confirms that total instead.
  const feeBearing = parsed.lasoAction === 'intl' || parsed.lasoAction === 'gift';
  if (args.amountUsd != null && parsed.lasoAction !== 'gift') {
    const requested = dollarsToBaseUnits(String(args.amountUsd));
    if (feeBearing) {
      if (BigInt(parsed.proposal.outflow) < BigInt(requested)) return null;
    } else if (requested !== parsed.proposal.outflow) return null;
  }
  if (args.lasoAction != null && parsed.lasoAction !== args.lasoAction) return null;
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
