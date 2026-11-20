import { SOLANA_CLUSTER, EXECUTION_LABEL } from '@ubc2026/contracts/solana';
/**
 * Paper positions for trading and position-management bots.
 * Marks to market with a mainnet price lookup (DexScreener, Jupiter fallback).
 * Fills stay on mainnet-beta or testnet and never broadcast a swap.
 */
import { evaluateProposal } from '@ubc2026/bot-policy';

export class PaperError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PaperError';
    this.code = code;
  }
}

export const PRICE_LABEL = EXECUTION_LABEL;
export const MIN_HOLD_MS = 60 * 60 * 1000;
export const MAX_QUOTE_AGE_MS = 5 * 60 * 1000;

/** Mainnet mints used only as price identities. Execution never uses these clusters. */
export const PAPER_UNIVERSE = Object.freeze([
  Object.freeze({
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    kind: 'blue-chip',
  }),
  Object.freeze({
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    kind: 'stablecoin',
  }),
  Object.freeze({
    symbol: 'USDT',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    kind: 'stablecoin',
  }),
]);

const BY_MINT = new Map(PAPER_UNIVERSE.map(asset => [asset.mint, asset]));
const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const KEY = /^[a-zA-Z0-9:_-]{1,128}$/;
const MICRO = 1_000_000n;

export function assetByMint(mint) {
  return BY_MINT.get(mint) ?? null;
}

export function createPaperBook() {
  return { positions: [], fills: [], keys: {} };
}

function fail(code) {
  throw new PaperError(code);
}

function assertBot(bot) {
  if (!bot || typeof bot.id !== 'string' || bot.id.length < 1 || bot.id.length > 128) fail('invalid_bot');
  if (typeof bot.ownerId !== 'string' || bot.ownerId.length < 1 || bot.ownerId.length > 128) fail('invalid_bot');
  if (!['trading', 'shopping', 'position-management'].includes(bot.type)) fail('invalid_bot');
  if (typeof bot.enabled !== 'boolean') fail('invalid_bot');
  return bot;
}

function assertNow(now) {
  if (!Number.isSafeInteger(now) || now < 1) fail('invalid_now');
  return now;
}

function assertQuantity(quantity) {
  if (typeof quantity !== 'string' || !AMOUNT.test(quantity) || quantity === '0') fail('invalid_quantity');
  return BigInt(quantity);
}

function assertKey(idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey)) fail('invalid_idempotency_key');
  return idempotencyKey;
}

/**
 * Refuse a mainnet or signed swap. Paper fills are the only trade this package records.
 */
export function assertNoLiveTrade(request = {}) {
  const cluster = request.cluster ?? SOLANA_CLUSTER;
  if (
    cluster === 'mainnet'
    || request.executionCluster === 'mainnet'
    || request.network === 'mainnet'
    || request.pricingCluster === SOLANA_CLUSTER
  ) fail('mainnet_trade_refused');
  if (cluster !== SOLANA_CLUSTER) fail('mainnet_trade_refused');
  if (
    request.broadcast === true
    || request.sign === true
    || request.swapTransaction != null
    || request.serializedTransaction != null
  ) fail('live_trade_refused');
  return cluster;
}

function usdToMicro(priceUsd) {
  if (typeof priceUsd !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(priceUsd)) fail('invalid_quote');
  const [whole, frac = ''] = priceUsd.split('.');
  const digits = `${frac}0000000`.slice(0, 7);
  let micro = BigInt(whole) * MICRO + BigInt(digits.slice(0, 6));
  if (digits[6] >= '5') micro += 1n;
  if (micro <= 0n) fail('invalid_quote');
  return micro;
}

