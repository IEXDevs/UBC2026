import { FILE_BYTE_CAP, STORAGE_CAP_WARNING } from './file-quota.mjs';

export const STORAGE_UPLOAD_TOO_BIG = 'That file is larger than 512 MB, so it was not saved.';
export const STORAGE_POOL_FULL = 'File storage is full. This file was not saved.';
export const STORAGE_SAVE_FAILED = 'That file did not save.';
export const STORAGE_NOT_READY = 'File storage is not ready, so this file stays on this device.';

export function applyStoredFile(library, localId, saved) {
  const removed = new Set(Array.isArray(saved?.removed) ? saved.removed : []);
  const next = {};
  for (const [botId, files] of Object.entries(library || {})) {
    const rows = [];
    for (const file of files) {
      if (file?.ref && removed.has(file.ref)) continue;
      if (file?.id === localId && saved?.secret) {
        rows.push({ ...file, id: saved.secret, ref: saved.ref, addedAt: saved.addedAt || file.addedAt });
      } else {
        rows.push(file);
      }
    }
    if (rows.length > 0) next[botId] = rows;
  }
  return next;
}

export function uploadNotice(saved) {
  if (!saved) return '';
  if (saved.ok && Array.isArray(saved.removed) && saved.removed.length > 0) return STORAGE_CAP_WARNING;
  if (saved.ok) return '';
  if (saved.error === 'file_too_large') return STORAGE_UPLOAD_TOO_BIG;
  if (saved.error === 'storage_full') return STORAGE_POOL_FULL;
  if (saved.error === 'drive_not_configured') return STORAGE_NOT_READY;
  return STORAGE_SAVE_FAILED;
}

export async function storeAttachedFile({ fetcher = fetch, ownerId, token, item } = {}) {
  const blob = item?.blob;
  const canRead = blob instanceof Blob || (blob && typeof blob.arrayBuffer === 'function');
  if (!ownerId || !token || !canRead) return null;
  if (Number(item.size) > FILE_BYTE_CAP) return { ok: false, error: 'file_too_large' };
  const body = new FormData();
  body.append('file', item.blob, item.name || 'file');
  const response = await fetcher('/api/files', {
    method: 'POST',
    headers: {
      'x-owner-id': ownerId,
      authorization: `Bearer ${token}`,
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.secret !== 'string' || !/^[0-9a-z]{128}$/.test(data.secret)) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : 'upload_failed' };
  }
  return {
    ok: true,
    secret: data.secret,
    ref: data.ref,
    removed: Array.isArray(data.removed) ? data.removed : [],
    addedAt: data.addedAt,
  };
}
