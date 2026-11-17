/**
 * Unit tests for resolveBuildId (apps/web/lib/build-id.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildId } from './build-id.mjs';

/**
 * Rigor audit — resolveBuildId preference order
 * Achieves: valid git SHA wins over env; env wins over 'dev'; invalid SHA ignored.
 * Fails when: non-hex head is accepted, or empty env returns undefined instead of 'dev'.
 * Oracle: SHA /^[0-9a-f]{7,40}$/i → else NEXT_PUBLIC_BUILD_ID → else 'dev'.
 * Side effects: none (head injected; no real git required).
 * Gaps: does not assert execFileSync git path (injectable head covers the branch).
 */
test('resolveBuildId prefers git SHA, then env, then dev', () => {
  assert.equal(
    resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: () => 'abc1234' }),
    'abc1234',
  );
  assert.equal(
    resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: () => 'deadbeefcafebabe0123456789abcdef01234567' }),
    'deadbeefcafebabe0123456789abcdef01234567',
  );
  assert.equal(
    resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: '  env-build  ' }, head: () => '' }),
    'env-build',
  );
  assert.equal(
    resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: () => 'not-a-sha' }),
    'from-env',
  );
  assert.equal(
    resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: 'from-env' }, head: () => 'abc12' }),
    'from-env',
  );
  assert.equal(resolveBuildId({ env: {}, head: () => '' }), 'dev');
  assert.equal(resolveBuildId({ env: { NEXT_PUBLIC_BUILD_ID: '   ' }, head: () => 'nope' }), 'dev');
  assert.equal(resolveBuildId({ env: {}, head: 'not-a-function' }), 'dev');
});
