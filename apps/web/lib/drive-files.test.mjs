import assert from 'node:assert/strict';
import test from 'node:test';
import { FILE_BYTE_CAP, PROJECT_STORAGE_CAP, USER_STORAGE_CAP } from './file-quota.mjs';
import { filesToEvict, readOwnerFile, saveOwnerFile } from './drive-files.mjs';
import { createFileSecret, fileSecretFromBytes, hashFileSecret, hashOwnerId } from './file-secret.mjs';
import { catalogRecallText } from './file-catalog.mjs';

const ENV = {
  GOOGLE_DRIVE_CLIENT_ID: 'client',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh',
};

const SECRET = 'a'.repeat(128);
const ACCOUNT = '1234567890123456';

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function memoryDrive() {
  const rows = [];
  let seq = 1;
  const seen = [];
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    const method = init.method || 'GET';
    if (!href.includes('oauth2.googleapis.com')) {
      seen.push(href + JSON.stringify(init.body || ''));
    }
    if (href.includes('oauth2.googleapis.com/token')) {
      const raw = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init.body || ''));
      if (raw.get('refresh_token') !== 'refresh') return json({ error: 'nope' }, 400);
      return json({ access_token: 'ya29.test' });
    }
    if (href.includes('uploadType=resumable')) {
      const meta = JSON.parse(init.body);
      const ticket = `up-${seq}`;
      seq += 1;
      rows.push({ ticket, meta });
      return new Response(null, { status: 200, headers: { location: `https://upload.example/${ticket}` } });
    }
    if (href.startsWith('https://upload.example/')) {
      const ticket = href.split('/').pop();
      const pending = rows.find(row => row.ticket === ticket);
      const id = `file-${seq}`;
      seq += 1;
      const saved = {
        id,
        name: pending.meta.name,
        size: String(init.body.byteLength),
        mimeType: init.headers['content-type'],
        createdTime: '2026-11-18T00:00:00.000Z',
        appProperties: pending.meta.appProperties,
        bytes: init.body,
      };
      rows.push(saved);
      return json({ id });
    }
    const parsed = new URL(href);
    if (method === 'POST' && parsed.pathname === '/drive/v3/files') {
      const body = JSON.parse(init.body);
      const id = `folder-${seq}`;
      seq += 1;
      rows.push({ id, name: body.name, mimeType: body.mimeType, size: '0', appProperties: {} });
      return json({ id });
    }
    if (method === 'DELETE') {
      const id = decodeURIComponent(parsed.pathname.split('/').pop());
      const index = rows.findIndex(row => row.id === id);
      if (index >= 0) rows.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    if (parsed.searchParams.get('alt') === 'media') {
      const id = decodeURIComponent(parsed.pathname.split('/').pop());
      const file = rows.find(row => row.id === id);
      return new Response(file.bytes, { status: 200 });
    }
    const query = parsed.searchParams.get('q') || '';
    const files = rows.filter(row => row.id && !row.ticket);
    if (query.includes('application/vnd.google-apps.folder')) {
      return json({ files: files.filter(row => row.mimeType === 'application/vnd.google-apps.folder') });
    }
    return json({ files: files.filter(row => row.mimeType !== 'application/vnd.google-apps.folder') });
  };
  return { fetcher, rows, seen };
}

test('file secret uses 0-9 and a-z and skips leftover bytes', () => {
  const secret = fileSecretFromBytes(Uint8Array.from([0, 35, 252, 253, 10]));
  assert.equal(secret, '0z' + 'a');
  assert.equal(createFileSecret(() => Uint8Array.from({ length: 300 }, (_, index) => index % 200)).length, 128);
  assert.match(SECRET, /^[0-9a-z]{128}$/);
  assert.equal(hashFileSecret(SECRET), hashFileSecret(SECRET));
  assert.notEqual(hashOwnerId('did:privy:1'), hashOwnerId('did:privy:2'));
});

test('a file over either cap is refused and other owners stay', () => {
  const mine = [{ id: 'old', size: '10', appProperties: { addedAt: '1', secretHash: 'oldhash' } }];
  const other = [{ id: 'theirs', size: String(PROJECT_STORAGE_CAP), appProperties: { addedAt: '1', secretHash: 'theirhash' } }];
  const blocked = filesToEvict(mine, [...mine, ...other], 1);
  assert.equal(blocked.error, 'storage_full');
  assert.equal(blocked.removed, undefined);
  const huge = filesToEvict([], [], USER_STORAGE_CAP + 1);
  assert.equal(huge.error, 'file_too_large');
  assert.ok(FILE_BYTE_CAP < USER_STORAGE_CAP);
});

