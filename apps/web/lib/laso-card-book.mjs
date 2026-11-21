/**
 * Owner-only Laso card book. Numbers and CVVs are never stored.
 */
import { billingAddress, presentLasoCard, publicLasoCard } from '@ubc2026/shopping/laso-card.mjs';

function key(ownerId, name) {
  return typeof ownerId === 'string' && ownerId ? `maelstrom.laso.${name}.${ownerId}` : '';
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
  return next;
}

export function stampBilling(card, billing) {
  return presentLasoCard(card, { reveal: false, billing: billing || null });
}
