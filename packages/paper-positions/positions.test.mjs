import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMainnetPriceProvider } from '@ubc2026/prices';
import {
  PAPER_UNIVERSE,
  PRICE_LABEL,
  MIN_HOLD_MS,
  PaperError,
  assetByMint,
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

/**
 * Achieves: Trading bots open paper SOL positions from mainnet quotes on the execution cluster with broadcast=false; idempotent keys replay.
 * Fails when: Positions mark live/mainnet broadcast, wrong entry cost, or duplicate keys create a second lot.
 * Oracle: Paper trading rules: mainnet pricing / execution-cluster paper fills / PRICE_LABEL.
 * Side effects: Mutates an in-memory paper book.
 * Gaps: Does not cover concurrent idempotency under shared durable storage.
 */
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

/**
 * Achieves: Position/shopping/disabled bots, meme mints, mainnet/live swap flags, invalid/stale quotes are refused with stable codes.
 * Fails when: Any refused path opens a position, or assertNoLiveTrade accepts mainnet.
 * Oracle: PaperError codes from the paper-positions gate matrix.
 * Side effects: Mutates an in-memory paper book (expects empty).
 * Gaps: Does not cover every PAPER_UNIVERSE mint positively.
 */
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

/**
 * Achieves: Closes before MIN_HOLD_MS throw; partial/full closes realize micro-USDC PnL without broadcast; other bots cannot close; close keys replay.
 * Fails when: Early sells succeed, PnL math drifts, broadcast=true, cross-bot close is allowed, or close idempotency doubles fills.
 * Oracle: MIN_HOLD_MS + paper PnL arithmetic from quote prices.
 * Side effects: Mutates an in-memory paper book.
 * Gaps: Does not cover loss-side closes across multiple mints in one assertion.
 */
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
  const replayedClose = closePaperPosition({
    book,
    bot: trader,
    positionId: opened.position.id,
    quantity: '250000000',
    quote: quote(SOL, '160', { fetchedAt: new Date(NOW + MIN_HOLD_MS).toISOString() }),
    now: NOW + MIN_HOLD_MS,
    idempotencyKey: 'sell-half',
  });
  assert.equal(replayedClose.replayed, true);
  assert.equal(partial.position.quantity, '250000000');

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

/**
 * Achieves: markPaperBook prices each open mint once, marks max-loss stop, and positionLossDecision blocks further proposals.
 * Fails when: Fallback runs unnecessarily, max loss is ignored, or a stop still returns approval-needed.
 * Oracle: Position-management maxLoss policy + mainnet price adapter contract.
 * Side effects: Calls injected price provider (no network).
 * Gaps: Does not persist stop decisions to the policy ledger.
 */
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

/**
 * Achieves: Marking another bot’s lots throws bot_mismatch; disabled position bots stop with zero trades/PnL.
 * Fails when: Cross-bot marks succeed, or disabled bots still place trades.
 * Oracle: Bot ownership + enabled gate for markPaperBook.
 * Side effects: none
 * Gaps: Does not cover frozen bots separately from disabled.
 */
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

/**
 * Achieves: assetByMint returns PAPER_UNIVERSE rows for known mints and null for unknowns.
 * Fails when: Unknown mint returns a stub asset, or SOL/USDC symbols swapped.
 * Oracle: PAPER_UNIVERSE mint → symbol map.
 * Side effects: none.
 * Gaps: does not cover mint case folding (mints are case-sensitive base58).
 */
test('assetByMint resolves paper universe mints and returns null for unknowns', () => {
  assert.equal(assetByMint(SOL).symbol, 'SOL');
  assert.equal(assetByMint(USDC).symbol, 'USDC');
  assert.equal(assetByMint(PAPER_UNIVERSE[2].mint).symbol, 'USDT');
  assert.equal(assetByMint(BONK), null);
  assert.equal(assetByMint(''), null);
  assert.equal(assetByMint(null), null);
});

/**
 * Rigor audit — cross-owner paper book refusal
 * Achieves: close/mark refuse when position.ownerId != bot.ownerId (IDOR).
 * Fails when: attacker bot object can close or mark another owner's lot.
 * Oracle: bot_mismatch / owner_mismatch guards in closePaperPosition / markPaperBook.
 * Side effects: none beyond in-memory book.
 * Gaps: persistence/RLS covered in supabase/paper-positions.test.mjs.
 */
test('a bot cannot close or mark another owner\'s paper lot by swapping ownerId', async () => {
  const book = createPaperBook();
  const opened = openPaperPosition({
    book,
    bot: trader,
    mint: SOL,
    quantity: '1000000000',
    quote: quote(SOL, '100'),
    now: NOW,
    idempotencyKey: 'owned',
  });
  assert.throws(() => closePaperPosition({
    book,
    bot: { ...trader, ownerId: 'attacker' },
    positionId: opened.position.id,
    quantity: '1',
    quote: quote(SOL, '100', { fetchedAt: new Date(NOW + MIN_HOLD_MS).toISOString() }),
    now: NOW + MIN_HOLD_MS,
    idempotencyKey: 'steal-owner',
  }), error => error.code === 'bot_mismatch');

  await assert.rejects(
    markPaperBook({
      bot: { ...watcher, ownerId: 'attacker' },
      positions: [opened.position],
      lookup: async () => quote(SOL, '90'),
      now: NOW,
    }),
    error => error.code === 'owner_mismatch',
  );
});
