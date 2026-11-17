import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportAddressForSheet,
  exportFailureNote,
  privyEmbeddedSolanaWallet,
} from './privy-export.mjs';

const ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OTHER = 'So11111111111111111111111111111111111111112';

/*
 * Achieves: verifies only Privy Solana linked wallets are treated as embedded export targets.
 * Fails when: null/empty user returns a wallet, phantom Solana matches, or address not returned for Privy.
 * Oracle: walletClientType privy + chainType solana → { address }; phantom → null.
 * Side effects / state checked: N/A.
 * Gaps: does not cover ethereum Privy wallets or multiple Solana accounts.
 */
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

/*
 * Achieves: verifies export sheet only unlocks when selected address matches (or is empty for) the embedded wallet.
 * Fails when: mismatched OTHER returns ADDRESS, empty sheet does not fall back, or null user exports.
 * Oracle: match/empty → ADDRESS; OTHER/null user → null.
 * Side effects / state checked: N/A.
 * Gaps: case-normalization of addresses not asserted.
 */
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

/*
 * Achieves: verifies failure copy distinguishes server-side wallets, address mismatch, and auth errors.
 * Fails when: notes lose server-side / agent wallet / Sign in guidance.
 * Oracle: exportFailureNote patterns for hasEmbedded/addressMatch/auth error.
 * Side effects / state checked: N/A.
 * Gaps: does not assert full sentence copy — regex fragments only.
 */
test('exportFailureNote explains server vs embedded wallets', () => {
  assert.match(exportFailureNote(null, { hasEmbedded: false }), /server-side/);
  assert.match(exportFailureNote(null, { hasEmbedded: true, addressMatch: false }), /agent wallet/);
  assert.match(exportFailureNote(new Error('User is not authenticated'), { hasEmbedded: true }), /Sign in/);
});
