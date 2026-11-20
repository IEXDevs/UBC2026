import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createMemoryLedger } from '@ubc2026/bot-policy/ledger';
import { parsePermissionedSpendBody, spendApprovalMessage } from '@ubc2026/contracts';
import { SOLANA_USDC_MINT } from '@ubc2026/wallets/privy';
import { SystemInstruction, Transaction } from '@solana/web3.js';
import { decodeTransferCheckedInstruction } from '@solana/spl-token';
import { sha256Hex } from './desk-grant.mjs';
import worker from './owner-auth.fixture.mjs';
import { handleVoiceRequest } from './voice.mjs';
import { usdMicros } from './usd-budget.mjs';
import { BotStateMachine } from './bot-do.mjs';
import { createLoopSwapIntent, LOOP_SWAP_PENDING } from './loop-swap.mjs';

const DESTINATION = '11111111111111111111111111111111';
const NOW = 1_700_000_000_000;
const SECRET = 'test-elevenlabs-webhook-secret';

const wallet = {
  id: 'w_main',
  ownerId: 'user_1',
  kind: 'main',
  label: 'Main',
  address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  frozen: false,
  provider: 'privy',
};
const bot = {
  id: 'bot_1',
  ownerId: 'user_1',
  name: 'APY hunter',
  goal: 'yield',
  type: 'trading',
  enabled: true,
  frozen: false,
  walletId: 'w_main',
  policyVersion: 1,
  approvalMode: 'ask',
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100000', maxPerTransaction: '50000' },
};
const ledger = { botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };

function spendEnv(extra = {}) {
  return {
    PRODUCT: 'Maelstrom',
    SOLANA_CLUSTER: 'mainnet-beta',
    spendNow: NOW,
    trustLookup: null,
    loadSpendContext: async () => ({ bot, wallet, ledger }),
    ...extra,
  };
}

function spendRequest(body, headers = {}) {
  return new Request('https://runtime/api/spend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1', ...headers },
    body: JSON.stringify(body),
  });
}

test('USD valuation keeps precision and rounds the debit up', () => {
  assert.equal(usdMicros('1000000000', 9, '142.125'), '142125000');
  assert.equal(usdMicros('5000', 9, '142.125'), '711');
  assert.equal(usdMicros('1', 9, '0.000000001'), '1');
  assert.equal(usdMicros('1', 6, '0'), null);
});

for (const path of ['chat', 'scheduled']) test(`a ${path} mainnet swap submits only the approved quote and reserves USD once`, async () => {
  const sol = 'So11111111111111111111111111111111111111112';
  const grant = '12'.repeat(32);
  const grantHash = await sha256Hex(grant);
  const headers = { 'x-desk-grant': grant };
  const usdBot = {
    ...bot, cap: { mode: 'limited', asset: 'USD', maxOutflow: '5000000', maxPerTransaction: '1200000' },
  };
  const now = Date.now();
  const machine = new BotStateMachine();
  const intent = path === 'scheduled' ? createLoopSwapIntent({ bot: usdBot, wallet, now, swap: {
    inputMint: SOLANA_USDC_MINT, outputMint: sol, inAmount: '1000000',
  } }) : null;
  const idempotencyKey = intent?.idempotencyKey || 'test_swap';
  if (intent) {
    await machine.put('meta', { botId: bot.id, ownerId: bot.ownerId, cluster: 'mainnet-beta' });
    await machine.put('run', { botId: bot.id, step: 'decide', paused: true, pauseReason: LOOP_SWAP_PENDING, events: [],
      checkpoints: { decide: { status: 'waiting', reason: LOOP_SWAP_PENDING, swapIntent: intent } } });
  }
  let simulation;
  let routeSlippage = 50;
  let reserved = 0;
  let signed = 0;
  const env = spendEnv({
    spendNow: now,
    BOT: { idFromName: name => name, get: () => ({ fetch: request => machine.handle(request) }) },
    JUPITER_API_KEY: 'test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role',
    spendTrustScore: '800',
    loadSpendContext: async () => ({ bot: usdBot, wallet, ledger: { ...ledger, asset: 'USD' } }),
    lookupSpendPrice: async mint => ({
      mint, pricingCluster: 'mainnet', executionCluster: 'mainnet-beta',
      priceUsd: mint === sol ? '100' : '1', fetchedAt: new Date(now).toISOString(),
    }),
    transferClient: {
      getSolanaBlockhash: async () => ({ cluster: 'mainnet-beta', blockhash: DESTINATION }),
      readSolanaMint: async ({ mint }) => ({ cluster: 'mainnet-beta', mint, decimals: 6 }),
      prepareSolanaSwap: async input => {
        simulation ??= input.transaction;
        assert.equal(input.transaction, simulation);
        assert.equal(input.amount, '1000000');
        assert.equal(input.minOutput, '9950000');
        return { transaction: input.transaction, feeLamports: '5000', maxSolCost: '5000' };
      },
      formatPreparedSpendAuthorization: () => Buffer.from('swap-owner-authorization-payload'.repeat(2)).toString('base64'),
      signPreparedSolanaTransfer: async ({ prepared: { transaction }, ownerAuthorization }) => {
        assert.equal(transaction, simulation);
        assert.ok(ownerAuthorization);
        signed += 1;
        return { cluster: 'mainnet-beta', signature: '5'.repeat(64) };
      },
    },
    ledgerApi: {
      reserveBudget: async ({ proposal, idempotencyKey, approvalId }) => {
        assert.equal(idempotencyKey, intent?.idempotencyKey || 'test_swap');
        assert.ok(approvalId);
        assert.equal(proposal.asset, 'USD');
        assert.equal(proposal.outflow, '1000000');
        assert.equal(proposal.maxFee, '500');
        assert.equal(proposal.expectedReceiveAsset, 'SOL');
        assert.equal(proposal.expectedReceive, '9950000');
        assert.equal(proposal.quoteId, await sha256Hex(simulation));
        return { state: 'reserved', replay: reserved++ > 0 };
      },
    },
    fetch: async url => {
      const target = new URL(url);
      if (target.hostname === 'api.jup.ag') {
        assert.equal(target.pathname, '/swap/v2/build');
        assert.equal(target.searchParams.get('taker'), wallet.address);
        const data = Buffer.alloc(34);
        createHash('sha256').update('global:route_v2').digest().copy(data, 0, 0, 8);
        data.writeBigUInt64LE(1_000_000n, 8);
        data.writeBigUInt64LE(10_000_000n, 16);
        data.writeUInt16LE(routeSlippage, 24);
        return Response.json({
          inputMint: SOLANA_USDC_MINT, outputMint: sol, inAmount: '1000000',
          outAmount: '10000000', otherAmountThreshold: '9950000', swapMode: 'ExactIn', slippageBps: 50,
          swapInstruction: {
            programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
            accounts: [wallet.address, DESTINATION, DESTINATION, SOLANA_USDC_MINT, sol].map((pubkey, index) => ({ pubkey, isSigner: index === 0 })),
            data: data.toString('base64'),
          },
        });
      }
      if (target.pathname.endsWith('/desk_locks')) {
        return Response.json([{ grant_hash: grantHash, grant_until: new Date(now + 120_000).toISOString() }]);
      }
      if (target.pathname.endsWith('/approvals')) return new Response('', { status: 201 });
      return new Response('[]');
    },
  });
  const swap = { botId: bot.id, permission: 'full', action: 'swap', asset: 'USDC', outputAsset: 'SOL', amount: '1000000', idempotencyKey };
  const request = body => worker.fetch(spendRequest({ ...swap, ...body }, headers), env);
  routeSlippage = 100;
  assert.equal((await (await request()).json()).error, 'swap_quote_unavailable');
  routeSlippage = 50;
  const preview = await (await request()).json();
  assert.equal(preview.swapPreview?.usdMicros, '1000500');
  assert.equal(signed, 0);
  assert.equal(reserved, 0);
  const ticket = preview.swapPreview.ticket;
  const changed = await (await request({ confirmed: true, amount: '2000000', swapTicket: ticket, spendAuthorization: 'prepare' })).json();
  assert.equal(changed.error, intent ? 'swap_intent_unavailable' : 'swap_quote_expired');
  const unbound = await (await request({ confirmed: true, swapTicket: ticket })).json();
  assert.equal(unbound.error, 'swap_owner_authorization_required');
  usdBot.cap.maxPerTransaction = '1000000';
  const capped = await (await request({ confirmed: true, swapTicket: ticket, spendAuthorization: 'prepare' })).json();
  assert.equal(capped.reason, 'per-transaction');
  assert.equal(capped.spendAuthorization, undefined);
  assert.equal(reserved, 0);
  usdBot.cap.maxPerTransaction = '1200000';
  const challenge = await (await request({ confirmed: true, swapTicket: ticket, spendAuthorization: 'prepare' })).json();
  assert.equal(reserved, 0);
  const { payload, ...binding } = challenge.spendAuthorization;
  const spendAuthorization = { ...binding, signature: 'A'.repeat(88) };
  if (intent) {
    await machine.put('ownerPaused', true);
    const paused = await (await request({ confirmed: true, swapTicket: ticket, spendAuthorization })).json();
    assert.equal(paused.error, 'swap_intent_unavailable');
    assert.equal(reserved, 0);
    await machine.delete('ownerPaused');
  }
  const approved = await (await request({ confirmed: true, swapTicket: ticket, spendAuthorization })).json();
  assert.equal(approved.signed, true);
  const replay = await (await request({ confirmed: true, swapTicket: ticket, spendAuthorization })).json();
  if (intent) {
    assert.equal((await machine.get('run')).checkpoints.execute.signature, approved.signature);
    assert.equal((await machine.get('run')).checkpoints.execute.state, 'submitted');
    assert.equal(replay.error, 'swap_intent_unavailable');
  } else {
    assert.equal(replay.reason, 'duplicate-spend');
  }
  assert.equal(signed, 1);
});