test('save stores a hash and returns the secret once', async () => {
  const drive = memoryDrive();
  const saved = await saveOwnerFile({
    env: ENV,
    fetcher: drive.fetcher,
    ownerId: 'did:privy:1',
    accountCode: ACCOUNT,
    name: "owner's notes.txt",
    type: 'text/plain',
    bytes: new Uint8Array([9, 8, 7]),
    now: 50,
    createSecret: () => SECRET,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.secret, SECRET);
  assert.equal(saved.ref, hashFileSecret(SECRET));
  const stored = drive.rows.find(row => row.appProperties?.secretHash === saved.ref);
  assert.equal(stored.appProperties.ownerHash, hashOwnerId('did:privy:1'));
  assert.equal(stored.appProperties.accountCode, ACCOUNT);
  assert.equal(stored.name, "owner's notes.txt");
  assert.equal(drive.seen.some(line => line.includes(SECRET) || line.includes('refresh')), false);
  const recall = catalogRecallText([{ name: saved.name, type: saved.type, botName: 'Nova' }]);
  assert.equal(recall.includes(SECRET), false);
  assert.equal(recall.includes(ACCOUNT), false);
  const read = await readOwnerFile({
    env: ENV,
    fetcher: drive.fetcher,
    ownerId: 'did:privy:1',
    accountCode: ACCOUNT,
    secret: SECRET,
  });
  assert.equal(read.ok, true);
  assert.deepEqual([...read.bytes], [9, 8, 7]);
  const wrongOwner = await readOwnerFile({
    env: ENV,
    fetcher: drive.fetcher,
    ownerId: 'did:privy:2',
    accountCode: ACCOUNT,
    secret: SECRET,
  });
  assert.equal(wrongOwner.ok, false);
  assert.equal(wrongOwner.error, 'not_found');
  const wrongAccount = await readOwnerFile({
    env: ENV,
    fetcher: drive.fetcher,
    ownerId: 'did:privy:1',
    accountCode: '0000000000000000',
    secret: SECRET,
  });
  assert.equal(wrongAccount.ok, false);
  assert.equal(wrongAccount.error, 'not_found');
  assert.equal(wrongAccount.gone, undefined);
  const missing = await readOwnerFile({
    env: ENV,
    fetcher: drive.fetcher,
    ownerId: 'did:privy:1',
    accountCode: ACCOUNT,
    secret: 'c'.repeat(128),
  });
  assert.equal(missing.gone, true);
  const mismatched = await saveOwnerFile({
    env: ENV,
    fetcher: drive.fetcher,
    ownerId: 'did:privy:1',
    accountCode: '0000000000000000',
    name: 'other.txt',
    bytes: new Uint8Array([1]),
    createSecret: () => 'b'.repeat(128),
  });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.error, 'account_mismatch');
});

test('crossing 5 GB removes that owner oldest file only', async () => {
  const drive = memoryDrive();
  const ownerHash = hashOwnerId('did:privy:1');
  drive.rows.push(
    { id: 'folder-0', name: 'Maelstrom', mimeType: 'application/vnd.google-apps.folder', size: '0', appProperties: {} },
    { id: 'old', name: 'old.bin', size: String(4_000_000_000), mimeType: 'application/octet-stream', appProperties: { ownerHash, secretHash: 'a'.repeat(64), accountCode: ACCOUNT, addedAt: '1' } },
    { id: 'keep', name: 'keep.bin', size: String(2_000_000_000), mimeType: 'application/octet-stream', appProperties: { ownerHash, secretHash: 'b'.repeat(64), accountCode: ACCOUNT, addedAt: '2' } },
    { id: 'other', name: 'other.bin', size: String(1_000_000_000), mimeType: 'application/octet-stream', appProperties: { ownerHash: hashOwnerId('did:privy:2'), secretHash: 'c'.repeat(64), addedAt: '1' } },
  );
  const saved = await saveOwnerFile({
    env: ENV,
    fetcher: drive.fetcher,
    ownerId: 'did:privy:1',
    accountCode: ACCOUNT,
    name: 'new.bin',
    type: 'application/octet-stream',
    bytes: Uint8Array.from({ length: 8 }),
    now: 9,
    createSecret: () => 'd'.repeat(128),
  });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.removed, ['a'.repeat(64)]);
  assert.equal(drive.rows.some(row => row.id === 'old'), false);
  assert.equal(drive.rows.some(row => row.id === 'keep'), true);
  assert.equal(drive.rows.some(row => row.id === 'other'), true);
});

test('missing drive config and a bad refresh token stay generic', async () => {
  const empty = await saveOwnerFile({ env: {}, ownerId: 'did:privy:1', name: 'a.txt', bytes: new Uint8Array([1]) });
  assert.equal(empty.error, 'drive_not_configured');
  const drive = memoryDrive();
  const bad = await saveOwnerFile({
    env: { ...ENV, GOOGLE_DRIVE_REFRESH_TOKEN: 'nope' },
    fetcher: drive.fetcher,
    ownerId: 'did:privy:1',
    accountCode: ACCOUNT,
    name: 'a.txt',
    bytes: new Uint8Array([1]),
  });
  assert.equal(bad.error, 'drive_auth_failed');
  assert.equal(bad.message, undefined);
});
