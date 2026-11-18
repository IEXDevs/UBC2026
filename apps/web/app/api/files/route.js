import { saveOwnerFile } from '../../../lib/drive-files.mjs';
import { readRootEnv } from '../../../lib/root-env.mjs';

const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;
const NO_STORE = { 'cache-control': 'no-store' };

function driveConfig() {
  return {
    GOOGLE_DRIVE_CLIENT_ID: readRootEnv('GOOGLE_DRIVE_CLIENT_ID'),
    GOOGLE_DRIVE_CLIENT_SECRET: readRootEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
    GOOGLE_DRIVE_REFRESH_TOKEN: readRootEnv('GOOGLE_DRIVE_REFRESH_TOKEN'),
  };
}

export async function POST(request) {
  const ownerId = (request.headers.get('x-owner-id') || '').trim();
  const bearer = request.headers.get('authorization') || '';
  if (!OWNER.test(ownerId) || !bearer.startsWith('Bearer ') || bearer.length < 12) {
    return Response.json({ error: 'owner_required' }, { status: 401, headers: NO_STORE });
  }
  let form = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'file_required' }, { status: 400, headers: NO_STORE });
  }
  const saved = await saveOwnerFile({
    env: driveConfig(),
    ownerId,
    name: file.name,
    type: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!saved.ok) {
    const status = saved.error === 'drive_not_configured' ? 503
      : saved.error === 'file_too_large' ? 413
        : saved.error === 'storage_full' ? 507
          : 502;
    return Response.json({ error: saved.error }, { status, headers: NO_STORE });
  }
  return Response.json({
    secret: saved.secret,
    ref: saved.ref,
    removed: saved.removed,
    name: saved.name,
    size: saved.size,
    type: saved.type,
    addedAt: saved.addedAt,
  }, { headers: NO_STORE });
}
