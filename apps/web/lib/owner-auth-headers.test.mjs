/**
 * Rigor audit — owner auth headers for runtime proxy
 * Achieves: Bearer is attached when getAccessToken resolves; omitted when missing.
 * Fails when: token is dropped or secrets leak into unexpected headers.
 * Oracle: agent-runtime resolveOwner requires Bearer when Privy secrets are set.
 * Side effects: none.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ownerAuthHeaders } from './owner-auth-headers.mjs';

test('ownerAuthHeaders includes Bearer when getAccessToken returns a token', async () => {
  const headers = await ownerAuthHeaders('did:privy:u1', async () => 'tok_abc', {
    'content-type': 'application/json',
  });
  assert.equal(headers['x-owner-id'], 'did:privy:u1');
  assert.equal(headers.authorization, 'Bearer tok_abc');
  assert.equal(headers['content-type'], 'application/json');
});

test('ownerAuthHeaders omits Authorization when token is empty', async () => {
  const headers = await ownerAuthHeaders('did:privy:u1', async () => '');
  assert.equal(headers['x-owner-id'], 'did:privy:u1');
  assert.equal(headers.authorization, undefined);
});
