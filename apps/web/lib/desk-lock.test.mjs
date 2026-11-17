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

/*
 * Achieves: verifies desk lock rejects a short password and accepts a matching one.
 * Fails when: desk lock rejects a short password and accepts a matching one breaks (e.g. expected 'Use at least 8 characters.', record, record); failure/null paths flip.
 * Oracle: assert.equal(passwordProblem('short'), 'Use at least 8 characters.'); assert.equal(await unlockDesk('correct horse', record); assert.equal(await unlockDesk('correct horses', record); assert.equal(await unlockDesk('', record); assert.equal(await unlockDesk('correct horse', other); assert.rejects(() => createDeskLock('short')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

/*
 * Achieves: verifies desk lock verifier round-trips per owner and ignores a tampered hash.
 * Fails when: desk lock verifier round-trips per owner and ignores a tampered hash breaks (e.g. expected '', 'maelstrom.desk-lock.did:privy:abc', 'did:privy:abc', record); failure/null paths flip.
 * Oracle: assert.equal(deskLockStorageKey(''), ''); assert.equal(deskLockStorageKey(' did:privy:abc '), 'maelstrom.desk-lock.did:privy:abc'); assert.equal(writeDeskLock(storage, 'did:privy:abc', record); assert.equal(await unlockDesk('panel-lock', readDeskLock(storage, 'did:privy:abc'); assert.equal(readDeskLock(storage, 'did:privy:other'); assert.equal(await unlockDesk('panel-lock', readDeskLock(storage, 'did:privy:abc')
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
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

/*
 * Achieves: verifies shift L locks and shift U opens the unlock prompt, except while typing.
 * Fails when: shift L locks and shift U opens the unlock prompt, except while typing breaks (e.g. expected code: 'KeyL' }, code: 'KeyU' }, code: 'KeyL', repeat: true }); failure/null paths flip.
 * Oracle: assert.equal(walletHotkey({ shiftKey: true, code: 'KeyL' }); assert.equal(walletHotkey({ shiftKey: true, code: 'KeyU' }); assert.equal(walletHotkey({ shiftKey: true, code: 'KeyL', repeat: true }); assert.equal(walletHotkey({ shiftKey: false, code: 'KeyL' }); assert.equal(walletHotkey({ shiftKey: true, ctrlKey: true, code: 'KeyL' }); assert.equal(walletHotkey({ shiftKey: true, code: 'KeyK' })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

/*
 * Achieves: verifies idle lock trips after thirty minutes and stays open before that.
 * Fails when: idle lock trips after thirty minutes and stays open before that breaks (e.g. expected start + DESK_LOCK_IDLE_MS - 1, start + DESK_LOCK_IDLE_MS, start); failure/null paths flip.
 * Oracle: assert.equal(idleLockDue(start, start + DESK_LOCK_IDLE_MS - 1); assert.equal(idleLockDue(start, start + DESK_LOCK_IDLE_MS); assert.equal(idleLockDue(Number.NaN, start)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('idle lock trips after thirty minutes and stays open before that', () => {
  const start = 1_000_000;
  assert.equal(idleLockDue(start, start + DESK_LOCK_IDLE_MS - 1), false);
  assert.equal(idleLockDue(start, start + DESK_LOCK_IDLE_MS), true);
  assert.equal(idleLockDue(Number.NaN, start), false);
});

/*
 * Achieves: verifies a wallet unlock lasts thirty minutes across a reload and then locks.
 * Fails when: a wallet unlock lasts thirty minutes across a reload and then locks breaks (e.g. expected start + DESK_LOCK_IDLE_MS, 'did:privy:abc', until, 'did:privy:abc', start + DESK_LOCK_IDLE_MS - 1); failure/null paths flip.
 * Oracle: assert.equal(until, start + DESK_LOCK_IDLE_MS); assert.equal(writeDeskSession(storage, 'did:privy:abc', until); assert.equal(readDeskSession(storage, 'did:privy:abc', until); assert.equal(readDeskSession(storage, 'did:privy:other', start); assert.equal(parseDeskSession('not-json', start); assert.equal(clearDeskSession(storage, 'did:privy:abc')
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
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
