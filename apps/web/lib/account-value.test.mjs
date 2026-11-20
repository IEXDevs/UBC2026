import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountValueLabel } from './account-value.mjs';
import { buildPortfolio, choosePortfolioRpc, SOL_MINT, DEVNET_USDC_MINT } from './portfolio.mjs';

test('the account value uses devnet balances even when a mainnet read endpoint exists', () => {
  const env = { QUICKNODE_MAINNET_RPC_URL: 'https://mainnet.example', QUICKNODE_DEVNET_RPC_URL: 'https://devnet.example' };
  assert.equal(choosePortfolioRpc(env, 'devnet').rpcUrl, 'https://devnet.example');
  assert.equal(choosePortfolioRpc({ QUICKNODE_MAINNET_RPC_URL: env.QUICKNODE_MAINNET_RPC_URL }, 'devnet').rpcUrl, '');
  assert.equal(choosePortfolioRpc(env).rpcUrl, env.QUICKNODE_MAINNET_RPC_URL);
});

test('account value totals different assets across wallets without a floating-point conversion', () => {
  const book = buildPortfolio({
    cluster: 'devnet',
    prices: { [SOL_MINT]: '150.25', [DEVNET_USDC_MINT]: '1' },
    wallets: [
      { address: 'wallet-a', label: 'Main', tokens: [{ mint: SOL_MINT, amount: '1000000000', decimals: 9 }] },
      { address: 'wallet-b', label: 'Other', tokens: [{ mint: DEVNET_USDC_MINT, amount: '2500000', decimals: 6 }] },
    ],
  });
  assert.equal(accountValueLabel(book), '$152.75');
  assert.equal(accountValueLabel({ totalUsdMicro: '0', unpriced: 0 }), '$0.00');
});

test('missing prices never masquerade as a complete zero-dollar account', () => {
  assert.equal(accountValueLabel(null), '— USD');
  assert.equal(accountValueLabel({ totalUsdMicro: '-1' }), '— USD');
  assert.equal(accountValueLabel({ totalUsdMicro: '0', unpriced: 1 }), '— USD');
  assert.equal(accountValueLabel({ totalUsdMicro: '2500000', unpriced: 1 }), '≥ $2.50');
});
