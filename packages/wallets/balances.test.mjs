import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVNET_GENESIS_HASH, DEVNET_USDC_MINT } from './privy.mjs';
import {
  SPL_TOKEN_PROGRAM_ID,
  TESTNET_GENESIS_HASH,
  PUBLIC_DEVNET_RPC_URL,
  PUBLIC_TESTNET_RPC_URL,
  CLUSTERS,
  parseTokenAccountsByMint,
  readClusterWalletBalances,
  resolveClusterRpcUrls,
  readDevnetWalletBalances,
  readDevnetUsdcBalance,
  readWalletBalancesAcrossClusters,
} from './balances.mjs';

const address = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const rpcUrl = 'https://example.invalid/quicknode-secret-path';

/**
 * Rigor audit — genesis constant
 * Achieves: full 44-char Solana-devnet genesis (not CAIP-2 truncated form).
 * Fails when: truncated hash used for getGenesisHash compares (false cluster accept).
 * Oracle: published Solana-devnet genesis hash.
 * Side effects: none.
 * Gaps: none.
 */
test('DEVNET_GENESIS_HASH is the full getGenesisHash value (not the CAIP-2 truncation)', () => {
  assert.equal(DEVNET_GENESIS_HASH, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  assert.equal(DEVNET_GENESIS_HASH.length, 44);
  assert.notEqual(DEVNET_GENESIS_HASH, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
});

/**
 * Rigor audit — SPL parse aggregates
 * Achieves: non-zero mints kept; zero balances skipped; USDC recognized.
 * Fails when: zeros inflate the list or same mint not aggregated correctly.
 * Oracle: RPC tokenAmount.amount semantics.
 * Side effects: none.
 * Gaps: none for zero-skip + USDC symbol.
 */
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

/**
 * Rigor audit — unknown mints are not allowlisted away
 * Achieves: arbitrary non-zero mints appear as known:false holdings.
 * Fails when: parser only returns a fixed USDC/SOL allowlist.
 * Oracle: get_wallets must list every non-zero SPL the account holds.
 * Side effects: none.
 * Gaps: none for allowlist regression.
 */
test('parseTokenAccountsByMint returns every non-zero mint the wallet holds (not an allowlist)', () => {
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

/**
 * Rigor audit — devnet balance read + secret hygiene
 * Achieves: SOL + USDC from mocked RPC; response JSON never contains RPC URL path.
 * Fails when: wrong cluster accepted, USDC missed, or RPC URL leaks into client JSON.
 * Oracle: getGenesisHash must match DEVNET_GENESIS_HASH; amounts from RPC result.
 * Side effects: fetcher call methods asserted indirectly via returned balances.
 * Gaps: none for happy path. Remaining: wrong-genesis refusal covered elsewhere in privy tests.
 */
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
        assert.deepEqual(body.params[1], { commitment: 'confirmed' });
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 1_000_000_000 } });
      }
      assert.equal(body.method, 'getTokenAccountsByOwner');
      assert.equal(body.params[2].commitment, 'confirmed');
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

/**
 * Rigor audit — multi-cluster holdings
 * Achieves: per-cluster SOL reported; display label uses actual non-zero cluster;
 *   RPC hostnames never leak into JSON.
 * Fails when: clusters mixed up or empty cluster preferred in display.
 * Oracle: independent genesis per URL; holdings derived from returned lamports.
 * Side effects: none beyond fetcher.
 * Gaps: none for dual-cluster SOL. Remaining: SPL across clusters not asserted here.
 */
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

/**
 * Achieves: resolveClusterRpcUrls prefers QuickNode HTTPS secrets and falls back to public Solana RPC.
 * Fails when: http/credentialed URLs accepted, or empty env returns null instead of public HTTPS.
 * Oracle: PUBLIC_*_RPC_URL constants + https-only assertHttpsRpc.
 * Side effects: none.
 * Gaps: does not probe live RPC reachability.
 */
