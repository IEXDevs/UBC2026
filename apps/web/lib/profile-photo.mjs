import { PROFILE_LOOK_KEY, profilePhoto } from '@ubc2026/contracts';
import { ownerAuthHeaders } from './owner-auth-headers.mjs';
import { shellRuntimeUrl } from './runtime-data.mjs';

export { PROFILE_LOOK_KEY, profilePhoto, withProfilePhoto } from '@ubc2026/contracts';

// Send only the photo, never this browser's potentially stale agent appearance.
// An actual server acknowledgement is required; an empty mirror flush isn't one.
export async function saveProfilePhoto({ ownerId, getAccessToken, image, fetchImpl = fetch }) {
  const value = JSON.stringify({ [PROFILE_LOOK_KEY]: { image } });
  if (!ownerId || !profilePhoto(JSON.parse(value))) return false;
  try {
    const response = await fetchImpl(shellRuntimeUrl('/api/state'), {
      method: 'POST',
      headers: await ownerAuthHeaders(ownerId, getAccessToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ items: [{ name: 'looks', value, profilePhoto: true }] }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok && body.ok === true && body.saved?.includes('looks') === true;
  } catch { return false; }
}
