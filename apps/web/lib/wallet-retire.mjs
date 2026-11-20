/**
 * Additional wallets can leave the desk without deleting the Supabase row.
 * `deleted_at` stays on the row. The browser remembers ids the server accepted
 * so a list that has not caught up yet does not put the wallet back.
 */

const ID = /^[a-zA-Z0-9:_-]{1,128}$/;

export function retiredWalletKey(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.trim().length > 128) return '';
  return `maelstrom.wallet.retired.${ownerId.trim()}`;
}

export function retireTarget({ id, ownerId } = {}) {
  const walletId = typeof id === 'string' ? id.trim() : '';
  const owner = typeof ownerId === 'string' ? ownerId.trim() : '';
  if (!ID.test(walletId)) return { error: 'invalid_wallet' };
  if (!owner || owner.length > 128) return { error: 'owner_required' };
  return { id: walletId, ownerId: owner };
}

export function readRetiredWalletIds(storage, ownerId) {
  const key = retiredWalletKey(ownerId);
  if (!key || !storage || typeof storage.getItem !== 'function') return [];
  try {
    const raw = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => typeof item === 'string' && ID.test(item));
  } catch {
    return [];
  }
}

export function rememberRetiredWallet(storage, ownerId, id) {
  const key = retiredWalletKey(ownerId);
  if (!key || !storage || typeof storage.setItem !== 'function' || !ID.test(id)) return readRetiredWalletIds(storage, ownerId);
  const next = [...new Set([...readRetiredWalletIds(storage, ownerId), id])];
  storage.setItem(key, JSON.stringify(next));
  return next;
}

export function withoutRetiredWallets(wallets, ids) {
  const gone = new Set(Array.isArray(ids) ? ids : []);
  return (Array.isArray(wallets) ? wallets : []).filter(wallet => (
    wallet
    && typeof wallet.id === 'string'
    && !gone.has(wallet.id)
    && !wallet.deletedAt
    && !wallet.deleted_at
  ));
}
