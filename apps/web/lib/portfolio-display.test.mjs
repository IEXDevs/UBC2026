import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPortfolio, SOL_MINT } from './portfolio.mjs';
import { enrichPortfolio, portfolioWithDex } from './dex-token.mjs';
import { portfolioEmptyMessage, unpricedHoldingLabels } from './portfolio-display.mjs';

const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

test('unpriced holdings show amounts and symbols or short mints without priced assets', () => {
  assert.deepEqual(unpricedHoldingLabels([
    { mint: JUP, symbol: 'JUP', amount: '1234567', decimals: 6, usdMicro: '0' },
    { mint: JUP, symbol: ' ', amount: '1', decimals: 6, usdMicro: '0' },
    { mint: SOL_MINT, symbol: 'SOL', amount: '1000000000', decimals: 9, usdMicro: '100000000' },
  ]), ['1.234567 JUP · Not priced', '0.000001 JUPyi...sDvCN · Not priced']);
});

test('empty and fully priced portfolios have no unpriced labels', () => {
  assert.deepEqual(unpricedHoldingLabels(), []);
  assert.deepEqual(unpricedHoldingLabels([
    { mint: JUP, amount: '1000000', decimals: 6, usdMicro: '250000' },
  ]), []);
  assert.equal(portfolioEmptyMessage(), 'No assets in the linked wallets yet.');
  assert.equal(portfolioEmptyMessage([{ holdings: [] }, {}]), 'No assets in the linked wallets yet.');
});

test('failed or rate-limited pricing retains JUP while keeping it out of the dollar graph', async () => {
  const portfolio = buildPortfolio({
    cluster: 'mainnet',
    wallets: [{ address: SOL_MINT, tokens: [{ mint: JUP, amount: '1000000', decimals: 6 }] }],
  });
  for (const fetcher of [
    async () => { throw new Error('offline'); },
    async () => ({ status: 429, ok: false }),
  ]) {
    const { portfolio: unpriced } = await enrichPortfolio(portfolio, { fetcher });
    assert.deepEqual(unpriced.slices, []);
    assert.equal(unpriced.totalUsdMicro, '0');
    assert.deepEqual(unpricedHoldingLabels(unpriced.wallets[0].holdings), ['1 JUPyi...sDvCN · Not priced']);
    assert.equal(portfolioEmptyMessage(unpriced.wallets), 'No priced assets in the linked wallets yet.');
  }
  const priced = portfolioWithDex(portfolio, [{ mint: JUP, symbol: 'JUP', priceUsd: '0.25' }]);
  assert.equal(priced.slices[0].mint, JUP);
  assert.equal(priced.totalUsdMicro, '250000');
  assert.deepEqual(unpricedHoldingLabels(priced.wallets[0].holdings), []);
});
