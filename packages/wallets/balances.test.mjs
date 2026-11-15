import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } from './privy.mjs';
import {
  SPL_TOKEN_PROGRAM_ID,
  TESTNET_GENESIS_HASH,
  parseTokenAccountsByMint,
  readDevnetWalletBalances,
  readWalletBalancesAcrossClusters,
} from './balances.mjs';

const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const rpcUrl = 'https://example.invalid/quicknode-secret-path';

test('DEVNET_GENESIS_HASH is the full getGenesisHash value (not the CAIP-2 truncation)', () => {
  assert.equal(DEVNET_GENESIS_HASH, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  assert.equal(DEVNET_GENESIS_HASH.length, 44);
  assert.notEqual(DEVNET_GENESIS_HASH, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
});

test('parseTokenAccountsByMint aggregates non-zero mints and skips zeros', () => {
  const other = 'So11111111111111111111111111111111111111112';
  const parsed = parseTokenAccountsByMint([
    {
      account: {
        data: { parsed: { info: { mint: DEVNET_USDC_MINT, tokenAmount: { amount: '5', decimals: 6 } } } },
      },
    },
    {
      account: {
        data: { parsed: { info: { mint: other, tokenAmount: { amount: '0', decimals: 9 } } } },
      },
    },
    {
      account: {
        data: { parsed: { info: { mint: other, tokenAmount: { amount: '9', decimals: 9 } } } },
      },
    },
  ]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tokens.length, 2);
  assert.equal(parsed.tokens[0].symbol, 'USDC');
  assert.equal(parsed.tokens[1].amount, '9');
});

test('parseTokenAccountsByMint returns every non-zero mint the wallet holds (not an allowlist)', () => {
  // Arbitrary meme-style mints — must show up without being pre-registered.
  const sixtySeven = '67o1n1111111111111111111111111111111111111';
  const trump = 'Trump1111111111111111111111111111111111111';
  const parsed = parseTokenAccountsByMint([
    {
      account: {
        data: { parsed: { info: { mint: sixtySeven, tokenAmount: { amount: '420000000', decimals: 6 } } } },
      },
    },
    {
      account: {
        data: { parsed: { info: { mint: trump, tokenAmount: { amount: '1000000000', decimals: 6 } } } },
      },
    },
  ], { cluster: 'testnet' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tokens.length, 2);
  assert.ok(parsed.tokens.every((token) => token.known === false));
  assert.ok(parsed.tokens.some((token) => token.mint === sixtySeven));
  assert.ok(parsed.tokens.some((token) => token.mint === trump));
});

test('readDevnetWalletBalances returns SOL and SPL tokens without leaking the RPC URL', async () => {
  const bal = await readDevnetWalletBalances({
    rpcUrl,
    address,
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH });
      }
      if (body.method === 'getBalance') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 1_000_000_000 } });
      }
      assert.equal(body.method, 'getTokenAccountsByOwner');
      if (body.params[1].programId !== SPL_TOKEN_PROGRAM_ID) {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
      }
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: [{
            account: {
              data: {
                parsed: {
                  info: { mint: DEVNET_USDC_MINT, tokenAmount: { amount: '42', decimals: 6 } },
                },
              },
            },
          }],
        },
      });
    },
  });
  assert.equal(bal.ok, true);
  assert.equal(bal.solLamports, '1000000000');
  assert.equal(bal.usdcAmount, '42');
  assert.equal(bal.tokens[0].symbol, 'USDC');
  assert.equal(JSON.stringify(bal).includes('quicknode-secret-path'), false);
});

test('readWalletBalancesAcrossClusters returns whatever each cluster actually holds', async () => {
  const bal = await readWalletBalancesAcrossClusters({
    address,
    env: {
      QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/devnet',
      QUICKNODE_TESTNET_RPC_URL: 'https://example.invalid/testnet',
    },
    fetcher: async (url, init) => {
      const href = String(url);
      const body = JSON.parse(init.body || '{}');
      const genesis = href.includes('testnet') ? TESTNET_GENESIS_HASH : DEVNET_GENESIS_HASH;
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: genesis });
      }
      if (body.method === 'getBalance') {
        const value = href.includes('testnet') ? 3_000_000_000 : 0;
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value } });
      }
      return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
    },
  });
  assert.equal(bal.ok, true);
  assert.equal(bal.clusters.testnet.solLamports, '3000000000');
  assert.equal(bal.clusters.devnet.solLamports, '0');
  assert.equal(bal.holdings.length, 1);
  assert.equal(bal.holdings[0].cluster, 'testnet');
  assert.equal(bal.holdings[0].label, '3 SOL (testnet)');
  assert.equal(bal.displayBalanceLabel, '3 SOL (testnet)');
  assert.equal(JSON.stringify(bal).includes('example.invalid'), false);
});
