import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerIdFromPrivyUser, privyAccountLabel, privyProviderProps, sessionReadyForWallets } from './privy-config.mjs';

test('Privy provider props stay public and Solana-only', () => {
  assert.equal(privyProviderProps({ appId: '  ' }), null);
  assert.equal(privyProviderProps({}), null);

  const props = privyProviderProps({
    appId: ' cl-app ',
    clientId: ' client-1 ',
  });
  assert.equal(props.appId, 'cl-app');
  assert.equal(props.clientId, 'client-1');
  assert.equal(props.config.appearance.walletChainType, 'solana-only');
  assert.deepEqual(props.config.appearance.walletList, [
    'detected_solana_wallets',
    'phantom',
    'solflare',
    'backpack',
    'jupiter',
  ]);
  assert.equal(props.config.embeddedWallets.ethereum.createOnLogin, 'off');
  assert.equal(props.config.embeddedWallets.solana.createOnLogin, 'all-users');
  assert.equal(props.config.mfa.noPromptOnMfaRequired, false);
  assert.deepEqual(props.config.loginMethods, ['email', 'google', 'github', 'discord', 'wallet']);

  const withoutClient = privyProviderProps({ appId: 'cl-app' });
  assert.equal(withoutClient.clientId, undefined);

  const serialized = JSON.stringify(props);
  assert.equal(serialized.includes('PRIVY_APP_SECRET'), false);
  assert.equal(serialized.includes('QUICKNODE'), false);
  assert.equal(serialized.includes('http'), false);
});

test('wallet provisioning waits until Privy terms are accepted', () => {
  const user = { id: 'did:privy:abc', hasAcceptedTerms: false };
  assert.equal(sessionReadyForWallets(false, user), false);
  assert.equal(sessionReadyForWallets(true, null), false);
  assert.equal(sessionReadyForWallets(true, user), false);
  assert.equal(sessionReadyForWallets(true, { ...user, hasAcceptedTerms: true }), true);
  assert.equal(sessionReadyForWallets(true, { id: 'did:privy:abc' }), true);
});

test('owner id comes from an authenticated Privy user', () => {
  assert.equal(ownerIdFromPrivyUser({ id: 'did:privy:abc' }, true), 'did:privy:abc');
  assert.equal(ownerIdFromPrivyUser({ id: 'did:privy:abc' }, false), null);
  assert.equal(ownerIdFromPrivyUser(null, true), null);
  assert.equal(privyAccountLabel({ email: { address: 'a@example.com' }, id: 'did:privy:abc' }), 'a@example.com');
  assert.equal(privyAccountLabel({ google: { email: 'g@example.com' } }), 'g@example.com');
  assert.equal(privyAccountLabel({ github: { username: 'octocat' } }), '@octocat');
  assert.equal(privyAccountLabel({ discord: { username: 'mage#1234' } }), 'mage#1234');
  assert.equal(
    privyAccountLabel({
      linkedAccounts: [{ type: 'github_oauth', username: 'linked-gh' }],
    }),
    '@linked-gh',
  );
  assert.equal(privyAccountLabel({ wallet: { address: 'So11111111111111111111111111111111111111112' } }), 'So11…1112');
});