test('SOL to a handle reserves lamports plus the fee and signs the simulated transaction only once', async () => {
  const destination = 'So11111111111111111111111111111111111111112';
  const grant = 'ab'.repeat(32);
  const grantHash = await sha256Hex(grant);
  const nativeBot = { ...bot, cap: { mode: 'limited', asset: 'SOL', maxOutflow: '3000000000', maxPerTransaction: '1000010000' } };
  let prepared;
  let approvals = 0;
  let reserves = 0;
  let signs = 0;
  let blockhashReads = 0;
  let originalTransaction;
  const env = spendEnv({
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role',
    loadSpendContext: async () => ({ bot: nativeBot, wallet, ledger: { ...ledger, asset: 'SOL' } }),
    fetch: async (url, init) => {
      const target = new URL(url);
      if (target.pathname.endsWith('/desk_locks')) return Response.json([{ grant_hash: grantHash, grant_until: new Date(NOW + 60000).toISOString() }]);
      if (target.pathname.endsWith('/profiles')) {
        assert.equal(target.searchParams.get('handle'), 'eq.hi');
        return Response.json([{ owner_id: 'user_2' }]);
      }
      if (target.pathname.endsWith('/wallets')) {
        assert.equal(target.searchParams.get('owner_id'), 'eq.user_2');
        return Response.json([{ address: destination }]);
      }
      if (target.pathname === '/rest/v1/rpc/policy_reserve_budget') {
        const parameters = JSON.parse(init.body);
        if (!parameters.payload) return Response.json({ code: 'PGRST202' }, { status: 404 });
        assert.deepEqual(Object.keys(parameters), ['payload']);
        const { ownerId, now, idempotencyKey, proposal, approvalId } = parameters.payload;
        assert.equal(ownerId, 'user_1');
        assert.equal(now, NOW);
        assert.equal(idempotencyKey, 'test_sol_send');
        assert.equal(proposal.asset, 'SOL');
        assert.equal(proposal.outflow, '1000000000');
        assert.equal(proposal.maxFee, '5000');
        assert.equal(proposal.quoteId, await sha256Hex(prepared.transaction));
        assert.ok(approvalId);
        return Response.json({ state: 'reserved', replay: reserves++ > 0 });
      }
      assert.equal(target.pathname, '/rest/v1/approvals');
      assert.equal(JSON.parse(init.body).action, 'approve');
      approvals++;
      return new Response(null, { status: 201 });
    },
    transferClient: {
      getSolanaBlockhash: async () => {
        blockhashReads++;
        return { cluster: 'mainnet-beta', blockhash: DESTINATION };
      },
      prepareSolanaTransfer: async ({ transaction }) => {
        const ix = Transaction.from(Buffer.from(transaction, 'base64')).instructions[0];
        const transfer = SystemInstruction.decodeTransfer(ix);
        assert.equal(transfer.toPubkey.toBase58(), destination);
        prepared = { transaction, feeLamports: '5000' };
        return prepared;
      },
      formatPreparedSpendAuthorization: ({ prepared, expiresAt }) => {
        assert.equal(expiresAt, NOW + 60_000);
        return prepared.transaction;
      },
      signPreparedSolanaTransfer: async input => {
        assert.equal(input.prepared, prepared);
        assert.equal(input.prepared.transaction, originalTransaction);
        assert.equal(input.ownerAuthorization.signature, Buffer.alloc(64, 3).toString('base64'));
        assert.equal(input.accessToken, undefined);
        assert.equal(reserves, 1);
        signs++;
        return { cluster: 'mainnet-beta', signature: 'mock_signature' };
      },
    },
  });
  const spend = { action: 'pay', permission: 'full', botId: 'bot_1', handle: '@hi', asset: 'SOL', amount: '1000000000', idempotencyKey: 'test_sol_send' };
  const call = body => worker.fetch(spendRequest(body, {
    'x-desk-grant': grant,
    authorization: 'Bearer test-owner-session',
  }), env);

  const held = await (await call(spend)).json();
  assert.equal(held.state, 'approval-needed');
  assert.equal(prepared, undefined);
  const confirmed = { ...spend, confirmed: true };
  const challenge = await (await call({ ...confirmed, spendAuthorization: 'prepare' })).json();
  assert.equal(challenge.signed, false);
  assert.match(challenge.spendAuthorization.proof, /^[a-f0-9]{64}$/);
  assert.equal(challenge.spendAuthorization.payload, prepared.transaction);
  originalTransaction = prepared.transaction;
  assert.equal(SystemInstruction.decodeTransfer(Transaction.from(Buffer.from(originalTransaction, 'base64')).instructions[0]).lamports, 1000000000n);
  assert.equal(reserves, 0);
  assert.equal(approvals, 0);
  assert.equal(signs, 0);

  const { payload: _payload, ...binding } = challenge.spendAuthorization;
  const spendAuthorization = { ...binding, signature: Buffer.alloc(64, 3).toString('base64') };
  const expired = await (await call({ ...confirmed, spendAuthorization: { ...spendAuthorization, expiresAt: NOW } })).json();
  assert.equal(expired.error, 'spend_authorization_expired');
  const changed = await (await call({ ...confirmed, amount: '999999999', spendAuthorization })).json();
  assert.equal(changed.reason, 'spend_authorization_changed');
  assert.equal(reserves, 0);
  const sent = await (await call({ ...confirmed, spendAuthorization })).json();
  assert.equal(sent.state, 'signed', sent.reason);
  assert.equal(sent.signed, true);
  assert.equal(sent.feeLamports, '5000');
  assert.deepEqual(sent.steps, ['trust-gate', 'verify-consensus', 'wallet-freeze', 'bot-policy', 'approval-mode', 'reserve', 'sign']);
  const replay = await (await call({ ...confirmed, spendAuthorization })).json();
  assert.equal(replay.reason, 'duplicate-spend');
  assert.equal(signs, 1);
  assert.equal(blockhashReads, 1);
  assert.equal(approvals, 2);
  const wrongRecipient = await (await call({ ...spend, confirmed: true, destination: DESTINATION })).json();
  assert.equal(wrongRecipient.error, 'recipient_address_missing');
});

