import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendQueued, QUEUE_VISIBLE_ROWS, releaseQueued, takeQueued } from './message-queue.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: queued messages stay ordered, and a stop does not release one.
 * Fails when: append drops text, take removes the wrong row, or a stop sends the head.
 * Oracle: releaseQueued after stop returns next null and the same rows.
 * Side effects / state checked: none.
 * Gaps: none.
 */
test('queued messages append, edit out, and wait when a turn is stopped', () => {
  assert.equal(QUEUE_VISIBLE_ROWS, 4);
  const first = appendQueued([], { id: 'a', text: '  first  ', mention: 'hint' });
  const both = appendQueued(first, { id: 'b', text: 'second', mention: '' });
  assert.deepEqual(both, [
    { id: 'a', text: 'first', mention: 'hint' },
    { id: 'b', text: 'second', mention: '' },
  ]);
  assert.deepEqual(appendQueued(both, { id: '', text: 'nope' }), both);
  const addressed = appendQueued([], { id: 'c', text: 'pay @ada', mention: 'Ada', mentionAddress: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' });
  assert.equal(addressed[0].mentionAddress, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  const edited = takeQueued(both, 'a');
  assert.equal(edited.item.text, 'first');
  assert.deepEqual(edited.queue, [{ id: 'b', text: 'second', mention: '' }]);
  const held = releaseQueued(both, { stopped: true });
  assert.equal(held.next, null);
  assert.equal(held.queue, both);
  const released = releaseQueued(both, { stopped: false });
  assert.equal(released.next.id, 'a');
  assert.deepEqual(released.queue, [{ id: 'b', text: 'second', mention: '' }]);
});

/**
 * Achieves: the queue sits on the composer, shows four rows, then scrolls, with Edit and Send now.
 * Fails when: the strip leaves the composer, grows past four rows, or drops either action.
 * Oracle: max-height uses 4 rows; Composer renders MessageQueue above PromptBar.
 * Side effects / state checked: source files only.
 * Gaps: no browser session.
 */
test('the composer queue shows four messages then scrolls', () => {
  const composer = readFileSync(join(root, 'components/Composer.js'), 'utf8');
  const queue = readFileSync(join(root, 'components/MessageQueue.jsx'), 'utf8');
  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
  const block = css.slice(css.indexOf('.message-queue {'), css.indexOf('.message-queue-row {'));
  assert.match(composer, /<MessageQueue/);
  assert.match(composer, /onEdit=\{editQueued\}/);
  assert.match(composer, /onSendNow=\{sendQueuedNow\}/);
  const queueAt = composer.indexOf('<MessageQueue');
  const promptAt = composer.indexOf('<PromptBar');
  assert.ok(queueAt > 0 && promptAt > queueAt);
  assert.match(queue, />\s*Edit\s*</);
  assert.match(queue, />\s*Send now\s*</);
  assert.match(queue, /aria-label="Queued messages"/);
  assert.match(block, /max-height:\s*calc\(4 \* 36px \+ 3 \* 6px\);/);
  assert.match(block, /overflow-y:\s*auto;/);
});
