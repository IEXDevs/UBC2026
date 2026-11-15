import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviseThread } from './talk-edit.mjs';

const thread = [
  { id: 'u1', role: 'user', text: 'first' },
  { id: 'a1', role: 'agent', text: 'reply one' },
  { id: 'u2', role: 'user', text: 'second' },
  { id: 'a2', role: 'assistant', text: 'reply two' },
];

test('reviseThread keeps earlier lines and drops later ones', () => {
  const revised = reviseThread(thread, 'u2', '  second, edited  ');
  assert.ok(revised);
  assert.deepEqual(revised.prior.map((line) => line.id), ['u1', 'a1']);
  assert.deepEqual(revised.lines.map((line) => line.id), ['u1', 'a1', 'u2']);
  assert.equal(revised.lines[2].text, 'second, edited');
  assert.equal(typeof revised.lines[2].editToken, 'string');
  assert.ok(revised.lines[2].editToken.startsWith('u2:'));
});

test('reviseThread rejects blank text and non-user lines', () => {
  assert.equal(reviseThread(thread, 'u2', '   '), null);
  assert.equal(reviseThread(thread, 'a1', 'nope'), null);
  assert.equal(reviseThread(thread, 'missing', 'hello'), null);
  assert.equal(reviseThread(null, 'u1', 'hello'), null);
});
