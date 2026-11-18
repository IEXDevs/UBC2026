import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLedger } from '@ubc2026/bot-policy/ledger';
import { DEVNET_USDC_MINT } from '@ubc2026/wallets/privy';
import { sha256Hex } from './desk-grant.mjs';
import worker from './index.mjs';
import { handleVoiceRequest } from './voice.mjs';

const DESTINATION = '11111111111111111111111111111111';
const NOW = 1_700_000_000_000;
const SECRET = 'test-elevenlabs-webhook-secret';

const wallet = {
  id: 'w_main',
  ownerId: 'user_1',
  kind: 'main',
  label: 'Main',
  address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
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
    CLUSTER: 'devnet',
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

/**
 * Achieves: full-permission spend signs on devnet through each spend step.
 * Fails when: sign skipped or mainnet used.
 * Oracle: devnet signature path; step completion.
 * Side effects / state checked: signer mocks.
 * Gaps: none
 */
test('full permissions sign on devnet after every spend step', async () => {
  const calls = [];
  const response = await worker.fetch(spendRequest({
    permission: 'full',
    confirmed: true,
    botId: 'bot_1',
    action: 'pay',
    amount: '1000',
    destination: DESTINATION,
    quote: { privateKey: 'do-not-keep', pricingCluster: 'devnet' },
  }), spendEnv({
    transferClient: {
      async getDevnetBlockhash() {
        return { cluster: 'devnet', blockhash: DESTINATION };
      },
      async signAndBroadcastDevnet(request) {
        calls.push(request);
        return { cluster: 'devnet', signature: 'sig_devnet_1', signed_transaction: 'secret-bytes' };
      },
    },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.signed, true);
  assert.equal(body.signature, 'sig_devnet_1');
  assert.equal(body.cluster, 'devnet');
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
      async getDevnetBlockhash() {
        return { cluster: 'devnet', blockhash: DESTINATION };
      },
      async signAndBroadcastDevnet() {
        signed = true;
        return { cluster: 'devnet', signature: 'sig_should_not' };
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
test('voice request_spend keeps the session permission and posts the shared route', async () => {
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
    CLUSTER: 'devnet',
  }, {
    fetchApi: async (request) => {
      seen = { url: request.url, body: JSON.parse(await request.text()) };
      return Response.json({ ok: false, state: 'quote-not-authorization', signed: false, steps: [] });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(seen.url, 'https://runtime.internal/api/spend');
  assert.equal(seen.body.permission, 'full');
  assert.equal(seen.body.confirmed, false);
  assert.equal(seen.body.action, 'sell');
  assert.equal(seen.body.quote.pricingCluster, 'mainnet');
  assert.equal(seen.body.quote.authorizesTransaction, false);
});

/**
 * Achieves: POST /api/spend without x-owner-id is 401; invalid body with owner is 400.
 * Fails when: ownerless spend succeeds or invalid JSON is treated as a valid spend.
 * Oracle: status + error codes; signed===false.
 * Side effects / state checked: loadSpendContext must not run on ownerless call.
 * Gaps: desk lock 403 path covered in desk-grant.test.mjs.
 */
/**
 * Achieves: full permission trades without a confirm slide, and a Jupiter miss or low score still blocks.
 * Fails when: unconfirmed full skips signing on a passing gate, or a failed/low trust lookup signs.
 * Oracle: Jupiter search score 800 signs; score 100 and a thrown lookup do not.
 * Side effects / state checked: signer call count.
 * Gaps: live Jupiter is not called.
 */
test('full permission signs after Jupiter trust and a failed lookup does not', async () => {
  const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  let signed = 0;
  const client = {
    async getDevnetBlockhash() {
      return { cluster: 'devnet', blockhash: DESTINATION };
    },
    async signAndBroadcastDevnet() {
      signed += 1;
      return { cluster: 'devnet', signature: 'sig_jupiter_full' };
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
  assert.equal(failedBody.state, 'trust-unavailable');
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
 * Achieves: a missing grant cannot finish a spend, and a valid grant still runs every gate before devnet sign.
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
    async getDevnetBlockhash() {
      return { cluster: 'devnet', blockhash: DESTINATION };
    },
    async signAndBroadcastDevnet() {
      signed += 1;
      return { cluster: 'devnet', signature: 'sig_locked_desk' };
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
        mint: DEVNET_USDC_MINT,
        cluster: 'devnet',
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
