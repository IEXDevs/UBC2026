import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computerStatus, countOpenBrowserSessions } from './computer-status.mjs';

test('open browser sessions make the computer Awake even when the bot is idle', () => {
  assert.equal(computerStatus({ openSessionCount: 0, botStatus: 'idle' }), 'Asleep');
  assert.equal(computerStatus({ openSessionCount: 0, botStatus: 'watching' }), 'Asleep');
  assert.equal(computerStatus({ openSessionCount: 1, botStatus: 'idle' }), 'Awake');
  assert.equal(computerStatus({ openSessionCount: 2, botStatus: 'watching' }), 'Awake');
  assert.equal(computerStatus({ openSessionCount: 0, botStatus: 'paused' }), 'Paused');
  assert.equal(computerStatus({ openSessionCount: 1, botStatus: 'paused' }), 'Awake');
});

test('countOpenBrowserSessions ignores closed and malformed rows', () => {
  assert.equal(countOpenBrowserSessions(null), 0);
  assert.equal(countOpenBrowserSessions({ sessions: [] }), 0);
  assert.equal(countOpenBrowserSessions({
    sessions: [
      { sessionRecordId: 'bs_1', status: 'open' },
      { sessionRecordId: 'bs_2', status: 'closed' },
      { status: 'open' },
      null,
    ],
  }), 1);
  assert.equal(countOpenBrowserSessions([
    { sessionRecordId: 'bs_a', status: 'open' },
    { sessionRecordId: 'bs_b' },
  ]), 2);
});
