import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair, Transaction } from '@solana/web3.js';
import { proposalDigest } from '@ubc2026/bot-policy';
import { createMemoryLedger } from '@ubc2026/bot-policy/ledger';
import { DEVNET_USDC_MINT, NETWORKS } from '@ubc2026/x402';
import { assignBotWallet, createMainWallet } from '@ubc2026/wallets';
import { DEVNET_USDC_DECIMALS, MEMO_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID } from '@ubc2026/transfers';
import { SOL_MINT, createPriceTrustHandler } from './worker.mjs';
import { buildX402Proposal, createX402BotClient } from './client.mjs';

const payTo = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const feePayer = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const owner = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();
const wallet = createMainWallet({ ownerId: 'user_1', address: owner.publicKey.toBase58(), id: 'w_main' });

function botRecord(extra = {}) {
  return assignBotWallet({
    id: 'bot_1',
    ownerId: 'user_1',
    name: 'Price bot',
    goal: 'Buy price and trust quotes',
    type: 'trading',
    approvalMode: 'fully-automatic',
    walletId: wallet.id,
    enabled: true,
    frozen: false,
    policyVersion: 1,
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100000000', maxPerTransaction: '50000000' },
    ...extra,
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100000000', maxPerTransaction: '50000000', ...extra.cap },
  }, extra.wallet ?? wallet);
}