test('a non-USDC transfer cannot spend a USDC budget', async () => {
  const response = await worker.fetch(spendRequest({
    permission: 'full', confirmed: true, botId: 'bot_1', action: 'pay', asset: 'SOL', amount: '1', destination: DESTINATION,
  }), spendEnv());
  const body = await response.json();
  assert.equal(body.signed, false);
  assert.equal(body.reason, 'accounting-asset-mismatch');
});

test('over-limit SOL waits for a bound one-time approval, then reserves before signing once', async () => {
  const grant = 'ab'.repeat(32);
  const grantHash = await sha256Hex(grant);
  const key = 'test-role';
  const destination = 'So11111111111111111111111111111111111111112';
  let nativeBot = {
    ...bot, approvalMode: 'fully-automatic',
    cap: { mode: 'limited', asset: 'SOL', maxOutflow: '3000000000', maxPerTransaction: '999999999' },
  };
  let currentWallet = wallet;
  let feeLamports = '5000';
  let signs = 0;
  let reserves = 0;
  let approval;
  const env = spendEnv({
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: key,
    loadSpendContext: async () => ({ bot: nativeBot, wallet: currentWallet, ledger: { ...ledger, asset: 'SOL' } }),
    fetch: async (url, init) => {
      const { pathname } = new URL(url);
      if (pathname.endsWith('/desk_locks')) return Response.json([{ grant_hash: grantHash, grant_until: new Date(NOW + 60_000).toISOString() }]);
      if (pathname.endsWith('/profiles')) return Response.json([{ owner_id: 'user_2' }]);
      if (pathname.endsWith('/wallets')) return Response.json([{ address: destination }]);
      assert.equal(pathname, '/rest/v1/approvals');
      approval = JSON.parse(init.body);
      assert.equal(approval.action, 'approve-once');
      return new Response(null, { status: 201 });
    },
    ledgerApi: {
      async reserveBudget({ proposal, approvalId, idempotencyKey }) {
        assert.equal(approval.id, approvalId);
        assert.equal(approval.policy_version, nativeBot.policyVersion);
        assert.equal(approval.owner_id, nativeBot.ownerId);
        assert.equal(approval.bot_id, nativeBot.id);
        assert.equal(idempotencyKey, 'test_approve_once');
        assert.equal(proposal.maxFee, '5000');
        return { state: 'reserved', replay: reserves++ > 0 };
      },
    },
    transferClient: {
      getSolanaBlockhash: async () => ({ cluster: 'mainnet-beta', blockhash: DESTINATION }),
      prepareSolanaTransfer: async ({ transaction }) => ({ transaction, feeLamports }),
      signPreparedSolanaTransfer: async () => {
        assert.equal(reserves, 1);
        signs++;
        return { cluster: 'mainnet-beta', signature: 'test_signature' };
      },
    },
  });
  const spend = {
    action: 'spend', permission: 'review', confirmed: true, reviewCap: '3000000000',
    botId: nativeBot.id, destination, handle: '@hi', asset: 'SOL', amount: '1000000000',
    idempotencyKey: 'test_approve_once',
  };
  const call = async (overrides = {}, headers = {}) => (await worker.fetch(spendRequest(
    { ...spend, ...overrides }, { 'x-desk-grant': grant, ...headers },
  ), env)).json();
  const waiting = await call();
  assert.equal(waiting.state, 'approval-needed');
  assert.equal(waiting.reason, 'per-transaction');
  assert.deepEqual(waiting.approvalTerms, {
    walletId: wallet.id, walletAddress: wallet.address, policyVersion: nativeBot.policyVersion, feeLamports,
  });
  assert.equal(reserves, 0);
  assert.equal(approval, undefined);
  assert.equal((await call({}, { 'x-desk-grant': '' })).error, 'desk_locked');
  const token = expiresAt => {
    const binding = spendApprovalMessage({
      ownerId: nativeBot.ownerId, spend: parsePermissionedSpendBody(spend), terms: waiting.approvalTerms, expiresAt,
    });
    return `v1.${expiresAt}.${createHmac('sha256', key).update(binding).digest('hex')}`;
  };
  const header = { 'x-spend-approve-once': token(NOW + 60_000) };
  assert.equal((await call({}, { ...header, 'x-desk-grant': '' })).error, 'desk_locked');
  assert.equal((await call({ amount: '1000000001' }, header)).error, 'invalid_spend_approval');
  assert.equal((await call({ idempotencyKey: 'different_spend' }, header)).error, 'invalid_spend_approval');
  assert.equal((await call({}, { 'x-spend-approve-once': token(NOW) })).error, 'invalid_spend_approval');
  feeLamports = '10000';
  assert.equal((await call({}, header)).error, 'invalid_spend_approval');
  feeLamports = '5000';
  nativeBot.policyVersion++;
  assert.equal((await call({}, header)).error, 'invalid_spend_approval');
  nativeBot.policyVersion--;
  currentWallet = { ...wallet, frozen: true };
  assert.equal((await call({}, header)).reason, 'spend-frozen');
  currentWallet = wallet;
  assert.equal(reserves, 0);
  assert.equal(approval, undefined);
  assert.equal(signs, 0);
  assert.equal((await call({}, header)).state, 'signed');
  assert.equal((await call({}, header)).reason, 'duplicate-spend');
  assert.equal(signs, 1);
  assert.equal(nativeBot.cap.maxPerTransaction, '999999999');
});

