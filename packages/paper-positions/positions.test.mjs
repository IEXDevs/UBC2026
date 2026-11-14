import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMainnetPriceProvider } from '@ubc2026/prices';
import {
  PAPER_UNIVERSE,
  PRICE_LABEL,
  MIN_HOLD_MS,
  PaperError,
  assertNoLiveTrade,
  closePaperPosition,
  createPaperBook,
  markPaperBook,
  openPaperPosition,
  positionLossDecision,
} from './positions.mjs';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const SOL = PAPER_UNIVERSE[0].mint;
const USDC = PAPER_UNIVERSE[1].mint;
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

const trader = { id: 'bot_trade', ownerId: 'owner_1', type: 'trading', enabled: true };
const watcher = {
  id: 'bot_watch',
  ownerId: 'owner_1',
  name: 'Positions',
  goal: 'Stop at max loss',
  type: 'position-management',
  enabled: true,
  policyVersion: 1,
  cap: { mode: 'limited', asset: 'USDC', maxLoss: '5000000' },
};

function quote(mint, priceUsd, overrides = {}) {
  return {
    mint,
    priceUsd,
    quoteSource: 'dexscreener',
    pricingCluster: 'mainnet',
    executionCluster: 'devnet',
    label: PRICE_LABEL,
    pairAddress: 'pair',
    liquidityUsd: 1000,
    fetchedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

const proposal = {
  id: 'p',
  botId: 'bot_watch',
  cluster: 'devnet',
  asset: 'USDC',
  recipient: 'treasury',
  quoteId: 'q',
  outflow: '1',
  maxFee: '0',
  expectedReceive: '1',
  expectedReceiveAsset: 'USDC',
  expiresAt: NOW + 3_600_000,
};
const ledger = { asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };

test('trading bot opens a paper SOL lot from a mainnet quote and does not broadcast', () => {
  const book = createPaperBook();
  const opened = openPaperPosition({
    book,
    bot: trader,
    mint: SOL,
    quantity: '500000000',
    quote: quote(SOL, '150'),
    now: NOW,
    idempotencyKey: 'buy-1',
  });
  assert.equal(opened.replayed, false);
  assert.equal(opened.position.mode, 'paper');
  assert.equal(opened.position.cluster, 'devnet');
  assert.equal(opened.position.label, PRICE_LABEL);
  assert.equal(opened.position.symbol, 'SOL');
  assert.equal(opened.position.entryMicroUsdc, '75000000');
  assert.equal(opened.fill.side, 'buy');
  assert.equal(opened.fill.broadcast, false);
  assert.equal(opened.fill.pricingCluster, 'mainnet');
  assert.equal(book.positions.length, 1);

  const again = openPaperPosition({
    book,
    bot: trader,
    mint: SOL,
    quantity: '500000000',
    quote: quote(SOL, '150'),
    now: NOW + 10_000,
    idempotencyKey: 'buy-1',
  });
  assert.equal(again.replayed, true);
  assert.equal(book.positions.length, 1);
  assert.equal(book.fills.length, 1);
});

test('position bots, shopping bots, meme mints, and live trades are refused', () => {
  const book = createPaperBook();
  const attempt = overrides => openPaperPosition({
    book,
    bot: trader,
    mint: SOL,
    quantity: '1000000000',
    quote: quote(SOL, '150'),
    now: NOW,
    idempotencyKey: 'nope',
    ...overrides,
  });
  assert.throws(() => attempt({ bot: { ...trader, type: 'position-management' } }), error => error.code === 'position_bot_watches_only');
  assert.throws(() => attempt({ bot: { ...trader, type: 'shopping' } }), error => error.code === 'bot_type_refused');
  assert.throws(() => attempt({ bot: { ...trader, enabled: false } }), error => error.code === 'bot_disabled');
  assert.throws(() => attempt({ mint: BONK }), error => error.code === 'asset_not_allowed');
  assert.throws(() => attempt({ cluster: 'mainnet' }), error => error.code === 'mainnet_trade_refused');
  assert.throws(() => attempt({ broadcast: true }), error => error.code === 'live_trade_refused');
  assert.throws(() => attempt({ swapTransaction: { program: 'jupiter' } }), error => error.code === 'live_trade_refused');
  assert.throws(() => attempt({ quote: quote(SOL, '0') }), error => error.code === 'invalid_quote');
  assert.throws(() => attempt({ quote: quote(SOL, '150', { fetchedAt: new Date(NOW - 300_001).toISOString() }) }), error => error.code === 'stale_quote');
  assert.equal(book.positions.length, 0);
  assert.throws(() => assertNoLiveTrade({ network: 'mainnet' }), PaperError);
});

test('a sell after the hold realizes paper PnL and a same-hour sell does not', () => {
  const book = createPaperBook();
  const opened = openPaperPosition({
    book,
    bot: trader,
    mint: SOL,
    quantity: '500000000',
    quote: quote(SOL, '150'),
    now: NOW,
    idempotencyKey: 'buy-2',
    cluster: 'testnet',
  });
  assert.equal(opened.position.cluster, 'testnet');
  assert.throws(() => closePaperPosition({
    book,
    bot: trader,
    positionId: opened.position.id,
    quantity: '250000000',
    quote: quote(SOL, '160', { fetchedAt: new Date(NOW + MIN_HOLD_MS - 1).toISOString() }),
    now: NOW + MIN_HOLD_MS - 1,
    idempotencyKey: 'sell-early',
  }), error => error.code === 'hold_period');

  const partial = closePaperPosition({
    book,
    bot: trader,
    positionId: opened.position.id,
    quantity: '250000000',
    quote: quote(SOL, '160', {
      quoteSource: 'jupiter-price-v3',
      fallbackFrom: 'dexscreener',
      fetchedAt: new Date(NOW + MIN_HOLD_MS).toISOString(),
    }),
    now: NOW + MIN_HOLD_MS,
    idempotencyKey: 'sell-half',
  });
  assert.equal(partial.fill.realizedMicroUsdc, '2500000');
  assert.equal(partial.fill.fallbackFrom, 'dexscreener');
  assert.equal(partial.fill.broadcast, false);
  assert.equal(partial.position.quantity, '250000000');
  assert.equal(partial.position.entryMicroUsdc, '37500000');
  assert.equal(partial.position.status, 'open');

  const rest = closePaperPosition({
    book,
    bot: trader,
    positionId: opened.position.id,
    quantity: '250000000',
    quote: quote(SOL, '160', { fetchedAt: new Date(NOW + MIN_HOLD_MS).toISOString() }),
    now: NOW + MIN_HOLD_MS,
    idempotencyKey: 'sell-rest',
  });
  assert.equal(rest.position.status, 'closed');
  assert.equal(rest.position.quantity, '0');
  assert.equal(rest.position.entryMicroUsdc, '0');
  assert.equal(rest.position.realizedMicroUsdc, '5000000');
  assert.throws(() => closePaperPosition({
    book,
    bot: { ...trader, id: 'other' },
    positionId: opened.position.id,
    quantity: '1',
    quote: quote(SOL, '160', { fetchedAt: new Date(NOW + MIN_HOLD_MS).toISOString() }),
    now: NOW + MIN_HOLD_MS,
    idempotencyKey: 'steal',
  }), error => error.code === 'bot_mismatch');
});

test('mark to market uses the price adapter once per mint and stops a position bot at max loss', async () => {
  const book = createPaperBook();
  openPaperPosition({
    book,
    bot: trader,
    mint: SOL,
    quantity: '1000000000',
    quote: quote(SOL, '100'),
    now: NOW,
    idempotencyKey: 'buy-sol',
  });
  openPaperPosition({
    book,
    bot: trader,
    mint: USDC,
    quantity: '1000000',
    quote: quote(USDC, '1'),
    now: NOW,
    idempotencyKey: 'buy-usdc',
  });
  const calls = [];
  const lookup = createMainnetPriceProvider({
    primary: async mint => {
      calls.push(mint);
      const priceUsd = mint === SOL ? '90' : '1';
      return quote(mint, priceUsd, { fetchedAt: new Date(NOW + 60_000).toISOString() });
    },
    fallback: async () => {
      throw new Error('fallback should not run');
    },
  });
  const marked = await markPaperBook({
    bot: watcher,
    positions: book.positions,
    lookup,
    now: NOW + 60_000,
  });
  assert.deepEqual(calls, [SOL, USDC]);
  assert.equal(marked.mode, 'paper');
  assert.equal(marked.tradesPlaced, 0);
  assert.equal(marked.label, PRICE_LABEL);
  assert.equal(marked.unrealizedMicroUsdc, '-10000000');
  assert.equal(marked.pnlMicroUsdc, '-10000000');
  assert.equal(marked.lossMicroUsdc, '10000000');
  assert.equal(marked.maxLossReached, true);
  assert.equal(marked.action, 'stop');

  const blocked = positionLossDecision({
    bot: watcher,
    ledger,
    proposal,
    mark: marked,
    now: NOW + 60_000,
  });
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.reason, 'max-loss-reached');

  const healthy = await markPaperBook({
    bot: { ...watcher, cap: { ...watcher.cap, maxLoss: '50000000' } },
    positions: book.positions,
    lookup,
    now: NOW + 60_000,
  });
  assert.equal(healthy.maxLossReached, false);
  assert.equal(healthy.action, 'hold');
  const allowed = positionLossDecision({
    bot: { ...watcher, cap: { ...watcher.cap, maxLoss: '50000000' } },
    ledger,
    proposal,
    mark: healthy,
    now: NOW + 60_000,
  });
  assert.equal(allowed.state, 'approval-needed');
  assert.equal(calls.length, 4);
});

test('a trading bot mark ignores other bots and a disabled position bot stops without a trade', async () => {
  const book = createPaperBook();
  const opened = openPaperPosition({
    book,
    bot: trader,
    mint: SOL,
    quantity: '1000000000',
    quote: quote(SOL, '100'),
    now: NOW,
    idempotencyKey: 'own',
  });
  await assert.rejects(
    markPaperBook({
      bot: { ...trader, id: 'bot_other' },
      positions: [opened.position],
      lookup: async () => quote(SOL, '100'),
      now: NOW,
    }),
    error => error.code === 'bot_mismatch',
  );
  const stopped = await markPaperBook({
    bot: { ...watcher, enabled: false },
    positions: [],
    lookup: async () => {
      throw new Error('no open lots');
    },
    now: NOW,
  });
  assert.equal(stopped.action, 'stop');
  assert.equal(stopped.pnlMicroUsdc, '0');
  assert.equal(stopped.tradesPlaced, 0);
});
