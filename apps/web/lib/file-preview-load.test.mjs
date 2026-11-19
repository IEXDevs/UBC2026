import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyFileLoadFailure,
  fetchFilePreviewBytes,
  isStoredFileSecret,
} from './file-preview-load.mjs';
import { fileAvailability } from './file-session.mjs';

test('stored secrets are detected and empty status is not speculative loading', () => {
  assert.equal(isStoredFileSecret('a'.repeat(128)), true);
  assert.equal(isStoredFileSecret('local-notes'), false);
  assert.equal(fileAvailability({ id: 'a'.repeat(128), remoteStatus: '' }).state, 'device_local');
  assert.equal(fileAvailability({ id: 'a'.repeat(128), remoteStatus: 'loading' }).state, 'loading');
});

test('classifyFileLoadFailure keeps storage and auth failures actionable', () => {
  assert.equal(classifyFileLoadFailure({ timedOut: true }).state, 'error');
  assert.match(classifyFileLoadFailure({ timedOut: true }).message, /timed out/i);
  assert.equal(classifyFileLoadFailure({ status: 404, body: { gone: true } }).state, 'gone');
  assert.match(classifyFileLoadFailure({ status: 503, body: { error: 'drive_not_configured' } }).message, /storage is not ready/i);
  assert.match(classifyFileLoadFailure({ status: 401 }).message, /sign in again/i);
});

test('fetchFilePreviewBytes returns text fixture bytes and times out when hung', async () => {
  const fixture = 'maelstrom-qa-fixture: open positions check\n';
  const ok = await fetchFilePreviewBytes({
    url: '/api/files/secret',
    timeoutMs: 5_000,
    fetcher: async () => new Response(fixture, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }),
  });
  assert.equal(ok.ok, true);
  assert.equal(new TextDecoder().decode(ok.bytes), fixture);

  const hung = await fetchFilePreviewBytes({
    url: '/api/files/secret',
    timeoutMs: 30,
    fetcher: () => new Promise(() => {}),
  });
  assert.equal(hung.ok, false);
  assert.equal(hung.state, 'error');
  assert.match(hung.message, /timed out/i);
});
