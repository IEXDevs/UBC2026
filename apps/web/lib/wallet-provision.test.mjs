import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingWalletSecrets, resolvePrivyAppId, walletProvisionNote } from './wallet-provision.mjs';

test('missing wallet secrets allow public app id as PRIVY_APP_ID', () => {
  assert.deepEqual(
    missingWalletSecrets({
      NEXT_PUBLIC_PRIVY_APP_ID: 'app_1',
      PRIVY_APP_SECRET: 'secret',
      QUICKNODE_DEVNET_RPC_URL: 'https://example.quiknode.pro/path',
    }),
    [],
  );
  assert.deepEqual(
    missingWalletSecrets({ NEXT_PUBLIC_PRIVY_APP_ID: 'app_1' }),
    ['PRIVY_APP_SECRET', 'QUICKNODE_DEVNET_RPC_URL'],
  );
  assert.equal(resolvePrivyAppId({ NEXT_PUBLIC_PRIVY_APP_ID: ' app_1 ' }), 'app_1');
  assert.equal(resolvePrivyAppId({ PRIVY_APP_ID: 'server', NEXT_PUBLIC_PRIVY_APP_ID: 'pub' }), 'server');
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
  assert.equal(
    walletProvisionNote({ created: true, wallets: [{ id: 'w1' }] }, { ok: true }),
    'Main wallet created and assigned to these agents.',
  );
  assert.equal(walletProvisionNote({ error: 'missing_config', missing: ['evil; drop'] }).includes('evil'), false);
});