test('a confirmed send returns only public facts about a Privy signing failure', async () => {
  const solBot = { ...bot, approvalMode: 'fully-automatic', cap: { ...bot.cap, asset: 'SOL' } };
  const env = spendEnv({
    loadSpendContext: async () => ({ bot: solBot, wallet, ledger: { ...ledger, asset: 'SOL' } }),
    transferClient: {
      getSolanaBlockhash: async () => ({ cluster: 'mainnet-beta', blockhash: DESTINATION }),
      prepareSolanaTransfer: async ({ transaction }) => ({ transaction, feeLamports: '5000' }),
      signPreparedSolanaTransfer: async () => {
        throw Object.assign(new Error('private provider diagnostics'), {
          code: 'wallet_authorization_failed',
          privyFailure: {
            status: 400, code: 'private-code', token: 'private token',
            requests: [
              { stage: 'app-sign', status: 401 },
              { stage: 'session-exchange', status: 400, requestId: 'req_test123456', body: 'private body' },
            ],
          },
        });
      },
    },
    ledgerApi: { reserveBudget: async () => ({ state: 'reserved' }) },
  });
  const response = await worker.fetch(spendRequest({
    permission: 'ask', confirmed: true, botId: 'bot_1', action: 'pay',
    asset: 'SOL', amount: '1', destination: DESTINATION, idempotencyKey: 'test_failure',
  }), env);
  const body = await response.json();
  assert.equal(body.state, 'sign-rejected');
  assert.equal(body.reason, 'wallet_authorization_failed');
  assert.deepEqual(body.privyFailure, {
    status: 400,
    requests: [
      { stage: 'app-sign', status: 401 },
      { stage: 'session-exchange', status: 400, requestId: 'req_test123456' },
    ],
  });
  assert.doesNotMatch(JSON.stringify(body), /private/i);
});

test('a classic SPL send uses the exact mint and mainnet-beta decimals', async () => {
  const mint = 'So11111111111111111111111111111111111111112';
  const splBot = { ...bot, approvalMode: 'fully-automatic', cap: { ...bot.cap, asset: mint } };
  let reserved = false;
  const env = spendEnv({
    loadSpendContext: async () => ({ bot: splBot, wallet, ledger: { ...ledger, asset: mint } }),
    transferClient: {
      getSolanaBlockhash: async () => ({ cluster: 'mainnet-beta', blockhash: DESTINATION }),
      readSolanaMint: async input => ({ cluster: 'mainnet-beta', mint: input.mint, decimals: 9 }),
      prepareSolanaTransfer: async ({ transaction }) => {
        const tx = Transaction.from(Buffer.from(transaction, 'base64'));
        const { keys, data } = decodeTransferCheckedInstruction(tx.instructions[0]);
        assert.equal(keys.mint.pubkey.toBase58(), mint);
        assert.equal(data.amount, 1000n);
        assert.equal(data.decimals, 9);
        assert.equal(tx.instructions.length, 2);
        return { transaction, feeLamports: '5000' };
      },
      signPreparedSolanaTransfer: async () => {
        assert.equal(reserved, true);
        return { cluster: 'mainnet-beta', signature: 'mock_spl_signature' };
      },
    },
    ledgerApi: { reserveBudget: async ({ proposal }) => {
      assert.equal(proposal.asset, mint);
      assert.equal(proposal.outflow, '1000');
      assert.equal(proposal.maxFee, '0');
      reserved = true;
      return { state: 'reserved' };
    } },
  });
  const request = { permission: 'review', confirmed: true, botId: 'bot_1', action: 'pay', amount: '1000', asset: mint, destination: DESTINATION, idempotencyKey: 'test_spl_send' };
  assert.equal((await (await worker.fetch(spendRequest(request), env)).json()).signed, true);
  env.transferClient.readSolanaMint = async () => ({ cluster: 'mainnet', mint, decimals: 9 });
  const invalid = await (await worker.fetch(spendRequest(request), env)).json();
  assert.equal(invalid.signed, false);
  assert.equal(invalid.error, 'transfer_preparation_failed');
});

/**
 * Achieves: full-permission spend signs on mainnet-beta through each spend step.
 * Fails when: sign skipped or mainnet used.
 * Oracle: mainnet-beta signature path; step completion.
 * Side effects / state checked: signer mocks.
 * Gaps: none
 */