function fixture(bot, ledgerWallet = wallet) {
  return {
    users: [{ id: 'user_1', privyUserId: 'did:privy:user_1' }],
    wallets: [ledgerWallet],
    bots: [bot],
    ledgers: [{ botId: bot.id, asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' }],
    approvals: [],
  };
}

function signer() {
  const signed = [];
  return {
    signed,
    async signAndBroadcastDevnet({ transaction, bot, wallet: spendWallet }) {
      signed.push({ transaction, bot, wallet: spendWallet });
      return { signature: String(signed.length).padStart(88, '2'), cluster: 'devnet' };
    },
  };
}

async function buyer({ bot = botRecord(), ledgerWallet, confirm, payMerchant = payTo, fetcher, client = signer() } = {}) {
  const record = bot;
  const ledger = createMemoryLedger();
  await ledger.reset(fixture(record, ledgerWallet ?? wallet));
  const receipts = new Set();
  const spend = client;
  const wrapped = {
    signed: spend.signed,
    async signAndBroadcastDevnet(input) {
      const sent = await spend.signAndBroadcastDevnet(input);
      receipts.add(sent.signature);
      return sent;
    },
  };
  const handle = createPriceTrustHandler({
    payTo,
    feePayer,
    confirmPayment: confirm ?? (async ({ signature }) => (
      receipts.has(signature) ? { ok: true } : { ok: false, reason: 'unknown_transaction' }
    )),
  });
  const service = fetcher ?? ((url, init) => handle(new Request(url, init), { CLUSTER: 'devnet' }));
  return {
    ledger,
    spend: wrapped,
    client: createX402BotClient({
      baseUrl: 'https://x402.test',
      fetcher: service,
      bot: record,
      wallet: record.wallet ?? wallet,
      ownerId: 'user_1',
      ledger,
      client: wrapped,
      now: 1000,
      recentBlockhash: blockhash,
      payTo: payMerchant,
    }),
  };
}

/**
 * Achieves: automatic bot pays exact USDC on devnet, receives quote, and replays with same attemptId without re-signing.
 * Fails when: mainnet used, wrong amount/mint, or replay signs again.
 * Oracle: paid state; transfer amount 10000; signed.length 1 then replay keeps 1; reserved 15000 after trust.
 * Side effects / state checked: ledger reserved; signed txs; global fetch thrower.
 * Gaps: none for happy/replay
 */
test('a fully automatic bot pays devnet USDC and receives the quote', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('live network'); };
  try {
    const { client, spend, ledger } = await buyer();
    const paid = await client.price(SOL_MINT);
    assert.equal(paid.state, 'paid');
    assert.equal(paid.body.priceUsd, '150.25');
    assert.equal(paid.body.executionCluster, 'devnet');
    assert.equal(paid.transfer.cluster, 'devnet');
    assert.equal(paid.transfer.destination, payTo);
    assert.equal(paid.transfer.amount, '10000');
    assert.equal(paid.transfer.mint, DEVNET_USDC_MINT);
    assert.equal(paid.payment.protocol, 'x402-v2');
    assert.equal(paid.payment.network, NETWORKS.devnet);
    assert.equal(paid.payment.status, 'verified');
    assert.equal(spend.signed.length, 1);
    const tx = Transaction.from(Buffer.from(spend.signed[0].transaction, 'base64'));
    assert.equal(tx.feePayer.toBase58(), wallet.address);
    assert.equal(tx.recentBlockhash, blockhash);
    const transfer = tx.instructions[1];
    assert.equal(transfer.programId.toBase58(), SPL_TOKEN_PROGRAM_ID);
    assert.equal(transfer.data.readBigUInt64LE(1), 10000n);
    assert.equal(transfer.data[9], DEVNET_USDC_DECIMALS);
    assert.equal(transfer.keys[1].pubkey.toBase58(), DEVNET_USDC_MINT);
    assert.equal(tx.instructions[2].programId.toBase58(), MEMO_PROGRAM_ID);
    assert.equal(tx.instructions[2].data.toString('utf8'), `x402:price:${SOL_MINT}`);
    assert.equal((await ledger.snapshot()).ledgers[0].reserved, '10000');

    const again = await client.price(SOL_MINT, { attemptId: paid.attemptId });
    assert.equal(again.state, 'replay');
    assert.equal(spend.signed.length, 1);

    const trust = await client.trust(SOL_MINT);
    assert.equal(trust.state, 'paid');
    assert.equal(trust.body.score, '900');
    assert.equal(trust.body.decision.state, 'allowed');
    assert.equal(trust.transfer.amount, '5000');
    assert.equal((await ledger.snapshot()).ledgers[0].reserved, '15000');
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * Achieves: over-budget/frozen/ask-without-approval block before sign; approve-once then pays.
 * Fails when: sign occurs while blocked, or approve path fails to pay.
 * Oracle: over-budget/blocked/approval-needed then paid with signed.length 1.
 * Side effects / state checked: ledger reserved 0 while blocked; signer count.
 * Gaps: none
 */
test('policy blocks spending before the bot wallet signs', async () => {
  const tight = botRecord({
    cap: { maxOutflow: '1000', maxPerTransaction: '1000' },
  });
  const over = await buyer({ bot: tight });
  const blocked = await over.client.price(SOL_MINT);
  assert.equal(blocked.state, 'over-budget');
  assert.ok(blocked.violations.includes('per-transaction'));
  assert.equal(over.spend.signed.length, 0);
  assert.equal((await over.ledger.snapshot()).ledgers[0].reserved, '0');

  const frozenWallet = { ...wallet, frozen: true };
  const frozen = await buyer({
    bot: botRecord(),
    ledgerWallet: frozenWallet,
    client: signer(),
  });
  const held = await createX402BotClient({
    baseUrl: 'https://x402.test',
    fetcher: () => { throw new Error('should not fetch'); },
    bot: botRecord(),
    wallet: frozenWallet,
    ownerId: 'user_1',
    ledger: frozen.ledger,
    client: frozen.spend,
    now: 1000,
    recentBlockhash: blockhash,
    payTo,
  }).price(SOL_MINT);
  assert.equal(held.state, 'blocked');
  assert.equal(held.reason, 'wallet-frozen');
  assert.equal(frozen.spend.signed.length, 0);

  const askBot = botRecord({ approvalMode: 'ask' });
  const ask = await buyer({ bot: askBot });
  const needed = await ask.client.price(SOL_MINT);
  assert.equal(needed.state, 'approval-needed');
  assert.equal(ask.spend.signed.length, 0);
  assert.equal(proposalDigest(needed.proposal), needed.digest);
  await ask.ledger.reset({
    ...fixture(askBot),
    approvals: [{
      id: 'appr_1',
      ownerId: 'user_1',
      botId: 'bot_1',
      digest: needed.digest,
      policyVersion: 1,
      action: 'approve',
      expiresAt: 1050,
      usedAt: null,
    }],
  });
  const paid = await ask.client.price(SOL_MINT, { attemptId: needed.attemptId, approvalId: 'appr_1' });
  assert.equal(paid.state, 'paid');
  assert.equal(ask.spend.signed.length, 1);
  assert.equal(paid.body.executionCluster, 'devnet');
});

/**
 * Achieves: mainnet challenge and merchant mismatch block without sign; failed settlement keeps reserved and marks failed.
 * Fails when: mainnet still signs, or failed settlement clears reserve incorrectly.
 * Oracle: wrong-cluster/merchant-mismatch signed 0; settlement-failed signed 1 reserved 10000.
 * Side effects / state checked: ledger + signer.
 * Gaps: none
 */
test('mainnet challenges and a rejected settlement never skip bot-policy', async () => {
  const hostile = await buyer({
    fetcher: async (url) => Response.json({
      resource: { url },
      accepts: [{
        scheme: 'exact',
        network: NETWORKS.mainnet,
        amount: '10000',
        asset: DEVNET_USDC_MINT,
        payTo,
        maxTimeoutSeconds: 60,
      }],
    }, { status: 402 }),
  });
  const refused = await hostile.client.price(SOL_MINT);
  assert.equal(refused.state, 'blocked');
  assert.equal(refused.reason, 'wrong-cluster');
  assert.equal(hostile.spend.signed.length, 0);
  assert.equal((await hostile.ledger.snapshot()).ledgers[0].reserved, '0');

  const swapped = await buyer({ payMerchant: SOL_MINT });
  const mismatch = await swapped.client.price(SOL_MINT);
  assert.equal(mismatch.reason, 'merchant-mismatch');
  assert.equal(swapped.spend.signed.length, 0);

  const denied = await buyer({
    confirm: async () => ({ ok: false, reason: 'unknown_transaction' }),
  });
  const failed = await denied.client.price(SOL_MINT);
  assert.equal(failed.state, 'settlement-failed');
  assert.equal(failed.paid, false);
  assert.equal(failed.payment.status, 'failed');
  assert.equal(failed.transfer.cluster, 'devnet');
  assert.equal(denied.spend.signed.length, 1);
  assert.equal((await denied.ledger.snapshot()).ledgers[0].reserved, '10000');
});

/**
 * Achieves: client.mjs source excludes mainnet USDC mint and mainnet CAIP id.
 * Fails when: mainnet identifiers appear in source.
 * Oracle: readFileSync excludes known mainnet strings.
 * Side effects / state checked: N/A.
 * Gaps: none — static source scan only
 */
test('client source does not name a mainnet USDC mint or mainnet CAIP network', () => {
  const source = readFileSync(new URL('./client.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), false);
  assert.equal(source.includes('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), false);
});

/**
 * Achieves: buildX402Proposal maps accepted terms into a bot-policy proposal with capped timeout.
 * Fails when: cluster leaves devnet, wrong expectedReceiveAsset, or timeout uncapped above 600s.
 * Oracle: Independent accepted fixture → expiresAt = now + min(timeout, 600); asset USDC.
 * Side effects / state checked: none (pure).
 * Gaps: reserveBudget integration covered in pay path tests above.
 */
test('buildX402Proposal maps accepted x402 terms into a policy proposal', () => {
  const bot = botRecord();
  const accepted = {
    scheme: 'exact',
    network: NETWORKS.devnet,
    amount: '10000',
    asset: DEVNET_USDC_MINT,
    payTo,
    maxTimeoutSeconds: 120,
  };
  const price = buildX402Proposal({
    bot,
    accepted,
    kind: 'price',
    mint: SOL_MINT,
    now: 1000,
    attemptId: 'x402_attempt_1',
  });
  assert.equal(price.id, 'x402_attempt_1');
  assert.equal(price.botId, bot.id);
  assert.equal(price.cluster, 'devnet');
  assert.equal(price.asset, 'USDC');
  assert.equal(price.recipient, payTo);
  assert.equal(price.quoteId, `price:${SOL_MINT}`);
  assert.equal(price.outflow, '10000');
  assert.equal(price.expectedReceiveAsset, 'price-quote');
  assert.equal(price.expiresAt, 1120);

  const trust = buildX402Proposal({
    bot,
    accepted: { ...accepted, maxTimeoutSeconds: 9999 },
    kind: 'trust',
    mint: SOL_MINT,
    now: 500,
    attemptId: 'x402_attempt_2',
  });
  assert.equal(trust.expectedReceiveAsset, 'trust-score');
  assert.equal(trust.expiresAt, 1100);

  const fallback = buildX402Proposal({
    bot,
    accepted: { ...accepted, maxTimeoutSeconds: 0 },
    kind: 'price',
    mint: SOL_MINT,
    now: 10,
    attemptId: 'x402_attempt_3',
  });
  assert.equal(fallback.expiresAt, 70);
});
