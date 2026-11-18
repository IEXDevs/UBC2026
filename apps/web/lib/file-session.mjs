/**
 * Session-only file bytes for preview. Catalog persistence strips blob URLs;
 * this map keeps Object URLs alive until reload so text/pdf previews still work
 * after the catalog is written to localStorage.
 */
const sessions = new Map();

export function rememberSessionFile(id, blob) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) return '';
  const canRead = typeof Blob !== 'undefined' && blob instanceof Blob;
  if (!canRead || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
  const prior = sessions.get(key);
  if (prior?.url) {
    try { URL.revokeObjectURL(prior.url); } catch { /* ignore */ }
  }
  const url = URL.createObjectURL(blob);
  sessions.set(key, { url, blob });
  return url;
}

export function sessionPreviewUrl(id) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) return '';
  const row = sessions.get(key);
  return typeof row?.url === 'string' ? row.url : '';
}

export function sessionBlob(id) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) return null;
  return sessions.get(key)?.blob || null;
}

export function moveSessionFile(fromId, toId) {
  const from = typeof fromId === 'string' ? fromId.trim() : '';
  const to = typeof toId === 'string' ? toId.trim() : '';
  if (!from || !to || from === to) return;
  const row = sessions.get(from);
  if (!row) return;
  sessions.delete(from);
  const prior = sessions.get(to);
  if (prior?.url && prior.url !== row.url) {
    try { URL.revokeObjectURL(prior.url); } catch { /* ignore */ }
  }
  sessions.set(to, row);
}

export function forgetSessionFile(id) {
  const key = typeof id === 'string' ? id.trim() : '';
  if (!key) return;
  const row = sessions.get(key);
  sessions.delete(key);
  if (row?.url) {
    try { URL.revokeObjectURL(row.url); } catch { /* ignore */ }
  }
}

export function clearSessionFiles() {
  for (const row of sessions.values()) {
    if (row?.url) {
      try { URL.revokeObjectURL(row.url); } catch { /* ignore */ }
    }
  }
  sessions.clear();
}

export function fileAvailability({ id = '', url = '', remoteStatus = '' } = {}) {
  const view = typeof url === 'string' ? url.trim() : '';
  if (view) return { state: 'ready', message: '' };
  if (remoteStatus === 'loading') {
    return { state: 'loading', message: 'Opening this file.' };
  }
  if (remoteStatus === 'gone') {
    return { state: 'gone', message: 'This file is no longer in storage. Remove it from the catalog or attach a new copy.' };
  }
  if (remoteStatus === 'error') {
    return { state: 'error', message: 'Could not load this file. Check your connection and try again.' };
  }
  const secret = typeof id === 'string' && /^[0-9a-z]{128}$/.test(id.trim());
  if (secret && remoteStatus === '') {
    return { state: 'loading', message: 'Opening this file.' };
  }
  return {
    state: 'device_local',
    message: 'This file stayed on this device and is not available after a reload. Attach it again to preview it here.',
  };
}
