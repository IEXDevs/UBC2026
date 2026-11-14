import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerIdFromPrivyUser, privyAccountLabel, privyProviderProps } from './privy-config.mjs';

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
  assert.equal(props.config.embeddedWallets.solana.createOnLogin, 'users-without-wallets');
  assert.deepEqual(props.config.loginMethods, ['email', 'wallet']);

  const withoutClient = privyProviderProps({ appId: 'cl-app' });
  assert.equal(withoutClient.clientId, undefined);

  const serialized = JSON.stringify(props);
  assert.equal(serialized.includes('PRIVY_APP_SECRET'), false);
  assert.equal(serialized.includes('QUICKNODE'), false);
  assert.equal(serialized.includes('http'), false);
});

test('owner id comes from an authenticated Privy user', () => {
  assert.equal(ownerIdFromPrivyUser({ id: 'did:privy:abc' }, true), 'did:privy:abc');
  assert.equal(ownerIdFromPrivyUser({ id: 'did:privy:abc' }, false), null);
  assert.equal(ownerIdFromPrivyUser(null, true), null);
  assert.equal(privyAccountLabel({ email: { address: 'a@example.com' }, id: 'did:privy:abc' }), 'a@example.com');
  assert.equal(privyAccountLabel({ wallet: { address: 'So11111111111111111111111111111111111111112' } }), 'So11…1112');
});
