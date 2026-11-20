/**
 * Account-scoped desk state and the single seed vault per account.
 *
 * State rows replace browser-only storage so a second browser sees the same
 * desk. The seed phrase is never a row. While a seed is unconfirmed the row
 * holds a vault the browser encrypted with the onboarding password. Once the
 * owner types the phrase back, the vault is deleted and only a PBKDF2 verifier
 * remains. A second seed is never issued for an account.
 */
import { supabaseConfig, supabaseGet, supabaseWrite } from './supabase-rest.mjs';

export const STATE_NAMES = Object.freeze([
  'roster',
  'looks',
  'talks',
  'tokens',
  'permission',
  'reviewCap',
  'acceptance',
  'voiceTime',
  'voiceSettings',
  'accountCode',
]);

// The same-origin proxy refuses bodies over 1,000,000 bytes, so a value stays below that.
export const STATE_VALUE_MAX = 900_000;
const STATE_BATCH_MAX = 12;
const ACCOUNT_CODE = /^[0-9]{16}$/;
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_24 = /^[0-9a-f]{24}$/;
const HEX_CT = /^(?:[0-9a-f]{2}){24,256}$/;
const SECRET_NAMES = /^(privatekey|privkey|secretkey|seed|seedphrase|mnemonic|mnemonicphrase|authorizationkey|password|passphrase|apikey|accesstoken|refreshtoken|servicerole|servicerolekey|authorization|cookie|viewerurl|liveviewurl|words|phrase)$/;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function hasSecretKey(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return false;
  if (Array.isArray(value)) return value.some(item => hasSecretKey(item, depth + 1));
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_NAMES.test(key.replace(/[^A-Za-z0-9]/g, '').toLowerCase())) return true;
    if (hasSecretKey(child, depth + 1)) return true;
  }
  return false;
}

/** One state item. Null value deletes the row. Returns null when it is not allowed. */
export function parseStateItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (typeof item.name !== 'string' || !STATE_NAMES.includes(item.name)) return null;
  if (item.value === null) return { name: item.name, value: null };
  if (typeof item.value !== 'string' || item.value.length > STATE_VALUE_MAX) return null;
  if (item.name === 'accountCode' && !ACCOUNT_CODE.test(item.value)) return null;
  const first = item.value.trimStart()[0];
  if (first === '{' || first === '[') {
    let parsed = null;
    try { parsed = JSON.parse(item.value); } catch { return null; }
    if (hasSecretKey(parsed)) return null;
  }
  return { name: item.name, value: item.value };
}

export function parseStateBatch(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) return null;
  if (body.items.length === 0 || body.items.length > STATE_BATCH_MAX) return null;
  const seen = new Set();
  const items = [];
  for (const raw of body.items) {
    const item = parseStateItem(raw);
    if (!item || seen.has(item.name)) return null;
    seen.add(item.name);
    items.push(item);
  }
  return items;
}

function hexText(value, pattern) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return pattern.test(text) ? text : null;
}

function iterations(value) {
  return Number.isSafeInteger(value) && value >= 10000 && value <= 2000000 ? value : null;
}

/** The vault is ciphertext only: salt, iv, ct, iteration count. A phrase field is refused. */
export function parseRecoveryVault(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'ct,iterations,iv,salt,v') return null;
  if (value.v !== 1) return null;
  const count = iterations(value.iterations);
  const salt = hexText(value.salt, HEX_32);
  const iv = hexText(value.iv, HEX_24);
  const ct = hexText(value.ct, HEX_CT);
  if (count == null || !salt || !iv || !ct) return null;
  return { v: 1, iterations: count, salt, iv, ct };
}

export function parseRecoveryVerifier(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'hash,iterations,salt') return null;
  const count = iterations(value.iterations);
  const salt = hexText(value.salt, HEX_32);
  const hash = hexText(value.hash, HEX_64);
  if (count == null || !salt || !hash) return null;
  return { iterations: count, salt, hash };
}

export function parseRecoveryIssue(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const vault = parseRecoveryVault(body.vault);
  const verifier = parseRecoveryVerifier(body.verifier);
  if (!vault || !verifier) return null;
  return { vault, verifier };
}

function sameText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function storageError(read) {
  if (read.code === 'PGRST205' || read.code === '42P01' || read.code === '42703') {
    return 'account_state_schema_missing';
  }
  if (read.status === 401 || read.status === 403) return 'account_state_access_failed';
  return 'account_state_unavailable';
}

async function ensureUser(env, ownerId, fetcher) {
  const written = await supabaseWrite(env, {
    path: 'users?on_conflict=id',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: ownerId, privy_user_id: ownerId },
    fetcher,
  });
  return written?.ok === true;
}

async function readRecoveryRow(env, ownerId, fetcher) {
  const read = await supabaseGet(
    env,
    `owner_recovery?owner_id=eq.${encodeURIComponent(ownerId)}&select=status,vault,verifier_salt,verifier_hash,verifier_iterations`,
    fetcher,
  );
  if (read.status !== 200 || !Array.isArray(read.rows)) return { error: storageError(read) };
  return { row: read.rows[0] ?? null };
}

function recoveryView(row) {
  if (!row) return { state: 'none' };
  const view = {
    state: row.status === 'confirmed' ? 'confirmed' : 'issued',
    verifier: { salt: row.verifier_salt, iterations: row.verifier_iterations },
  };
  if (view.state === 'issued') view.vault = row.vault;
  return view;
}

