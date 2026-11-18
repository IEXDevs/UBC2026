import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipOwnerMessage,
  compactLines,
  contextTone,
  contextUsage,
  contextWindowFor,
  estimateTokens,
  formatTokens,
  inputBudget,
  MESSAGE_CHAR_CAP,
} from './context-usage.mjs';

/**
 * Achieves: verifies an empty thread reports zero usage against the 128k window.
 * Fails when: empty input invents tokens/messages or changes the limit.
 * Oracle: all counters 0; limit 128000.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies user lines count as messages/input and tone colors escalate with percent.
 * Fails when: assistant lines count as messages, token estimate drifts, or tone thresholds mis-map.
 * Oracle: 8 a's → 2 tokens; messages=2; input=3; output=1; used=4; tones grey→yellow→amber→red.
 * Side effects / state checked: N/A.
 * Gaps: none for estimators.
 */
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

/**
 * Achieves: verifies compaction marks older lines and keeps the recent tail under a tiny window.
 * Fails when: recent id is dropped, compacted flag missing, or percent does not decrease after compact.
 * Oracle: limit 80 → first line compacted; last id 'c'; percent(next) < percent(lines); huge limit keeps length 3.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

test('the context window follows the model and a reported endpoint size', () => {
  assert.equal(contextWindowFor('muse-spark-1.3-contributor'), 1_048_576);
  assert.equal(contextWindowFor('meta-llama/llama-3.3-70b-instruct:free'), 131_072);
  assert.equal(contextWindowFor('unknown-model'), 128000);
  assert.equal(contextWindowFor('muse-spark-1.3-contributor', 32000), 32000);
  assert.equal(inputBudget(1_048_576), 1_048_576 - 8192);
  assert.equal(clipOwnerMessage('x'.repeat(600)).length, MESSAGE_CHAR_CAP);
});
