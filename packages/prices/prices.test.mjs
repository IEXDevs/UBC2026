import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JUPITER_SWAP_BUILD_URL,
  readJupiterSwapOrder,
  createDexScreenerPriceProvider,
  createJupiterPriceProvider,
  createMainnetPriceProvider,
  formatUsdPrice,
  jupiterSwapQuoteUrl,
  PriceError,
  readAgentPriceQuote,
  readJupiterSwapQuote,
  usdPriceBaseUnits,
  WRAPPED_SOL_MINT,
} from './prices.mjs';

const mint = 'So11111111111111111111111111111111111111112';

/**
 * Achieves: DexScreener lookup returns the highest-liquidity USD pair with mainnet pricing / mainnet-beta execution labels.
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
  assert.equal(quote.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(quote.pricingCluster, 'mainnet');
  assert.equal(quote.executionCluster, 'mainnet-beta');
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
  assert.equal(quote.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(quote.pricingCluster, 'mainnet');
  assert.equal(quote.executionCluster, 'mainnet-beta');
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
  assert.equal(quote.label, 'mainnet-beta execution, mainnet pricing');
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
  assert.equal(quote.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(quote.pricingCluster, 'mainnet');
  assert.equal(quote.executionCluster, 'mainnet-beta');
  assert.equal(quote.paperPnl, true);
  assert.equal(quote.authorizesTransaction, false);
  assert.equal(Object.hasOwn(quote, 'signature'), false);
  assert.equal(Object.hasOwn(quote, 'apiKey'), false);
});

/**
 * Achieves: a UI-wrapped SOL mint hits DexScreener; a missing client is not an outage; HTTP 5xx falls through to Jupiter Price v3.
 * Fails when: the wrapped mint is rewritten, a 401 is called provider_failed, or a 503 does not call Jupiter.
 * Oracle: request URLs for the wrapped-SOL mint and PriceError codes.
 * Side effects: injected fetcher only.
 * Gaps: live HTTP is not part of npm test.
 */
test('wrapped SOL builds DexScreener then Jupiter requests and does not call a missing client an outage', async () => {
  assert.equal(WRAPPED_SOL_MINT, mint);
  const direct = createDexScreenerPriceProvider({
    fetcher: async url => {
      assert.equal(url, `https://api.dexscreener.com/tokens/v1/solana/${mint}`);
      return Response.json({
        pairs: [{
          baseToken: { address: mint },
          priceUsd: 74.73,
          pairAddress: 'pair',
          liquidity: { usd: 10 },
        }],
      });
    },
  });
  const wrapped = await direct(`SOL (${mint})`);
  assert.equal(wrapped.mint, mint);
  assert.equal(wrapped.priceUsd, '74.73');
  assert.equal(wrapped.quoteSource, 'dexscreener');

  await assert.rejects(
    async () => createDexScreenerPriceProvider({ fetcher: null })(mint),
    error => error instanceof PriceError && error.code === 'client_missing',
  );

  let calls = 0;
  const missing = createMainnetPriceProvider({
    fetcher: async () => {
      calls += 1;
      return new Response('no key', { status: 401 });
    },
  });
  await assert.rejects(missing(mint), error => error.code === 'client_missing');
  assert.equal(calls, 1);

  const urls = [];
  const fallback = createMainnetPriceProvider({
    fetcher: async url => {
      urls.push(String(url));
      if (String(url).includes('dexscreener')) return new Response('down', { status: 503 });
      return Response.json({ [mint]: { usdPrice: 74.73, liquidity: 1, blockId: 2 } });
    },
  });
  const quote = await fallback(`  ${mint}  `);
  assert.equal(quote.quoteSource, 'jupiter-price-v3');
  assert.equal(quote.fallbackFrom, 'dexscreener');
  assert.equal(quote.priceUsd, '74.73');
  assert.equal(quote.mint, mint);
  assert.equal(urls[0], `https://api.dexscreener.com/tokens/v1/solana/${mint}`);
  assert.equal(urls[1], `https://api.jup.ag/price/v3?ids=${mint}`);
});

/**
 * Achieves: Jupiter swap quote URL is built for wrapped SOL to USDC and the body does not authorize a transaction.
 * Fails when: the host, mints, or amount drift, or a swap transaction is returned.
 * Oracle: lite-api swap/v1 quote query string.
 * Side effects: injected fetcher only.
 * Gaps: live Jupiter swap is not part of npm test.
 */
test('Jupiter swap quote reads outAmount and does not return a transaction', async () => {
  const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const built = jupiterSwapQuoteUrl({ inputMint: mint, outputMint: usdc, amount: '10000000' });
  assert.match(built, /^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/);
  assert.match(built, new RegExp(`inputMint=${mint}`));
  assert.match(built, new RegExp(`outputMint=${usdc}`));
  assert.match(built, /amount=10000000/);
  const quote = await readJupiterSwapQuote({
    inputMint: `SOL (${mint})`,
    outputMint: usdc,
    amount: '10000000',
    fetcher: async url => {
      assert.equal(String(url), built);
      return Response.json({ inAmount: '10000000', outAmount: '747000', swapTransaction: 'should-not-pass' });
    },
  });
  assert.equal(quote.outAmount, '747000');
  assert.equal(quote.inputMint, mint);
  assert.equal(quote.quoteSource, 'jupiter-swap-v1');
  assert.equal(quote.broadcast, false);
  assert.equal(quote.authorizesTransaction, false);
  assert.equal(quote.executionCluster, 'mainnet-beta');
  assert.equal(quote.label, 'mainnet-beta execution, mainnet pricing');
  assert.equal(Object.hasOwn(quote, 'swapTransaction'), false);
  await assert.rejects(
    readJupiterSwapQuote({ inputMint: mint, outputMint: usdc, amount: '10000000', fetcher: null }),
    error => error.code === 'client_missing',
  );
});

/**
 * Achieves: a live Jupiter order quotes, then builds the unsigned transaction for the given signer.
 * Fails when: the quote is not passed to /swap, the signer changes, or a mismatched quote is accepted.
 * Oracle: request bodies and the returned order; a mismatched quote throws.
 * Side effects: none. fetch is injected.
 * Gaps: live Jupiter is not called.
 */
test('readJupiterSwapOrder builds the swap for the quoted pair and signer', async () => {
  const SOL = 'So11111111111111111111111111111111111111112';
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const OWNER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
  const quote = { inputMint: SOL, outputMint: USDC, inAmount: '10000000', outAmount: '747000', otherAmountThreshold: '743000' };
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).includes('/quote')) return Response.json(quote);
    return Response.json({ swapTransaction: 'AQAAswap==', lastValidBlockHeight: 1 });
  };
  const order = await readJupiterSwapOrder({ inputMint: SOL, outputMint: USDC, amount: '10000000', userPublicKey: OWNER, fetcher });
  assert.equal(order.transaction, 'AQAAswap==');
  assert.equal(order.minOutAmount, '743000');
  assert.equal(seen[1].url, JUPITER_SWAP_BUILD_URL);
  const body = JSON.parse(seen[1].init.body);
  assert.deepEqual(body.quoteResponse, quote);
  assert.equal(body.userPublicKey, OWNER);
  const wrong = async url => String(url).includes('/quote') ? Response.json({ ...quote, inAmount: '1' }) : Response.json({ swapTransaction: 'AQ==' });
  await assert.rejects(readJupiterSwapOrder({ inputMint: SOL, outputMint: USDC, amount: '10000000', userPublicKey: OWNER, fetcher: wrong }));
});