function assertQuote(quote, mint, now) {
  if (!quote || quote.mint !== mint) fail('invalid_quote');
  if (quote.pricingCluster !== 'mainnet' || quote.executionCluster !== SOLANA_CLUSTER) fail('invalid_quote');
  if (quote.label !== PRICE_LABEL) fail('invalid_quote');
  if (quote.quoteSource !== 'dexscreener' && quote.quoteSource !== 'jupiter-price-v3') fail('invalid_quote');
  if (typeof quote.fetchedAt !== 'string') fail('invalid_quote');
  const fetched = Date.parse(quote.fetchedAt);
  if (!Number.isFinite(fetched)) fail('invalid_quote');
  const age = now - fetched;
  if (age > MAX_QUOTE_AGE_MS || age < -5000) fail('stale_quote');
  return usdToMicro(quote.priceUsd);
}

function divHalfUp(numerator, denominator) {
  if (denominator <= 0n) fail('invalid_quantity');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

function notionalMicro(quantity, decimals, priceMicro) {
  const scale = 10n ** BigInt(decimals);
  return divHalfUp(quantity * priceMicro, scale);
}

function signed(value) {
  return value.toString();
}

function keyId(botId, idempotencyKey) {
  return `${botId}:${idempotencyKey}`;
}

function assertStoredPosition(position) {
  if (!position || typeof position.id !== 'string' || typeof position.botId !== 'string') fail('invalid_book');
  if (typeof position.ownerId !== 'string' || typeof position.mint !== 'string') fail('invalid_book');
  if (!Number.isInteger(position.decimals) || position.decimals < 0 || position.decimals > 18) fail('invalid_book');
  if (typeof position.quantity !== 'string' || !AMOUNT.test(position.quantity)) fail('invalid_book');
  if (typeof position.entryMicroUsdc !== 'string' || !AMOUNT.test(position.entryMicroUsdc)) fail('invalid_book');
  if (typeof position.realizedMicroUsdc !== 'string' || !/^-?(0|[1-9][0-9]{0,39})$/.test(position.realizedMicroUsdc)) {
    fail('invalid_book');
  }
  if (position.status !== 'open' && position.status !== 'closed') fail('invalid_book');
  if (position.mode !== 'paper') fail('live_trade_refused');
}

function replay(book, bot, idempotencyKey, shape) {
  const prior = book.keys[keyId(bot.id, idempotencyKey)];
  if (!prior) return null;
  if (prior.shape !== shape) fail('idempotency_mismatch');
  const position = book.positions.find(item => item.id === prior.positionId);
  const fill = book.fills.find(item => item.id === prior.fillId);
  if (!position || !fill) fail('idempotency_mismatch');
  return { position: { ...position }, fill: { ...fill }, replayed: true };
}

function remember(book, bot, idempotencyKey, shape, positionId, fillId) {
  book.keys[keyId(bot.id, idempotencyKey)] = { shape, positionId, fillId };
}

/**
 * Open a long paper lot. Trading bots only. The quote must come from the mainnet price adapter.
 */
export function openPaperPosition({
  book,
  bot,
  mint,
  quantity,
  quote,
  now,
  idempotencyKey,
  cluster,
  broadcast,
  sign,
  swapTransaction,
  serializedTransaction,
  executionCluster,
  network,
}) {
  assertBot(bot);
  if (!book || !Array.isArray(book.positions) || !Array.isArray(book.fills) || !book.keys) fail('invalid_book');
  const execution = assertNoLiveTrade({
    cluster, broadcast, sign, swapTransaction, serializedTransaction, executionCluster, network,
  });
  const stamp = assertNow(now);
  const key = assertKey(idempotencyKey);
  const again = replay(book, bot, key, `open:${mint}:${quantity}`);
  if (again) return again;
  if (bot.type === 'position-management') fail('position_bot_watches_only');
  if (bot.type !== 'trading') fail('bot_type_refused');
  if (!bot.enabled) fail('bot_disabled');
  const asset = assetByMint(mint);
  if (!asset) fail('asset_not_allowed');
  const qty = assertQuantity(quantity);
  const priceMicro = assertQuote(quote, mint, stamp);
  const entry = notionalMicro(qty, asset.decimals, priceMicro);
  const position = {
    id: `pos:${bot.id}:${key}`,
    botId: bot.id,
    ownerId: bot.ownerId,
    mint: asset.mint,
    symbol: asset.symbol,
    kind: asset.kind,
    decimals: asset.decimals,
    quantity: qty.toString(),
    entryMicroUsdc: entry.toString(),
    entryPriceUsd: quote.priceUsd,
    realizedMicroUsdc: '0',
    openedAt: stamp,
    updatedAt: stamp,
    status: 'open',
    cluster: execution,
    mode: 'paper',
    label: PRICE_LABEL,
  };
  const fill = {
    id: `fill:${bot.id}:${key}`,
    positionId: position.id,
    botId: bot.id,
    ownerId: bot.ownerId,
    side: 'buy',
    mint: asset.mint,
    symbol: asset.symbol,
    quantity: qty.toString(),
    priceUsd: quote.priceUsd,
    notionalMicroUsdc: entry.toString(),
    realizedMicroUsdc: '0',
    quoteSource: quote.quoteSource,
    fallbackFrom: quote.fallbackFrom ?? null,
    cluster: execution,
    pricingCluster: 'mainnet',
    mode: 'paper',
    broadcast: false,
    at: stamp,
  };
  book.positions.push(position);
  book.fills.push(fill);
  remember(book, bot, key, `open:${mint}:${quantity}`, position.id, fill.id);
  return { position: { ...position }, fill: { ...fill }, replayed: false };
}

/**
 * Close part or all of a paper lot after the minimum hold. No swap is signed.
 */
export function closePaperPosition({
  book,
  bot,
  positionId,
  quantity,
  quote,
  now,
  idempotencyKey,
  cluster,
  broadcast,
  sign,
  swapTransaction,
  serializedTransaction,
  executionCluster,
  network,
}) {
  assertBot(bot);
  if (!book || !Array.isArray(book.positions) || !Array.isArray(book.fills) || !book.keys) fail('invalid_book');
  const execution = assertNoLiveTrade({
    cluster, broadcast, sign, swapTransaction, serializedTransaction, executionCluster, network,
  });
  const stamp = assertNow(now);
  const key = assertKey(idempotencyKey);
  const again = replay(book, bot, key, `close:${positionId}:${quantity}`);
  if (again) return again;
  if (bot.type === 'position-management') fail('position_bot_watches_only');
  if (bot.type !== 'trading') fail('bot_type_refused');
  if (!bot.enabled) fail('bot_disabled');
  const position = book.positions.find(item => item.id === positionId);
  if (!position) fail('position_not_found');
  if (position.botId !== bot.id || position.ownerId !== bot.ownerId) fail('bot_mismatch');
  if (position.status !== 'open') fail('position_closed');
  if (stamp < position.openedAt + MIN_HOLD_MS) fail('hold_period');
  const qty = assertQuantity(quantity);
  const remaining = BigInt(position.quantity);
  if (qty > remaining) fail('insufficient_quantity');
  const priceMicro = assertQuote(quote, position.mint, stamp);
  const cost = BigInt(position.entryMicroUsdc);
  const closedCost = qty === remaining ? cost : divHalfUp(cost * qty, remaining);
  const exitValue = notionalMicro(qty, position.decimals, priceMicro);
  const realized = exitValue - closedCost;
  position.quantity = (remaining - qty).toString();
  position.entryMicroUsdc = (cost - closedCost).toString();
  position.realizedMicroUsdc = (BigInt(position.realizedMicroUsdc) + realized).toString();
  position.updatedAt = stamp;
  position.cluster = execution;
  if (position.quantity === '0') position.status = 'closed';
  const fill = {
    id: `fill:${bot.id}:${key}`,
    positionId: position.id,
    botId: bot.id,
    ownerId: bot.ownerId,
    side: 'sell',
    mint: position.mint,
    symbol: position.symbol,
    quantity: qty.toString(),
    priceUsd: quote.priceUsd,
    notionalMicroUsdc: exitValue.toString(),
    realizedMicroUsdc: realized.toString(),
    quoteSource: quote.quoteSource,
    fallbackFrom: quote.fallbackFrom ?? null,
    cluster: execution,
    pricingCluster: 'mainnet',
    mode: 'paper',
    broadcast: false,
    at: stamp,
  };
  book.fills.push(fill);
  remember(book, bot, key, `close:${positionId}:${quantity}`, position.id, fill.id);
  return { position: { ...position }, fill: { ...fill }, replayed: false };
}

/**
 * Value open lots with the injected mainnet price lookup. Places no trades.
 * `lossMicroUsdc` is the unsigned drawdown a position bot's ledger can store.
 */
export async function markPaperBook({ bot, positions, lookup, now }) {
  assertBot(bot);
  if (bot.type === 'shopping') fail('bot_type_refused');
  if (!Array.isArray(positions)) fail('invalid_book');
  const stamp = assertNow(now);
  if (typeof lookup !== 'function') fail('lookup_required');

  let realized = 0n;
  let unrealized = 0n;
  const quotes = new Map();
  const openMints = [];
  for (const position of positions) {
    assertStoredPosition(position);
    if (position.ownerId !== bot.ownerId) fail('owner_mismatch');
    if (bot.type === 'trading' && position.botId !== bot.id) fail('bot_mismatch');
    if (position.status === 'open' && position.quantity !== '0' && !openMints.includes(position.mint)) {
      openMints.push(position.mint);
    }
  }
  for (const mint of openMints) {
    quotes.set(mint, await lookup(mint));
  }

  const marked = positions.map(position => {
    const lotRealized = BigInt(position.realizedMicroUsdc ?? '0');
    realized += lotRealized;
    if (position.status !== 'open' || position.quantity === '0') {
      return {
        ...position,
        markPriceUsd: null,
        markMicroUsdc: '0',
        unrealizedMicroUsdc: '0',
      };
    }
    const quote = quotes.get(position.mint);
    const priceMicro = assertQuote(quote, position.mint, stamp);
    const mark = notionalMicro(BigInt(position.quantity), position.decimals, priceMicro);
    const entry = BigInt(position.entryMicroUsdc);
    const pnl = mark - entry;
    unrealized += pnl;
    return {
      ...position,
      markPriceUsd: quote.priceUsd,
      markMicroUsdc: mark.toString(),
      unrealizedMicroUsdc: pnl.toString(),
      quoteSource: quote.quoteSource,
      fallbackFrom: quote.fallbackFrom ?? null,
    };
  });

  const pnl = realized + unrealized;
  const loss = pnl < 0n ? -pnl : 0n;
  let maxLossReached = false;
  if (bot.type === 'position-management' && bot.cap?.mode === 'limited') {
    if (typeof bot.cap.maxLoss !== 'string' || !AMOUNT.test(bot.cap.maxLoss)) fail('invalid_bot');
    maxLossReached = loss >= BigInt(bot.cap.maxLoss);
  }
  const action = !bot.enabled || maxLossReached ? 'stop' : 'hold';
  return {
    label: PRICE_LABEL,
    pricingCluster: 'mainnet',
    executionCluster: SOLANA_CLUSTER,
    mode: 'paper',
    tradesPlaced: 0,
    positions: marked,
    realizedMicroUsdc: signed(realized),
    unrealizedMicroUsdc: signed(unrealized),
    pnlMicroUsdc: signed(pnl),
    lossMicroUsdc: loss.toString(),
    maxLossReached,
    action,
  };
}

/**
 * Copy paper loss into the shape `evaluateProposal` already reads.
 * Does not reserve, sign, or trade. A position bot at max loss is blocked.
 */
export function positionLossDecision({ bot, ledger, proposal, mark, now }) {
  assertBot(bot);
  if (bot.type !== 'position-management') fail('bot_type_refused');
  if (!mark || typeof mark.lossMicroUsdc !== 'string' || !AMOUNT.test(mark.lossMicroUsdc)) fail('invalid_book');
  if (mark.tradesPlaced !== 0 || mark.mode !== 'paper') fail('live_trade_refused');
  const nextLedger = { ...ledger, realizedLoss: mark.lossMicroUsdc };
  return evaluateProposal(bot, proposal, nextLedger, now);
}
