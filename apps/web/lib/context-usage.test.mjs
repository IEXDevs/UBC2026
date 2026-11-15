import assert from 'node:assert/strict';
import test from 'node:test';
import { compactLines, contextTone, contextUsage, estimateTokens, formatTokens } from './context-usage.mjs';

test('empty thread uses none of the window', () => {
  assert.deepEqual(contextUsage([]), {
    input: 0,
    output: 0,
    used: 0,
    limit: 128000,
    messages: 0,
    percent: 0,
    compacted: 0,
  });
});

test('user lines count as messages and input tokens', () => {
  const usage = contextUsage([
    { role: 'user', text: 'a'.repeat(8) },
    { role: 'assistant', text: 'b'.repeat(4) },
    { role: 'user', text: 'hi' },
  ]);
  assert.equal(estimateTokens('a'.repeat(8)), 2);
  assert.equal(usage.messages, 2);
  assert.equal(usage.input, 3);
  assert.equal(usage.output, 1);
  assert.equal(usage.used, 4);
  assert.equal(formatTokens(1500), '1.5K');
  assert.equal(usage.compacted, 0);
  assert.equal(contextTone(10), '#a3a3a3');
  assert.equal(contextTone(60), '#eab308');
  assert.equal(contextTone(80), '#f59e0b');
  assert.equal(contextTone(95), '#ef4444');
});

test('a full window compacts earlier messages and keeps the recent tail', () => {
  const lines = [
    { id: 'a', role: 'user', text: 'x'.repeat(200) },
    { id: 'b', role: 'assistant', text: 'y'.repeat(200) },
    { id: 'c', role: 'user', text: 'recent' },
  ];
  const next = compactLines(lines, 80);
  assert.equal(next[0].compacted, true);
  assert.equal(next.at(-1).id, 'c');
  assert.ok(contextUsage(next, 80).percent < contextUsage(lines, 80).percent);
  assert.equal(compactLines(lines, 128000).length, 3);
});
