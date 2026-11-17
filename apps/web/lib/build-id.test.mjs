import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildId } from './build-id.mjs';

/**
 * Rigor audit — resolveBuildId preference order
 * Achieves: git head SHA wins; else NEXT_PUBLIC_BUILD_ID; else 'dev'.
 * Fails when: invalid SHA is accepted, or env ignored when head empty.
 * Oracle: SHA regex + documented fallback chain.
 * Side effects: none (injected head/env).
 * Gaps: none.
 */
test('resolveBuildId prefers git head then env then dev', () => {
  assert.equal(resolveBuildId({ head: () => 'abc1234', env: {} }), 'abc1234');
  assert.equal(
    resolveBuildId({ head: () => 'not-a-sha', env: { NEXT_PUBLIC_BUILD_ID: 'build_9' } }),
    'build_9',
  );
  assert.equal(resolveBuildId({ head: () => '', env: {} }), 'dev');
  assert.equal(resolveBuildId({ head: () => null, env: { NEXT_PUBLIC_BUILD_ID: '  x  ' } }), 'x');
});