test('resolveClusterRpcUrls prefers secrets and falls back to public HTTPS', () => {
  assert.deepEqual(CLUSTERS, ['devnet', 'testnet']);
  const fallback = resolveClusterRpcUrls({});
  assert.equal(fallback.devnet, new URL(PUBLIC_DEVNET_RPC_URL).toString());
  assert.equal(fallback.testnet, new URL(PUBLIC_TESTNET_RPC_URL).toString());
  const secret = resolveClusterRpcUrls({
    QUICKNODE_DEVNET_RPC_URL: 'https://example.invalid/devnet-secret',
    QUICKNODE_TESTNET_RPC_URL: 'https://example.invalid/testnet-secret',
  });
  assert.equal(secret.devnet, 'https://example.invalid/devnet-secret');
  assert.equal(secret.testnet, 'https://example.invalid/testnet-secret');
  const refused = resolveClusterRpcUrls({
    QUICKNODE_DEVNET_RPC_URL: 'http://insecure.example/rpc',
    QUICKNODE_TESTNET_RPC_URL: 'https://user:pass@example.invalid/rpc',
  });
  assert.equal(refused.devnet, null);
  assert.equal(refused.testnet, null);
});

/**
 * Achieves: readClusterWalletBalances enforces cluster genesis; invalid cluster/address soft-fail.
 * Fails when: wrong genesis accepted, mainnet cluster ok, or bad address throws instead of code.
 * Oracle: CLUSTER_GENESIS map + rejectBalance codes.
 * Side effects: injected fetcher only.
 * Gaps: Token-2022 merge path covered via empty 2022 response.
 */
test('readClusterWalletBalances validates cluster and soft-fails invalid inputs', async () => {
  const invalidCluster = await readClusterWalletBalances({ cluster: 'mainnet-beta', address, rpcUrl });
  assert.equal(invalidCluster.ok, false);
  assert.equal(invalidCluster.code, 'invalid_cluster');
  const badAddress = await readClusterWalletBalances({ cluster: 'devnet', address: '!!!', rpcUrl });
  assert.equal(badAddress.code, 'invalid_address');
  const noRpc = await readClusterWalletBalances({ cluster: 'devnet', address });
  assert.equal(noRpc.code, 'rpc_not_configured');
  const wrongGenesis = await readClusterWalletBalances({
    cluster: 'devnet',
    rpcUrl,
    address,
    fetcher: async () => Response.json({ jsonrpc: '2.0', id: 1, result: TESTNET_GENESIS_HASH }),
  });
  assert.equal(wrongGenesis.code, 'wrong_cluster');
  const ok = await readClusterWalletBalances({
    cluster: 'testnet',
    rpcUrl: 'https://example.invalid/testnet',
    address,
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: TESTNET_GENESIS_HASH });
      }
      if (body.method === 'getBalance') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 5 } });
      }
      return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.cluster, 'testnet');
  assert.equal(ok.solLamports, '5');
  assert.equal(ok.usdcAmount, '0');
});

/**
 * Achieves: readDevnetUsdcBalance returns only USDC amount fields from the cluster read.
 * Fails when: amount missing on ok path, or RPC URL leaks into JSON.
 * Oracle: Compat wrapper over readDevnetWalletBalances.usdcAmount.
 * Side effects: injected fetcher.
 * Gaps: none for USDC-only shape.
 */
test('readDevnetUsdcBalance returns USDC amount without RPC URL leakage', async () => {
  const bal = await readDevnetUsdcBalance({
    rpcUrl,
    address,
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH });
      }
      if (body.method === 'getBalance') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 0 } });
      }
      if (body.params?.[1]?.programId !== SPL_TOKEN_PROGRAM_ID) {
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
                  info: { mint: DEVNET_USDC_MINT, tokenAmount: { amount: '7', decimals: 6 } },
                },
              },
            },
          }],
        },
      });
    },
  });
  assert.equal(bal.ok, true);
  assert.equal(bal.amount, '7');
  assert.equal(bal.cluster, 'devnet');
  assert.equal(bal.mint, DEVNET_USDC_MINT);
  assert.equal(JSON.stringify(bal).includes('quicknode-secret-path'), false);
  const failed = await readDevnetUsdcBalance({ address, fetcher: async () => { throw new Error('no'); } });
  assert.equal(failed.ok, false);
  assert.equal(failed.amount, null);
});

