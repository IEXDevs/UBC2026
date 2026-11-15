import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESK_LOCK_IDLE_MS,
  createDeskLock,
  deskLockStorageKey,
  idleLockDue,
  parseDeskLock,
  passwordProblem,
  readDeskLock,
  unlockDesk,
  writeDeskLock,
} from './desk-lock.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test('desk lock rejects a short password and accepts a matching one', async () => {
  assert.equal(passwordProblem('short'), 'Use at least 8 characters.');
  await assert.rejects(() => createDeskLock('short'), /at least 8/);
  const record = await createDeskLock('correct horse');
  assert.equal(await unlockDesk('correct horse', record), true);
  assert.equal(await unlockDesk('correct horses', record), false);
  assert.equal(await unlockDesk('', record), false);
  const other = await createDeskLock('correct horse');
  assert.notEqual(other.salt, record.salt);
  assert.equal(await unlockDesk('correct horse', other), true);
});

test('desk lock verifier round-trips per owner and ignores a tampered hash', async () => {
  assert.equal(deskLockStorageKey(''), '');
  assert.equal(deskLockStorageKey('  did:privy:abc  '), 'maelstrom.desk-lock.did:privy:abc');
  const storage = memoryStorage();
  const record = await createDeskLock('panel-lock');
  assert.equal(writeDeskLock(storage, 'did:privy:abc', record), true);
  assert.equal(await unlockDesk('panel-lock', readDeskLock(storage, 'did:privy:abc')), true);
  assert.equal(readDeskLock(storage, 'did:privy:other'), null);
  const stored = JSON.parse(storage.getItem('maelstrom.desk-lock.did:privy:abc'));
  stored.hash = '00'.repeat(32);
  storage.setItem('maelstrom.desk-lock.did:privy:abc', JSON.stringify(stored));
  assert.equal(await unlockDesk('panel-lock', readDeskLock(storage, 'did:privy:abc')), false);
  assert.equal(parseDeskLock('{"v":1}'), null);
  assert.equal(parseDeskLock('not-json'), null);
});

test('idle lock trips after thirty minutes and stays open before that', () => {
  const start = 1_000_000;
  assert.equal(idleLockDue(start, start + DESK_LOCK_IDLE_MS - 1), false);
  assert.equal(idleLockDue(start, start + DESK_LOCK_IDLE_MS), true);
  assert.equal(idleLockDue(Number.NaN, start), false);
});
