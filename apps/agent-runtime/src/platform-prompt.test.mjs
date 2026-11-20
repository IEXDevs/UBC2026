/**
 * Unit tests for the locked PLATFORM_PROMPT constants.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_PROMPT, PLATFORM_PROMPT_VERSION } from './platform-prompt.mjs';

/**
 * Achieves: platform prompt stays versioned and locks the hard rules bots cannot override.
 * Fails when: version drifts without review, or a locked rule string is dropped.
 * Oracle: VERSION === 1; substring presence for each locked rule.
 * Side effects / state checked: none.
 * Gaps: does not assert prompt is injected into every model call (voice/openrouter suites).
 */
test('PLATFORM_PROMPT locks versioned company rules', () => {
  assert.equal(PLATFORM_PROMPT_VERSION, 1);
  assert.equal(typeof PLATFORM_PROMPT, 'string');
  assert.match(PLATFORM_PROMPT, /locked/i);
  assert.match(PLATFORM_PROMPT, /mainnet-beta only/i);
  assert.match(PLATFORM_PROMPT, /Never ask for.*private keys/i);
  assert.match(PLATFORM_PROMPT, /do not sign/i);
  assert.match(PLATFORM_PROMPT, /You can request actions from the platform gate/);
  assert.match(PLATFORM_PROMPT, /Maelstrom bot/);
  assert.match(PLATFORM_PROMPT, /No meme coins/i);
  assert.ok(!PLATFORM_PROMPT.includes('\n\n\n'), 'prompt should be single joined block');
});
