import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDexScreenerPriceProvider, PriceError } from './prices.mjs';

const mint = 'So11111111111111111111111111111111111111112';

test('DexScreener provider picks the highest-liquidity USD pair', async () => {
  const lookup = createDexScreenerPriceProvider({
    fetcher: async url => {
      assert.match(url, new RegExp(`/solana/${mint}$`));
      return Response.json([
        {
          baseToken: { address: mint },
          priceUsd: '100.5',
          pairAddress: 'low',
          liquidity: { usd: 1000 },
        },
        {
          baseToken: { address: mint },
          priceUsd: '101.25',
          pairAddress: 'high',
          liquidity: { usd: 50000 },
        },
      ]);
    },
  });
  const quote = await lookup(mint);
  assert.equal(quote.priceUsd, '101.25');
  assert.equal(quote.pairAddress, 'high');
  assert.equal(quote.label, 'devnet execution, mainnet pricing');
  assert.equal(quote.pricingCluster, 'mainnet');
  assert.equal(quote.executionCluster, 'devnet');
});

test('invalid mints and empty pair lists fail cleanly', async () => {
  await assert.rejects(createDexScreenerPriceProvider({})('bad'), PriceError);
  await assert.rejects(
    createDexScreenerPriceProvider({ fetcher: async () => Response.json([]) })(mint),
    (error) => error.code === 'price_not_found' && error.status === 404,
  );
});
