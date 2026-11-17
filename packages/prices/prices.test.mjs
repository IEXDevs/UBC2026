import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDexScreenerPriceProvider,
  createJupiterPriceProvider,
  createMainnetPriceProvider,
  formatUsdPrice,
  PriceError,
  readAgentPriceQuote,
  usdPriceBaseUnits,
} from './prices.mjs';

const mint = 'So11111111111111111111111111111111111111112';

/**
 * Achieves: DexScreener lookup returns the highest-liquidity USD pair with mainnet pricing / devnet execution labels.
 * Fails when: Lower-liquidity pair wins, wrong mint URL, or cluster labels flip.
 * Oracle: DexScreener tokens/v1/solana response shape + PRICE_LABEL.
 * Side effects: Injected fetcher only.
 * Gaps: Transport/empty/wrong-mint negatives covered in the following test.
 */
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

/**
 * Achieves: Bad mints, empty lists, rate limits, wrong-baseToken pairs, and bad JSON fail with stable PriceError codes.
 * Fails when: Invalid mints succeed, empty/wrong pairs return a fabricated price, or 429 is not rate-limited.
 * Oracle: PriceError code/status contract + DexScreener mint filter.
 * Side effects: Injected fetcher.
 * Gaps: none meaningful
 */
test('invalid mints and empty pair lists fail cleanly', async () => {
  await assert.rejects(createDexScreenerPriceProvider({})('bad'), PriceError);
  await assert.rejects(
    createDexScreenerPriceProvider({ fetcher: async () => Response.json([]) })(mint),
    (error) => error.code === 'price_not_found' && error.status === 404,
  );
  await assert.rejects(
    createDexScreenerPriceProvider({ fetcher: async () => new Response('slow', { status: 429 }) })(mint),
    (error) => error.code === 'provider_rate_limited' && error.status === 429,
  );
  await assert.rejects(
    createDexScreenerPriceProvider({
      fetcher: async () => Response.json([
        { baseToken: { address: 'other' }, priceUsd: '9', pairAddress: 'x', liquidity: { usd: 99 } },
      ]),
    })(mint),
    (error) => error.code === 'price_not_found',
  );
  await assert.rejects(
    createDexScreenerPriceProvider({ fetcher: async () => new Response('{', { status: 200 }) })(mint),
    (error) => error.code === 'invalid_provider_response',
  );
});

/**
 * Achieves: Finite non-negative numbers format as plain decimals; scientific inputs expand; negatives/strings throw.
 * Fails when: Scientific form survives, negatives are accepted, or string sci-notation is accepted.
 * Oracle: Jupiter numeric → decimal string contract used by paper PnL.
 * Side effects: none
 * Gaps: Does not cover extreme exponents beyond safe integer range.
 */
test('formatUsdPrice keeps plain decimals and expands scientific form', () => {
  assert.equal(formatUsdPrice(147.48), '147.48');
  assert.equal(formatUsdPrice(0), '0');
  assert.equal(formatUsdPrice(1.23e-7), '0.000000123');
  assert.equal(formatUsdPrice(1e-7), '0.0000001');
  assert.throws(() => formatUsdPrice(-1), PriceError);
  assert.throws(() => formatUsdPrice('1e-7'), PriceError);
});

/**
 * Achieves: Jupiter /price/v3 returns usdPrice with API key header and cluster labels.
 * Fails when: Wrong URL/header, missing fields accepted as OK, or labels flip.
 * Oracle: Jupiter Price API v3 response fields.
 * Side effects: Injected fetcher only.
 * Gaps: Does not cover multi-mint batch responses.
 */
test('Jupiter price provider reads usdPrice for the mint', async () => {
  const lookup = createJupiterPriceProvider({
    apiKey: 'jup-key',
    fetcher: async (url, options) => {
      assert.match(url, new RegExp(`/price/v3\\?ids=${mint}$`));
      assert.equal(options.headers['x-api-key'], 'jup-key');
      return Response.json({
        [mint]: {
          usdPrice: 147.48,
          liquidity: 1000.5,
          blockId: 348004023,
          decimals: 9,
          priceChange24h: 1.29,
          createdAt: '2024-06-05T08:55:25.527Z',
        },
      });
    },
  });
  const quote = await lookup(mint);
  assert.equal(quote.priceUsd, '147.48');
  assert.equal(quote.quoteSource, 'jupiter-price-v3');
  assert.equal(quote.liquidityUsd, 1000.5);
  assert.equal(quote.blockId, 348004023);
  assert.equal(quote.label, 'devnet execution, mainnet pricing');
  assert.equal(quote.pricingCluster, 'mainnet');
  assert.equal(quote.executionCluster, 'devnet');
});

/**
 * Achieves: Missing prices → 404; 429 → provider_rate_limited without body leak; bad mint → invalid_mint.
 * Fails when: Empty payloads succeed, rate-limit bodies leak, or bad mints fall through.
 * Oracle: PriceError sanitization contract.
 * Side effects: none
 * Gaps: Does not cover network throw → provider_unavailable for Jupiter.
 */
