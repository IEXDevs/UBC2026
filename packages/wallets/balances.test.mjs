import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } from './privy.mjs';
import {
  SPL_TOKEN_PROGRAM_ID,
  parseTokenAccountsByMint,
  readDevnetWalletBalances,
} from './balances.mjs';

const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const rpcUrl = 'https://example.invalid/quicknode-secret-path';

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
