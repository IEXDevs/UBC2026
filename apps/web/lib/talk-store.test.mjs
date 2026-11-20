import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearTalks,
  normalizeTalks,
  readTalks,
  talkStorageKey,
  writeTalks,
} from './talk-store.mjs';

function memory(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

/**
 * Achieves: verifies talk storage key is owner-scoped.
 * Fails when: talk storage key is owner-scoped breaks (e.g. expected 'maelstrom.talks.did:privy:abc', '', '').
 * Oracle: assert.equal(talkStorageKey('did:privy:abc'), 'maelstrom.talks.did:privy:abc'); assert.equal(talkStorageKey(''), ''); assert.equal(talkStorageKey(null), '')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('talk storage key is owner-scoped', () => {
  assert.equal(talkStorageKey('did:privy:abc'), 'maelstrom.talks.did:privy:abc');
  assert.equal(talkStorageKey(''), '');
  assert.equal(talkStorageKey(null), '');
});

/**
 * Achieves: verifies normalizeTalks drops junk and caps lines.
 * Fails when: normalizeTalks drops junk and caps lines breaks (e.g. expected ['1', '3'], 'note', 'circle.com').
 * Oracle: assert.equal(kept.bot_1[0].role, 'note'); assert.equal(kept.bot_1[1].activity[0].sites[0].host, 'circle.com'); assert.equal(talks[''], undefined); assert.deepEqual(talks.bot_1.map(line => line.id), ['1', '3'])
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('normalizeTalks drops junk and caps lines', () => {
  const talks = normalizeTalks({
    bot_1: [
      { id: '1', role: 'user', text: 'hi' },
      { id: '2', role: 'nope', text: 'x' },
      { id: '3', role: 'agent', text: 'hello' },
      null,
    ],
    '': [{ id: '4', role: 'user', text: 'bad bot' }],
  });
  assert.deepEqual(talks.bot_1.map(line => line.id), ['1', '3']);
  const kept = normalizeTalks({
    bot_1: [{
      id: 'n',
      role: 'note',
      text: 'Permissions set to Ask every time',
    }, {
      id: 'a',
      role: 'agent',
      text: 'done',
      activity: [{ kind: 'search', query: 'USDC', sites: [{ title: 'Circle', url: 'https://circle.com', host: 'circle.com' }] }],
    }],
  });
  assert.equal(kept.bot_1[0].role, 'note');
  assert.equal(kept.bot_1[1].activity[0].sites[0].host, 'circle.com');
  assert.equal(talks[''], undefined);
});

/**
 * Achieves: verifies read and write round-trip chats per owner.
 * Fails when: read and write round-trip chats per owner breaks (e.g. expected 'did:privy:1', talks, 'did:privy:1', 'did:privy:other').
 * Oracle: assert.equal(writeTalks(storage, 'did:privy:1', talks); assert.deepEqual(readTalks(storage, 'did:privy:1'); assert.deepEqual(readTalks(storage, 'did:privy:other'); assert.deepEqual(readTalks(storage, 'did:privy:1')
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('read and write round-trip chats per owner', () => {
  const storage = memory();
  const talks = {
    bot_1: [{ id: '1', role: 'user', text: 'ping' }, { id: '2', role: 'agent', text: 'pong' }],
  };
  assert.equal(writeTalks(storage, 'did:privy:1', talks), true);
  assert.deepEqual(readTalks(storage, 'did:privy:1'), talks);
  assert.deepEqual(readTalks(storage, 'did:privy:other'), {});
  clearTalks(storage, 'did:privy:1');
  assert.deepEqual(readTalks(storage, 'did:privy:1'), {});
});

/**
 * Achieves: verifies corrupt JSON and overlong owner ids fail closed to empty talks.
 * Fails when: JSON.parse throw becomes a crash, or an overlong ownerId still writes a key.
 * Oracle: corrupt raw → {}; ownerId length > 256 → talkStorageKey '' and writeTalks false.
 * Side effects / state checked: storage may hold corrupt raw without throwing on read.
 * Gaps: none.
 */
test('corrupt storage and overlong owner ids fail closed', () => {
  const storage = memory({ 'maelstrom.talks.did:privy:1': '{not-json' });
  assert.deepEqual(readTalks(storage, 'did:privy:1'), {});
  const long = 'x'.repeat(300);
  assert.equal(talkStorageKey(long), '');
  assert.equal(writeTalks(storage, long, { bot_1: [{ id: '1', role: 'user', text: 'x' }] }), false);
});

test('resolved mention addresses survive saving and reloading a chat', () => {
  const storage = memory();
  const talks = { bot_1: [{ id: '1', role: 'user', text: 'Hello @ada', mentionAddress: 'So11111111111111111111111111111111111111112' }] };
  assert.equal(writeTalks(storage, 'owner', talks), true);
  assert.deepEqual(readTalks(storage, 'owner'), talks);
});

test('invalid and empty mention addresses are discarded on save and load', () => {
  for (const mentionAddress of [undefined, null, '', 123, {}, 'bad address', '0'.repeat(32), '1'.repeat(31), '1'.repeat(45), ' So11111111111111111111111111111111111111112']) {
    const storage = memory();
    const talks = { bot_1: [{ id: '1', role: 'user', text: 'Hello', mentionAddress }] };
    const expected = { bot_1: [{ id: '1', role: 'user', text: 'Hello' }] };
    assert.equal(writeTalks(storage, 'owner', talks), true);
    assert.deepEqual(JSON.parse(storage.getItem(talkStorageKey('owner'))), expected);
    storage.setItem(talkStorageKey('owner'), JSON.stringify(talks));
    assert.deepEqual(readTalks(storage, 'owner'), expected);
  }
});
