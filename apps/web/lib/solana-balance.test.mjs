import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignedWalletAddress, solanaSpendableLabel } from './solana-balance.mjs';
import { registeredHoldingsLabel } from './money-views.mjs';

const MAIN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PHANTOM = 'So11111111111111111111111111111111111111112';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

/**
 * Achieves: the chip uses the generated Privy wallet, and a faucet balance shows with no ledger rows.
 * Fails when: a connected wallet replaces the main wallet, or an empty book hides mainnet-beta USDC.
 * Oracle: address is MAIN; label is '0.5 SOL · 20 USDC · 3 JUP'; holdings label matches with empty transfers.
 * Side effects / state checked: N/A.
 * Gaps: does not call RPC.
 */
test('the assigned wallet label is mainnet-beta SOL and USDC, ledger or not', () => {
  const address = assignedWalletAddress([
    { kind: 'additional', address: PHANTOM, spendable: false, walletClientType: 'phantom' },
    { kind: 'main', address: MAIN, spendable: true, walletClientType: 'privy' },
  ]);
  assert.equal(address, MAIN);
  assert.equal(assignedWalletAddress([
    { kind: 'main', address: PHANTOM, spendable: false, walletClientType: 'phantom' },
  ]), '');
  const balance = {
    ok: true,
    cluster: 'mainnet-beta',
    solLamports: '500000000',
    usdcAmount: '20000000',
    tokens: [
      { symbol: 'USDC', amount: '20000000', decimals: 6 },
      { symbol: 'JUP', amount: '3000000', decimals: 6, mint: JUP },
    ],
  };
  const label = solanaSpendableLabel(balance);
  assert.equal(label, '0.5 SOL · 20 USDC · 3 JUP');
  assert.equal(registeredHoldingsLabel({
    wallets: [],
    positions: [],
    transfers: [],
    chainLabel: label,
  }), label);
  assert.equal(solanaSpendableLabel({ ...balance, cluster: 'mainnet' }), null);
  assert.equal(solanaSpendableLabel({ ok: false, cluster: 'mainnet-beta', solLamports: '1', usdcAmount: '1' }), null);
});
