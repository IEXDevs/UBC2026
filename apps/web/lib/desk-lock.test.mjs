import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESK_LOCK_IDLE_MS,
  clearDeskGrant,
  clearDeskSession,
  createDeskLock,
  deskLockStorageKey,
  deskSessionUntil,
  hotkeyTypingTarget,
  idleLockDue,
  parseDeskLock,
  parseDeskSession,
  passwordProblem,
  readDeskGrant,
  readDeskLock,
  readDeskSession,
  unlockDesk,
  walletHotkey,
  writeDeskGrant,
  writeDeskLock,
  writeDeskSession,
} from './desk-lock.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
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

test('shift L locks and shift U opens the unlock prompt, except while typing', () => {
  assert.equal(walletHotkey({ shiftKey: true, code: 'KeyL' }), 'lock');
  assert.equal(walletHotkey({ shiftKey: true, code: 'KeyU' }), 'unlock');
  assert.equal(walletHotkey({ shiftKey: true, code: 'KeyL', repeat: true }), '');
  assert.equal(walletHotkey({ shiftKey: false, code: 'KeyL' }), '');
  assert.equal(walletHotkey({ shiftKey: true, ctrlKey: true, code: 'KeyL' }), '');
  assert.equal(walletHotkey({ shiftKey: true, code: 'KeyK' }), '');
  assert.equal(hotkeyTypingTarget({ tagName: 'input' }), true);
  assert.equal(hotkeyTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(hotkeyTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(hotkeyTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(hotkeyTypingTarget(null), false);
});

test('idle lock trips after thirty minutes and stays open before that', () => {
  const start = 1_000_000;
  assert.equal(idleLockDue(start, start + DESK_LOCK_IDLE_MS - 1), false);
  assert.equal(idleLockDue(start, start + DESK_LOCK_IDLE_MS), true);
  assert.equal(idleLockDue(Number.NaN, start), false);
});

test('a wallet unlock lasts thirty minutes across a reload and then locks', () => {
  const storage = memoryStorage();
  const start = 1_700_000_000_000;
  const until = deskSessionUntil(start);
  assert.equal(until, start + DESK_LOCK_IDLE_MS);
  assert.equal(writeDeskSession(storage, 'did:privy:abc', until), true);
  assert.deepEqual(readDeskSession(storage, 'did:privy:abc', start + DESK_LOCK_IDLE_MS - 1), { v: 1, until });
  assert.equal(readDeskSession(storage, 'did:privy:abc', until), null);
  assert.equal(readDeskSession(storage, 'did:privy:other', start), null);
  assert.equal(parseDeskSession('not-json', start), null);
  assert.equal(clearDeskSession(storage, 'did:privy:abc'), true);
  assert.equal(readDeskSession(storage, 'did:privy:abc', start), null);
  const broken = {
    getItem() { return null; },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(writeDeskSession(broken, 'did:privy:abc', until), false);
  const grant = 'ab'.repeat(32);
  assert.equal(writeDeskGrant(storage, 'did:privy:abc', grant, until), true);
  assert.equal(readDeskGrant(storage, 'did:privy:abc', start).grant, grant);
  assert.equal(readDeskGrant(storage, 'did:privy:abc', until), null);
  assert.equal(clearDeskGrant(storage, 'did:privy:abc'), true);
  assert.equal(readDeskGrant(storage, 'did:privy:abc', start), null);
  assert.equal(writeDeskLock(broken, 'did:privy:abc', { v: 1, iterations: 120000, salt: 'aa', hash: 'bb' }), false);
});
