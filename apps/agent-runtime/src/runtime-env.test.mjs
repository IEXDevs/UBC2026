/**
 * Dedicated enrichEnv coverage (also smoke-tested via api-data.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichEnv } from './runtime-env.mjs';

function baseEnv(extra = {}) {
  return {
    PRODUCT: 'Maelstrom',
    SOLANA_CLUSTER: 'mainnet-beta',
    ...extra,
  };
}

/**
 * Achieves: non-objects pass through; first enrich sets __maelstromEnriched;
 *   second enrich is identity; injectables win over auto-wiring.
 * Fails when: primitives are wrapped, or injectables are overwritten.
 * Oracle: identity equality; reference equality for injectables.
 * Side effects / state checked: none.
 * Gaps: Privy client construction with real secrets not exercised here.
 */
test('enrichEnv is a no-op for non-objects and idempotent for objects', () => {
  assert.equal(enrichEnv(null), null);
  assert.equal(enrichEnv(undefined), undefined);
  assert.equal(enrichEnv('x'), 'x');

  const transferClient = { signAndBroadcastSolana: async () => ({}) };
  const loadLoopContext = async () => ({});
  const signShoppingPayment = async () => 'sig';
  const executeSnsTransfer = async () => ({ signature: 's' });
  const once = enrichEnv(baseEnv({
    transferClient,
    loadLoopContext,
    signShoppingPayment,
    executeSnsTransfer,
  }));
  assert.equal(once.__maelstromEnriched, true);
  assert.equal(once.transferClient, transferClient);
  assert.equal(once.loadLoopContext, loadLoopContext);
  assert.equal(once.signShoppingPayment, signShoppingPayment);
  assert.equal(once.executeSnsTransfer, executeSnsTransfer);
  assert.equal(enrichEnv(once), once);
});

/**
 * Achieves: without Privy secrets, transferClient stays null and shopping/SNS
 *   wrappers are also null; with an injected client, wrappers are functions that
 *   require bot+wallet.
 * Fails when: missing secrets invent a client, or wrappers skip bot/wallet checks.
 * Oracle: null client; wrapper throws bot_and_wallet_required.
 * Side effects / state checked: none (no network).
 * Gaps: successful wrapShoppingSigner/wrapSnsExecutor signing paths need Privy
 *   doubles — covered via spend/commerce suites.
 */
test('enrichEnv leaves transferClient null without Privy and wraps injectables', async () => {
  const bare = enrichEnv(baseEnv());
  assert.equal(bare.transferClient, null);
  assert.equal(bare.signShoppingPayment, null);
  assert.equal(bare.executeSnsTransfer, null);

  const client = {
    getSolanaBlockhash: async () => ({ cluster: 'mainnet-beta', blockhash: 'bh' }),
    signAndBroadcastSolana: async () => ({ cluster: 'mainnet-beta', signature: 'sig' }),
  };
  const wired = enrichEnv(baseEnv({ transferClient: client }));
  assert.equal(typeof wired.signShoppingPayment, 'function');
  assert.equal(typeof wired.executeSnsTransfer, 'function');
  await assert.rejects(
    () => wired.signShoppingPayment({ amount: '1', payTo: 'x' }),
    err => err?.code === 'bot_and_wallet_required',
  );
  await assert.rejects(
    () => wired.executeSnsTransfer({ amount: '1', to: 'x' }),
    err => err?.code === 'bot_and_wallet_required',
  );
});

/**
 * Achieves: supabaseConfig presence installs loadLoopContext; injected supabaseRpc wins.
 * Fails when: configured env skips loadLoopContext, or injected rpc is replaced.
 * Oracle: typeof loadLoopContext; reference equality for supabaseRpc.
 * Side effects / state checked: none.
 * Gaps: loadOwnerLoopContext HTTP paths covered in supabase-rest.test.mjs.
 */
test('enrichEnv wires loadLoopContext when Supabase is configured', () => {
  const rpc = async () => ({});
  const withRpc = enrichEnv(baseEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    supabaseRpc: rpc,
  }));
  assert.equal(withRpc.supabaseRpc, rpc);
  assert.equal(typeof withRpc.loadLoopContext, 'function');
});
