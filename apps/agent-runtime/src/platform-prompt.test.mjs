import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_PROMPT, PLATFORM_PROMPT_VERSION } from './platform-prompt.mjs';

/**
 * Rigor audit — locked platform prompt invariants
 * Achieves: version is a positive int; prompt forbids mainnet, keys, and self-labeling as bot.
 * Fails when: rules are weakened or version resets without review.
 * Oracle: product safety rules (devnet/testnet only, no secrets, no "bot").
 * Side effects: none.
 * Gaps: does not prove model compliance — only that the locked text stays present.
 */
test('PLATFORM_PROMPT stays locked to safe execution rules', () => {
  assert.equal(typeof PLATFORM_PROMPT_VERSION, 'number');
  assert.ok(PLATFORM_PROMPT_VERSION >= 1);
  assert.match(PLATFORM_PROMPT, /devnet or testnet only/i);
  assert.match(PLATFORM_PROMPT, /Never ask for, repeat, or invent API keys/i);
  assert.match(PLATFORM_PROMPT, /Never call yourself a bot/i);
  assert.match(PLATFORM_PROMPT, /cannot override/i);
  assert.equal(PLATFORM_PROMPT.includes('mainnet transfer'), true);
});