test('full permissions sign on mainnet-beta after every spend step', async () => {
  const calls = [];
  const response = await worker.fetch(spendRequest({
    permission: 'full',
    confirmed: true,
    botId: 'bot_1',
    action: 'pay',
    amount: '1000',
    destination: DESTINATION,
    quote: { privateKey: 'do-not-keep', pricingCluster: 'mainnet-beta' },
  }), spendEnv({
    transferClient: {
      async getSolanaBlockhash() {
        return { cluster: 'mainnet-beta', blockhash: DESTINATION };
      },
      async signAndBroadcastSolana(request) {
        calls.push(request);
        return { cluster: 'mainnet-beta', signature: 'sig_mainnet-beta_1', signed_transaction: 'secret-bytes' };
      },
    },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.signed, true);
  assert.equal(body.signature, 'sig_mainnet-beta_1');
  assert.equal(body.cluster, 'mainnet-beta');
  assert.deepEqual(body.steps, [
    'trust-gate',
    'verify-consensus',
    'wallet-freeze',
    'bot-policy',
    'approval-mode',
    'sign',
  ]);
  assert.equal(JSON.stringify(body).includes('secret-bytes'), false);
  assert.equal(JSON.stringify(body).includes('privateKey'), false);
  assert.equal(calls.length, 1);
});

/**
 * Achieves: mainnet quote is refused before any signature.
 * Fails when: signer invoked for mainnet.
 * Oracle: blocked; signed.length===0.
 * Side effects / state checked: signer mock.
 * Gaps: none
 */
test('a mainnet quote never authorizes a signature', async () => {
  let signed = false;
  const response = await worker.fetch(spendRequest({
    permission: 'full',
    confirmed: true,
    botId: 'bot_1',
    action: 'buy',
    amount: '1000',
    destination: DESTINATION,
    quote: { pricingCluster: 'mainnet', paperPnl: true, authorizesTransaction: false },
  }), spendEnv({
    transferClient: {
      async getSolanaBlockhash() {
        return { cluster: 'mainnet-beta', blockhash: DESTINATION };
      },
      async signAndBroadcastSolana() {
        signed = true;
        return { cluster: 'mainnet-beta', signature: 'sig_should_not' };
      },
    },
  }));
  const body = await response.json();
  assert.equal(body.state, 'quote-not-authorization');
  assert.equal(body.signed, false);
  assert.equal(body.signature, undefined);
  assert.equal(signed, false);
  assert.equal(body.steps.at(-1), 'approval-mode');
});

/**
 * Achieves: voice request_spend preserves session permission and hits shared spend route.
 * Fails when: permission dropped or wrong route.
 * Oracle: permission retained; shared route posted.
 * Side effects / state checked: route/session mocks.
 * Gaps: none
 */
test('voice request_spend does not call the spend route', async () => {
  let seen = null;
  const response = await handleVoiceRequest(new Request('https://runtime.example/voice/tools/request_spend', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-elevenlabs-webhook-secret': SECRET,
      'x-owner-id': 'user_1',
      'x-spend-permission': 'full',
    },
    body: JSON.stringify({
      parameters: {
        botId: 'bot_1',
        action: 'sell',
        amount: '1000',
        destination: DESTINATION,
        permission: 'ask',
        confirmed: true,
        quoteCluster: 'mainnet',
      },
    }),
  }), {
    ELEVENLABS_WEBHOOK_SECRET: SECRET,
    PRODUCT: 'Maelstrom',
    SOLANA_CLUSTER: 'mainnet-beta',
  }, {
    fetchApi: async (request) => {
      seen = { url: request.url, body: JSON.parse(await request.text()) };
      return Response.json({ ok: false, state: 'quote-not-authorization', signed: false, steps: [] });
    },
  });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).error, 'voice_tools_retired');
  assert.equal(seen, null);
});

/**
 * Achieves: POST /api/spend without x-owner-id is 401; invalid body with owner is 400.
 * Fails when: ownerless spend succeeds or invalid JSON is treated as a valid spend.
 * Oracle: status + error codes; signed===false.
 * Side effects / state checked: loadSpendContext must not run on ownerless call.
 * Gaps: desk lock 403 path covered in desk-grant.test.mjs.
 */
/**
 * Achieves: full permission trades without a confirm slide, and a Jupiter miss or low score still does not sign.
 * Fails when: unconfirmed full skips signing on a passing gate, a low score signs, or a failed lookup signs.
 * Oracle: Jupiter search score 800 signs; score 100 and a thrown lookup stay unsigned.
 * Side effects / state checked: signer call count.
 * Gaps: live Jupiter is not called.
 */
test('full permission signs after Jupiter trust and a failed lookup does not', async () => {
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  let signed = 0;
  const client = {
    async getSolanaBlockhash() {
      return { cluster: 'mainnet-beta', blockhash: DESTINATION };
    },
    async signAndBroadcastSolana() {
      signed += 1;
      return { cluster: 'mainnet-beta', signature: 'sig_jupiter_full' };
    },
  };
  const highEnv = spendEnv({
    transferClient: client,
    fetch: async (url) => {
      assert.match(String(url), /api\.jup\.ag\/tokens\/v2\/search/);
      return Response.json([{
        id: mint,
        organicScore: 80,
        isVerified: true,
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
      }]);
    },
  });
  delete highEnv.trustLookup;
  const passed = await worker.fetch(spendRequest({
    permission: 'full',
    botId: 'bot_1',
    action: 'buy',
    amount: '1000',
    destination: DESTINATION,
  }), highEnv);
  const okBody = await passed.json();
  assert.equal(passed.status, 200);
  assert.equal(okBody.signed, true);
  assert.equal(okBody.signature, 'sig_jupiter_full');
  assert.equal(okBody.steps[0], 'trust-gate');
  assert.equal(okBody.steps.at(-1), 'sign');
  assert.equal(signed, 1);

  const lowEnv = spendEnv({
    transferClient: client,
    fetch: async () => Response.json([{
      id: mint,
      organicScore: 10,
      isVerified: false,
    }]),
  });
  delete lowEnv.trustLookup;
  const low = await worker.fetch(spendRequest({
    permission: 'full',
    botId: 'bot_1',
    action: 'buy',
    amount: '1000',
    destination: DESTINATION,
  }), lowEnv);
  const lowBody = await low.json();
  assert.equal(lowBody.signed, false);
  assert.equal(lowBody.state, 'trust-confirmation-required');
  assert.equal(signed, 1);

  const failedEnv = spendEnv({
    transferClient: client,
    fetch: async () => { throw new Error('jupiter down'); },
  });
  delete failedEnv.trustLookup;
  const failed = await worker.fetch(spendRequest({
    permission: 'full',
    botId: 'bot_1',
    action: 'buy',
    amount: '1000',
    destination: DESTINATION,
  }), failedEnv);
  const failedBody = await failed.json();
  assert.equal(failedBody.signed, false);
  assert.equal(failedBody.state, 'trust-confirmation-required');
  assert.equal(failedBody.prompt, 'This has a low trust score, are you sure you want to buy?');
  assert.equal(failedBody.steps.includes('verify-consensus'), true);
  assert.equal(failedBody.steps.includes('wallet-freeze'), true);
  assert.equal(failedBody.steps.includes('bot-policy'), true);
  assert.equal(failedBody.steps.includes('approval-mode'), true);
  assert.equal(failedBody.steps.includes('reserve'), false);
  assert.equal(failedBody.steps.includes('sign'), false);
  assert.equal(signed, 1);
});

