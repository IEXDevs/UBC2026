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

test('talk storage key is owner-scoped', () => {
  assert.equal(talkStorageKey('did:privy:abc'), 'maelstrom.talks.did:privy:abc');
  assert.equal(talkStorageKey(''), '');
  assert.equal(talkStorageKey(null), '');
});

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
