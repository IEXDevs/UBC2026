import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIVY_AUTH_API_URL,
  describeLoginMethods,
  ownerIdFromPrivyUser,
  privyAccountLabel,
  privyProviderProps,
  sessionReadyForWallets,
} from './privy-config.mjs';

test('Privy provider props stay public and Solana-only', () => {
  assert.equal(privyProviderProps({ appId: '  ' }), null);
  assert.equal(privyProviderProps({}), null);

  const props = privyProviderProps({
    appId: ' cl-app ',
    clientId: ' client-1 ',
  });
  assert.equal(props.appId, 'cl-app');
  assert.equal(props.clientId, 'client-1');
  assert.equal(props.apiUrl, PRIVY_AUTH_API_URL);
  assert.equal(props.apiUrl, 'https://auth.privy.io');
  assert.doesNotMatch(props.apiUrl, /privy-auth/);
  assert.equal(props.config.captchaEnabled, false);
  assert.equal(props.config.sessions.cookieWriteBehavior, 'never');
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
  assert.deepEqual(props.config.loginMethods, ['email', 'google', 'github', 'discord', 'wallet']);

  const withoutClient = privyProviderProps({ appId: 'cl-app' });
  assert.equal(withoutClient.clientId, undefined);

  const serialized = JSON.stringify(props);
  assert.equal(serialized.includes('PRIVY_APP_SECRET'), false);
  assert.equal(serialized.includes('QUICKNODE'), false);
  assert.equal(serialized.includes('/api/privy-auth'), false);
});

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

test('wallet provisioning runs once Privy reports a signed-in user', () => {
  const user = { id: 'did:privy:abc', hasAcceptedTerms: false };
  assert.equal(sessionReadyForWallets(false, user), false);
  assert.equal(sessionReadyForWallets(true, null), false);
  assert.equal(sessionReadyForWallets(true, user), true);
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
  assert.equal(privyAccountLabel({ wallet: { address: 'So11111111111111111111111111111111111111112' } }), 'So111...11112');
});

test('PrivyRoot pins apiUrl and does not mount a same-origin auth proxy', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const source = readFileSync(join(root, 'components/PrivyRoot.js'), 'utf8');
  assert.match(source, /apiUrl: props\.apiUrl/);
  assert.match(source, /toSolanaWalletConnectors/);
  assert.doesNotMatch(source, /['"`]\/api\/privy-auth/);
});
