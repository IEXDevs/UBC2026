import { privyJwksUrl, verifyPrivyAccessToken } from '@ubc2026/wallets/privy-access-token';

export const testOwnerAuth = Symbol('testOwnerAuth');
const verifiedOwners = new WeakMap();

export function requestOwner(request) {
  return verifiedOwners.get(request) ?? null;
}

export async function resolveOwner(request, env) {
  const header = request.headers.get('x-owner-id');
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]{1,8192})$/i)?.[1] || '';
  if (!env.PRIVY_APP_ID && typeof env[testOwnerAuth] === 'function') {
    const ownerId = env[testOwnerAuth](header);
    if (ownerId) verifiedOwners.set(request, ownerId);
    return ownerId ? { ownerId, token } : { error: 'owner_required' };
  }
  if (!token) return { error: 'login_required' };
  const appId = env.PRIVY_APP_ID?.trim();
  if (!privyJwksUrl(appId)) return { error: 'owner_auth_unconfigured' };
  try {
    const { sub } = await verifyPrivyAccessToken(token, { appId, fetcher: env.fetch ?? fetch });
    if (header !== null && header !== sub) return { error: 'owner_mismatch' };
    verifiedOwners.set(request, sub);
    return { ownerId: sub, token };
  } catch {
    return { error: 'login_required' };
  }
}

export function ownerAuthStatus(error) {
  if (error === 'owner_auth_unconfigured') return 503;
  if (error === 'owner_mismatch') return 403;
  return 401;
}
