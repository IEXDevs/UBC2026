/**
 * Owner file rows in Postgres. The raw file id is not stored.
 * Missing Supabase config is a no-op so tests stay offline.
 */
const OWNER = /^[a-zA-Z0-9:_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;

function originOf(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function configured(env) {
  const origin = originOf(env?.SUPABASE_URL);
  const key = typeof env?.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (!origin || !key) return null;
  return { origin, key };
}

async function rest(fetcher, { origin, key }, path, options = {}) {
  const method = options.method || 'GET';
  const response = await fetcher(`${origin}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'content-type': 'application/json',
      prefer: options.prefer || 'return=minimal',
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  return response;
}

export async function rememberOwnerFile({ env, fetcher = fetch, ownerId, accountCode, secretHash, name, type, size, addedAt } = {}) {
  const ready = configured(env);
  if (!ready) return { ok: true, skipped: true };
  if (!OWNER.test(ownerId) || !HASH.test(secretHash)) return { ok: false, error: 'record_invalid' };
  try {
    const userWrite = await rest(fetcher, ready, 'users?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { id: ownerId, privy_user_id: ownerId },
    });
    if (!userWrite.ok) return { ok: false, error: 'record_failed' };
    const saved = await rest(fetcher, ready, 'owner_files?on_conflict=secret_hash', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        secret_hash: secretHash,
        owner_id: ownerId,
        account_code: accountCode,
        name: String(name || 'file').slice(0, 180),
        mime_type: String(type || 'application/octet-stream').slice(0, 120),
        size_bytes: size,
        added_at: new Date(addedAt || Date.now()).toISOString(),
      },
    });
    if (!saved.ok) return { ok: false, error: 'record_failed' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'record_unreachable' };
  }
}

export async function forgetOwnerFile({ env, fetcher = fetch, ownerId, secretHash } = {}) {
  const ready = configured(env);
  if (!ready) return { ok: true, skipped: true };
  if (!OWNER.test(ownerId) || !HASH.test(secretHash)) return { ok: false, error: 'record_invalid' };
  try {
    const removed = await rest(
      fetcher,
      ready,
      `owner_files?secret_hash=eq.${secretHash}&owner_id=eq.${encodeURIComponent(ownerId)}`,
      { method: 'DELETE' },
    );
    if (!removed.ok) return { ok: false, error: 'record_failed' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'record_unreachable' };
  }
}

export async function clearOwnerFiles({ env, fetcher = fetch } = {}) {
  const ready = configured(env);
  if (!ready) return { ok: true, skipped: true };
  try {
    const removed = await rest(fetcher, ready, 'owner_files?secret_hash=not.is.null', { method: 'DELETE' });
    if (!removed.ok) return { ok: false, error: 'record_failed' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'record_unreachable' };
  }
}
