import { readOwnerFile } from '../../../../lib/drive-files.mjs';
import { readRootEnv } from '../../../../lib/root-env.mjs';

const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;
const NO_STORE = { 'cache-control': 'no-store' };

function driveConfig() {
  return {
    GOOGLE_DRIVE_CLIENT_ID: readRootEnv('GOOGLE_DRIVE_CLIENT_ID'),
    GOOGLE_DRIVE_CLIENT_SECRET: readRootEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
    GOOGLE_DRIVE_REFRESH_TOKEN: readRootEnv('GOOGLE_DRIVE_REFRESH_TOKEN'),
  };
}

export async function GET(request, { params }) {
  const ownerId = (request.headers.get('x-owner-id') || '').trim();
  const accountCode = (request.headers.get('x-account-code') || '').trim();
  const bearer = request.headers.get('authorization') || '';
  const secret = (await params)?.secret || '';
  if (!OWNER.test(ownerId) || !bearer.startsWith('Bearer ') || bearer.length < 12) {
    return Response.json({ error: 'owner_required' }, { status: 401, headers: NO_STORE });
  }
  const read = await readOwnerFile({
    env: driveConfig(),
    ownerId,
    accountCode,
    secret,
  });
  if (!read.ok) {
    const status = read.error === 'drive_not_configured' ? 503
      : read.error === 'unreachable' ? 502
        : 404;
    const body = read.gone ? { error: 'not_found', gone: true } : { error: 'not_found' };
    return Response.json(body, { status, headers: NO_STORE });
  }
  return new Response(read.bytes, {
    headers: {
      ...NO_STORE,
      'content-type': read.type || 'application/octet-stream',
      'content-disposition': 'inline',
    },
  });
}
