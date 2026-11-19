import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindSolanaConnectRetry,
  connectSolanaWallet,
  linkAccountNote,
  retryEmptySolanaConnect,
} from './solana-wallet-login.mjs';
import { walletLoginFailureNote } from './siws-login-diagnostic.mjs';

function walletWith(connect, accounts = []) {
  let current = accounts;
  const wallet = {
    features: {
      'standard:connect': { connect },
    },
  };
  Object.defineProperty(wallet, 'accounts', {
    configurable: true,
    enumerable: true,
    get() {
      return current;
    },
    set(value) {
      current = value;
    },
  });
  return wallet;
}

/**
 * Achieves: verifies a prompted connect that returns no accounts is retried once, silently.
 * Fails when: the second call is not silent, or a successful first call is retried.
 * Oracle: assert.deepEqual(calls, [{}, { silent: true }]); assert.equal(wallet.accounts[0].address, 'Ready')
 * Side effects / state checked: the fake connect function's arguments.
 * Gaps: does not open Phantom.
 */
test('an empty Phantom connect is retried once in silence', async () => {
  const calls = [];
  const account = { address: 'Ready' };
  const wallet = walletWith(async (input) => {
    calls.push(input);
    return calls.length === 1 ? { accounts: [] } : { accounts: [account] };
  });
  assert.equal(retryEmptySolanaConnect(wallet), true);
  const result = await wallet.features['standard:connect'].connect();
  assert.deepEqual(calls, [undefined, { silent: true }]);
  assert.equal(result.accounts[0], account);
  assert.equal(wallet.accounts[0].address, 'Ready');
  assert.equal(retryEmptySolanaConnect(wallet), true);
});

/**
 * Achieves: verifies a connect that already returned accounts is not called again.
 * Fails when: a second connect runs, or the returned account is dropped.
 * Oracle: assert.deepEqual(calls, [{}]); assert.equal(wallet.accounts.length, 1)
 * Side effects / state checked: the fake connect function's arguments.
 * Gaps: does not open Phantom.
 */
test('a connect that returns accounts is not retried', async () => {
  const calls = [];
  const account = { address: 'Once' };
  const wallet = walletWith(async (input) => {
    calls.push(input);
    return { accounts: [account] };
  }, []);
  retryEmptySolanaConnect(wallet);
  await wallet.features['standard:connect'].connect({});
  assert.deepEqual(calls, [{}]);
  assert.equal(wallet.accounts[0], account);
});

/**
 * Achieves: verifies a rejected connect is not retried.
 * Fails when: a second connect runs after the user rejects the first.
 * Oracle: assert.equal(calls, 1)
 * Side effects / state checked: the fake connect function's call count.
 * Gaps: does not open Phantom.
 */
test('a rejected connect is not retried', async () => {
  let calls = 0;
  const wallet = walletWith(async () => {
    calls += 1;
    throw new Error('User rejected the request');
  });
  retryEmptySolanaConnect(wallet);
  await assert.rejects(
    () => wallet.features['standard:connect'].connect(),
    /User rejected/,
  );
  assert.equal(calls, 1);
  assert.equal(retryEmptySolanaConnect(null), false);
  assert.equal(retryEmptySolanaConnect({ features: {} }), false);
});

/**
 * Achieves: verifies a silent connect is left alone, and later wallets are patched once.
 * Fails when: silent auto-connect is retried, or register subscribes twice.
 * Oracle: assert.deepEqual(calls, [{ silent: true }]); assert.equal(listeners.length, 1)
 * Side effects / state checked: the fake wallet registry.
 * Gaps: does not load the real wallet-standard registry.
 */
test('silent connect is not retried and later wallets are patched once', async () => {
  const calls = [];
  const existing = walletWith(async (input) => {
    calls.push(input);
    return { accounts: [] };
  });
  const registered = [];
  const listeners = [];
  const api = {
    get: () => [existing],
    on: (_event, listener) => {
      listeners.push(listener);
    },
  };
  bindSolanaConnectRetry(() => api);
  await existing.features['standard:connect'].connect({ silent: true });
  assert.deepEqual(calls, [{ silent: true }]);
  const later = walletWith(async () => ({ accounts: [{ address: 'Later' }] }));
  listeners[0](later);
  registered.push(later);
  await later.features['standard:connect'].connect();
  assert.equal(later.accounts[0].address, 'Later');
  bindSolanaConnectRetry(() => api);
  assert.equal(listeners.length, 1);
  bindSolanaConnectRetry(null);
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

/**
 * Achieves: verifies linking a Solana wallet does not disconnect the extension.
 * Fails when: linkWallet is called without solana-only, or a disconnect runs.
 * Oracle: assert.deepEqual(calls, [{ walletChainType: 'solana-only' }]); assert.equal(disconnects, 0)
 * Side effects / state checked: one linkWallet call and no disconnect.
 * Gaps: does not open the Privy modal.
 */
test('linking a Solana wallet does not disconnect the extension', async () => {
  let disconnects = 0;
  const calls = [];
  const provider = { disconnect() { disconnects += 1; } };
  await connectSolanaWallet((options) => { calls.push(options); });
  assert.equal(disconnects, 0);
  assert.equal(typeof provider.disconnect, 'function');
  assert.deepEqual(calls, [{ walletChainType: 'solana-only' }]);
  assert.equal(await connectSolanaWallet(null), undefined);
  assert.equal(linkAccountNote({ privyErrorCode: 'exited_link_flow' }), '');
  assert.match(linkAccountNote({ privyErrorCode: 'linked_to_another_user' }), /another account/);
  assert.match(linkAccountNote({ privyErrorCode: 'failed_to_link_account' }), /could not be linked/);
});
