import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeObservedWallets,
  missingWalletSecrets,
  resolvePrivyAppId,
  walletConfigNote,
  walletProvisionNote,
  linkedWalletKey,
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

test('linkedWalletKey changes when another Solana wallet is added', () => {
  const first = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const second = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  assert.equal(linkedWalletKey(null), '');
  assert.equal(linkedWalletKey({ linkedAccounts: [{ address: first }] }), first);
  assert.notEqual(
    linkedWalletKey({ linkedAccounts: [{ address: first }] }),
    linkedWalletKey({ linked_accounts: [{ address: first }, { address: second }] }),
  );
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

test('walletsFromPrivyUser also keeps connected external Solana wallets', () => {
  const embedded = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const phantom = 'So11111111111111111111111111111111111111112';
  const wallets = walletsFromPrivyUser({
    linkedAccounts: [
      {
        type: 'wallet',
        address: embedded,
        chainType: 'solana',
        walletClientType: 'privy',
      },
      {
        type: 'wallet',
        address: phantom,
        chainType: 'solana',
        walletClientType: 'phantom',
      },
      {
        type: 'wallet',
        address: '0xabc123',
        chainType: 'ethereum',
        walletClientType: 'metamask',
      },
    ],
  }, 'did:privy:user1');
  assert.equal(wallets.length, 2);
  assert.equal(wallets[0].address, embedded);
  assert.equal(wallets[0].spendable, true);
  assert.equal(wallets[1].address, phantom);
  assert.equal(wallets[1].walletClientType, 'phantom');
  assert.equal(wallets[1].label, 'Phantom');
  assert.equal(wallets[1].spendable, false);
});

test('mergeObservedWallets keeps the agent wallet and appends linked wallets', () => {
  const agent = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const phantom = 'So11111111111111111111111111111111111111112';
  const merged = mergeObservedWallets(
    [{ id: 'w_main', kind: 'main', label: 'Main', address: agent, frozen: false, provider: 'privy' }],
    {
      linkedAccounts: [
        { type: 'wallet', address: agent, chainType: 'solana', walletClientType: 'privy' },
        { type: 'wallet', address: phantom, chainType: 'solana', walletClientType: 'phantom' },
      ],
    },
    'did:privy:user1',
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'w_main');
  assert.equal(merged[0].kind, 'main');
  assert.equal(merged[0].spendable, true);
  assert.equal(merged[1].address, phantom);
  assert.equal(merged[1].kind, 'additional');
  assert.equal(merged[1].spendable, false);
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
  assert.match(walletProvisionNote({ error: 'token_missing' }), /access token/);
  assert.match(walletConfigNote({ missing: ['PRIVY_APP_SECRET'] }), /PRIVY_APP_SECRET/);
  assert.match(walletConfigNote({ hasAppSecret: true, hasAuthorizationKey: false }), /PRIVY_AUTHORIZATION_KEY/);
  assert.equal(walletConfigNote({ hasAppId: true, hasAppSecret: true, hasAuthorizationKey: true }), '');
});