test('spend route rejects missing owner and invalid bodies', async () => {
  let loaded = 0;
  const denied = await worker.fetch(new Request('https://runtime/api/spend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      permission: 'full',
      confirmed: true,
      botId: 'bot_1',
      action: 'pay',
      amount: '1000',
      destination: DESTINATION,
    }),
  }), spendEnv({
    loadSpendContext: async () => {
      loaded += 1;
      return { bot, wallet, ledger };
    },
  }));
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error, 'owner_required');
  assert.equal(loaded, 0);

  const invalid = await worker.fetch(spendRequest({ nope: true }), spendEnv());
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid_spend');
});

function lockedDeskEnv(extra = {}, grantHash = 'ab'.repeat(32)) {
  return spendEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url) => {
      const href = String(url);
      if (href.includes('desk_locks') && href.includes('grant_hash')) {
        return Response.json([{
          grant_hash: grantHash,
          grant_until: new Date(NOW + 60_000).toISOString(),
        }]);
      }
      return Response.json([]);
    },
    ...extra,
  });
}

/**
 * Achieves: a missing grant cannot finish a spend, and a valid grant still runs every gate before mainnet-beta sign.
 * Fails when: a bare owner signs, a valid grant skips trust or reserve, or max loss signs.
 * Oracle: no grant stays unsigned after trust and approval; 1000000 with the grant signs once.
 * Side effects: in-memory ledger and mocked desk row. The grant value is a test hash, not a password.
 * Gaps: live Supabase and Privy are not called.
 */
