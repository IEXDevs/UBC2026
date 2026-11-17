import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeObservedWallets,
  missingWalletSecrets,
  resolvePrivyAppId,
  walletConfigNote,
  walletProvisionNote,
  walletProvisionPaths,
  walletProvisionSucceeded,
  linkedWalletKey,
  walletsFromPrivyUser,
} from './wallet-provision.mjs';

test('shell wallet provision never hits the runtime create path', () => {
  const paths = walletProvisionPaths();
  // Independent of page.js: hosted Workers strip Origin on outbound Privy calls.
  assert.deepEqual([...paths], ['/api/wallets']);
  assert.equal(paths.some(path => path.includes('/api/runtime/')), false);
  assert.equal(paths.some(path => path.includes('persist')), false);
  // Frozen contract — page.js must not reintroduce a runtime fallback list.
  assert.throws(() => { paths.push('/api/runtime/api/wallets'); });
});

test('walletProvisionSucceeded requires ok response and a non-empty wallets array', () => {
  assert.equal(walletProvisionSucceeded(true, { wallets: [{ id: 'w1' }] }), true);
  assert.equal(walletProvisionSucceeded(true, { wallets: [] }), false);
  assert.equal(walletProvisionSucceeded(true, {}), false);
  assert.equal(walletProvisionSucceeded(false, { wallets: [{ id: 'w1' }] }), false);
  assert.equal(walletProvisionSucceeded(200, { wallets: [{ id: 'w1' }] }), false);
});

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

test('wallet provision notes explain Worker Origin failures without leaking secrets', () => {
  assert.match(
    walletProvisionNote({
      error: 'privy_failed',
      detail: 'Worker cannot set Origin for Privy; use POST /api/wallets on Next then /api/wallets/persist',
    }),
    /Origin|Domains|Sign in/i,
  );
  assert.equal(
    walletProvisionNote({
      error: 'privy_failed',
      detail: 'Bearer sk_live_super_secret_value_that_must_not_leak',
    }).includes('sk_live'),
    false,
  );
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
