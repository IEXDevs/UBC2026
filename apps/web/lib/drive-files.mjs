/**
 * Project Drive folder. Bytes live in Drive. The 128-character id is returned
 * once to the owner. Drive stores only its SHA-256.
 */
import { FILE_BYTE_CAP, PROJECT_STORAGE_CAP, USER_STORAGE_CAP } from './file-quota.mjs';
import { createFileSecret, hashFileSecret, hashOwnerId } from './file-secret.mjs';

const FOLDER_NAME = 'Maelstrom';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export class DriveFilesError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DriveFilesError';
    this.code = code;
  }
}

export function driveEnv(env = {}) {
  const clientId = typeof env.GOOGLE_DRIVE_CLIENT_ID === 'string' ? env.GOOGLE_DRIVE_CLIENT_ID.trim() : '';
  const clientSecret = typeof env.GOOGLE_DRIVE_CLIENT_SECRET === 'string' ? env.GOOGLE_DRIVE_CLIENT_SECRET.trim() : '';
  const refreshToken = typeof env.GOOGLE_DRIVE_REFRESH_TOKEN === 'string' ? env.GOOGLE_DRIVE_REFRESH_TOKEN.trim() : '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function safeName(name) {
  const cleaned = String(name || 'file').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return cleaned || 'file';
}

async function driveJson(fetcher, url, token, init = {}) {
  const response = await fetcher(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body && !(init.body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new DriveFilesError(`drive_${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

async function accessToken(env, fetcher) {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: env.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
    throw new DriveFilesError('drive_auth_failed');
  }
  return data.access_token;
}

async function listFiles(fetcher, token, query) {
  const files = [];
  let pageToken = '';
  do {
    const url = new URL(DRIVE_FILES);
    url.searchParams.set('q', query);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,size,mimeType,createdTime,appProperties)');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('spaces', 'drive');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await driveJson(fetcher, url, token);
    files.push(...(Array.isArray(data.files) ? data.files : []));
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
  } while (pageToken);
  return files;
}

async function ensureFolder(fetcher, token) {
  const query = `mimeType=${quote(FOLDER_TYPE)} and name=${quote(FOLDER_NAME)} and trashed=false`;
  const found = await listFiles(fetcher, token, query);
  if (found[0]?.id) return found[0].id;
  const created = await driveJson(fetcher, DRIVE_FILES, token, {
    method: 'POST',
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_TYPE }),
  });
  if (!created?.id) throw new DriveFilesError('drive_folder_missing');
  return created.id;
}

function stamp(file) {
  const raw = Number(file?.appProperties?.addedAt);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const created = Date.parse(file?.createdTime || '');
  return Number.isFinite(created) ? created : 0;
}

function sizeOf(file) {
  const size = Number(file?.size);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

export function filesToEvict(userFiles, allFiles, incoming, caps = {}) {
  const userCap = caps.userCap ?? USER_STORAGE_CAP;
  const projectCap = caps.projectCap ?? PROJECT_STORAGE_CAP;
  if (incoming > userCap || incoming > projectCap) return { error: 'file_too_large' };
  const ordered = [...userFiles].sort((a, b) => stamp(a) - stamp(b));
  let userUsed = ordered.reduce((sum, file) => sum + sizeOf(file), 0);
  let projectUsed = allFiles.reduce((sum, file) => sum + sizeOf(file), 0);
  const removed = [];
  while (userUsed + incoming > userCap && ordered.length > 0) {
    const oldest = ordered.shift();
    removed.push(oldest);
    userUsed -= sizeOf(oldest);
    projectUsed -= sizeOf(oldest);
  }
  if (userUsed + incoming > userCap) return { error: 'file_too_large' };
  if (projectUsed + incoming > projectCap) return { error: 'storage_full' };
  return { removed };
}

async function uploadBytes(fetcher, token, folderId, { name, type, bytes, ownerHash, secretHash, addedAt }) {
  const start = await fetcher(`${DRIVE_UPLOAD}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': type || 'application/octet-stream',
      'x-upload-content-length': String(bytes.byteLength),
    },
    body: JSON.stringify({
      name,
      parents: [folderId],
      appProperties: {
        ownerHash,
        secretHash,
        addedAt: String(addedAt),
      },
    }),
  });
  if (!start.ok) throw new DriveFilesError(`drive_${start.status}`);
  const location = start.headers.get('location');
  if (!location) throw new DriveFilesError('drive_upload_missing');
  const put = await fetcher(location, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': type || 'application/octet-stream',
      'content-length': String(bytes.byteLength),
    },
    body: bytes,
  });
  const saved = await put.json().catch(() => ({}));
  if (!put.ok || !saved.id) throw new DriveFilesError(put.ok ? 'drive_upload_missing' : `drive_${put.status}`);
  return saved.id;
}

