/**
 * Build owner headers for same-origin /api/runtime calls.
 * When Privy secrets are bound on agent-runtime, Bearer is required
 * (x-owner-id alone returns login_required).
 */

export async function ownerAuthHeaders(ownerId, getAccessToken, extra = {}) {
  const headers = { ...extra };
  if (typeof ownerId === 'string' && ownerId.trim()) {
    headers['x-owner-id'] = ownerId.trim();
  }
  if (typeof getAccessToken === 'function') {
    try {
      const token = await getAccessToken();
      if (typeof token === 'string' && token.trim() && token.length < 8000) {
        headers.authorization = `Bearer ${token.trim()}`;
      }
    } catch {
      /* leave Authorization unset — runtime returns login_required */
    }
  }
  return headers;
}
