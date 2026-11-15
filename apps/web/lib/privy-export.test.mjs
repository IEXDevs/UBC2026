import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportAddressForSheet,
  exportFailureNote,
  privyEmbeddedSolanaWallet,
} from './privy-export.mjs';

const ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OTHER = 'So11111111111111111111111111111111111111112';

test('privyEmbeddedSolanaWallet finds privy solana linked accounts', () => {
  assert.equal(privyEmbeddedSolanaWallet(null), null);
  assert.equal(privyEmbeddedSolanaWallet({ linkedAccounts: [] }), null);
  assert.deepEqual(
    privyEmbeddedSolanaWallet({
      linkedAccounts: [{
        type: 'wallet',
        walletClientType: 'privy',
        chainType: 'solana',
        address: ADDRESS,
      }],
    }),
    { address: ADDRESS },
  );
  assert.equal(
    privyEmbeddedSolanaWallet({
      linkedAccounts: [{
        type: 'wallet',
        walletClientType: 'phantom',
        chainType: 'solana',
        address: ADDRESS,
      }],
    }),
    null,
  );
});

test('exportAddressForSheet only returns when sheet matches embedded', () => {
  const user = {
    linkedAccounts: [{
      type: 'wallet',
      walletClientType: 'privy',
      chainType: 'solana',
      address: ADDRESS,
    }],
  };
  assert.equal(exportAddressForSheet(user, ADDRESS), ADDRESS);
  assert.equal(exportAddressForSheet(user, ''), ADDRESS);
  assert.equal(exportAddressForSheet(user, OTHER), null);
  assert.equal(exportAddressForSheet(null, ADDRESS), null);
});

test('exportFailureNote explains server vs embedded wallets', () => {
  assert.match(exportFailureNote(null, { hasEmbedded: false }), /server-side/);
  assert.match(exportFailureNote(null, { hasEmbedded: true, addressMatch: false }), /agent wallet/);
  assert.match(exportFailureNote(new Error('User is not authenticated'), { hasEmbedded: true }), /Sign in/);
});
