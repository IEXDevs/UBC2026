import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } from '@ubc2026/wallets/privy';
import { PUBLIC_DEVNET_RPC_URL } from '@ubc2026/wallets/balances';
import { devnetSpendableLabel } from './devnet-balance.mjs';
import {
  devnetBalanceRpcUrl,
  handleDevnetBalanceRequest,
  readAssignedDevnetBalance,
} from './devnet-balance-read.mjs';

const ADDRESS = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function rpcMock({ genesis, lamports, usdc = '0', extra = [] }) {
  const urls = [];
  return {
    urls,
    fetcher: async (url, init) => {
      urls.push(String(url));
      const body = JSON.parse(init.body);
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: genesis });
      }
      if (body.method === 'getBalance') {
        assert.deepEqual(body.params[1], { commitment: 'confirmed' });
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: lamports } });
      }
      assert.equal(body.method, 'getTokenAccountsByOwner');
      assert.equal(body.params[2].commitment, 'confirmed');
      const program = body.params?.[1]?.programId;
      const value = program === SPL
        ? [
          {
            account: {
              data: {
                parsed: {
                  info: { mint: DEVNET_USDC_MINT, tokenAmount: { amount: usdc, decimals: 6 } },
                },
              },
            },
          },
          ...extra,
        ]
        : [];
      return Response.json({ jsonrpc: '2.0', id: 1, result: { value } });
    },
  };
}

/**
 * Achieves: confirmed devnet read returns 20 USDC and SOL, and ignores a mainnet RPC URL.
 * Fails when: the public devnet host is skipped, mainnet is queried, or the faucet amount is dropped.
 * Oracle: fetcher URL is PUBLIC_DEVNET_RPC_URL; label '0.5 SOL · 20 USDC'; JSON has no RPC host.
 * Side effects: mocked fetch only.
 * Gaps: does not hit a live cluster.
 */
test('readAssignedDevnetBalance uses public devnet when QuickNode is unset', async () => {
  const mainnet = 'https://example.invalid/mainnet-secret-path';
  assert.equal(devnetBalanceRpcUrl({}), PUBLIC_DEVNET_RPC_URL);
  assert.equal(devnetBalanceRpcUrl({ QUICKNODE_MAINNET_RPC_URL: mainnet }), PUBLIC_DEVNET_RPC_URL);
  const { urls, fetcher } = rpcMock({
    genesis: DEVNET_GENESIS_HASH,
    lamports: 500_000_000,
    usdc: '20000000',
    extra: [{
      account: {
        data: {
          parsed: {
            info: { mint: JUP, tokenAmount: { amount: '3000000', decimals: 6 } },
          },
        },
      },
    }],
  });
  const bal = await readAssignedDevnetBalance({
    address: ADDRESS,
    env: { QUICKNODE_MAINNET_RPC_URL: mainnet, QUICKNODE_DEVNET_RPC_URL: '' },
    fetcher,
  });
  assert.equal(bal.ok, true);
  assert.equal(bal.cluster, 'devnet');
  assert.equal(bal.spendableCluster, 'devnet');
  assert.equal(bal.mint, DEVNET_USDC_MINT);
  assert.equal(bal.usdcAmount, '20000000');
  assert.equal(bal.solLamports, '500000000');
  assert.match(devnetSpendableLabel(bal), /^0\.5 SOL · 20 USDC · 3 JUPy/);
  assert.equal(urls.length > 0, true);
  assert.equal(urls.every(url => url.startsWith(PUBLIC_DEVNET_RPC_URL)), true);
  const raw = JSON.stringify(bal);
  assert.equal(raw.includes('example.invalid'), false);
  assert.equal(raw.includes('api.devnet.solana.com'), false);
  assert.equal(raw.includes(mainnet), false);
});

/**
 * Achieves: a mainnet genesis is not reported as this wallet's spendable balance.
 * Fails when: lamports from the wrong cluster are returned.
 * Oracle: ok false, code wrong_cluster, solLamports null, and the mock balance 999 never appears.
 * Side effects: mocked fetch only.
 * Gaps: does not hit a live cluster.
 */
test('a mainnet genesis does not become the spendable balance', async () => {
  let balanceReads = 0;
  const bal = await readAssignedDevnetBalance({
    address: ADDRESS,
    env: {},
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === 'getBalance') balanceReads += 1;
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: MAINNET_GENESIS });
      }
      return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 999_000_000_000 } });
    },
  });
  assert.equal(bal.ok, false);
  assert.equal(bal.code, 'wrong_cluster');
  assert.equal(bal.solLamports, null);
  assert.equal(bal.usdcAmount, null);
  assert.equal(balanceReads, 0);
  assert.equal(JSON.stringify(bal).includes('999'), false);
  assert.equal(devnetSpendableLabel(bal), null);
});

/**
 * Achieves: the route requires a bearer and does not call RPC for a bad address.
 * Fails when: an anonymous request reads the cluster, or an invalid address is fetched.
 * Oracle: 401 login_required; 400 invalid_address with zero fetcher calls.
 * Side effects: none.
 * Gaps: does not prove live QuickNode.
 */
test('devnet balance route stays offline without a session', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    throw new Error('should not fetch');
  };
  const missing = await handleDevnetBalanceRequest(new Request('http://localhost/api/devnet-balance?address=' + ADDRESS), {
    env: {},
    fetcher,
  });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, 'login_required');
  const bad = await handleDevnetBalanceRequest(new Request('http://localhost/api/devnet-balance?address=nope', {
    headers: { authorization: 'Bearer test-token' },
  }), { env: {}, fetcher });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'invalid_address');
  assert.equal(calls, 0);
  const { GET } = await import('../app/api/devnet-balance/route.js');
  const res = await GET(new Request('http://localhost/api/devnet-balance?address=' + ADDRESS));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'login_required');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
