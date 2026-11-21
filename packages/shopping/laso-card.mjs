/**
 * Laso virtual cards.
 * One billing address is stamped on every card.
 * Setup and balance changes are x402 routes. A card payment never
 * returns the number or CVV.
 */

export class LasoCardError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new LasoCardError(code); };

const TEXT = /^[^\n\r]{1,80}$/;
const COUNTRY = /^[A-Z]{2}$/;
const EXPIRY = /^(0[1-9]|1[0-2])\/\d{2}$/;

function clean(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > max || !TEXT.test(text)) return '';
  return text;
}

export function billingAddress(input) {
  if (!input || typeof input !== 'object') fail('billing_required');
  const name = clean(input.name, 64);
  const line1 = clean(input.line1, 80);
  const line2 = clean(input.line2 || '', 80);
  const city = clean(input.city, 40);
  const region = clean(input.region, 40);
  const postalCode = clean(input.postalCode ?? input.postal_code, 16);
  const country = typeof input.country === 'string' ? input.country.trim().toUpperCase() : '';
  if (!name || !line1 || !city || !region || !postalCode) fail('billing_required');
  if (!COUNTRY.test(country)) fail('billing_country');
  return {
    name,
    line1,
    line2: line2 || '',
    city,
    region,
    postalCode,
    country,
  };
}

export function formatBillingAddress(billing) {
  const shared = billingAddress(billing);
  const street = [shared.line1, shared.line2].filter(Boolean).join(', ');
  return `${shared.name}, ${street}, ${shared.city}, ${shared.region} ${shared.postalCode}, ${shared.country}`;
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function parsePan(value) {
  const pan = digits(value);
  if (pan.length < 13 || pan.length > 19) fail('invalid_pan');
  return pan;
}

export function parseCvv(value) {
  const cvv = digits(value);
  if (cvv.length < 3 || cvv.length > 4) fail('invalid_cvv');
  return cvv;
}

export function parseExpiry(value) {
  const expiry = typeof value === 'string' ? value.trim() : '';
  if (!EXPIRY.test(expiry)) fail('invalid_expiry');
  return expiry;
}

export function groupPan(pan) {
  return parsePan(pan).replace(/(.{4})/g, '$1 ').trim();
}

function cardId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_.-]{1,128}$/.test(value)) fail('card_required');
  return value;
}

/**
 * setup follows GET /get-card (USA non-reloadable prepaid, $5-$1000, no fee).
 * modify follows GET /fund-card-balance (reloadable balance top-up, $5-$10000, no fee).
 * intl follows GET /order-intl-card (international non-reloadable, whole dollars
 * $100-$1000 plus at most a 3.8% fee). gift follows GET /order-gift-card
 * (brand catalog, amount in the product's currency, product fee varies).
 * A new reloadable card has no x402 quote: it is KYC + card-issuer link +
 * fund + POST /create-reloadable-card, so it never goes through setup.
 * Use chooseLasoCardKind before preparing anything.
 */
export function lasoCardAction(action, amountUsd, extra = {}) {
  const usd = Number(amountUsd);
  const units = Math.round(usd * 1_000_000);
  if (!Number.isFinite(usd) || Math.abs(units / 1_000_000 - usd) > Number.EPSILON * Math.max(usd, 1)) fail('invalid_amount');
  if (action === 'setup') {
    if (usd < 5 || usd > 1000) fail('invalid_amount');
    return { action: 'setup', path: '/get-card', amountUsd: usd, kind: 'prepaid' };
  }
  if (action === 'modify') {
    if (usd < 5 || usd > 10000) fail('invalid_amount');
    return { action: 'modify', path: '/fund-card-balance', amountUsd: usd, kind: 'reloadable' };
  }
  if (action === 'intl') {
    if (!Number.isInteger(usd) || usd < 100 || usd > 1000) fail('invalid_amount');
    return { action: 'intl', path: '/order-intl-card', amountUsd: usd, kind: 'prepaid-intl' };
  }
  if (action === 'gift') {
    if (!(usd > 0)) fail('invalid_amount');
    const id = typeof extra?.laso_server_id === 'string' ? extra.laso_server_id.trim() : '';
    if (!id || id.length > 128 || /[\r\n]/.test(id)) fail('gift_product_required');
    const country = extra?.country == null || extra.country === ''
      ? 'US'
      : String(extra.country).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) fail('gift_country');
    return { action: 'gift', path: '/order-gift-card', amountUsd: usd, kind: 'gift', laso_server_id: id, country };
  }
  fail('invalid_action');
}

