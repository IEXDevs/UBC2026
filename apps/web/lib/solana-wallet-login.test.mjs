import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseInjectedSolanaWallets } from './solana-wallet-login.mjs';
import { walletLoginFailureNote } from './siws-login-diagnostic.mjs';

/**
 * Achieves: verifies a stale injected session is disconnected once before login.
 * Fails when: a stale injected session is disconnected once before login breaks (e.g. expected 1, 1, 0).
 * Oracle: assert.equal(phantom.calls, 1); assert.equal(legacy.calls, 1); assert.equal(shared.calls, 1)
 * Side effects / state checked: in-memory provider disconnect calls.
 * Gaps: does not open Phantom.
 */
test('a stale injected session is disconnected once before login', async () => {
  const phantom = { calls: 0, disconnect() { this.calls += 1; } };
  const legacy = { calls: 0, async disconnect() { this.calls += 1; } };
  const shared = { calls: 0, disconnect() { this.calls += 1; throw new Error('not connected'); } };
  await releaseInjectedSolanaWallets({
    phantom: { solana: phantom },
    solflare: shared,
    backpack: shared,
    solana: legacy,
  });
  assert.equal(phantom.calls, 1);
  assert.equal(legacy.calls, 1);
  assert.equal(shared.calls, 1);
  await releaseInjectedSolanaWallets({ solana: { connect() {} } });
  await releaseInjectedSolanaWallets(null);
});

/**
 * Achieves: verifies the sign-in card names the SIWS code and drops secrets.
 * Fails when: the sign-in card names the SIWS code and drops secrets breaks (e.g. expected /Disconnect the site/, '').
 * Oracle: assert.match(walletLoginFailureNote('[wallet-login] siws/authenticate 400 invalid_data'), /Disconnect the site/); assert.equal(walletLoginFailureNote('sig-secret'), '')
 * Side effects / state checked: none.
 * Gaps: the Privy modal text stays generic.
 */
test('the sign-in card names the SIWS code and drops secrets', () => {
  assert.match(
    walletLoginFailureNote('[wallet-login] siws/authenticate 400 invalid_data'),
    /Disconnect the site/,
  );
  assert.match(
    walletLoginFailureNote('[wallet-login] siws/init 403 disallowed_login_method'),
    /turned off/,
  );
  assert.match(
    walletLoginFailureNote('[wallet-login] siws/authenticate 400 linked_to_another_user'),
    /another account/,
  );
  assert.match(
    walletLoginFailureNote('[wallet-login] siws/init network siws_failed'),
    /did not reach Privy/,
  );
  assert.equal(walletLoginFailureNote('header.payload.signature'), '');
  assert.equal(walletLoginFailureNote(''), '');
});
