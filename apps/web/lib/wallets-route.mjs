/**
 * Pure helpers for apps/web/app/api/wallets/route.js.
 * Kept out of the route module so tests can exercise Origin selection,
 * public wallet shaping, and error field sanitization without Next runtime.
 */
import { sanitizeOrigin } from '@ubc2026/wallets/privy';

export function requestOrigin(request) {
  const fromOrigin = sanitizeOrigin(request.headers.get('origin'));
  if (fromOrigin) return fromOrigin;
  const referer = request.headers.get('referer');
  if (typeof referer === 'string' && referer.trim()) {
    try { return sanitizeOrigin(new URL(referer.trim()).origin); } catch { /* ignore */ }
  }
  return 'http://localhost:3000';
}

export function publicWallet(wallet) {
  return {
    id: wallet.id,
    ownerId: wallet.ownerId,
    kind: wallet.kind,
    label: wallet.label,
    address: wallet.address,
    frozen: wallet.frozen,
    provider: wallet.provider,
    spendable: wallet.spendable !== false && !String(wallet.id).startsWith('linked_'),
    walletClientType: wallet.walletClientType || null,
  };
}

/** Prefer duck-typing — `instanceof` fails when the wallets package is duplicated. */
export function walletErrorFields(error) {
  if (!error || typeof error !== 'object') return null;
  if (error.name !== 'WalletError' && error.constructor?.name !== 'WalletError') return null;
  const code = typeof error.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : 'wallet_failed';
  const detail = typeof error.message === 'string'
    ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 180)
    : undefined;
  return { code, detail };
}

/** Status codes the wallets POST route returns for known WalletError codes. */
export function walletErrorStatus(code) {
  if (code === 'missing_config' || code === 'invalid_rpc' || code === 'missing_origin') return 503;
  if (code === 'worker_origin_forbidden') return 502;
  return 502;
}
