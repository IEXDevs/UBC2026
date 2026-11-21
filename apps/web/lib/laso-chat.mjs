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
  const clean = value => (typeof value === 'string' ? value.replace(/,/g, '') : value);
  const price = /\$\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:USDC|USD|dollars?|bucks?)\b/gi;
  const explicit = /\b(?:for|worth)\s+\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:USDC|USD|dollars?|bucks?)\b|(?=\s|$))/i.exec(text);
  if (explicit) return clean(explicit[1]);
  const prices = [...text.matchAll(price)];
  if (prices.length !== 1) return null;
  return clean(prices[0][1] ?? prices[0][2]);
}

/**
 * Owner-safe natural line for a Laso status/prepare failure. Pure data, no
 * I/O, no secrets, no links. Returns '' for flows with dedicated replies
 * (choice prompt, reloadable handover) and for unknown codes so the caller
 * falls back to the generic failure line.
 */
export function lasoStatusLine(input) {
  const payload = typeof input === 'string' ? null : input;
  const error = typeof payload?.error === 'string' ? payload.error : '';
  if (!error) return '';
  if (error === 'laso_card_choice_required' || error === 'laso_reloadable_human_steps') return '';
  if (error === 'laso_session_expired') {
    return 'The card session lapsed. Open your Laso dashboard link and tell me when you are back in, then I will re-check — I am not showing a live status until then.';
  }
  if (error === 'kyc_required') {
    return 'That step needs KYC first. Finish verification in your Laso dashboard link, then say done and I will continue. Nothing was charged.';
  }
  if (error === 'card_unavailable') {
    return 'USA prepaid cards are down right now. I can set up the international card instead — say the word. Nothing was charged.';
  }
  if (error === 'unknown_laso_server_id') {
    return 'I do not know that gift product id. Check the catalog id and try again — nothing was charged.';
  }
  if (error === 'payment_not_found' || error === 'account_balance_not_found') {
    return 'Laso has no record of that. Check the id and try again — nothing was charged.';
  }
  if (error === 'laso_requires_x402') {
    return 'Card buys go through the prepared ticket, never a plain transfer. I will prepare the ticket first.';
  }
  if (error === 'laso_payment_rejected') {
    return 'The payment was rejected and nothing was charged. A smaller amount can retry cleanly — say the word.';
  }
  if (error === 'payment_already_used') {
    return 'That ticket was already used, so I did not charge again. I will check the order status instead — reply done and I will verify.';
  }
  if (error === 'laso_settlement_unknown') {
    return 'The payment result is unclear, so I am checking status before anything is retried. Nothing is reported as bought yet.';
  }
  if (error === 'gift_country') {
    return 'Gift country needs a two-letter code like US. Nothing was charged — try again with the country set.';
  }
  if (error === 'rate_limited' || error === 'too_many_requests') {
    const wait = Number(payload?.retry_after_seconds ?? payload?.retryAfterSeconds);
    const when = Number.isSafeInteger(wait) && wait > 0 ? ` Try again in about ${wait} seconds.` : ' Try again in a bit.';
    return `Laso asked us to slow down.${when} Nothing was charged.`;
  }
  if (error === 'laso_status_unavailable' || error === 'provider_failed' || error === 'provider_unavailable') {
    return 'I could not reach Laso just now. Nothing was charged — try again in a bit.';
  }
  return '';
}

/**
 * Owner-safe natural line for a failed Laso card preparation. Pure data, no
 * I/O. Ranges follow the action being quoted so an out-of-range amount tells
 * the owner the right window. Returns '' for flows with dedicated replies
 * and for unknown codes so the caller falls back to the generic line.
 */
const LASO_PREPARE_RANGES = Object.freeze({
  setup: '$5 to $1000',
  modify: '$5 to $10,000',
  intl: 'whole dollars $100 to $1000 (plus the fee on top)',
  gift: 'the product currency ($5 to $9000 equivalent)',
});

export function lasoPrepareLine(error, action = '') {
  if (typeof error !== 'string' || !error) return '';
  if (error === 'laso_card_choice_required' || error === 'laso_reloadable_human_steps') return '';
  if (error === 'invalid_amount') {
    const range = LASO_PREPARE_RANGES[action] || '$5 to $1000 for a USA prepaid card ($5 to $10,000 top-up, whole-dollar $100 to $1000 international, product currency for gifts)';
    return `That amount is outside the range (${range}). No purchase was submitted — give me an amount inside it and I will quote again.`;
  }
  if (error === 'unknown_laso_server_id' || error === 'gift_product_required') {
    return 'I do not know that gift product. Name the brand from the catalog (or read the catalog first) and give the amount in the product currency — nothing was charged.';
  }
  if (error === 'gift_country') {
    return 'Gift country needs a two-letter code like US. Nothing was charged — try again with the country set.';
  }
  if (error === 'laso_payment_rejected') {
    return 'The payment was rejected and nothing was charged. A smaller amount can retry cleanly — say the word.';
  }
  if (error === 'payment_already_used') {
    return 'That ticket was already used, so I did not charge again. I will check the order status instead — reply done and I will verify.';
  }
  if (error === 'laso_settlement_unknown') {
    return 'The payment result is unclear, so I am checking status before anything is retried. Nothing is reported as bought yet.';
  }
  return '';
}

/**
 * Merchant name from a Laso ask, for the natural first line
 * ("checking Domino's…"). Known brands canonicalized; otherwise a
 * short "at X / from X / order X" phrase with amounts and card words
 * stripped. Never throws, never guesses from bare verbs.
 */
const KNOWN_LASO_MERCHANTS = Object.freeze([
  ['domino', 'Dominos'],
  ['amazon', 'Amazon'],
  ['walmart', 'Walmart'],
  ['target', 'Target'],
  ['best buy', 'Best Buy'],
  ['costco', 'Costco'],
  ['uber', 'Uber'],
  ['lyft', 'Lyft'],
  ['doordash', 'DoorDash'],
  ['grubhub', 'Grubhub'],
  ['starbucks', 'Starbucks'],
  ['chipotle', 'Chipotle'],
  ['netflix', 'Netflix'],
  ['spotify', 'Spotify'],
  ['steam', 'Steam'],
  ['ebay', 'eBay'],
  ['etsy', 'Etsy'],
  ['apple', 'Apple'],
  ['home depot', 'Home Depot'],
]);

export function lasoMerchantFrom(message) {
  const text = typeof message === 'string' ? message : '';
  if (!text.trim()) return null;
  const lower = ` ${text.toLowerCase().replace(/[’']/g, '')} `;
  for (const [key, canonical] of KNOWN_LASO_MERCHANTS) {
    if (new RegExp(`\\b${key}s?\\b`).test(lower)) return canonical;
  }
  const match = /\b(?:at|from)\s+([a-z0-9][a-z0-9&'’.\- ]{1,40})|\border\s+([a-z0-9][a-z0-9&'’.\- ]{1,40})/i.exec(text);
  let raw = (match?.[1] ?? match?.[2] ?? '').trim();
  if (!raw) return null;
  raw = raw.replace(/\$\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:usdc|usd|dollars?|bucks?)\b/gi, ' ');
  raw = raw.replace(/\b(?:cards?|reloadable|prepaid|laso|lasso|please|thanks|now|today|pizza)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  raw = raw.replace(/\s+(?:for|at|from|to|with|and|or)$/i, '');
  if (!raw || raw.length < 2 || raw.length > 40) return null;
  if (/^(me|my|the|a|an|it|this|that|some|any|one)$/i.test(raw)) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
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