/** Handles state.* and recovery.* once the caller has resolved the owner. */
export async function handleAccountRoute(routeId, request, env, ownerId, fetcher = fetch) {
  if (!supabaseConfig(env)) {
    if (request.method === 'GET') return json({ ok: true, source: 'unconfigured', items: [], state: 'none' });
    return json({ error: 'unconfigured' }, 503);
  }

  if (routeId === 'state.list') {
    const owner = encodeURIComponent(ownerId);
    const [read, deletions] = await Promise.all([
      supabaseGet(env, `owner_state?owner_id=eq.${owner}&select=name,value,updated_at`, fetcher),
      supabaseGet(env, `rpc/list_deleted_owner_agents?p_owner_id=${owner}`, fetcher),
    ]);
    if (read.status !== 200 || !Array.isArray(read.rows)) return json({ error: storageError(read) }, 503);
    const deletedAgentIds = deletions.rows?.[0]?.ids;
    const migrationMissing = deletions.status === 404 && deletions.code === 'PGRST202';
    if (!migrationMissing && !Array.isArray(deletedAgentIds)) {
      return json({ error: storageError(deletions) }, 503);
    }
    const items = read.rows
      .filter(row => row && STATE_NAMES.includes(row.name) && typeof row.value === 'string')
      .map(row => ({ name: row.name, value: row.value, updatedAt: row.updated_at ?? null }));
    return json({ ok: true, source: 'supabase', items, deletedAgentIds: deletedAgentIds ?? [] });
  }

  if (routeId === 'state.write') {
    const body = await request.json().catch(() => null);
    const items = parseStateBatch(body);
    if (!items) return json({ error: 'invalid_state' }, 400);
    if (!(await ensureUser(env, ownerId, fetcher))) return json({ error: 'state_failed' }, 502);
    const saved = [];
    const rows = [];
    for (const item of items) {
      if (item.value === null) {
        const removed = await supabaseWrite(env, {
          path: `owner_state?owner_id=eq.${encodeURIComponent(ownerId)}&name=eq.${encodeURIComponent(item.name)}`,
          method: 'DELETE',
          prefer: 'return=minimal',
          fetcher,
        });
        if (removed?.ok !== true) return json({ error: 'state_failed' }, 502);
        saved.push(item.name);
        continue;
      }
      rows.push({ owner_id: ownerId, name: item.name, value: item.value, updated_at: new Date().toISOString() });
    }
    // The account id is written once. A file already bound to it must stay readable.
    const once = rows.filter(row => row.name === 'accountCode');
    const plain = rows.filter(row => row.name !== 'accountCode');
    if (plain.length > 0) {
      const upserted = await supabaseWrite(env, {
        path: 'owner_state?on_conflict=owner_id,name',
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: plain,
        fetcher,
      });
      if (upserted?.ok !== true) return json({ error: 'state_failed' }, 502);
      saved.push(...plain.map(row => row.name));
    }
    if (once.length > 0) {
      const first = await supabaseWrite(env, {
        path: 'owner_state?on_conflict=owner_id,name',
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=minimal',
        body: once,
        fetcher,
      });
      if (first?.ok !== true) return json({ error: 'state_failed' }, 502);
      saved.push('accountCode');
    }
    return json({ ok: true, saved });
  }

  if (routeId === 'recovery.status') {
    const result = await readRecoveryRow(env, ownerId, fetcher);
    if (result.error) return json({ error: result.error }, 503);
    return json({ ok: true, source: 'supabase', ...recoveryView(result.row) });
  }

  if (routeId === 'recovery.issue') {
    const body = await request.json().catch(() => null);
    const issue = parseRecoveryIssue(body);
    if (!issue) return json({ error: 'invalid_recovery' }, 400);
    const existing = await readRecoveryRow(env, ownerId, fetcher);
    if (existing.error) return json({ error: existing.error }, 503);
    if (existing.row) return json({ error: 'recovery_exists', ...recoveryView(existing.row) }, 409);
    if (!(await ensureUser(env, ownerId, fetcher))) return json({ error: 'recovery_failed' }, 502);
    const written = await supabaseWrite(env, {
      path: 'owner_recovery',
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        owner_id: ownerId,
        status: 'issued',
        vault: issue.vault,
        verifier_salt: issue.verifier.salt,
        verifier_hash: issue.verifier.hash,
        verifier_iterations: issue.verifier.iterations,
      },
      fetcher,
    });
    if (written?.status === 409) {
      const raced = await readRecoveryRow(env, ownerId, fetcher);
      if (raced.error) return json({ error: raced.error }, 503);
      return json({ error: 'recovery_exists', ...recoveryView(raced.row) }, 409);
    }
    if (written?.ok !== true) return json({ error: 'recovery_failed' }, 502);
    return json({ ok: true, state: 'issued' });
  }

  if (routeId === 'recovery.verify') {
    const body = await request.json().catch(() => null);
    const proof = body && typeof body === 'object' ? hexText(body.proof, HEX_64) : null;
    if (!proof) return json({ error: 'invalid_recovery' }, 400);
    const result = await readRecoveryRow(env, ownerId, fetcher);
    if (result.error) return json({ error: result.error }, 503);
    if (!result.row) return json({ error: 'recovery_missing' }, 404);
    if (!sameText(proof, result.row.verifier_hash)) return json({ error: 'recovery_mismatch' }, 401);
    if (body.confirm === true && result.row.status !== 'confirmed') {
      const confirmed = await supabaseWrite(env, {
        path: `owner_recovery?owner_id=eq.${encodeURIComponent(ownerId)}&status=eq.issued`,
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'confirmed', vault: null, confirmed_at: new Date().toISOString() },
        fetcher,
      });
      if (confirmed?.ok !== true) return json({ error: 'recovery_failed' }, 502);
      return json({ ok: true, state: 'confirmed' });
    }
    return json({ ok: true, state: result.row.status === 'confirmed' ? 'confirmed' : 'issued' });
  }

  return null;
}
