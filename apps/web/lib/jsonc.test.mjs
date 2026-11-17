/**
 * Unit tests for parseJsonc (wrangler.jsonc assertions).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc } from './jsonc.mjs';

/**
 * Rigor audit — parseJsonc comment and trailing-comma stripping
 * Achieves: block/line comments and trailing commas are removed before JSON.parse.
 * Fails when: comments remain and JSON.parse throws, or valid wrangler-like JSONC fails.
 * Oracle: strip block comments, line comments, then trailing commas before }/].
 * Side effects: none.
 * Gaps: does not implement a full JSONC grammar (strings containing // are out of scope).
 */
test('parseJsonc strips comments and trailing commas', () => {
  const parsed = parseJsonc(`
    {
      // line comment
      "name": "maelstrom",
      "vars": {
        "DEV_PREVIEW": "0", /* inline */
      },
      "list": [1, 2,],
    }
  `);
  assert.deepEqual(parsed, {
    name: 'maelstrom',
    vars: { DEV_PREVIEW: '0' },
    list: [1, 2],
  });
});

/**
 * Rigor audit — parseJsonc invalid inputs
 * Achieves: non-string input → TypeError; broken JSON after strip → SyntaxError.
 * Fails when: null/undefined are coerced silently or invalid JSON returns {}.
 * Oracle: TypeError('JSONC text is required'); JSON.parse errors propagate.
 * Side effects: none.
 * Gaps: none for error surface.
 */
test('parseJsonc rejects non-string and invalid JSON', () => {
  assert.throws(() => parseJsonc(null), TypeError);
  assert.throws(() => parseJsonc(undefined), TypeError);
  assert.throws(() => parseJsonc(12), TypeError);
  assert.throws(() => parseJsonc('{'), SyntaxError);
  assert.throws(() => parseJsonc('{ "a": }'), SyntaxError);
});