test('Jupiter omits unreliable prices and hides transport failures', async () => {
  await assert.rejects(
    createJupiterPriceProvider({ fetcher: async () => Response.json({}) })(mint),
    (error) => error.code === 'price_not_found' && error.status === 404,
  );
  await assert.rejects(
    createJupiterPriceProvider({ fetcher: async () => new Response('nope', { status: 429 }) })(mint),
    (error) => error.code === 'provider_rate_limited' && error.message === 'provider_rate_limited',
  );
  await assert.rejects(createJupiterPriceProvider({})('bad'), (error) => error.code === 'invalid_mint');
});

/**
 * Achieves: Primary DexScreener hit skips Jupiter; empty DexScreener falls back with fallbackFrom set and sci prices expanded.
 * Fails when: Jupiter runs on a primary hit, fallbackFrom missing, or sci price left unexpanded.
 * Oracle: createMainnetPriceProvider fallback ordering.
 * Side effects: Injected fetcher only.
 * Gaps: Does not cover primary transport failure fallback.
 */
test('mainnet prices use DexScreener and fall back to Jupiter', async () => {
  let jupiterCalls = 0;
  const lookup = createMainnetPriceProvider({
    fetcher: async (url) => {
      if (url.includes('dexscreener')) {
        return Response.json([
          { baseToken: { address: mint }, priceUsd: '10', pairAddress: 'pair', liquidity: { usd: 5 } },
        ]);
      }
      jupiterCalls += 1;
      return Response.json({ [mint]: { usdPrice: 1, liquidity: 1, blockId: 1, decimals: 9, priceChange24h: 0, createdAt: '2024-06-05T08:55:25.527Z' } });
    },
  });
  const direct = await lookup(mint);
  assert.equal(direct.quoteSource, 'dexscreener');
  assert.equal(direct.priceUsd, '10');
  assert.equal(direct.fallbackFrom, undefined);
  assert.equal(jupiterCalls, 0);

  const fallback = createMainnetPriceProvider({
    fetcher: async (url) => {
      if (url.includes('dexscreener')) return Response.json([]);
      return Response.json({
        [mint]: { usdPrice: 1.23e-7, liquidity: 2, blockId: 9, decimals: 6, priceChange24h: null, createdAt: '2024-06-05T08:55:25.527Z' },
      });
    },
  });
  const quote = await fallback(mint);
  assert.equal(quote.quoteSource, 'jupiter-price-v3');
  assert.equal(quote.priceUsd, '0.000000123');
  assert.equal(quote.fallbackFrom, 'dexscreener');
  assert.equal(quote.label, 'devnet execution, mainnet pricing');
});

/**
 * Achieves: invalid_mint from primary never calls fallback; rate-limited primary surfaces fallback’s price_not_found.
 * Fails when: Fallback runs after invalid_mint, or primary 429 is returned instead of fallback error.
 * Oracle: FALLBACK_CODES set in prices.mjs.
 * Side effects: none
 * Gaps: Does not cover provider_unavailable primary path.
 */
test('price fallback skips invalid mints and surfaces the Jupiter error', async () => {
  let fallbackCalls = 0;
  const lookup = createMainnetPriceProvider({
    primary: async () => { throw new PriceError('invalid_mint', 400); },
    fallback: async () => { fallbackCalls += 1; return {}; },
  });
  await assert.rejects(lookup(mint), (error) => error.code === 'invalid_mint');
  assert.equal(fallbackCalls, 0);

  const limited = createMainnetPriceProvider({
    primary: async () => { throw new PriceError('provider_rate_limited', 429); },
    fallback: async () => { throw new PriceError('price_not_found', 404); },
  });
  await assert.rejects(limited(mint), (error) => error.code === 'price_not_found' && error.status === 404);
});

/**
 * Achieves: readAgentPriceQuote returns paperPnl=true, authorizesTransaction=false, base units, and no signature/apiKey fields.
 * Fails when: Quote authorizes a tx, includes secrets, or wrong cluster labels.
 * Oracle: Agent tool contract for price quotes (paper-only).
 * Side effects: Injected fetcher only.
 * Gaps: Does not cover usdPriceBaseUnits rounding edges beyond 1.50.
 */
test('agent price quote is paper PnL and does not authorize a transaction', async () => {
  assert.equal(usdPriceBaseUnits('1.50'), '1500000');
  const quote = await readAgentPriceQuote(mint, {
    fetcher: async (url) => {
      if (String(url).includes('dexscreener')) return Response.json([]);
      return Response.json({ [mint]: { usdPrice: 1.5, liquidity: 4, blockId: 3 } });
    },
  });
  assert.equal(quote.quoteSource, 'jupiter-price-v3');
  assert.equal(quote.fallbackFrom, 'dexscreener');
  assert.equal(quote.priceUsd, '1.5');
  assert.equal(quote.priceBaseUnits, '1500000');
  assert.equal(quote.label, 'devnet execution, mainnet pricing');
  assert.equal(quote.pricingCluster, 'mainnet');
  assert.equal(quote.executionCluster, 'devnet');
  assert.equal(quote.paperPnl, true);
  assert.equal(quote.authorizesTransaction, false);
  assert.equal(Object.hasOwn(quote, 'signature'), false);
  assert.equal(Object.hasOwn(quote, 'apiKey'), false);
});
