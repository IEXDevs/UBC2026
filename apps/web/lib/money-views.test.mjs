import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayment, validateWallet } from '@ubc2026/contracts';
import { getDemoShellState } from './demo-state.mjs';
import {
  describeHistory,
  describePayments,
  describePositions,
  describeWallets,
  formatBaseUnits,
  moneyPane,
  solanaExplorerTxUrl,
  solscanTxUrl,
  shortAddress,
  walletGlance,
} from './money-views.mjs';

test('money panes are history, wallets, and positions', () => {
  assert.equal(moneyPane('History'), 'history');
  assert.equal(moneyPane('Wallets'), 'wallets');
  assert.equal(moneyPane('Positions'), 'positions');
  assert.equal(moneyPane('Main'), null);
  assert.equal(moneyPane('Plugins'), null);
});

test('base unit strings render with six decimals', () => {
  assert.equal(formatBaseUnits('10000'), '0.01');
  assert.equal(formatBaseUnits('25000000'), '25');
  assert.equal(formatBaseUnits('-1500000'), '-1.5');
});

test('demo money rows match the contract shapes', () => {
  const state = getDemoShellState();

  for (const payment of state.payments) validatePayment(payment);
  for (const wallet of state.wallets) validateWallet(wallet);

  const payments = describePayments(state.payments, state.bots);
  assert.equal(payments[0].direction, 'paid');
  assert.equal(payments[0].amountLabel, '0.01 USDC');
  assert.match(payments[1].detail, /Meteora · x402 · devnet/);

  const wallets = describeWallets(state.wallets, state.bots);
  assert.equal(wallets[0].kind, 'main');
  assert.deepEqual(wallets[0].bots, ['Meteora', 'Position guard']);
  assert.equal(wallets[1].frozen, true);
  assert.deepEqual(wallets[1].bots, ['Sandbox shopper']);

  const positions = describePositions(state.positions, state.bots);
  assert.equal(positions[0].amountLabel, '25 USDC');
  assert.equal(positions[0].pnlLabel, '-1.5 USDC');
  assert.match(positions[0].note, /devnet execution, mainnet pricing/);

  const history = describeHistory(state.payments, state.bots);
  assert.equal(history[0].solscanUrl, null);
  assert.equal(history[0].flow, 'out');
  assert.equal(history[0].counterparty, 'x402 sandbox catalog');
  assert.equal(history[0].botName, 'Sandbox shopper');
  assert.equal(history[0].signedFigure, '−0.01');
  assert.equal(history[0].baseUnits, '10000');
  assert.equal(history[1].flow, 'in');
  assert.equal(history[1].signedFigure, '+0.25');
  assert.equal(history[1].protocol, 'x402');
  assert.equal(history[1].cluster, 'devnet');
  assert.equal(walletGlance(state.wallets, state.positions).balanceLabel, '25 USDC');
  assert.equal(walletGlance(state.wallets, state.positions).label, 'Main');
  assert.equal(walletGlance(state.wallets, state.positions, [
    { asset: 'USDC', amount: '5000000', direction: 'in' },
  ]).balanceLabel, '5 USDC');
});

test('wallet addresses show the first five and last five characters', () => {
  const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  assert.equal(shortAddress(address), '4zMMC...DncDU');
  assert.equal(shortAddress('short'), 'short');
});

test('solscan links cover devnet, testnet, and mainnet signatures', () => {
  const signature = '5'.repeat(64);
  assert.equal(solscanTxUrl(signature, 'devnet'), `https://solscan.io/tx/${signature}?cluster=devnet`);
  assert.equal(solanaExplorerTxUrl(signature, 'devnet'), `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  assert.equal(solscanTxUrl(signature, 'mainnet'), `https://solscan.io/tx/${signature}`);
  assert.equal(solscanTxUrl(null, 'devnet'), null);
  assert.equal(solscanTxUrl(signature, 'mainnet-beta'), null);
  assert.equal(solanaExplorerTxUrl(signature, 'mainnet-beta'), null);
});
