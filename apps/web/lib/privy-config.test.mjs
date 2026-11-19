import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeLoginMethods,
  ownerIdFromPrivyUser,
  privyAccountLabel,
  privyProviderProps,
  sessionReadyForWallets,
} from './privy-config.mjs';

/**
 * Achieves: verifies Privy provider props stay public and Solana-only.
 * Fails when: Privy provider props stay public and Solana-only breaks (e.g. expected null, null, 'cl-app').
 * Oracle: assert.equal(privyProviderProps({ appId: ' ' }), null); assert.equal(privyProviderProps({}), null); assert.equal(props.appId, 'cl-app'); assert.equal(props.clientId, 'client-1'); assert.equal(props.config.appearance.walletChainType, 'solana-only'); assert.equal(props.config.embeddedWallets.ethereum.createOnLogin, 'off')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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
  assert.equal(props.config.embeddedWallets.solana.createOnLogin, 'off');
  assert.equal(props.config.mfa.noPromptOnMfaRequired, false);
  assert.equal(props.config.sessions.cookieWriteBehavior, 'never');
  assert.deepEqual(props.config.loginMethods, ['email', 'google', 'github', 'discord', 'wallet']);
  assert.equal(props.config.loginMethods.includes('sms'), false);
  assert.equal(props.config.loginMethods.includes('passkey'), false);
  assert.equal(JSON.stringify(props.config).includes('"password"'), false);

  const withoutClient = privyProviderProps({ appId: 'cl-app' });
  assert.equal(withoutClient.clientId, undefined);

  const serialized = JSON.stringify(props);
  assert.equal(serialized.includes('PRIVY_APP_SECRET'), false);
  assert.equal(serialized.includes('QUICKNODE'), false);
  assert.equal(serialized.includes('http'), false);
});

/**
 * Achieves: verifies linked wallets and login methods stay on one user.
 * Fails when: linked wallets and login methods stay on one user breaks (e.g. expected 'did:privy:one', ['phantom', 'solflare'], false).
 * Oracle: assert.equal(described.userId, 'did:privy:one'); assert.equal(described.wallets[0].spendable, false); assert.equal(described.methods.find(method => method.id === 'email').linked, true); assert.equal(described.methods.find(method => method.id === 'email').detail, 'a@example.com'); assert.equal(described.methods.find(method => method.id === 'github').linked, false); assert.equal(described.methods.find(method => method.id === 'discord').linked, false)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('linked wallets and login methods stay on one user', () => {
  const phantom = 'So11111111111111111111111111111111111111112';
  const extra = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const described = describeLoginMethods({
    id: 'did:privy:one',
    linkedAccounts: [
      { type: 'email', address: 'a@example.com' },
      { type: 'google_oauth', email: 'g@example.com' },
      { type: 'wallet', address: phantom, chainType: 'solana', walletClientType: 'phantom' },
      { type: 'wallet', address: extra, chainType: 'solana', walletClientType: 'solflare' },
      { type: 'wallet', address: phantom, chainType: 'solana', walletClientType: 'phantom' },
      { type: 'wallet', address: '0xabc', chainType: 'ethereum', walletClientType: 'metamask' },
    ],
  });
  assert.equal(described.userId, 'did:privy:one');
  assert.deepEqual(described.wallets.map(wallet => wallet.client), ['phantom', 'solflare']);
  assert.equal(described.wallets[0].spendable, false);
  assert.equal(described.methods.find(method => method.id === 'email').linked, true);
  assert.equal(described.methods.find(method => method.id === 'email').detail, 'a@example.com');
  assert.equal(described.methods.find(method => method.id === 'github').linked, false);
  assert.equal(described.methods.find(method => method.id === 'discord').linked, false);
});

/**
 * Achieves: verifies wallet provisioning runs once Privy reports a signed-in user.
 * Fails when: wallet provisioning runs once Privy reports a signed-in user breaks (e.g. expected user, null, user).
 * Oracle: assert.equal(sessionReadyForWallets(false, user); assert.equal(sessionReadyForWallets(true, null); assert.equal(sessionReadyForWallets(true, user); assert.equal(sessionReadyForWallets(true, { id: 'did:privy:abc' })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('wallet provisioning runs once Privy reports a signed-in user', () => {
  const user = { id: 'did:privy:abc', hasAcceptedTerms: false };
  assert.equal(sessionReadyForWallets(false, user), false);
  assert.equal(sessionReadyForWallets(true, null), false);
  assert.equal(sessionReadyForWallets(true, user), true);
  assert.equal(sessionReadyForWallets(true, { id: 'did:privy:abc' }), true);
});

/**
 * Achieves: verifies owner id comes from an authenticated Privy user.
 * Fails when: owner id comes from an authenticated Privy user breaks (e.g. expected true, false, true).
 * Oracle: assert.equal(ownerIdFromPrivyUser({ id: 'did:privy:abc' }, true); assert.equal(ownerIdFromPrivyUser({ id: 'did:privy:abc' }, false); assert.equal(ownerIdFromPrivyUser(null, true); assert.equal(privyAccountLabel({ email: { address: 'a@example.com' }, id: 'did:privy:abc' }); assert.equal(privyAccountLabel({ google: { email: 'g@example.com' } }), 'g@example.com'); assert.equal(privyAccountLabel({ github: { username: 'octocat' } }), '@octocat')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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
  assert.equal(privyAccountLabel({ wallet: { address: 'So11111111111111111111111111111111111111112' } }), 'So111...11112');
});
