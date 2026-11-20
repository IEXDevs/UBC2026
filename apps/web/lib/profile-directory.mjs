/**
 * Profile directory writes for the claim screen when the agent runtime URL is unset.
 * The service role stays on the server. Callers never receive it.
 */
import {
  directoryFailureCode,
  httpsAvatarUrl,
  lookupHandleFilter,
  normalizeDisplayName,
  normalizeHandle,
  parseLookupQuery,
  postgrestEq,
  publicDisplayName,
} from '@ubc2026/contracts';

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
    redirect: 'follow',
  });
}

async function failureCode(response) {
  try {
    return directoryFailureCode(response.status, await response.json());
  } catch {
    return directoryFailureCode(response.status, null);
  }
}

export function useLocalProfileDirectory(env = {}) {
  return Boolean(supabaseOrigin(env.SUPABASE_URL)
    && typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string'
    && env.SUPABASE_SERVICE_ROLE_KEY.trim());
}

/** True when another owner already stored this handle. The caller's own row is free. */
export async function localHandleLookup(request, { env = {}, fetcher = fetch } = {}) {
  const ownerId = (request.headers.get('x-owner-id') || '').trim();
  if (!OWNER.test(ownerId)) return json({ error: 'owner_required' }, 401);
  const origin = supabaseOrigin(env.SUPABASE_URL);
  const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (!origin || !key) return json({ ok: false, error: 'directory_unconfigured', source: 'unconfigured' }, 503);
  const parsed = parseLookupQuery(new URL(request.url).searchParams.get('q') || '');
  if (parsed?.kind === 'sns') return json({ error: 'invalid_recipient' }, 400);
  const handle = parsed?.kind === 'handle' ? parsed.handle : '';
  if (!handle) return json({ error: 'invalid_recipient' }, 400);
  let response;
  try {
    response = await rest(
      fetcher,
      origin,
      key,
      `profiles?${lookupHandleFilter(handle)}&select=owner_id,handle,display_name,avatar_url&limit=1`,
    );
  } catch {
    return json({ error: 'profile_read_failed' }, 502);
  }
  if (!response.ok) return json({ error: 'profile_read_failed' }, 502);
  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.handle) {
    return json({ ok: true, recipient: { kind: 'handle', handle, missing: true } });
  }
  return json({
    ok: true,
    recipient: {
      kind: 'handle',
      handle: row.handle,
      displayName: publicDisplayName(row.display_name) || `@${row.handle}`,
      avatarUrl: row.avatar_url || null,
      self: row.owner_id === ownerId,
      missing: false,
    },
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
        `profiles?${postgrestEq('owner_id', ownerId)}&select=handle,display_name,avatar_url`,
      );
    } catch {
      return json({ error: 'profile_read_failed' }, 502);
    }
    if (!response.ok) return json({ error: (await failureCode(response)) || 'profile_read_failed' }, 502);
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
  let handle = normalizeHandle(body.handle);
  const editOnly = body.editOnly === true;
  const displayName = normalizeDisplayName(body.displayName);
  const avatarUrl = body.avatarUrl == null || body.avatarUrl === '' ? null : httpsAvatarUrl(body.avatarUrl);
  if (!handle || !displayName) return json({ error: 'invalid_profile' }, 400);
  if (body.avatarUrl && !avatarUrl) return json({ error: 'invalid_avatar' }, 400);

  try {
    if (editOnly) {
      const existing = await rest(fetcher, origin, key, `profiles?${postgrestEq('owner_id', ownerId)}&select=handle`);
      if (!existing.ok) return json({ error: (await failureCode(existing)) || 'profile_read_failed' }, 502);
      const rows = await existing.json().catch(() => []);
      const canonical = Array.isArray(rows) ? rows[0]?.handle : null;
      if (!canonical) return json({ error: 'profile_not_registered' }, 409);
      handle = canonical;
    }
    if (!editOnly) {
      const userWrite = await rest(fetcher, origin, key, 'users?on_conflict=id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { id: ownerId, privy_user_id: ownerId },
      });
      if (!userWrite.ok) return json({ error: (await failureCode(userWrite)) || 'profile_save_failed' }, 502);
    }
    const saved = await rest(fetcher, origin, key, editOnly ? `profiles?${postgrestEq('owner_id', ownerId)}` : 'profiles?on_conflict=owner_id', {
      method: editOnly ? 'PATCH' : 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: {
        ...(!editOnly ? { owner_id: ownerId, handle } : {}),
        display_name: displayName,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      },
    });
    if (saved.status === 409) return json({ error: 'handle_taken' }, 409);
    if (!saved.ok) return json({ error: (await failureCode(saved)) || 'profile_save_failed' }, 502);
    const read = await rest(
      fetcher,
      origin,
      key,
      `profiles?${postgrestEq('owner_id', ownerId)}&select=handle,display_name,avatar_url`,
    );
    if (!read.ok) return json({ error: (await failureCode(read)) || 'profile_save_failed' }, 502);
    const rows = await read.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row?.handle !== handle) return json({ error: 'profile_not_confirmed' }, 502);
  } catch {
    return json({ error: 'profile_directory_unreachable' }, 502);
  }
  return json({
    ok: true,
    source: 'supabase',
    profile: { handle, displayName, avatarUrl },
  });
}
