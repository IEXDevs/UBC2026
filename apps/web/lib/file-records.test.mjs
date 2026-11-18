import assert from 'node:assert/strict';
import test from 'node:test';
import { driveItemUrl, forgetOwnerFile, rememberOwnerFile } from './file-records.mjs';

test('a file row is stored by hash and removed when the file is gone', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body });
    return new Response(null, { status: 201 });
  };
  const env = { SUPABASE_URL: 'https://directory.example', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
  const hash = 'ab'.repeat(32);
  const saved = await rememberOwnerFile({
    env,
    fetcher,
    ownerId: 'did:privy:1',
    accountCode: '1234567890123456',
    secretHash: hash,
    driveFileId: '1AbC_def-xyz',
    name: 'notes.txt',
    type: 'text/plain',
    size: 4,
    addedAt: 10,
  });
  assert.equal(saved.ok, true);
  const row = JSON.parse(calls[1].body);
  assert.equal(row.secret_hash, hash);
  assert.equal(row.name, 'notes.txt');
  assert.equal(row.account_code, '1234567890123456');
  assert.equal(row.drive_url, 'https://drive.google.com/file/d/1AbC_def-xyz/view');
  assert.equal(driveItemUrl('https://drive.google.com/file/d/1AbC_def-xyz/view'), '');
  assert.equal(JSON.stringify(row).includes('z'.repeat(128)), false);
  const forgotten = await forgetOwnerFile({ env, fetcher, ownerId: 'did:privy:1', secretHash: hash });
  assert.equal(forgotten.ok, true);
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.equal(calls.at(-1).url.includes(hash), true);
  const offline = await rememberOwnerFile({ env: {}, ownerId: 'did:privy:1', secretHash: hash });
  assert.equal(offline.skipped, true);
});
