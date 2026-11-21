import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainAgentState, subagentLabel, visibleSubagents } from './subagents-view.mjs';

/**
 * Achieves: subagent strip shows only rows with replies, hides while autocomplete is open.
 * Fails when: empty rows leak in, suggesting does not hide the strip, or history grows unbounded.
 * Oracle: hand-built rows; suggesting=true must yield [].
 * Side effects: none.
 * Gaps: JSX rendering is covered by the Composer markup, not here.
 */
test('subagent strip filters empties, hides while suggesting, and caps at eight', () => {
  const rows = [
    { id: 'a', task: 'Check the price', skill: '', reply: '  ' },
    { id: 'b', task: 'Check the price', skill: '', reply: 'It is $4.' },
    { id: 'c', task: '', skill: 'aihero', reply: 'Done.' },
  ];
  assert.deepEqual(visibleSubagents(rows, false).map(row => row.id), ['b', 'c']);
  assert.deepEqual(visibleSubagents(rows, true), []);
  assert.deepEqual(visibleSubagents(null, false), []);
  const withTrace = visibleSubagents(
    [{ id: 't', task: 't', skill: '', reply: 'r', activity: [{ kind: 'think', text: 'hmm' }], status: 'error' }],
    false,
  );
  assert.deepEqual(withTrace[0].activity, [{ kind: 'think', text: 'hmm' }]);
  assert.equal(withTrace[0].status, 'error');
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, task: '', skill: '', reply: `r${i}` }));
  assert.equal(visibleSubagents(many, false).length, 8);
});

/**
 * Achieves: pill labels prefer the task, fall back to /skill, then Subagent.
 * Fails when: long tasks overflow or the fallback order drifts.
 * Oracle: fixed strings.
 * Side effects: none.
 * Gaps: none.
 */
test('subagent labels prefer task text and main state reads working or waiting', () => {
  assert.equal(subagentLabel({ task: 'Find it', skill: 'aihero' }), 'Find it');
  assert.equal(subagentLabel({ task: '', skill: 'aihero' }), '/aihero');
  assert.equal(subagentLabel({}), 'Subagent');
  assert.equal(subagentLabel({ task: `x`.repeat(80), skill: '' }).length, 58);
  assert.equal(mainAgentState(true), 'working');
  assert.equal(mainAgentState(false), 'waiting');
});
