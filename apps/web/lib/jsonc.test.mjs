import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc } from './jsonc.mjs';

/**
 * Rigor audit — JSONC parse for wrangler configs
 * Achieves: strips // and /* *\/ comments and trailing commas; rejects non-strings.
 * Fails when: comments break parse or trailing commas remain fatal.
 * Oracle: JSON.parse after documented strip rules.
 * Side effects: none.
 * Gaps: none for strip/parse. Remaining: does not validate wrangler schema.
 */
test('parseJsonc strips comments and trailing commas', () => {
  const parsed = parseJsonc(`{
    // hello
    "name": "maelstrom", /* block */
    "list": [1, 2,],
  }`);
  assert.deepEqual(parsed, { name: 'maelstrom', list: [1, 2] });
  assert.throws(() => parseJsonc(null), TypeError);
  assert.throws(() => parseJsonc('{bad'), SyntaxError);
});
