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
 * setup follows GET /get-card. modify follows GET /fund-card-balance.
 * Both are unpaid until the owner signs the x402 challenge.
 */
export function lasoCardAction(action, amountUsd) {
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
  fail('invalid_action');
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