/** Fee-aware upper bound for an intl quote: requested units plus at most 3.8%. */
export function lasoIntlMaxUnits(units) {
  const value = typeof units === 'bigint' ? units : BigInt(String(units));
  if (value <= 0n) fail('invalid_amount');
  return ((value * 1038n + 999n) / 1000n).toString();
}

export function lasoCardRecord(input = {}) {
  const id = cardId(input.id || input.card_id || input.cardId);
  const pan = input.pan || input.card_number || input.cardNumber ? parsePan(input.pan || input.card_number || input.cardNumber) : null;
  const cvv = input.cvv ? parseCvv(input.cvv) : null;
  const expiry = input.expiry ? parseExpiry(input.expiry) : null;
  const status = ['pending', 'ready', 'open'].includes(input.status) ? input.status : (pan ? 'ready' : 'pending');
  const kind = input.kind === 'reloadable' || /reload/i.test(String(input.card_type || '')) ? 'reloadable' : 'prepaid';
  const amount = input.amountUsd ?? input.usd_amount ?? input.balance ?? null;
  const amountUsd = amount == null || amount === '' ? null : Number(amount);
  if (amountUsd != null && (!Number.isFinite(amountUsd) || amountUsd < 0)) fail('invalid_amount');
  return {
    id,
    pan,
    cvv,
    expiry,
    status,
    kind,
    amountUsd,
  };
}

export function cardFromLasoDetails(payload = {}) {
  const card = payload.card && typeof payload.card === 'object' ? payload.card : payload;
  const details = payload.card_details || payload.cardDetails || card.card_details || {};
  return lasoCardRecord({
    id: card.card_id || card.cardId || card.id,
    pan: details.card_number || details.cardNumber,
    cvv: details.cvv,
    expiry: details.expiry || card.expiry,
    status: card.status || (details.card_number ? 'ready' : 'pending'),
    card_type: card.card_type || card.cardType,
    amountUsd: card.usd_amount ?? card.balance ?? card.amountUsd,
  });
}

function maskedNumber(last4) {
  const tail = last4 && /^\d{4}$/.test(last4) ? last4 : '••••';
  return `•••• •••• •••• ${tail}`;
}

/**
 * Display model. reveal shows the number and CVV only when this card has them.
 * billing is the one address used for every card.
 */
export function presentLasoCard(card, { reveal = false, billing = null } = {}) {
  const record = card?.pan || card?.card_number ? lasoCardRecord(card) : {
    ...card,
    id: cardId(card?.id),
    pan: null,
    cvv: null,
    status: card?.status || 'pending',
    kind: card?.kind === 'reloadable' ? 'reloadable' : 'prepaid',
  };
  const shared = billing ? billingAddress(billing) : null;
  const last4 = record.pan ? record.pan.slice(-4) : (typeof card?.last4 === 'string' && /^\d{4}$/.test(card.last4) ? card.last4 : null);
  const show = Boolean(reveal && record.pan);
  return {
    id: record.id,
    brand: 'Laso',
    kind: record.kind,
    status: record.status,
    holder: shared?.name || card?.holder || 'Cardholder',
    expiry: show ? (record.expiry || '••/••') : '••/••',
    last4,
    number: show ? groupPan(record.pan) : maskedNumber(last4),
    cvv: show && record.cvv ? record.cvv : '•••',
    revealed: show,
    canReveal: Boolean(record.pan),
    amountUsd: record.amountUsd ?? card?.amountUsd ?? null,
    billing: shared,
  };
}

/** What an agent may see. No number, no CVV. */
export function agentLasoCard(card, billing = null) {
  const face = presentLasoCard(card, { reveal: false, billing });
  return {
    id: face.id,
    brand: face.brand,
    kind: face.kind,
    status: face.status,
    holder: face.holder,
    last4: face.last4,
    amountUsd: face.amountUsd,
    billing: face.billing,
  };
}

export function publicLasoCard(card) {
  if (!card || typeof card !== 'object') return null;
  const id = card.card_id || card.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const face = presentLasoCard({
    id,
    status: ['pending', 'ready', 'open'].includes(card.status) ? card.status : 'pending',
    amountUsd: card.usd_amount ?? card.amountUsd ?? null,
    kind: card.kind === 'reloadable' ? 'reloadable' : 'prepaid',
    last4: card.last4,
  }, { reveal: false });
  const leaked = `${face.number}${face.cvv}`.replace(/\D/g, '');
  if (leaked.length > 4) return null;
  return face;
}

export function cardCanPay(card) {
  const id = card?.id || card?.card_id;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !id.startsWith('laso_');
}

