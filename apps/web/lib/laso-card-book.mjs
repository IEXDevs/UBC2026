/**
 * Owner-only Laso card book. Numbers and CVVs are never stored.
 */
import { billingAddress, presentLasoCard, publicLasoCard } from '@ubc2026/shopping/laso-card.mjs';

export const LASO_CARDS_EVENT = 'maelstrom-laso-cards';
const CLAIM = /^https:\/\/laso\.finance\/agent\/dashboard\/auth\?/;

function key(ownerId, name) {
  return typeof ownerId === 'string' && ownerId ? `maelstrom.laso.${name}.${ownerId}` : '';
}

function notify(ownerId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LASO_CARDS_EVENT, { detail: { ownerId } }));
}

function readJson(storage, id) {
  if (!storage || !id) return null;
  try {
    const raw = storage.getItem(id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function readLasoBilling(storage, ownerId) {
  const saved = readJson(storage, key(ownerId, 'billing'));
  try {
    return saved ? billingAddress(saved) : null;
  } catch {
    return null;
  }
}

export function writeLasoBilling(storage, ownerId, billing) {
  const id = key(ownerId, 'billing');
  if (!storage || !id) return null;
  const shared = billingAddress(billing);
  storage.setItem(id, JSON.stringify(shared));
  notify(ownerId);
  return shared;
}

export function readLasoCards(storage, ownerId) {
  const saved = readJson(storage, key(ownerId, 'cards'));
  if (!Array.isArray(saved)) return [];
  return saved.map(publicLasoCard).filter(Boolean);
}

export function rememberLasoCard(storage, ownerId, card) {
  const id = key(ownerId, 'cards');
  const face = publicLasoCard(card);
  if (!storage || !id || !face) return readLasoCards(storage, ownerId);
  const prev = readLasoCards(storage, ownerId).find(item => item.id === face.id);
  // Chat-supplied cards (model path) must never inject transactions or timestamps.
  // Only rememberLasoTransactions (live /laso/status API) writes those.
  const merged = {
    ...face,
    label: typeof card?.label === 'string' && card.label.trim() ? card.label.trim().slice(0, 40) : (prev?.label || face.label || null),
    transactions: prev?.transactions || [],
    updatedAt: prev?.updatedAt || null,
    expiry: face.expiry && face.expiry !== 'XX/XX' ? face.expiry : (prev?.expiry || null),
  };
  const next = [merged, ...readLasoCards(storage, ownerId).filter(item => item.id !== face.id)].slice(0, 8);
  storage.setItem(id, JSON.stringify(next.map(item => ({
    id: item.id,
    kind: item.kind,
    status: item.status,
    last4: item.last4,
    amountUsd: item.amountUsd,
    label: item.label || null,
    transactions: item.transactions || [],
    updatedAt: item.updatedAt || null,
    expiry: item.expiry || null,
  }))));
  notify(ownerId);
  return next;
}

export function setLasoLabel(storage, ownerId, cardId, label) {
  const id = key(ownerId, 'cards');
  if (!storage || !id) return readLasoCards(storage, ownerId);
  const clean = typeof label === 'string' && label.trim() ? label.trim().slice(0, 40) : null;
  const next = readLasoCards(storage, ownerId).map(item => (
    item.id === cardId ? { ...item, label: clean } : item
  ));
  storage.setItem(id, JSON.stringify(next.map(item => ({
    id: item.id,
    kind: item.kind,
    status: item.status,
    last4: item.last4,
    amountUsd: item.amountUsd,
    label: item.label || null,
    transactions: item.transactions || [],
    updatedAt: item.updatedAt || null,
    expiry: item.expiry || null,
  }))));
  notify(ownerId);
  return next;
}

export function rememberLasoTransactions(storage, ownerId, cardId, { transactions = [], updatedAt = null, status = null, amountUsd = null, expiry = null, last4 = null } = {}) {
  const id = key(ownerId, 'cards');
  if (!storage || !id) return readLasoCards(storage, ownerId);
  const next = readLasoCards(storage, ownerId).map(item => (
    item.id === cardId ? {
      ...item,
      transactions: Array.isArray(transactions) ? transactions.slice(0, 25) : (item.transactions || []),
      updatedAt: Number.isSafeInteger(updatedAt) ? updatedAt : Date.now(),
      ...(status ? { status } : {}),
      ...(amountUsd != null ? { amountUsd } : {}),
      ...(typeof expiry === 'string' && expiry ? { expiry } : {}),
      ...(typeof last4 === 'string' && /^\d{4}$/.test(last4) ? { last4 } : {}),
    } : item
  ));
  storage.setItem(id, JSON.stringify(next.map(item => ({
    id: item.id,
    kind: item.kind,
    status: item.status,
    last4: item.last4,
    amountUsd: item.amountUsd,
    label: item.label || null,
    transactions: item.transactions || [],
    updatedAt: item.updatedAt || null,
  }))));
  notify(ownerId);
  return next;
}

export function readLasoClaim(storage, ownerId) {
  const saved = readJson(storage, key(ownerId, 'claim'));
  return typeof saved === 'string' && CLAIM.test(saved) ? saved : '';
}

export function writeLasoClaim(storage, ownerId, url) {
  const id = key(ownerId, 'claim');
  if (!storage || !id || !CLAIM.test(url || '')) return '';
  storage.setItem(id, JSON.stringify(url));
  notify(ownerId);
  return url;
}

export function clearLasoClaim(storage, ownerId) {
  const id = key(ownerId, 'claim');
  if (!storage || !id) return;
  storage.removeItem(id);
  notify(ownerId);
}

export function stampBilling(card, billing) {
  return presentLasoCard(card, { reveal: false, billing: billing || null });
}
