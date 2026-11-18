import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStoredFile, storeAttachedFile, uploadNotice } from './store-file.mjs';
import { STORAGE_CAP_WARNING } from './file-quota.mjs';

test('a stored upload replaces the local id and drops removed hashes', async () => {
  const secret = 'm'.repeat(128);
  const saved = await storeAttachedFile({
    ownerId: 'did:privy:1',
    token: 'token-value',
    item: { name: 'shot.png', size: 4, blob: new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' }) },
    fetcher: async (url, init) => {
      assert.equal(url, '/api/files');
      assert.equal(init.headers['x-owner-id'], 'did:privy:1');
      assert.equal(init.headers.authorization, 'Bearer token-value');
      return Response.json({ secret, ref: 'ab'.repeat(32), removed: ['cd'.repeat(32)], addedAt: 8 });
    },
  });
  const library = applyStoredFile({
    bot_1: [
      { id: 'local', name: 'shot.png', ref: '' },
      { id: 'gone', name: 'old.png', ref: 'cd'.repeat(32) },
    ],
  }, 'local', saved);
  assert.equal(library.bot_1[0].id, secret);
  assert.equal(library.bot_1[0].ref, 'ab'.repeat(32));
  assert.equal(library.bot_1.length, 1);
  assert.match(uploadNotice(saved), /5 GB/);
  assert.equal(uploadNotice(saved).includes('google'), false);
  assert.equal(uploadNotice(saved), STORAGE_CAP_WARNING);
});
