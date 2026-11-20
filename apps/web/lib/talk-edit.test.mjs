import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviseThread } from './talk-edit.mjs';

const thread = [
  { id: 'u1', role: 'user', text: 'first' },
  { id: 'a1', role: 'agent', text: 'reply one' },
  { id: 'u2', role: 'user', text: 'second' },
  { id: 'a2', role: 'assistant', text: 'reply two' },
];

/**
 * Achieves: verifies editing a user turn keeps prior lines, trims text, and stamps an editToken.
 * Fails when: later turns remain, whitespace not trimmed, or editToken missing/wrong prefix.
 * Oracle: edit u2 → prior [u1,a1]; lines [u1,a1,u2]; text trimmed; editToken starts with 'u2:'.
 * Side effects / state checked: N/A (returns new structure).
 * Gaps: none for happy path.
 */
test('reviseThread keeps earlier lines and drops later ones', () => {
  const revised = reviseThread(thread, 'u2', '  second, edited  ');
  assert.ok(revised);
  assert.deepEqual(revised.prior.map((line) => line.id), ['u1', 'a1']);
  assert.deepEqual(revised.lines.map((line) => line.id), ['u1', 'a1', 'u2']);
  assert.equal(revised.lines[2].text, 'second, edited');
  assert.equal(typeof revised.lines[2].editToken, 'string');
  assert.ok(revised.lines[2].editToken.startsWith('u2:'));
});

/**
 * Achieves: verifies blank text, non-user lines, missing ids, and null threads are rejected.
 * Fails when: any invalid case returns a revised thread instead of null.
 * Oracle: whitespace-only, agent id, missing id, and null thread all → null.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('reviseThread rejects blank text and non-user lines', () => {
  assert.equal(reviseThread(thread, 'u2', '   '), null);
  assert.equal(reviseThread(thread, 'a1', 'nope'), null);
  assert.equal(reviseThread(thread, 'missing', 'hello'), null);
  assert.equal(reviseThread(null, 'u1', 'hello'), null);
});

test('editing text drops a resolved mention address without mutating the original', () => {
  const line = { id: 'u1', role: 'user', text: 'Hello @ada', mentionAddress: 'So11111111111111111111111111111111111111112' };
  for (const text of ['Hello @bob', 'Hello', 'Hello @ada!']) {
    const revised = reviseThread([line], 'u1', text);
    assert.equal(Object.hasOwn(revised.lines[0], 'mentionAddress'), false);
    assert.equal(line.mentionAddress, 'So11111111111111111111111111111111111111112');
  }
  assert.equal(reviseThread([line], 'u1', '  Hello @ada  ').lines[0].mentionAddress, line.mentionAddress);
  assert.equal(reviseThread([line], 'u1', ''), null);
});