export async function saveOwnerFile({
  env,
  fetcher = fetch,
  ownerId,
  name,
  type = 'application/octet-stream',
  bytes,
  now = Date.now(),
  createSecret = createFileSecret,
} = {}) {
  const ready = driveEnv(env);
  if (!ready) return { ok: false, error: 'drive_not_configured' };
  if (!(bytes instanceof Uint8Array)) return { ok: false, error: 'file_required' };
  if (bytes.byteLength > FILE_BYTE_CAP) return { ok: false, error: 'file_too_large' };
  try {
    const token = await accessToken(ready, fetcher);
    const folderId = await ensureFolder(fetcher, token);
    const ownerHash = hashOwnerId(ownerId);
    const all = await listFiles(fetcher, token, `${quote(folderId)} in parents and trashed=false`);
    const mine = all.filter(file => file?.appProperties?.ownerHash === ownerHash);
    const plan = filesToEvict(mine, all, bytes.byteLength);
    if (plan.error) return { ok: false, error: plan.error };
    for (const file of plan.removed) {
      await driveJson(fetcher, `${DRIVE_FILES}/${encodeURIComponent(file.id)}`, token, { method: 'DELETE' });
    }
    const secret = createSecret();
    const secretHash = hashFileSecret(secret);
    await uploadBytes(fetcher, token, folderId, {
      name: safeName(name),
      type: typeof type === 'string' && type.trim() ? type.trim().slice(0, 120) : 'application/octet-stream',
      bytes,
      ownerHash,
      secretHash,
      addedAt: now,
    });
    return {
      ok: true,
      secret,
      ref: secretHash,
      removed: plan.removed.map(file => file.appProperties?.secretHash).filter(Boolean),
      name: safeName(name),
      size: bytes.byteLength,
      type: typeof type === 'string' && type.trim() ? type.trim().slice(0, 120) : 'application/octet-stream',
      addedAt: now,
    };
  } catch (error) {
    return { ok: false, error: error instanceof DriveFilesError ? error.code : 'drive_failed' };
  }
}

export async function readOwnerFile({ env, fetcher = fetch, ownerId, secret } = {}) {
  const ready = driveEnv(env);
  if (!ready) return { ok: false, error: 'drive_not_configured' };
  if (typeof secret !== 'string' || !/^[0-9a-z]{128}$/.test(secret)) return { ok: false, error: 'not_found' };
  try {
    const token = await accessToken(ready, fetcher);
    const folderId = await ensureFolder(fetcher, token);
    const ownerHash = hashOwnerId(ownerId);
    const secretHash = hashFileSecret(secret);
    const query = [
      `${quote(folderId)} in parents`,
      'trashed=false',
      `appProperties has { key='ownerHash' and value=${quote(ownerHash)} }`,
      `appProperties has { key='secretHash' and value=${quote(secretHash)} }`,
    ].join(' and ');
    const found = await listFiles(fetcher, token, query);
    const file = found.find(item => item?.appProperties?.ownerHash === ownerHash && item?.appProperties?.secretHash === secretHash);
    if (!file?.id) return { ok: false, error: 'not_found' };
    const media = await fetcher(`${DRIVE_FILES}/${encodeURIComponent(file.id)}?alt=media`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!media.ok) return { ok: false, error: 'not_found' };
    const buffer = new Uint8Array(await media.arrayBuffer());
    return {
      ok: true,
      name: file.name || 'file',
      type: file.mimeType || 'application/octet-stream',
      bytes: buffer,
    };
  } catch (error) {
    return { ok: false, error: error instanceof DriveFilesError ? error.code : 'drive_failed' };
  }
}