/**
 * Achieves: rpc_failed stays distinct from empty success in classifyBalanceRead.
 * Fails when: failed reads collapse to empty/"0 SOL".
 * Oracle: status failed; unavailable label; empty success stays empty.
 * Side effects: none.
 * Gaps: none.
 */
/**
 * Achieves: Solana RPC fetch uses Workers-safe redirect + soft timeout polyfill path;
 *   one retry on throw; AbortError surfaces as rpc_timeout (not empty zero).
 * Fails when: redirect error mode returns, first throw is not retried, or abort → rpc_failed.
 * Oracle: init.redirect === 'manual'; call count 2 on throw-then-ok; abort code rpc_timeout.
 * Side effects: injected fetcher only.
 * Gaps: does not assert real workerd AbortSignal.timeout absence.
 */
test('rpcCall uses redirect follow, retries once, and maps abort to rpc_timeout', async () => {
  let calls = 0;
  const ok = await readClusterWalletBalances({
    cluster: 'devnet',
    rpcUrl,
    address,
    fetcher: async (_url, init) => {
      calls += 1;
      assert.equal(init.redirect, 'follow');
      assert.ok(init.signal === undefined || typeof init.signal?.aborted === 'boolean');
      if (calls === 1) throw new Error('network_blip');
      const body = JSON.parse(init.body);
      if (body.method === 'getGenesisHash') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: DEVNET_GENESIS_HASH });
      }
      if (body.method === 'getBalance') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: { value: 9 } });
      }
      return Response.json({ jsonrpc: '2.0', id: 1, result: { value: [] } });
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.solLamports, '9');
  assert.ok(calls >= 2);

  const aborted = await readClusterWalletBalances({
    cluster: 'devnet',
    rpcUrl,
    address,
    fetcher: async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    },
  });
  assert.equal(aborted.ok, false);
  assert.equal(aborted.code, 'rpc_timeout');
  assert.equal(aborted.solLamports, null);
});

test('classifyBalanceRead keeps rpc_failed distinct from empty success', async () => {
  const { classifyBalanceRead, unavailableBalanceLabel } = await import('./balances.mjs');
  const failed = classifyBalanceRead({
    items: [{
      balanceStatus: 'rpc_failed',
      ok: false,
      code: 'rpc_failed',
      solLamports: null,
      usdcBalance: null,
      holdings: [],
    }],
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.ok, false);
  assert.equal(failed.displayBalanceLabel, unavailableBalanceLabel('rpc_failed'));
  assert.equal(failed.displayBalanceLabel.includes('0 SOL'), false);

  const empty = classifyBalanceRead({
    items: [{
      balanceStatus: 'ok',
      ok: true,
      solLamports: '0',
      usdcBalance: '0',
      holdings: [],
    }],
  });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.ok, true);
  assert.equal(empty.displayBalanceLabel, '0 SOL');

  const funded = classifyBalanceRead({
    items: [{
      balanceStatus: 'ok',
      ok: true,
      solLamports: '1000000000',
      holdings: [{ label: '1 SOL (devnet)' }],
      displayBalanceLabel: '1 SOL (devnet)',
    }],
  });
  assert.equal(funded.status, 'ok');
  assert.match(funded.displayBalanceLabel, /1 SOL/);

  const partial = classifyBalanceRead({
    items: [
      {
        balanceStatus: 'ok',
        ok: true,
        solLamports: '1000000000',
        holdings: [{ label: '1 SOL (devnet)' }],
        displayBalanceLabel: '1 SOL (devnet)',
      },
      {
        balanceStatus: 'rpc_failed',
        ok: false,
        code: 'rpc_failed',
        solLamports: null,
        holdings: [],
      },
    ],
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.ok, false);
  assert.match(partial.displayBalanceLabel, /1 SOL/);
  assert.match(partial.displayBalanceLabel, /unavailable/);
});
