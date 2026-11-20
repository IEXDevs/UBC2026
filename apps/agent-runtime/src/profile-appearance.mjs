import { PROFILE_LOOK_KEY, profilePhoto } from '@ubc2026/contracts';
import { supabaseGet, supabaseWrite } from './supabase-rest.mjs';

function record(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

// Photo edits touch only the reserved photo entry. Agent edits retain the
// canonical photo. Compare-and-set retries prevent either from replacing a
// newer edit from another browser. No schema change or new storage key needed.
export async function saveAppearance(env, ownerId, item, fetcher) {
  const path = `owner_state?owner_id=eq.${encodeURIComponent(ownerId)}&name=eq.looks`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await supabaseGet(env, `${path}&select=value,updated_at`, fetcher);
    if (read.status !== 200 || !Array.isArray(read.rows)) return false;
    const row = read.rows[0];
    const current = row ? record(row.value) : {};
    const incoming = record(item.value);
    let value = item.value;
    if (item.profilePhoto) {
      if (!current || !profilePhoto(incoming)) return false;
      value = JSON.stringify({ ...current, [PROFILE_LOOK_KEY]: incoming[PROFILE_LOOK_KEY] });
    } else if (incoming) {
      const { [PROFILE_LOOK_KEY]: ignored, ...agents } = incoming;
      value = JSON.stringify(profilePhoto(current) ? { ...agents, [PROFILE_LOOK_KEY]: current[PROFILE_LOOK_KEY] } : agents);
    } else if (profilePhoto(current)) return false;
    if (value.length > 900_000) return false;
    // Strictly increase the version even for two writes in one millisecond.
    const version = row ? Date.parse(row.updated_at) : 0;
    if (!Number.isFinite(version)) return false;
    const updated_at = new Date(Math.max(Date.now(), version + 1)).toISOString();
    const saved = await supabaseWrite(env, row ? {
      path: `${path}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,
      method: 'PATCH', prefer: 'return=representation', body: { value, updated_at }, fetcher,
    } : {
      path: 'owner_state?on_conflict=owner_id,name', method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: { owner_id: ownerId, name: 'looks', value, updated_at }, fetcher,
    });
    if (!saved.ok || !Array.isArray(saved.rows)) return false;
    if (saved.rows.length === 1) return true;
  }
  return false;
}
