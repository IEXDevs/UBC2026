import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { configuredSolanaRpc, resolveSolanaConfig, explorerClusterQuery, SOLANA_CONFIG } from './solana.mjs';

test('mainnet prefers the QuickNode secret and devnet uses its execution RPC', () => {
  const mainnet = 'https://mainnet.example.invalid';
  const fallback = 'https://fallback.example.invalid';
  const env = { SOLANA_RPC_URL: fallback, QUICKNODE_MAINNET_RPC_URL: ` ${mainnet} ` };
  assert.equal(configuredSolanaRpc(env, 'mainnet-beta'), mainnet);
  assert.equal(configuredSolanaRpc(env, 'mainnet'), mainnet);
  assert.equal(configuredSolanaRpc(env, 'devnet'), fallback);
  assert.equal(configuredSolanaRpc({ QUICKNODE_MAINNET_RPC_URL: mainnet }, 'devnet'), '');
  assert.equal(configuredSolanaRpc({ ...env, QUICKNODE_MAINNET_RPC_URL: ' ' }, 'mainnet-beta'), fallback);
});

test('mainnet is the empty/default configuration with canonical chain identifiers', () => {
  assert.equal(SOLANA_CONFIG.cluster, 'mainnet-beta');
  assert.deepEqual(resolveSolanaConfig(''), resolveSolanaConfig());
  assert.deepEqual(resolveSolanaConfig('mainnet'), resolveSolanaConfig());
  assert.equal(SOLANA_CONFIG.genesisHash, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
  assert.equal(SOLANA_CONFIG.caip2, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  assert.equal(SOLANA_CONFIG.usdcMint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.equal(explorerClusterQuery(), '');
  assert.equal(explorerClusterQuery('devnet'), '?cluster=devnet');
  assert.throws(() => resolveSolanaConfig('testnet'), /Unsupported SOLANA_CLUSTER/);
  assert.throws(() => resolveSolanaConfig('typo'), /Unsupported SOLANA_CLUSTER/);
});

test('devnet opt-in retargets proposal, fact and x402 guards together', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { SOLANA_CONFIG } from '@ubc2026/contracts/solana';
    import { CLUSTERS } from '@ubc2026/contracts';
    import { proposalDigest } from '@ubc2026/bot-policy';
    import { normalizeFacts } from '@ubc2026/verify-consensus';
    import { buildPaymentRequired, NETWORKS } from '@ubc2026/x402';
    assert.equal(SOLANA_CONFIG.cluster, 'devnet');
    assert.equal(SOLANA_CONFIG.genesisHash, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
    assert.equal(SOLANA_CONFIG.usdcMint, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    assert.deepEqual(CLUSTERS, ['devnet']);
    const p = { id:'p', botId:'b', cluster:'devnet', asset:'USDC', recipient:'r', quoteId:'q', outflow:'1', expectedReceive:'1', expectedReceiveAsset:'USDC', maxFee:'1', expiresAt:9007199254740000 };
    assert.equal(typeof proposalDigest(p), 'string');
    assert.throws(() => proposalDigest({...p, cluster:'mainnet-beta'}));
    const facts = { asset:'USDC', mint:SOLANA_CONFIG.usdcMint, cluster:'devnet', price:'1', amount:'1', trustScore:'800', reasonSummary:'reviewed' };
    assert.equal(normalizeFacts(facts).cluster, 'devnet');
    assert.throws(() => normalizeFacts({...facts, cluster:'mainnet-beta'}), /configured Solana cluster/);
    const challenge = { resourceUrl:'https://example.invalid', description:'quote', amount:'1', payTo:SOLANA_CONFIG.usdcMint, feePayer:SOLANA_CONFIG.usdcMint };
    assert.equal(buildPaymentRequired(challenge).body.accepts[0].network, NETWORKS.devnet);
    assert.throws(() => buildPaymentRequired({...challenge, network:NETWORKS.mainnet}));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, SOLANA_CLUSTER: 'devnet', NEXT_PUBLIC_SOLANA_CLUSTER: 'devnet' },
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
});

test('a public/server cluster mismatch fails closed', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('@ubc2026/contracts/solana')"], {
    env: { ...process.env, SOLANA_CLUSTER: 'mainnet-beta', NEXT_PUBLIC_SOLANA_CLUSTER: 'devnet' },
    encoding: 'utf8',
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /must match/);
});
