import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOLANA_GENESIS_HASH, SOLANA_USDC_MINT } from '@ubc2026/contracts/solana';
import { loadWalletActivity } from './wallet-activity.mjs';

const main = { address: '9'.repeat(44), label: 'Main' };
const agent = { address: '8'.repeat(44), label: 'Agent' };
const rpcUrl = 'https://rpc.example/';

function token(owner, accountIndex, amount) {
  return { owner, accountIndex, mint: SOLANA_USDC_MINT, uiTokenAmount: { amount, decimals: 6 } };
}

function transaction(n, keys, meta) {
  return {
    slot: n,
    blockTime: 1795150000 + n,
    transaction: { signatures: [String(n).repeat(64)], message: { accountKeys: keys.map(pubkey => ({ pubkey })) } },
    meta: { err: null, fee: 5000, ...meta },
  };
}

function mockRpc(history, genesis = SOLANA_GENESIS_HASH) {
  return async (url, { body, redirect }) => {
    assert.equal(url, rpcUrl);
    assert.equal(redirect, 'manual');
    const { method, params } = JSON.parse(body);
    if (method === 'getGenesisHash') return Response.json({ result: genesis });
    assert.equal(method, 'getTransactionsForAddress');
    assert.equal(params[1].filters.status, 'succeeded');
    assert.equal(params[1].filters.tokenAccounts, 'balanceChanged');
    assert.equal(params[1].transactionDetails, 'full');
    assert.equal(params[1].maxSupportedTransactionVersion, 1);
    if (!Object.hasOwn(history, params[0])) return Response.json({ error: { code: -32601 } });
    return Response.json({ result: { data: history[params[0]] } });
  };
}

test('reload recovers confirmed native sends and inbound token transfers, with one row per signature', async () => {
  const send = transaction(2, [main.address, agent.address], {
    preBalances: [132000000, 0], postBalances: [31995000, 100000000],
  });
  const deposit = transaction(3, ['7'.repeat(44)], {
    preTokenBalances: [token(undefined, 4, '1000000')],
    postTokenBalances: [token(main.address, 4, '3500000')],
  });
  const feeOnly = transaction(4, [main.address], {
    preBalances: [32000000], postBalances: [31995000],
  });
  const failed = transaction(5, [main.address], { err: 'InstructionError', preBalances: [32000000], postBalances: [0] });
  const { items, incomplete } = await loadWalletActivity({
    wallets: [main, agent, main],
    rpcUrl,
    fetcher: mockRpc({
      [main.address]: [send, deposit, feeOnly, failed],
      [agent.address]: [send],
    }),
  });
  assert.equal(incomplete, false);
  assert.deepEqual(items.map(item => item.slot), [3, 2]);
  assert.equal(items[0].at, 1795150003000);
  assert.equal(items[0].lines[0].value, '+2.5 USDC');
  assert.deepEqual(items[1].lines.map(line => line.value), ['-0.1 SOL', '+0.1 SOL']);
});

test('swaps show both wallet changes, and one unavailable wallet does not hide the others', async () => {
  const swap = transaction(6, [agent.address], {
    preBalances: [132000000], postBalances: [31995000],
    preTokenBalances: [],
    postTokenBalances: [token(agent.address, 2, '1500000')],
  });
  const { items, incomplete } = await loadWalletActivity({
    wallets: [main, agent], rpcUrl, fetcher: mockRpc({ [agent.address]: [swap] }),
  });
  assert.equal(incomplete, true);
  assert.equal(items[0].lines[0].value, '+1.5 USDC, -0.1 SOL');
});

test('rejects a wrong network or a fully unavailable history source', async () => {
  await assert.rejects(loadWalletActivity({ wallets: [main], rpcUrl, fetcher: mockRpc({}, 'wrong') }), { code: 'wrong_cluster' });
  await assert.rejects(loadWalletActivity({ wallets: [main], rpcUrl, fetcher: mockRpc({}) }), { code: 'rpc_failed' });
});
