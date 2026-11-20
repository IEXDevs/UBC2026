import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountValueLabel } from './account-value.mjs';
import { buildPortfolio, choosePortfolioRpc, SOL_MINT, SOLANA_USDC_MINT } from './portfolio.mjs';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';

test('the account value uses configured execution balances even when another read endpoint exists', () => {
  const env = { QUICKNODE_MAINNET_RPC_URL: 'https://portfolio.example', SOLANA_RPC_URL: 'https://execution.example' };
  assert.equal(choosePortfolioRpc(env, SOLANA_CLUSTER).rpcUrl, 'https://execution.example');
  assert.equal(choosePortfolioRpc({ QUICKNODE_MAINNET_RPC_URL: env.QUICKNODE_MAINNET_RPC_URL }, SOLANA_CLUSTER).rpcUrl, env.QUICKNODE_MAINNET_RPC_URL);
  assert.equal(choosePortfolioRpc(env).rpcUrl, env.QUICKNODE_MAINNET_RPC_URL);
});

test('account value totals different assets across wallets without a floating-point conversion', () => {
  const book = buildPortfolio({
    cluster: SOLANA_CLUSTER,
    prices: { [SOL_MINT]: '150.25', [SOLANA_USDC_MINT]: '1' },
    wallets: [
      { address: 'wallet-a', label: 'Main', tokens: [{ mint: SOL_MINT, amount: '1000000000', decimals: 9 }] },
      { address: 'wallet-b', label: 'Other', tokens: [{ mint: SOLANA_USDC_MINT, amount: '2500000', decimals: 6 }] },
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
