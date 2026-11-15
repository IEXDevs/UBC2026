/**
 * Profile directory writes for the claim screen when the agent runtime URL is unset.
 * The service role stays on the server. Callers never receive it.
 */
import { httpsAvatarUrl, normalizeDisplayName, normalizeHandle } from '@ubc2026/contracts';

const OWNER = /^[a-zA-Z0-9:_-]{1,128}$/;

function json(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function supabaseOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function headers(key, prefer) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: 'application/json',
    'content-type': 'application/json',
    prefer,
  };
}

async function rest(fetcher, origin, key, path, options = {}) {
  const method = options.method || 'GET';
  const prefer = options.prefer || (method === 'GET' ? 'return=representation' : 'return=minimal');
  return fetcher(`${origin}/rest/v1/${path}`, {
    method,
    headers: headers(key, prefer),
    body: options.body == null ? undefined : JSON.stringify(options.body),
    redirect: 'error',
  });
}

export async function localProfileResponse(request, { env = {}, fetcher = fetch } = {}) {
  const ownerId = (request.headers.get('x-owner-id') || '').trim();
  if (!OWNER.test(ownerId)) return json({ error: 'owner_required' }, 401);
  const origin = supabaseOrigin(env.SUPABASE_URL);
  const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (!origin || !key) return json({ ok: false, error: 'directory_unconfigured', source: 'unconfigured' }, 503);

  if (request.method === 'GET') {
    let response;
    try {
      response = await rest(
        fetcher,
        origin,
        key,
        `profiles?owner_id=eq.${encodeURIComponent(ownerId)}&select=handle,display_name,avatar_url`,
      );
    } catch {
      return json({ error: 'profile_read_failed' }, 502);
    }
    if (!response.ok) return json({ error: 'profile_read_failed' }, 502);
    const rows = await response.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    return json({
      ok: true,
      source: 'supabase',
      profile: row ? {
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: row.avatar_url || null,
      } : null,
    });
  }

  if (request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405);
  const body = await request.json().catch(() => ({}));
  const handle = normalizeHandle(body.handle);
  const displayName = normalizeDisplayName(body.displayName);
  const avatarUrl = body.avatarUrl == null || body.avatarUrl === '' ? null : httpsAvatarUrl(body.avatarUrl);
  if (!handle || !displayName) return json({ error: 'invalid_profile' }, 400);
  if (body.avatarUrl && !avatarUrl) return json({ error: 'invalid_avatar' }, 400);

  try {
    const userWrite = await rest(fetcher, origin, key, 'users?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { id: ownerId, privy_user_id: ownerId },
    });
    if (!userWrite.ok) return json({ error: 'profile_save_failed' }, 502);
    const saved = await rest(fetcher, origin, key, 'profiles?on_conflict=owner_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: {
        owner_id: ownerId,
        handle,
        display_name: displayName,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      },
    });
    if (saved.status === 409) return json({ error: 'handle_taken' }, 409);
    if (!saved.ok) return json({ error: 'profile_save_failed' }, 502);
  } catch {
    return json({ error: 'profile_save_failed' }, 502);
  }
  return json({
    ok: true,
    source: 'supabase',
    profile: { handle, displayName, avatarUrl },
  });
}
