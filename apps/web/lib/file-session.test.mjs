import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSessionFiles,
  fileAvailability,
  forgetSessionFile,
  moveSessionFile,
  rememberSessionFile,
  sessionBlob,
  sessionPreviewUrl,
} from './file-session.mjs';

test('session preview keeps bytes after catalog strip and moves with stored id', () => {
  clearSessionFiles();
  const blob = new Blob(['fixture line one'], { type: 'text/plain' });
  const url = rememberSessionFile('local-1', blob);
  assert.match(url, /^blob:/);
  assert.equal(sessionPreviewUrl('local-1'), url);
  assert.equal(sessionBlob('local-1'), blob);
  moveSessionFile('local-1', 'm'.repeat(128));
  assert.equal(sessionPreviewUrl('local-1'), '');
  assert.equal(sessionPreviewUrl('m'.repeat(128)), url);
  forgetSessionFile('m'.repeat(128));
  assert.equal(sessionPreviewUrl('m'.repeat(128)), '');
});

test('fileAvailability distinguishes ready, device-local, gone, and error', () => {
  assert.equal(fileAvailability({ url: 'blob:http://local/x' }).state, 'ready');
  assert.equal(fileAvailability({ id: 'local-notes' }).state, 'device_local');
  assert.match(fileAvailability({ id: 'local-notes' }).message, /this device/i);
  assert.equal(fileAvailability({ id: 'a'.repeat(128), remoteStatus: 'gone' }).state, 'gone');
  assert.equal(fileAvailability({ id: 'a'.repeat(128), remoteStatus: 'error' }).state, 'error');
  assert.equal(fileAvailability({ id: 'a'.repeat(128), remoteStatus: 'loading' }).state, 'loading');
  // A stored secret with no explicit loading flag must not look like an open-in-progress.
  assert.equal(fileAvailability({ id: 'a'.repeat(128), remoteStatus: '' }).state, 'device_local');
});
