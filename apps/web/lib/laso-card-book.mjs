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
  const next = [face, ...readLasoCards(storage, ownerId).filter(item => item.id !== face.id)].slice(0, 8);
  storage.setItem(id, JSON.stringify(next.map(item => ({
    id: item.id,
    kind: item.kind,
    status: item.status,
    last4: item.last4,
    amountUsd: item.amountUsd,
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
