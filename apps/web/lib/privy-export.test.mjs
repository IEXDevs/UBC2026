import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportAddressForSheet,
  exportFailureNote,
  exportWalletIdForSheet,
  keyExportAction,
  privyEmbeddedSolanaWallet,
} from './privy-export.mjs';

const ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OTHER = 'So11111111111111111111111111111111111111112';

/**
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

/**
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

/**
 * Achieves: verifies failure copy distinguishes server-side wallets, address mismatch, and auth errors.
 * Fails when: notes lose server-side / agent wallet / Sign in guidance.
 * Oracle: exportFailureNote patterns for hasEmbedded/addressMatch/auth error.
 * Side effects / state checked: N/A.
 * Gaps: does not assert full sentence copy — regex fragments only.
 */
/**
 * Achieves: a server wallet id copies through our API, and a client-only wallet still opens Privy.
 * Fails when: a Privy wallet id opens the iframe, or a client wallet is treated as a server export.
 * Oracle: keyExportAction mode server vs client vs none.
 * Side effects / state checked: N/A.
 * Gaps: does not call the export API.
 */
test('keyExportAction skips Privy for server wallets', () => {
  const embedded = privyEmbeddedSolanaWallet({
    linkedAccounts: [{
      type: 'wallet',
      walletClientType: 'privy',
      chainType: 'solana',
      address: ADDRESS,
      id: 'fmfdj6yqly31huorjqzq38zc',
    }],
  });
  assert.deepEqual(embedded, { address: ADDRESS, id: 'fmfdj6yqly31huorjqzq38zc' });
  assert.deepEqual(keyExportAction({ walletId: '', embedded }), {
    mode: 'server',
    walletId: 'fmfdj6yqly31huorjqzq38zc',
  });
  assert.deepEqual(keyExportAction({ walletId: 'sheetwalletid1', embedded: { address: ADDRESS } }), {
    mode: 'server',
    walletId: 'sheetwalletid1',
  });
  assert.deepEqual(keyExportAction({ walletId: '', embedded: { address: ADDRESS } }), { mode: 'client' });
  assert.deepEqual(keyExportAction({ walletId: 'short', embedded: null }), { mode: 'none' });
  assert.deepEqual(keyExportAction({
    walletId: '',
    embedded,
    sheetAddress: OTHER,
  }), { mode: 'none' });
  assert.deepEqual(keyExportAction({
    walletId: '',
    embedded,
    sheetAddress: ADDRESS,
  }), {
    mode: 'server',
    walletId: 'fmfdj6yqly31huorjqzq38zc',
  });
});

test('exportWalletIdForSheet uses the public wallet id when privyWalletId was stripped', () => {
  const privyId = 'fmfdj6yqly31huorjqzq38zc';
  assert.equal(exportWalletIdForSheet({
    id: privyId,
    spendable: true,
    address: ADDRESS,
  }), privyId);
  assert.equal(exportWalletIdForSheet({
    id: 'local-wallet-id',
    privyWalletId: privyId,
    spendable: true,
  }), privyId);
  assert.equal(exportWalletIdForSheet({ id: `linked_${ADDRESS}`, spendable: false }), '');
  assert.equal(exportWalletIdForSheet({ id: `client_${ADDRESS.slice(0, 8)}`, spendable: true }), '');
  assert.equal(exportWalletIdForSheet(null), '');
});

test('exportFailureNote explains server vs embedded wallets', () => {
  assert.match(exportFailureNote(null, { hasEmbedded: false }), /server-side/);
  assert.match(exportFailureNote(null, { hasEmbedded: true, addressMatch: false }), /agent wallet/);
  assert.match(exportFailureNote(new Error('User is not authenticated'), { hasEmbedded: true }), /Sign in/);
});
