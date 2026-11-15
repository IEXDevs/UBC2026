import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVNET_USDC_MINT,
  MAINNET_USDC_MINT,
  PRICE_LABEL,
  SOL_MINT,
  PortfolioError,
  buildPortfolio,
  choosePortfolioRpc,
  formatShare,
  formatUsdMicro,
  loadPortfolio,
  portfolioErrorNote,
  usdMicro,
} from './portfolio.mjs';

const RPC = 'https://example.invalid/quicknode-secret-path';
const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PHANTOM = 'So11111111111111111111111111111111111111112';
const AGENT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

test('usd micro multiplies base units by a decimal price', () => {
  assert.equal(usdMicro('1000000000', 9, '150.25'), '150250000');
  assert.equal(usdMicro('2500000', 6, '1'), '2500000');
  assert.equal(formatUsdMicro('150250000'), '$150.25');
  assert.equal(formatUsdMicro('2500000'), '$2.50');
  assert.equal(formatShare(2550), '25.5%');
  assert.equal(formatShare(10000), '100%');
});

test('portfolio slices sum to the whole and skip dust nfts', () => {
  const book = buildPortfolio({
    cluster: 'mainnet',
    prices: { [SOL_MINT]: '100', [MAINNET_USDC_MINT]: '1' },
    wallets: [
      {
        address: PHANTOM,
        label: 'Phantom',
        walletClientType: 'phantom',
        spendable: false,
        tokens: [
          { mint: SOL_MINT, amount: '2000000000', decimals: 9 },
          { mint: MAINNET_USDC_MINT, amount: '50000000', decimals: 6 },
          { mint: AGENT, amount: '1', decimals: 0 },
        ],
      },
      {
        address: AGENT,
        label: 'Main',
        walletClientType: 'privy',
        spendable: true,
        tokens: [{ mint: SOL_MINT, amount: '0', decimals: 9 }],
      },
    ],
  });
  assert.equal(book.authorizesTransaction, false);
  assert.equal(book.priceLabel, PRICE_LABEL);
  assert.equal(book.totalUsdMicro, '250000000');
  assert.equal(book.slices.reduce((sum, slice) => sum + slice.shareBps, 0), 10000);
  assert.equal(book.slices[0].symbol, 'SOL');
  assert.equal(book.slices[0].shareBps, 8000);
  assert.equal(book.slices[1].symbol, 'USDC');
  assert.equal(book.wallets[0].spendable, false);
  assert.equal(book.unpriced, 0);
  assert.match(book.note, /do not authorize a transaction/);
  assert.match(book.note, /devnet execution, mainnet pricing/);
});

test('quicknode read prices balances and never sends a transaction', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    assert.equal(url, RPC);
    const body = JSON.parse(init.body);
    calls.push(...body.map(row => row.method));
    assert.equal(body.some(row => row.method === 'sendTransaction'), false);
    const results = body.map(row => {
      if (row.method === 'getGenesisHash') return { jsonrpc: '2.0', id: row.id, result: DEVNET };
      if (row.method === 'getBalance') {
        return { jsonrpc: '2.0', id: row.id, result: { value: row.params[0] === PHANTOM ? 1_000_000_000 : 0 } };
      }
      const program = row.params?.[1]?.programId;
      const showUsdc = row.params?.[0] === PHANTOM
        && program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
      return {
        jsonrpc: '2.0',
        id: row.id,
        result: {
          value: showUsdc ? [{
            account: {
              data: {
                parsed: {
                  info: {
                    mint: DEVNET_USDC_MINT,
                    tokenAmount: { amount: '2000000', decimals: 6 },
                  },
                },
              },
            },
          }] : [],
        },
      };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  };
  const book = await loadPortfolio({
    rpcUrl: RPC,
    fetcher,
    wallets: [
      { address: PHANTOM, label: 'Phantom', walletClientType: 'phantom', spendable: false },
      { address: AGENT, label: 'Main', walletClientType: 'privy', spendable: true },
    ],
    lookupPrice: async mint => {
      if (mint === SOL_MINT) return { priceUsd: '100' };
      throw new Error(`no price ${RPC}`);
    },
    now: () => new Date('2026-11-15T00:00:00.000Z'),
  });
  assert.equal(book.cluster, 'devnet');
  assert.equal(book.totalUsdMicro, '102000000');
  assert.equal(book.wallets[0].holdings.some(row => row.symbol === 'USDC' && row.usdMicro === '2000000'), true);
  assert.equal(book.fetchedAt, '2026-11-15T00:00:00.000Z');
  assert.equal(calls.includes('sendTransaction'), false);
  assert.equal(JSON.stringify(book).includes('quicknode-secret-path'), false);
  assert.match(book.note, /QUICKNODE_MAINNET_RPC_URL/);
});

test('a non-solana genesis and a leaked url are refused', async () => {
  const fetcher = async () => new Response(JSON.stringify([
    { jsonrpc: '2.0', id: 0, result: MAINNET.replace('5', 'x') },
  ]), { status: 200 });
  await assert.rejects(
    () => loadPortfolio({
      rpcUrl: RPC,
      fetcher,
      wallets: [{ address: PHANTOM, label: 'Phantom' }],
      lookupPrice: async () => ({ priceUsd: '1' }),
    }),
    error => error instanceof PortfolioError && error.code === 'wrong_cluster' && !String(error.message).includes('quicknode'),
  );
  assert.deepEqual(choosePortfolioRpc({}).missing, ['QUICKNODE_MAINNET_RPC_URL', 'QUICKNODE_DEVNET_RPC_URL']);
  assert.equal(choosePortfolioRpc({ QUICKNODE_MAINNET_RPC_URL: ` ${RPC} ` }).rpcUrl, RPC);
  await assert.rejects(
    () => loadPortfolio({
      rpcUrl: 'http://example.invalid/quicknode-secret-path',
      fetcher: async () => { throw new Error('should not fetch'); },
      wallets: [{ address: PHANTOM }],
      lookupPrice: async () => ({ priceUsd: '1' }),
    }),
    error => error instanceof PortfolioError && error.code === 'invalid_rpc' && !String(error.message).includes('quicknode'),
  );
});

test('portfolio errors name the missing config and drop urls', () => {
  assert.match(portfolioErrorNote({ error: 'missing_config' }), /QUICKNODE_MAINNET_RPC_URL/);
  assert.equal(
    portfolioErrorNote({ error: 'rpc_failed', detail: 'https://example.invalid/quicknode-secret-path' }).includes('quicknode'),
    false,
  );
});

test('no linked wallets skip the rpc', async () => {
  let called = false;
  const book = await loadPortfolio({
    rpcUrl: RPC,
    fetcher: async () => { called = true; return new Response('{}'); },
    wallets: [],
    lookupPrice: async () => ({ priceUsd: '1' }),
    now: () => new Date('2026-11-15T00:00:00.000Z'),
  });
  assert.equal(called, false);
  assert.equal(book.totalUsdMicro, '0');
  assert.match(book.note, /Connect a Solana wallet/);
});
