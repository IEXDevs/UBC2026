export const runtime = 'nodejs';

import { readRootEnv } from '../../../../lib/root-env.mjs';
import { retireTarget } from '../../../../lib/wallet-retire.mjs';

/**
 * Marks an additional wallet deleted. The row stays.
 * Main wallets are not matched (`kind=eq.additional`).
 */
export async function POST(request) {
  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const ownerHeader = request.headers.get('x-owner-id');
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const target = retireTarget({
    id: body?.id,
    ownerId: typeof ownerHeader === 'string' ? ownerHeader : '',
  });
  if (target.error) {
    const status = target.error === 'owner_required' ? 401 : 400;
    return Response.json({ error: target.error }, { status, headers: { 'Cache-Control': 'no-store' } });
  }

  const url = readRootEnv('SUPABASE_URL');
  const key = readRootEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    return Response.json({ error: 'unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  let origin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return Response.json({ error: 'unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    origin = parsed.origin;
  } catch {
    return Response.json({ error: 'unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const deletedAt = new Date().toISOString();
  const path = `wallets?id=eq.${encodeURIComponent(target.id)}&owner_id=eq.${encodeURIComponent(target.ownerId)}&kind=eq.additional`;
  let response;
  try {
    response = await fetch(`${origin}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ deleted_at: deletedAt }),
      redirect: 'manual',
    });
  } catch {
    return Response.json({ error: 'retire_failed' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const rows = await response.json().catch(() => null);
  if (!response.ok) {
    return Response.json({ error: 'retire_failed' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!Array.isArray(rows) || rows.length < 1) {
    return Response.json({ error: 'wallet_missing' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ ok: true, id: target.id, deletedAt }, { headers: { 'Cache-Control': 'no-store' } });
}
