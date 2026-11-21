import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardRowToLine } from './subagents-view.mjs';

/**
 * Achieves: subagent turns land inline in chat with task, reply, and thinking trace.
 * Fails when: the row loses activity, the role is not agent-readable, or the
 * inline block/markup drifts (header, trace, clamped reply, modal trace).
 * Oracle: boardRowToLine shape + component source regex.
 * Side effects: none.
 * Gaps: No DOM render; JSX behavior is covered by markup contract.
 */
test('subagent board rows map to inline agent lines with trace and status', () => {
  const line = boardRowToLine({
    id: 'sub_1',
    task: 'Check the price',
    skill: 'aihero',
    reply: 'It is $4.',
    activity: [{ kind: 'think', text: 'searching' }],
    status: 'done',
  }, 2);
  assert.equal(line.role, 'agent');
  assert.equal(line.text, 'It is $4.');
  assert.deepEqual(line.activity, [{ kind: 'think', text: 'searching' }]);
  assert.deepEqual(line.subagent, { task: 'Check the price', skill: 'aihero', status: 'done', ref: 2 });
  const failed = boardRowToLine({ reply: 'The subagent could not finish that step.', status: 'error' }, 0);
  assert.equal(failed.subagent.status, 'error');
  assert.equal(failed.id, 'sub-line-0');
});

test('subagent inline block shows chat plus thinking log and links to the modal', () => {
  const bubbles = readFileSync(new URL('../components/ChatBubbles.js', import.meta.url), 'utf8');
  assert.match(bubbles, /if \(line\.subagent\)/);
  assert.match(bubbles, /sub-line-head/);
  assert.match(bubbles, /<AgentTrace steps=\{steps\} \/>/);
  assert.match(bubbles, /setOpenSub\(open \? null : line\.id\)/);
  assert.match(bubbles, /sub-clamp/);
  const composer = readFileSync(new URL('../components/Composer.js', import.meta.url), 'utf8');
  assert.match(composer, /boardRowToLine\(\{ \.\.\.subRow, id: subRow\.id \|\| `turn-\$\{subIndex\}` \}, subIndex\)/);
  assert.match(composer, /\{ subagent: subLine\.subagent \}/);
  assert.match(composer, /<AgentTrace steps=\{sanitizeActivity\(row\.activity\)\} \/>/);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.sub-line-head\s*\{/);
  assert.match(css, /\.sub-clamp\s*\{/);
});
