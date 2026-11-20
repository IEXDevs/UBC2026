import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKED_TURN, parseTurnVerdict, turnVerifyTask } from './turn.mjs';

test('a turn verdict allows only an explicit JSON allow', () => {
  assert.deepEqual(parseTurnVerdict('{"allow":true}'), { allow: true });
  assert.deepEqual(parseTurnVerdict('note {"allow":false}'), { allow: false });
  assert.equal(parseTurnVerdict('watching').allow, false);
  assert.equal(parseTurnVerdict('').allow, false);
  assert.match(turnVerifyTask('tool', { name: 'web_search' }), /Role: turn-verify/);
  assert.match(BLOCKED_TURN, /did not pass the check/);
});
