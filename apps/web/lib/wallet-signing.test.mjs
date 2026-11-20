import assert from 'node:assert/strict';
import test from 'node:test';
import { SOLANA_PRIVY_CHAIN } from '@ubc2026/contracts/solana';
import { serverSignsWallet, signSelectedWalletTransaction } from './wallet-signing.mjs';

const transaction = new Uint8Array(100);
const from = { address: 'selected-external-account', label: 'Phantom', spendable: false };

test('Privy wallets sign on the server and linked wallets stay in the browser', () => {
  assert.equal(serverSignsWallet({ id: 'cm5sender1234567890abcd', spendable: true, frozen: false }), true);
  assert.equal(serverSignsWallet({ id: 'cm5sender1234567890abcd', spendable: false, frozen: false, walletClientType: 'privy-v2' }), true);
  assert.equal(serverSignsWallet({ id: 'linked_So11111111111111111111111111111111111111112', spendable: false }), false);
  assert.equal(serverSignsWallet({ id: 'client_EPjFWdd5', spendable: true }), false);
  assert.equal(serverSignsWallet({ id: 'cm5sender1234567890abcd', frozen: true, spendable: true }), false);
});

test('signing routes to the selected external account rather than the default wallet', async () => {
  const main = { address: 'main-wallet' };
  const selected = { address: from.address };
  const signedTransaction = new Uint8Array(120);
  const calls = [];
  const signer = {
    wallets: [main, selected],
    async signTransaction(input) { calls.push(input); return { signedTransaction }; },
    connectWallet() { assert.fail('the selected wallet is already connected'); },
  };
  assert.equal(await signSelectedWalletTransaction({ from, transaction, signer }), signedTransaction);
  assert.deepEqual(calls, [{ transaction, wallet: selected, chain: SOLANA_PRIVY_CHAIN }]);
});

test('a disconnected or different account opens a Solana connection prompt without signing', async () => {
  const prompts = [];
  const signer = {
    wallets: [{ address: 'other-account-in-the-same-provider' }],
    connectWallet(options) { prompts.push(options); },
    signTransaction() { assert.fail('never fall back to another account'); },
  };
  await assert.rejects(signSelectedWalletTransaction({ from, transaction, signer }), { code: 'wallet_connection_required' });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].walletChainType, 'solana-only');
  assert.match(prompts[0].description, /Phantom/);
});

test('rejection, missing signatures and frozen wallets fail without retrying another signer', async () => {
  const signer = {
    wallets: [{ address: from.address }],
    async signTransaction() { throw new Error('User rejected'); },
    connectWallet() { assert.fail('do not reopen after rejection'); },
  };
  await assert.rejects(signSelectedWalletTransaction({ from, transaction, signer }), { code: 'wallet_approval_cancelled' });
  signer.signTransaction = async () => ({});
  await assert.rejects(signSelectedWalletTransaction({ from, transaction, signer }), { code: 'invalid_signature' });
  signer.signTransaction = () => assert.fail('frozen wallets cannot sign');
  await assert.rejects(signSelectedWalletTransaction({ from: { ...from, frozen: true }, transaction, signer }), { code: 'wallet_frozen' });
});