/**
 * Which Laso card the owner wants. Pure text match, no I/O.
 * Returns 'top-up' (add funds to the existing reloadable balance),
 * 'reloadable' (a new reusable card: subscriptions, ads, AI, anything kept on file),
 * 'non-reloadable-usa' (one USA prepaid card for a known one-time total), or
 * 'undecided' when the message does not say. Never guess: undecided must ask.
 */
export function chooseLasoCardKind(message) {
  const text = typeof message === 'string' ? message : '';
  if (/\bgift\s*cards?\b/i.test(text)) return 'gift';
  if (/\b(top up|top-up|add funds|modify the card|fund (?:the|my) card balance|reload the card)\b/i.test(text)) return 'top-up';
  if (/\bnon[\s-]?reloadable\b|\bprepaid\b/i.test(text)) return 'non-reloadable-usa';
  if (/\breloadable\b/i.test(text)) return 'reloadable';
  if (/\btopup\b/i.test(text)) return 'top-up';
  return 'undecided';
}

/** Ask this verbatim when chooseLasoCardKind returns undecided. */
export const LASO_CARD_CHOICE_PROMPT =
  'Reloadable or non-reloadable USA? A reloadable card stays open for repeat charges (subscriptions, ads, AI). '
  + 'A non-reloadable USA card is one prepaid card for a known one-time total at a US merchant. Which one?';

/**
 * Ordered human-gated steps for each card kind, from the Laso docs.
 * Steps the owner must do themselves are marked (owner). The agent
 * never opens claim, KYC, issuer-code, or approval links and never
 * submits identity for the owner. Pure data, no I/O.
 */
export function lasoCardChecklist(kind) {
  if (kind === 'non-reloadable-usa') {
    return [
      'GET /get-card?amount=<exact checkout total> (x402, $5-$1000, no added fee, US merchants and US shipping only).',
      'Poll GET /get-card-data?card_id=... every 2-3 seconds until status is ready (about 7-10 seconds), then read the number, CVV, and expiry.',
      'Spend the exact total. A pending card is not ready yet.',
    ];
  }
  if (kind === 'top-up') {
    return [
      'GET /fund-card-balance?amount=<5-10000> (x402, bridges Solana or Base to the card balance) or POST /fund-card-from-account-balance from the Laso account balance.',
      'Poll GET /list-card-transactions until the top-up is credited, then spend from the reloadable card.',
    ];
  }
  return [
    'Account (owner): the owner opens the claim link themselves and finishes signup. The agent hands the link over and polls status, never opens it.',
    'KYC (owner): check GET /get-kyc-status. When false, hand over GET /get-kyc-link (or POST /submit-verification-share with the partner token) and poll until kyc_verified is true.',
    'Card-issuer link (owner): GET /get-card-issuer-status, then POST /start-card-issuer-link so the issuer sends the owner a one-time code. The owner reads it from their own inbox and types it in; pass it to POST /verify-card-issuer-link with consent_accepted true. Never read their email.',
    'Fund: GET /fund-card-balance?amount=<dollars> (x402, USDC on Solana or Base) or POST /fund-card-from-account-balance. Poll GET /list-card-transactions until the top-up is credited.',
    'Create: POST /create-reloadable-card with usd_amount (min $1). Then GET /get-card-data?card_id=... to read the number and CVV.',
    'Spend: enter the card at the merchant. Billing address is null on reloadable cards, so use the address the owner verified with; a substituted address is declined.',
  ];
}

export function payWithVirtualCard({ card, billing, merchant, amountUsd } = {}) {
  const id = cardId(card?.id || card?.card_id);
  if (!cardCanPay({ id })) fail('card_not_ready');
  const pan = card?.pan || card?.card_number ? parsePan(card.pan || card.card_number) : null;
  const shared = billingAddress(billing);
  const name = clean(merchant, 80);
  if (!name) fail('merchant_required');
  const usd = typeof amountUsd === 'string' ? Number(amountUsd) : Number(amountUsd);
  if (!Number.isFinite(usd) || usd <= 0 || usd > 10000) fail('invalid_amount');
  const cents = Math.round(usd * 100);
  if (cents < 1) fail('invalid_amount');
  return {
    id: `cardpay_${id}_${cents}`,
    cardId: id,
    last4: pan ? pan.slice(-4) : (/^\d{4}$/.test(card?.last4 || '') ? card.last4 : null),
    merchant: name,
    amountUsd: (cents / 100).toFixed(2),
    billing: shared,
    status: 'authorized',
    instrument: 'laso-virtual-card',
  };
}
