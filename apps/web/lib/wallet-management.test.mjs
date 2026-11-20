import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manageableWallets } from './wallet-management.mjs';

const embedded = 'So11111111111111111111111111111111111111112';
const external = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const account = (address, client) => ({ type: 'wallet', chainType: 'solana', address, walletClientType: client });

test('only a Privy-linked external wallet exposes unlink, even with stale server flags', () => {
  const rows = manageableWallets([
    { address: embedded, label: 'Main', spendable: false },
    { address: external, label: 'Phantom', spendable: true },
  ], { linkedAccounts: [account(embedded, 'privy'), account(external, 'phantom')] });
  assert.equal(rows[0].canUnlink, false);
  assert.equal(rows[1].canUnlink, true);
  assert.equal(rows[1].label, 'Phantom');
  assert.equal(rows.length, 2);
});

test('unlinked server rows never expose unlink and newly linked accounts appear immediately', () => {
  assert.equal(manageableWallets([{ address: external, spendable: false }])[0].canUnlink, false);
  const rows = manageableWallets([], { linked_accounts: [{ type: 'wallet', chain_type: 'solana', address: external, wallet_client_type: 'solflare' }] });
  assert.equal(rows[0].canUnlink, true);
  assert.match(rows[0].label, /solflare/);
});

test('non-Solana and duplicate linked wallets do not become unlinkable rows', () => {
  const rows = manageableWallets([], { linkedAccounts: [
    account(external, 'phantom'), account(external, 'phantom'),
    { ...account(embedded, 'phantom'), chainType: 'ethereum' },
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, external);
});
