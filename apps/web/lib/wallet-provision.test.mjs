import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  missingWalletSecrets,
  resolvePrivyAppId,
  walletProvisionNote,
  walletsFromPrivyUser,
} from './wallet-provision.mjs';

test('missing wallet secrets allow public app id as PRIVY_APP_ID', () => {
  assert.deepEqual(
    missingWalletSecrets({
      NEXT_PUBLIC_PRIVY_APP_ID: 'app_1',
      PRIVY_APP_SECRET: 'secret',
    }),
    [],
  );
  assert.deepEqual(
    missingWalletSecrets({ NEXT_PUBLIC_PRIVY_APP_ID: 'app_1' }),
    ['PRIVY_APP_SECRET'],
  );
  assert.equal(resolvePrivyAppId({ NEXT_PUBLIC_PRIVY_APP_ID: ' app_1 ' }), 'app_1');
  assert.equal(resolvePrivyAppId({ PRIVY_APP_ID: 'server', NEXT_PUBLIC_PRIVY_APP_ID: 'pub' }), 'server');
});

test('walletsFromPrivyUser maps createOnLogin Solana embedded addresses', () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const wallets = walletsFromPrivyUser({
    linkedAccounts: [
      {
        type: 'wallet',
        id: null,
        address,
        chainType: 'solana',
        walletClientType: 'privy',
        connectorType: 'embedded',
      },
    ],
  }, 'did:privy:user1');
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].kind, 'main');
  assert.equal(wallets[0].address, address);
  assert.equal(wallets[0].ownerId, 'did:privy:user1');
});

test('wallet provision notes stay actionable and secret-free', () => {
  assert.match(
    walletProvisionNote({ error: 'missing_config', missing: ['PRIVY_APP_SECRET', 'QUICKNODE_DEVNET_RPC_URL'] }),
    /PRIVY_APP_SECRET, QUICKNODE_DEVNET_RPC_URL/,
  );
  assert.match(walletProvisionNote({ error: 'invalid_rpc' }), /https QuickNode/);
  assert.match(walletProvisionNote({ error: 'privy_failed' }), /PRIVY_APP_SECRET/);
  assert.match(
    walletProvisionNote({ error: 'privy_failed', detail: 'Privy request failed (401)' }),
    /Privy request failed \(401\)/,
  );
  assert.match(
    walletProvisionNote({
      error: 'privy_failed',
      detail: 'Privy wallets failed (403: insufficient_app_secret_permissions)',
    }),
    /full-access/,
  );
  assert.match(
    walletProvisionNote({
      error: 'privy_failed',
      detail: 'Privy wallets failed (403). Set PRIVY_AUTHORIZATION_KEY from Privy',
    }),
    /PRIVY_AUTHORIZATION_KEY/,
  );
  assert.equal(
    walletProvisionNote({ created: true, wallets: [{ id: 'w1' }] }, { ok: true }),
    'Main wallet created and assigned to these agents.',
  );
  assert.equal(walletProvisionNote({ error: 'missing_config', missing: ['evil; drop'] }).includes('evil'), false);
});
