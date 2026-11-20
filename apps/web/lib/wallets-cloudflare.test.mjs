/**
 * Rigor audit — OpenNext → agent-runtime wallet create mapping
 * Achieves: runtime success/error bodies map into the shell provision shape;
 *   TypeError messages stay secret-free.
 * Fails when: error envelopes drop codes or leak Bearer/sk_ values.
 * Oracle: mapRuntimeWalletCreate / safeFetchErrorDetail contracts.
 * Side effects: none.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasAgentRuntimeBinding,
  mapRuntimeWalletCreate,
  safeFetchErrorDetail,
} from './wallets-cloudflare.mjs';

test('mapRuntimeWalletCreate maps success and error envelopes', () => {
  assert.deepEqual(
    mapRuntimeWalletCreate({
      ok: true,
      created: true,
      wallets: [{ id: 'w1', address: 'So11111111111111111111111111111111111111112' }],
      loginMethods: ['email'],
    }),
    {
      created: true,
      wallets: [{ id: 'w1', address: 'So11111111111111111111111111111111111111112' }],
      loginMethods: ['email'],
    },
  );
  assert.deepEqual(
    mapRuntimeWalletCreate({ error: 'privy_failed', detail: 'Privy users failed (401)' }),
    { error: 'privy_failed', detail: 'Privy users failed (401)' },
  );
  assert.equal(mapRuntimeWalletCreate(null).error, 'wallet_failed');
});

test('safeFetchErrorDetail redacts secrets and keeps TypeError text', () => {
  const error = new TypeError('Fetch failed for Bearer sk_live_super_secret_value_abcdef');
  const detail = safeFetchErrorDetail(error);
  assert.match(detail, /TypeError/);
  assert.match(detail, /Fetch failed/);
  assert.equal(detail.includes('sk_live_super_secret'), false);
  assert.match(detail, /Bearer \[redacted\]|sk_\[redacted\]/);
});

test('hasAgentRuntimeBinding requires a fetchable binding', () => {
  assert.equal(hasAgentRuntimeBinding({}), false);
  assert.equal(hasAgentRuntimeBinding({ AGENT_RUNTIME: {} }), false);
  assert.equal(hasAgentRuntimeBinding({ AGENT_RUNTIME: { fetch: async () => new Response('ok') } }), true);
});