test('a locked desk does not answer before the spend gates', async () => {
  const trading = {
    ...bot,
    approvalMode: 'fully-automatic',
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '50000000', maxPerTransaction: '5000000' },
  };
  const ledgerApi = createMemoryLedger();
  await ledgerApi.reset({
    users: [{ id: 'user_1', privyUserId: 'did:privy:user_1' }],
    wallets: [wallet],
    bots: [trading],
    ledgers: [{ botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' }],
  });
  let reserves = 0;
  const counting = {
    reserveBudget: async (input) => {
      reserves += 1;
      return ledgerApi.reserveBudget(input);
    },
  };
  let signed = 0;
  const client = {
    async getSolanaBlockhash() {
      return { cluster: 'mainnet-beta', blockhash: DESTINATION };
    },
    async signAndBroadcastSolana() {
      signed += 1;
      return { cluster: 'mainnet-beta', signature: 'sig_locked_desk' };
    },
  };
  const body = {
    permission: 'full',
    botId: 'bot_1',
    action: 'buy',
    amount: '1000000',
    destination: DESTINATION,
    idempotencyKey: 'spend_once',
  };
  const bare = spendRequest(body);
  assert.equal(bare.headers.get('x-desk-grant'), null);
  const held = await worker.fetch(bare, lockedDeskEnv({
    transferClient: client,
    ledgerApi: counting,
    loadSpendContext: async () => ({ bot: trading, wallet, ledger }),
  }));
  const heldBody = await held.json();
  assert.equal(held.status, 403);
  assert.equal(heldBody.error, 'desk_locked');
  assert.equal(heldBody.signed, false);
  assert.equal(heldBody.signature, undefined);
  assert.equal(heldBody.steps.includes('trust-gate'), true);
  assert.equal(heldBody.steps.includes('verify-consensus'), true);
  assert.equal(heldBody.steps.includes('approval-mode'), true);
  assert.equal(heldBody.steps.includes('sign'), false);
  assert.equal(heldBody.steps.includes('reserve'), false);
  assert.equal(reserves, 0);
  assert.equal(signed, 0);

  const grant = 'cd'.repeat(32);
  const granted = await worker.fetch(spendRequest(body, { 'x-desk-grant': grant }), lockedDeskEnv({
    transferClient: client,
    ledgerApi: counting,
    loadSpendContext: async () => ({ bot: trading, wallet, ledger }),
  }, await sha256Hex(grant)));
  const passed = await granted.json();
  assert.equal(granted.status, 200);
  assert.equal(passed.error, undefined);
  assert.equal(passed.signed, true);
  assert.equal(passed.signature, 'sig_locked_desk');
  assert.equal(passed.state, 'signed');
  assert.deepEqual(passed.steps, [
    'trust-gate',
    'verify-consensus',
    'wallet-freeze',
    'bot-policy',
    'approval-mode',
    'reserve',
    'sign',
  ]);
  assert.equal(reserves, 1);
  assert.equal(signed, 1);
  assert.equal((await ledgerApi.snapshot()).ledgers[0].reserved, '1000000');
  assert.equal(JSON.stringify(passed).includes(grant), false);

  const low = await worker.fetch(spendRequest(body), lockedDeskEnv({
    spendTrustScore: '100',
    transferClient: client,
    loadSpendContext: async () => ({ bot: trading, wallet, ledger }),
  }));
  const lowBody = await low.json();
  assert.equal(low.status, 409);
  assert.equal(lowBody.error, undefined);
  assert.equal(lowBody.state, 'trust-confirmation-required');
  assert.equal(lowBody.signed, false);
  assert.equal(lowBody.steps[0], 'trust-gate');

  let checks = 0;
  const mismatched = await worker.fetch(spendRequest(body), lockedDeskEnv({
    transferClient: client,
    loadSpendContext: async () => ({ bot: trading, wallet, ledger }),
    spendVerifyFn: async () => {
      checks += 1;
      return {
        asset: 'USDC',
        mint: SOLANA_USDC_MINT,
        cluster: 'mainnet-beta',
        price: '1000000',
        amount: '1',
        trustScore: '800',
        reasonSummary: 'disagree',
      };
    },
  }));
  const mismatchBody = await mismatched.json();
  assert.equal(checks, 5);
  assert.equal(mismatchBody.state, 'verify-mismatch');
  assert.equal(mismatchBody.signed, false);
  assert.equal(mismatchBody.error, undefined);
  assert.deepEqual(mismatchBody.steps, ['trust-gate', 'verify-consensus']);

  const lossBot = { ...trading, cap: { ...trading.cap, maxLoss: '10' } };
  const loss = await worker.fetch(spendRequest({ ...body, permission: 'full', confirmed: true }), lockedDeskEnv({
    transferClient: client,
    loadSpendContext: async () => ({
      bot: lossBot,
      wallet,
      ledger: { ...ledger, realizedLoss: '10' },
    }),
  }));
  const lossBody = await loss.json();
  assert.equal(lossBody.state, 'blocked');
  assert.equal(lossBody.reason, 'max-loss-reached');
  assert.equal(lossBody.signed, false);
  assert.equal(lossBody.error, undefined);
  assert.equal(signed, 1);
});

/**
 * Achieves: a 1 USDC buy with no destination reaches trust, verify, reserve, and permission.
 * Fails when: the body dies as invalid_spend, the cap is skipped, or an over-cap buy reserves.
 * Oracle: amount 1000000 reserves once; 72860000 stops with per-transaction and does not sign.
 * Side effects: in-memory ledger. No live Jupiter or Privy.
 * Gaps: the swap itself is not a USDC transfer, so this path does not broadcast.
 */
test('a 1 USDC buy is not invalid_spend and an over-cap buy stops at the cap', async () => {
  const trading = {
    ...bot,
    id: 'bot_e0madta8',
    approvalMode: 'fully-automatic',
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '20000000', maxPerTransaction: '1000000' },
  };
  const book = { botId: 'bot_e0madta8', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
  const ledgerApi = createMemoryLedger();
  await ledgerApi.reset({
    users: [{ id: 'user_1', privyUserId: 'did:privy:user_1' }],
    wallets: [wallet],
    bots: [trading],
    ledgers: [book],
  });
  let signed = 0;
  const client = {
    async getSolanaBlockhash() {
      return { cluster: 'mainnet-beta', blockhash: DESTINATION };
    },
    async signAndBroadcastSolana() {
      signed += 1;
      return { cluster: 'mainnet-beta', signature: 'sig_should_not' };
    },
  };
  const env = spendEnv({
    transferClient: client,
    ledgerApi,
    loadSpendContext: async () => ({ bot: trading, wallet, ledger: book }),
  });
  const within = await worker.fetch(spendRequest({
    permission: 'full',
    botId: 'bot_e0madta8',
    action: 'buy',
    amount: 1000000,
    asset: 'USDC',
    quoteCluster: 'mainnet-beta',
  }), env);
  const body = await within.json();
  assert.equal(body.error, undefined);
  assert.equal(within.status, 200);
  assert.equal(body.signed, false);
  assert.equal(body.state, 'reserved');
  assert.equal(body.cluster, 'mainnet-beta');
  assert.equal(body.steps.includes('trust-gate'), true);
  assert.equal(body.steps.includes('verify-consensus'), true);
  assert.equal(body.steps.includes('wallet-freeze'), true);
  assert.equal(body.steps.includes('bot-policy'), true);
  assert.equal(body.steps.includes('approval-mode'), true);
  assert.equal(body.steps.includes('reserve'), true);
  assert.equal(body.steps.includes('sign'), false);
  assert.equal(signed, 0);
  assert.equal((await ledgerApi.snapshot()).ledgers[0].reserved, '1000000');

  const over = await worker.fetch(spendRequest({
    permission: 'full',
    confirmed: true,
    botId: 'bot_e0madta8',
    action: 'buy',
    amount: '72860000',
    asset: 'USDC',
    quoteCluster: 'mainnet-beta',
    idempotencyKey: 'over_cap',
  }), env);
  const overBody = await over.json();
  assert.equal(over.status, 409);
  assert.equal(overBody.error, undefined);
  assert.equal(overBody.signed, false);
  assert.equal(overBody.state, 'approval-needed');
  assert.equal(overBody.reason, 'per-transaction');
  assert.equal(overBody.steps.includes('trust-gate'), true);
  assert.equal(overBody.steps.includes('verify-consensus'), true);
  assert.equal(overBody.steps.includes('bot-policy'), true);
  assert.equal(overBody.steps.includes('approval-mode'), true);
  assert.equal(overBody.steps.includes('reserve'), false);
  assert.equal(overBody.steps.includes('sign'), false);
  assert.equal(signed, 0);
  assert.equal((await ledgerApi.snapshot()).ledgers[0].reserved, '1000000');
});

/**
 * Achieves: a 1 USDC buy continues when Jupiter trust is missing by forcing confirmation.
 * Fails when: the buy dies as trust-unavailable, a score is invented, or confirmation skips a gate.
 * Oracle: 1000000 stays unsigned until confirmed, then reserves; low score, cap, max loss, freeze, and mainnet still stop.
 * Side effects: in-memory ledger. Jupiter is a throwing or empty fetch, never a live call.
 * Gaps: the swap itself is not broadcast on this no-destination buy.
 */
test('a within-cap USDC buy continues when Jupiter trust is unavailable by forcing confirmation', async () => {
  const trading = {
    ...bot,
    id: 'bot_4y38iiud',
    approvalMode: 'fully-automatic',
    cap: { mode: 'limited', asset: 'USDC', maxOutflow: '50000000', maxPerTransaction: '5000000' },
  };
  const book = { botId: 'bot_4y38iiud', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' };
  const ledgerApi = createMemoryLedger();
  await ledgerApi.reset({
    users: [{ id: 'user_1', privyUserId: 'did:privy:user_1' }],
    wallets: [wallet],
    bots: [trading],
    ledgers: [book],
  });
  let signed = 0;
  let reserves = 0;
  const counting = {
    reserveBudget: async (input) => {
      reserves += 1;
      return ledgerApi.reserveBudget(input);
    },
  };
  const client = {
    async getSolanaBlockhash() {
      return { cluster: 'mainnet-beta', blockhash: DESTINATION };
    },
    async signAndBroadcastSolana() {
      signed += 1;
      return { cluster: 'mainnet-beta', signature: 'sig_should_not' };
    },
  };
  let mode = 'down';
  const envFor = (context) => spendEnv({
    transferClient: client,
    ledgerApi: counting,
    loadSpendContext: async () => context,
    fetch: async () => {
      if (mode === 'down') throw new Error('jupiter down');
      if (mode === 'empty') return Response.json([]);
      if (mode === 'mismatch') {
        return Response.json([{ id: 'not-the-mint', organicScore: 99, isVerified: true }]);
      }
      return Response.json([{
        id: SOLANA_USDC_MINT,
        organicScore: 10,
        isVerified: false,
      }]);
    },
  });
  const baseEnv = () => {
    const env = envFor({ bot: trading, wallet, ledger: book });
    delete env.trustLookup;
    return env;
  };
  const buy = {
    permission: 'full',
    botId: 'bot_4y38iiud',
    action: 'buy',
    amount: 1000000,
    asset: 'USDC',
    quoteCluster: 'mainnet-beta',
  };

  const held = await worker.fetch(spendRequest(buy), baseEnv());
  const heldBody = await held.json();
  assert.equal(held.status, 409);
  assert.equal(heldBody.error, undefined);
  assert.equal(heldBody.signed, false);
  assert.equal(heldBody.state, 'trust-confirmation-required');
  assert.equal(heldBody.prompt, 'This has a low trust score, are you sure you want to buy?');
  assert.equal(heldBody.cluster, 'mainnet-beta');
  assert.equal(heldBody.trustScore, undefined);
  assert.equal(JSON.stringify(heldBody).includes('800'), false);
  assert.equal(heldBody.steps.includes('trust-gate'), true);
  assert.equal(heldBody.steps.includes('verify-consensus'), true);
  assert.equal(heldBody.steps.includes('wallet-freeze'), true);
  assert.equal(heldBody.steps.includes('bot-policy'), true);
  assert.equal(heldBody.steps.includes('approval-mode'), true);
  assert.equal(heldBody.steps.includes('reserve'), false);
  assert.equal(heldBody.steps.includes('sign'), false);
  assert.equal(reserves, 0);
  assert.equal(signed, 0);

  mode = 'empty';
  const empty = await worker.fetch(spendRequest(buy), baseEnv());
  assert.equal((await empty.json()).state, 'trust-confirmation-required');

  mode = 'mismatch';
  const mismatched = await worker.fetch(spendRequest(buy), baseEnv());
  const mismatchedBody = await mismatched.json();
  assert.equal(mismatchedBody.state, 'trust-confirmation-required');
  assert.equal(mismatchedBody.signed, false);
  assert.equal(JSON.stringify(mismatchedBody).includes('99'), false);
  assert.equal(reserves, 0);

  mode = 'low';
  const low = await worker.fetch(spendRequest(buy), baseEnv());
  const lowBody = await low.json();
  assert.equal(lowBody.state, 'trust-confirmation-required');
  assert.equal(lowBody.signed, false);
  assert.deepEqual(lowBody.steps, ['trust-gate']);
  assert.equal(reserves, 0);

  mode = 'down';
  const continued = await worker.fetch(spendRequest({
    ...buy,
    confirmed: true,
    idempotencyKey: 'buy_1_usdc',
  }), baseEnv());
  const continuedBody = await continued.json();
  assert.equal(continued.status, 200);
  assert.equal(continuedBody.error, undefined);
  assert.equal(continuedBody.signed, false);
  assert.equal(continuedBody.state, 'reserved');
  assert.equal(continuedBody.trustScore, undefined);
  assert.equal(JSON.stringify(continuedBody).includes('800'), false);
  assert.equal(continuedBody.steps.includes('verify-consensus'), true);
  assert.equal(continuedBody.steps.includes('wallet-freeze'), true);
  assert.equal(continuedBody.steps.includes('bot-policy'), true);
  assert.equal(continuedBody.steps.includes('approval-mode'), true);
  assert.equal(continuedBody.steps.includes('reserve'), true);
  assert.equal(continuedBody.steps.includes('sign'), false);
  assert.equal(reserves, 1);
  assert.equal(signed, 0);
  assert.equal((await ledgerApi.snapshot()).ledgers[0].reserved, '1000000');

  const over = await worker.fetch(spendRequest({
    ...buy,
    confirmed: true,
    amount: '72860000',
    idempotencyKey: 'over_cap',
  }), baseEnv());
  const overBody = await over.json();
  assert.equal(overBody.state, 'approval-needed');
  assert.equal(overBody.reason, 'per-transaction');
  assert.equal(overBody.signed, false);
  assert.equal(overBody.steps.includes('bot-policy'), true);
  assert.equal(overBody.steps.includes('reserve'), false);
  assert.equal(overBody.steps.includes('sign'), false);
  assert.equal(reserves, 1);

  const lossEnv = envFor({
    bot: { ...trading, cap: { ...trading.cap, maxLoss: '10' } },
    wallet,
    ledger: { ...book, realizedLoss: '10' },
  });
  delete lossEnv.trustLookup;
  const loss = await worker.fetch(spendRequest({
    ...buy,
    confirmed: true,
    idempotencyKey: 'max_loss',
  }), lossEnv);
  const lossBody = await loss.json();
  assert.equal(lossBody.state, 'blocked');
  assert.equal(lossBody.reason, 'max-loss-reached');
  assert.equal(lossBody.signed, false);
  assert.equal(lossBody.steps.includes('reserve'), false);
  assert.equal(lossBody.steps.includes('sign'), false);

  const frozenEnv = envFor({ bot: trading, wallet: { ...wallet, frozen: true }, ledger: book });
  delete frozenEnv.trustLookup;
  const frozen = await worker.fetch(spendRequest({
    ...buy,
    confirmed: true,
    idempotencyKey: 'frozen',
  }), frozenEnv);
  const frozenBody = await frozen.json();
  assert.equal(frozenBody.state, 'blocked');
  assert.equal(frozenBody.reason, 'spend-frozen');
  assert.equal(frozenBody.signed, false);
  assert.equal(frozenBody.steps.includes('verify-consensus'), true);
  assert.equal(frozenBody.steps.includes('wallet-freeze'), true);
  assert.equal(frozenBody.steps.includes('sign'), false);

  const quoted = await worker.fetch(spendRequest({
    ...buy,
    confirmed: true,
    quoteCluster: 'mainnet',
    idempotencyKey: 'mainnet_quote',
  }), baseEnv());
  const quotedBody = await quoted.json();
  assert.equal(quotedBody.state, 'quote-not-authorization');
  assert.equal(quotedBody.signed, false);
  assert.equal(quotedBody.steps.includes('sign'), false);
  assert.equal(quotedBody.steps.includes('reserve'), false);
  assert.equal(reserves, 1);
  assert.equal(signed, 0);
  assert.equal((await ledgerApi.snapshot()).ledgers[0].reserved, '1000000');
});
