import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEX_TOKEN_ORIGIN,
  dexCacheKey,
  dexTokenUrl,
  dexTokenView,
  enrichPortfolio,
  indexDexPairs,
  memoryDexStorage,
  portfolioWithDex,
  rateLimitCopy,
  readDexTokens,
  requestUrl,
  toProfile,
} from './dex-token.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const POOL = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function pair(mint, extra = {}) {
  return {
    chainId: 'solana',
    dexId: 'raydium',
    url: `https://dexscreener.com/solana/${POOL}`,
    pairAddress: POOL,
    baseToken: { address: mint, name: extra.name || 'Bonk', symbol: extra.symbol || 'BONK' },
    quoteToken: { address: USDC, name: 'USD Coin', symbol: 'USDC' },
    priceUsd: extra.priceUsd === undefined ? '9.87' : extra.priceUsd,
    priceChange: { h1: 1.5, h24: -2 },
    liquidity: { usd: extra.liquidity ?? 1000 },
    marketCap: 2500000,
    info: { imageUrl: 'https://cdn.dexscreener.com/token.png' },
  };
}

/*
 * Achieves: verifies profiles keep token details and drop the spot price.
 * Fails when: profiles keep token details and drop the spot price breaks (e.g. expected 'BONK', undefined, undefined); failure/null paths flip.
 * Oracle: assert.equal(profile.symbol, 'BONK'); assert.equal(profile.priceUsd, undefined); assert.equal(profile.priceNative, undefined); assert.equal(profile.imageUrl, undefined); assert.equal(profile.url, 'https://dexscreener.com/solana/pair'); assert.equal(JSON.stringify(profile).includes('9.87'), false)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('profiles keep token details and drop the spot price', () => {
  const profile = toProfile({
    symbol: 'BONK',
    name: 'Bonk',
    dexId: 'raydium',
    priceUsd: '9.87',
    priceNative: '0.01',
    imageUrl: 'http://insecure.example/token.png',
    url: 'https://dexscreener.com/solana/pair',
    liquidityUsd: 10,
    priceChange: { h24: -2, nope: 'x' },
  });
  assert.equal(profile.symbol, 'BONK');
  assert.equal(profile.priceUsd, undefined);
  assert.equal(profile.priceNative, undefined);
  assert.equal(profile.imageUrl, undefined);
  assert.equal(profile.url, 'https://dexscreener.com/solana/pair');
  assert.deepEqual(profile.priceChange, { h24: -2 });
  assert.equal(JSON.stringify(profile).includes('9.87'), false);
});

/*
 * Achieves: verifies the highest-liquidity solana pair wins for each mint.
 * Fails when: the highest-liquidity solana pair wins for each mint breaks (e.g. expected '9.87', 50, false).
 * Oracle: assert.equal(indexed.get(BONK).priceUsd, '9.87'); assert.equal(indexed.get(BONK).liquiditySort, 50); assert.equal(indexed.has(SOL), false)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('the highest-liquidity solana pair wins for each mint', () => {
  const indexed = indexDexPairs([
    pair(BONK, { liquidity: 10, priceUsd: '1' }),
    pair(BONK, { liquidity: 50, priceUsd: '9.87', symbol: 'BONK' }),
    { ...pair(SOL, { priceUsd: '150' }), chainId: 'ethereum' },
  ], [BONK, SOL]);
  assert.equal(indexed.get(BONK).priceUsd, '9.87');
  assert.equal(indexed.get(BONK).liquiditySort, 50);
  assert.equal(indexed.has(SOL), false);
});

/*
 * Achieves: verifies a browser read caches details and leaves the price out of storage.
 * Fails when: duplicate mints refetch, priceUsd is persisted, or rateLimited flips true on success.
 * Oracle: one fetch to DEX_TOKEN_ORIGIN/BONK; book price 9.87 / symbol BONK; saved JSON omits priceUsd and 9.87.
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('a browser read caches details and leaves the price out of storage', async () => {
  const storage = memoryDexStorage();
  const calls = [];
  const book = await readDexTokens({
    mints: [BONK, 'nope', BONK],
    userId: 'did:privy:abc',
    storage,
    fetcher: async (url) => {
      calls.push(url);
      return Response.json([pair(BONK)]);
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], new RegExp(`^${DEX_TOKEN_ORIGIN}/${BONK}$`));
  assert.equal(book.tokens[0].priceUsd, '9.87');
  assert.equal(book.tokens[0].symbol, 'BONK');
  assert.equal(book.rateLimited, false);
  const saved = storage.getItem(dexCacheKey('did:privy:abc'));
  assert.equal(saved.includes('9.87'), false);
  assert.equal(saved.includes('priceUsd'), false);
  assert.match(saved, /BONK/);
});

/*
 * Achieves: verifies a rate limit keeps the saved profile and does not reuse a price.
 * Fails when: a rate limit keeps the saved profile and does not reuse a price breaks (e.g. expected true, true, 'BONK'); failure/null paths flip.
 * Oracle: assert.equal(book.rateLimited, true); assert.equal(book.tokens[0].fromCache, true); assert.equal(book.tokens[0].symbol, 'BONK'); assert.equal(book.tokens[0].priceUsd, null); assert.equal(storage.getItem(dexCacheKey('user-1')).includes('9.87'), false); assert.equal(view.price, null)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('a rate limit keeps the saved profile and does not reuse a price', async () => {
  const storage = memoryDexStorage();
  storage.setItem(dexCacheKey('user-1'), JSON.stringify({
    [BONK]: { symbol: 'BONK', name: 'Bonk', priceUsd: '9.87', liquidityUsd: 1000, dexId: 'raydium' },
  }));
  const book = await readDexTokens({
    mints: [BONK],
    userId: 'user-1',
    storage,
    fetcher: async () => new Response('limited', { status: 429 }),
  });
  assert.equal(book.rateLimited, true);
  assert.equal(book.tokens[0].fromCache, true);
  assert.equal(book.tokens[0].symbol, 'BONK');
  assert.equal(book.tokens[0].priceUsd, null);
  assert.equal(storage.getItem(dexCacheKey('user-1')).includes('9.87'), false);
  const view = dexTokenView({ mint: BONK, range: '1D', token: book.tokens[0], now: 1_700_000_000_000 });
  assert.equal(view.price, null);
  assert.equal(view.points.length, 0);
  assert.match(view.note, /Saved token details/);
  assert.match(view.note, /devnet execution, mainnet pricing/);
});

/*
 * Achieves: verifies a live price draws the published window and batches thirty mints.
 * Fails when: a live price draws the published window and batches thirty mints breaks (e.g. expected 2, '1H', 1); failure/null paths flip.
 * Oracle: assert.equal(view.price, 2); assert.equal(view.changeLabel, '1H'); assert.equal(view.points[0].price, 1); assert.equal(view.points[1].price, 2); assert.equal(view.quoteSource, 'dexscreener'); assert.equal(dexTokenView({ mint: BONK, range: 'nope' })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a live price draws the published window and batches thirty mints', () => {
  const view = dexTokenView({
    mint: BONK,
    range: '1H',
    token: { symbol: 'BONK', name: 'Bonk', priceUsd: '2', priceChange: { h1: 100 }, dexId: 'raydium' },
    now: 1_700_000_000_000,
  });
  assert.equal(view.price, 2);
  assert.equal(view.changeLabel, '1H');
  assert.equal(view.points[0].price, 1);
  assert.equal(view.points[1].price, 2);
  assert.equal(view.quoteSource, 'dexscreener');
  assert.equal(dexTokenView({ mint: BONK, range: 'nope' }), null);
  const many = [SOL, USDC, BONK];
  assert.match(dexTokenUrl(many), new RegExp(`${SOL},${USDC},${BONK}$`));
});

/*
 * Achieves: verifies more than thirty mints use a second browser request.
 * Fails when: more than thirty mints use a second browser request breaks (e.g. expected 2, ', ').
 * Oracle: assert.equal(calls.length, 2); assert.equal(calls[0].split(','); assert.equal(calls[1].split(',')
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('more than thirty mints use a second browser request', async () => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const mints = Array.from({ length: 31 }, (_, index) => `${alphabet[index]}${'1'.repeat(31)}`);
  const calls = [];
  await readDexTokens({
    mints,
    fetcher: async (url) => {
      calls.push(url);
      return Response.json([]);
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].split(',').length, 30);
  assert.equal(calls[1].split(',').length, 1);
});

/*
 * Achieves: verifies portfolio dollars use the live dex price, then a peg, and the saved symbol.
 * Fails when: portfolio dollars use the live dex price, then a peg, and the saved symbol breaks (e.g. expected 'BONK', '2000000000', '2000000').
 * Oracle: assert.equal(bonk.symbol, 'BONK'); assert.equal(bonk.usdMicro, '2000000000'); assert.equal(usdc.usdMicro, '2000000'); assert.equal(enriched.rateLimited, true); assert.equal(enriched.portfolio.wallets[0].holdings.find(row => row.mint === BONK).usdMicro, '0'); assert.equal(rateLimitCopy('https://api.dexscreener.com/tokens/v1/solana/x').title, 'DexScreener rate limit')
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('portfolio dollars use the live dex price, then a peg, and the saved symbol', async () => {
  const wallet = SOL;
  const portfolio = {
    cluster: 'devnet',
    wallets: [{
      address: wallet,
      label: 'Desk',
      client: 'privy',
      spendable: false,
      holdings: [
        { mint: BONK, symbol: 'DezXA...B263', amount: '1000', decimals: 0, usdMicro: '0' },
        { mint: DEVNET_USDC, symbol: 'USDC', amount: '2000000', decimals: 6, usdMicro: '0' },
      ],
    }],
  };
  const painted = portfolioWithDex(portfolio, [{ mint: BONK, symbol: 'BONK', priceUsd: '2' }]);
  const bonk = painted.wallets[0].holdings.find(row => row.mint === BONK);
  const usdc = painted.wallets[0].holdings.find(row => row.mint === DEVNET_USDC);
  assert.equal(bonk.symbol, 'BONK');
  assert.equal(bonk.usdMicro, '2000000000');
  assert.equal(usdc.usdMicro, '2000000');

  const storage = memoryDexStorage();
  const enriched = await enrichPortfolio(portfolio, {
    userId: 'user-1',
    storage,
    fetcher: async () => new Response('limited', { status: 429 }),
  });
  assert.equal(enriched.rateLimited, true);
  assert.equal(enriched.portfolio.wallets[0].holdings.find(row => row.mint === BONK).usdMicro, '0');
  assert.equal(rateLimitCopy('https://api.dexscreener.com/tokens/v1/solana/x').title, 'DexScreener rate limit');
  assert.equal(rateLimitCopy('/api/portfolio').title, 'Rate limit');
  assert.equal(requestUrl(new URL('https://api.dexscreener.com/tokens/v1/solana')), DEX_TOKEN_ORIGIN);
});
