import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateWallet,
  validateBotRecord,
  validateSpendLedger,
  validateDecisionRecord,
  validateTimelineEvent,
  validatePayment,
  validateMetric,
  createBuiltinTemplates,
  ContractError,
  ConfigError,
  SECRET_NAMES,
  PUBLIC_CONFIG_NAMES,
  SECRET_GROUPS,
  readConfig,
  requireConfig,
  API_ROUTES,
  matchApiRoute,
  privyAvatarUrl,
  normalizeHandle,
  postgrestEq,
  directoryFailureCode,
  parseRecipient,
  profileInitials,
  OPENROUTER_FREE_MODEL,
  isFreeOpenRouterModel,
  selectFreeOpenRouterModel,
  parsePermissionedSpendBody,
  buildPermissionedSpendRequest,
  PERMISSIONED_SPEND_PATH,
  OWNER_SPEND_PERMISSIONS,
} from './contracts.mjs';

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
  goal: 'Find stable APY and rebalance into blue chips on hourly checks.',
  type: 'trading',
  approvalMode: 'ask',
  walletId: 'w_main',
  enabled: true,
  frozen: false,
  policyVersion: 1,
  templateId: 'builtin:trading',
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '50000000', maxPerTransaction: '5000000' },
};

/**
 * Achieves: Only Privy wallets with base58 addresses validate; foreign providers and bad keys fail.
 * Fails when: phantom/other providers pass, or garbage addresses validate.
 * Oracle: ContractError on non-privy provider; independent base58 address fixture vs 'not-a-key'.
 * Side effects: none.
 * Gaps: Does not cover additional/bot wallet kinds beyond kind:'main' fixture.
 */
test('validates Privy wallets and rejects non-privy providers', () => {
  assert.equal(validateWallet(wallet).kind, 'main');
  assert.throws(() => validateWallet({ ...wallet, provider: 'phantom' }), ContractError);
  assert.throws(() => validateWallet({ ...wallet, address: 'not-a-key' }), ContractError);
});

/**
 * Achieves: Bot approval modes are enum-closed; capped-automatic requires autoApproveCap.
 * Fails when: Unknown mode validates, or capped-automatic without cap is accepted.
 * Oracle: APPROVAL_MODES contract — 'sometimes' is not in the enum; capped needs string cap.
 * Side effects: none.
 * Gaps: Does not exhaust every bot field nullability.
 */
test('validates bot records including approval modes and caps', () => {
  assert.equal(validateBotRecord(bot).approvalMode, 'ask');
  assert.throws(() => validateBotRecord({ ...bot, approvalMode: 'sometimes' }), ContractError);
  assert.throws(
    () => validateBotRecord({ ...bot, approvalMode: 'capped-automatic', autoApproveCap: undefined }),
    ContractError,
  );
  assert.equal(
    validateBotRecord({ ...bot, approvalMode: 'capped-automatic', autoApproveCap: '1000000' }).autoApproveCap,
    '1000000',
  );
});

/**
 * Achieves: Position-management bots require maxLoss and reject trading-style outflow caps.
 * Fails when: Position bot accepts maxOutflow/maxPerTransaction without maxLoss.
 * Oracle: Bot-type → cap-shape matrix from contracts (position ⇒ maxLoss).
 * Side effects: none.
 * Gaps: Shopping-specific cap edges deferred to bot-policy.
 */
test('position bots require maxLoss instead of outflow caps', () => {
  const position = {
    ...bot,
    type: 'position-management',
    templateId: 'builtin:position-management',
    cap: { mode: 'limited', asset: 'USDC', maxLoss: '10000000' },
  };
  assert.equal(validateBotRecord(position).type, 'position-management');
  assert.throws(() => validateBotRecord({ ...position, cap: bot.cap }), ContractError);
});

/**
 * Achieves: Ledger/decision/timeline shapes validate; unknown event kinds are rejected.
 * Fails when: secret.leak kind validates, or pending decision loses status.
 * Oracle: EVENT_KINDS allowlist — 'secret.leak' is intentionally absent.
 * Side effects: none.
 * Gaps: Does not hash-chain timeline prevHash continuity (runtime concern).
 */
test('spend ledger, decisions, and timeline events validate tightly', () => {
  assert.equal(validateSpendLedger({ botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' }).spent, '0');
  const digest = 'a'.repeat(64);
  assert.equal(
    validateDecisionRecord({
      id: 'dec_1',
      botId: 'bot_1',
      runId: 'run_1',
      cluster: 'devnet',
      factsDigest: digest,
      proposalDigest: digest,
      createdAt: Date.now(),
      status: 'pending',
    }).status,
    'pending',
  );
  assert.equal(
    validateTimelineEvent({
      id: 'evt_1',
      botId: 'bot_1',
      ownerId: 'user_1',
      kind: 'approval.requested',
      at: Date.now(),
      summary: 'Waiting for owner approval',
      prevHash: null,
    }).kind,
    'approval.requested',
  );
  assert.throws(
    () => validateTimelineEvent({
      id: 'evt_1',
      botId: 'bot_1',
      ownerId: 'user_1',
      kind: 'secret.leak',
      at: Date.now(),
      summary: 'nope',
    }),
    ContractError,
  );
});

/**
 * Achieves: x402 payments and metrics validate; non-x402 protocols are rejected.
 * Fails when: protocol 'card' validates, or pnlMicroUsdc is dropped.
 * Oracle: Payment protocol allowlist (x402 family only for this contract).
 * Side effects: none.
 * Gaps: Negative metric counters not exhaustively tested.
 */
test('payments and metrics validate, and reject bad shapes', () => {
  assert.equal(validatePayment({
    id: 'pay_1',
    botId: 'bot_1',
    direction: 'paid',
    protocol: 'x402',
    amount: '5000000',
    asset: 'USDC',
    cluster: 'devnet',
  }).direction, 'paid');
  assert.throws(() => validatePayment({
    id: 'pay_1',
    botId: 'bot_1',
    direction: 'paid',
    protocol: 'card',
    amount: '1',
    asset: 'USDC',
    cluster: 'devnet',
  }), ContractError);
  assert.equal(validateMetric({
    id: 'metric_1',
    ownerId: 'user_1',
    botId: 'bot_1',
    decisions: 1,
    transactionsExecuted: 0,
    mismatchesCaught: 0,
    transactionsBlocked: 0,
    approvalsRequested: 1,
    approvalsGranted: 0,
    x402Payments: 0,
    pnlMicroUsdc: '-1000',
  }).pnlMicroUsdc, '-1000');
});

/**
 * Achieves: Missing secrets surface by name; empty env values stay undefined; .env.example lists every name blank.
 * Fails when: Reader invents secret values, or .env.example omits/fills a secret.
 * Oracle: Independent filesystem read of ../../.env.example vs SECRET_NAMES/PUBLIC_CONFIG_NAMES.
 * Side effects: reads .env.example only (no network, no writes).
 * Gaps: Does not assert secret group completeness against Cloudflare bindings.
 */
test('config reader reports missing secret names and never invents values', () => {
  assert.throws(() => requireConfig({}, SECRET_GROUPS.serverSigning), ConfigError);
  const read = readConfig({ PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: '' }, SECRET_GROUPS.privy);
  assert.equal(read.ok, false);
  assert.deepEqual(read.missing, ['PRIVY_APP_SECRET']);
  assert.equal(read.values.PRIVY_APP_SECRET, undefined);
  const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  for (const name of [...SECRET_NAMES, ...PUBLIC_CONFIG_NAMES]) {
    assert.match(example, new RegExp(`^${name}=$`, 'm'));
  }
  const assignments = example.replaceAll('\r', '').split('\n').filter(line => /^[A-Z0-9_]+=/.test(line));
  assert.ok(assignments.every(line => /= $/.test(line) === false && line.endsWith('=')));
});

/**
 * Achieves: Concrete HTTP paths match declared route ids; CRON strings never match via HTTP matcher.
 * Fails when: Route id collisions, wrong param capture, or CRON matches as HTTP.
 * Oracle: Hand-built path strings vs API_ROUTES ids; CRON method must return null from matchApiRoute.
 * Side effects: none.
 * Gaps: Exhaustive live-route coverage is the next test.
 */
test('API route contracts match concrete paths and keep cron off the HTTP matcher', () => {
  const ids = API_ROUTES.map(route => route.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(matchApiRoute('POST', '/api/wallets/wal_1/sign').params.walletId, 'wal_1');
  assert.equal(matchApiRoute('POST', '/api/bots').route.id, 'bots.create');
  assert.equal(matchApiRoute('DELETE', '/api/bots/bot_1').route.id, 'bots.delete');
  assert.equal(matchApiRoute('DELETE', '/api/bots/bot_1').params.botId, 'bot_1');
  assert.equal(matchApiRoute('POST', '/api/bots/bot_1/chat').route.id, 'bots.chat');
  assert.equal(matchApiRoute('POST', '/api/bots/bot_1/chat').params.botId, 'bot_1');
  assert.equal(matchApiRoute('GET', '/bots/bot_1').route.action, 'status');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/wake').route.id, 'bots.wake');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/loop').route.id, 'bots.loop');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/loop').route.action, 'loop');
  const liveView = matchApiRoute('POST', '/bots/bot_1/browser/sessions/rec_1/live-view');
  assert.equal(liveView.route.id, 'bots.browser.liveView');
  assert.equal(liveView.params.sessionRecordId, 'rec_1');
  assert.equal(matchApiRoute('GET', '/bots/bot_1/browser/sessions').route.id, 'bots.browser.list');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/browser/sessions/rec_1/navigate').route.id, 'bots.browser.navigate');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/browser/sessions/rec_1/release').route.id, 'bots.browser.release');
  assert.equal(matchApiRoute('POST', '/voice/tools/list_bots').route.id, 'voice.tools');
  assert.equal(matchApiRoute('POST', '/voice/tools/list_bots').params.name, 'list_bots');
  assert.equal(matchApiRoute('POST', '/api/spend').route.id, 'spend.create');
  assert.equal(matchApiRoute('POST', '/voice/llm/chat/completions').route.id, 'voice.llm');
  assert.equal(matchApiRoute('GET', '/voice/agent').route.id, 'voice.agent');
  assert.equal(matchApiRoute('CRON', '0 * * * *'), null);
  assert.ok(API_ROUTES.some(route => route.id === 'cron.hourly' && route.status === 'live' && route.path === '0 * * * *'));
  assert.ok(API_ROUTES.some(route => route.id === 'cron.stream-fallback' && route.status === 'live' && route.path === '5,20,35,50 * * * *'));
});

/**
 * Achieves: Every live non-CRON API_ROUTES entry matches a filled sample path; wallet verbs stay distinct.
 * Fails when: A live route fails to self-match, or PUT /api/wallets silently matches another route.
 * Oracle: Generate pathname from route.path + samples map; wrong method must be null.
 * Side effects: none.
 * Gaps: Auth/phase metadata not asserted here.
 */
/**
 * Rigor audit — exhaustive live HTTP route matching
 * Achieves: every live non-CRON API_ROUTES entry matches matchApiRoute for a
 *   concrete sample path; wallet list/create/persist/export stay distinct by method.
 * Fails when: a new live route param lacks a sample, matcher drifts, or PUT /api/wallets
 *   silently matches another wallet route.
 * Oracle: API_ROUTES table is the product contract; samples are independent fixtures.
 * Side effects: none.
 * Gaps closed: full live HTTP set (not just hand-picked routes). Remaining: does not
 *   execute handlers — only routing.
 */
test('every live HTTP API route matches a concrete sample path (and wallet routes stay distinct)', () => {
  const samples = {
    walletId: 'fmfdj6yqly31huorjqzq38zc',
    botId: 'bot_1',
    sessionRecordId: 'rec_1',
    signalId: 'sig_1',
    name: 'list_bots',
  };
  const httpLive = API_ROUTES.filter(route => route.status === 'live' && route.method !== 'CRON');
  assert.ok(httpLive.length >= 20);
  for (const route of httpLive) {
    const pathname = route.path.replace(/:([A-Za-z]+)/g, (_, name) => {
      assert.ok(samples[name], `missing sample for :${name} on ${route.id}`);
      return samples[name];
    });
    const matched = matchApiRoute(route.method, pathname);
    assert.ok(matched, `${route.method} ${pathname} should match ${route.id}`);
    assert.equal(matched.route.id, route.id);
  }
  assert.equal(matchApiRoute('GET', '/api/wallets').route.id, 'wallets.list');
  assert.equal(matchApiRoute('POST', '/api/wallets').route.id, 'wallets.create');
  assert.equal(matchApiRoute('POST', '/api/wallets/persist').route.id, 'wallets.persist');
  assert.equal(
    matchApiRoute('POST', `/api/wallets/${samples.walletId}/export`).route.id,
    'wallets.export',
  );
  // Wrong method must not silently match another wallet route.
  assert.equal(matchApiRoute('PUT', '/api/wallets'), null);
});

/**
 * Achieves: Only https avatars win; handles normalize; SNS vs handle parsing stays distinct; PostgREST eq encodes safely.
 * Fails when: javascript: avatars win, richclub.sol normalizes as handle, or eq filter injects quotes.
 * Oracle: Scheme allowlist (https only); parseRecipient kind matrix; postgrestEq encoding of ':'.
 * Side effects: none.
 * Gaps: Does not cover every Privy linked-account avatar field.
 */
test('profile pictures, handles, and SNS recipients stay separate', () => {
  const user = {
    twitter: { profilePictureUrl: 'https://images.example/alex.png' },
    google: { picture: 'javascript:alert(1)' },
    linkedAccounts: [{ profilePictureUrl: 'http://insecure.example/a.png' }],
  };
  assert.equal(privyAvatarUrl(user), 'https://images.example/alex.png');
  assert.equal(privyAvatarUrl({ farcaster: { pfp: 'https://images.example/f.png' } }), 'https://images.example/f.png');
  assert.equal(privyAvatarUrl({ wallet: { address: 'So11111111111111111111111111111111111111112' } }), null);
  assert.equal(normalizeHandle('@Alex'), 'alex');
  assert.equal(normalizeHandle('richclub.sol'), null);
  assert.equal(postgrestEq('owner_id', 'did:privy:user_1'), 'owner_id=eq.did%3Aprivy%3Auser_1');
  assert.equal(postgrestEq('handle', 'alex'), 'handle=eq.alex');
  assert.equal(postgrestEq('owner_id', 'did:privy:user_1').includes('%22'), false);
  assert.equal(postgrestEq('bad column', 'alex'), '');
  assert.equal(directoryFailureCode(409, { code: '23505', message: 'duplicate key' }), '23505');
  assert.equal(directoryFailureCode(401, { message: 'Invalid API key', hint: 'service-role-secret' }), 'supabase_http_401');
  assert.equal(directoryFailureCode(0, null), '');
  assert.deepEqual(parseRecipient('@Alex'), { kind: 'handle', handle: 'alex' });
  assert.deepEqual(parseRecipient('@richclub.sol'), { kind: 'sns', domain: 'richclub.sol' });
  assert.equal(parseRecipient('not a handle'), null);
  assert.equal(profileInitials('Alex Rivera'), 'AR');
});

/**
 * Achieves: Free model selection accepts :free suffix or zero pricing; paid models fall back or null.
 * Fails when: Paid gpt-4o is treated free, or zero-price vendor id is rejected.
 * Oracle: OPENROUTER_FREE_MODEL constant + pricing zeros independent of catalog.mjs.
 * Side effects: none.
 * Gaps: Live OpenRouter API pricing not queried.
 */
test('OpenRouter accepts only :free ids or a zero price', () => {
  assert.equal(OPENROUTER_FREE_MODEL.endsWith(':free'), true);
  assert.equal(isFreeOpenRouterModel('meta-llama/llama-3.3-70b-instruct:free'), true);
  assert.equal(isFreeOpenRouterModel('vendor/zero', { prompt: '0', completion: '0.0', request: 0 }), true);
  assert.equal(isFreeOpenRouterModel('openai/gpt-4o'), false);
  assert.equal(isFreeOpenRouterModel('openai/gpt-4o', { prompt: '0.000002', completion: '0' }), false);
  assert.equal(isFreeOpenRouterModel('vendor/blank', {}), false);
  assert.equal(isFreeOpenRouterModel('  paid-model  '), false);
  assert.equal(selectFreeOpenRouterModel('openai/gpt-4o'), OPENROUTER_FREE_MODEL);
  assert.equal(selectFreeOpenRouterModel('google/gemma-2-9b-it:free'), 'google/gemma-2-9b-it:free');
  assert.equal(
    selectFreeOpenRouterModel('vendor/zero', { pricing: { prompt: '0', completion: '0' } }),
    'vendor/zero',
  );
  assert.equal(selectFreeOpenRouterModel('openai/gpt-4o', { fallback: 'openai/gpt-4o-mini' }), null);
});

/**
 * Achieves: Exactly three builtin templates exist, all locked/non-deletable, covering the three bot types.
 * Fails when: Count drifts, deletable flips true, or a type is missing.
 * Oracle: BOT_TYPES / BUILTIN_TEMPLATES set equality via sorted type list.
 * Side effects: none.
 * Gaps: User template CRUD is owned by bot-creation tests.
 */
test('builtin templates are locked and non-deletable', () => {
  const templates = createBuiltinTemplates();
  assert.equal(templates.length, 3);
  assert.ok(templates.every(t => t.builtin && t.deletable === false));
  assert.deepEqual(templates.map(t => t.type).sort(), ['position-management', 'shopping', 'trading']);
});

/**
 * Achieves: Permissioned spend bodies require a valid permission, bot, amount>0, and handle or destination.
 * Fails when: Invalid permission/amount/asset/quote shapes parse as spend, or path drifts from /api/spend.
 * Oracle: OWNER_SPEND_PERMISSIONS + FUND_ACTIONS allowlists; base58 destination fixture; PERMISSIONED_SPEND_PATH.
 * Side effects: none.
 * Gaps: Does not exercise voice/UI callers — only the shared body parser.
 */
test('parsePermissionedSpendBody accepts valid spends and rejects unsafe shapes', () => {
  const dest = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const ok = parsePermissionedSpendBody({
    permission: 'full',
    botId: 'bot_1',
    action: 'spend',
    amount: '1000',
    destination: dest,
    confirmed: true,
  });
  assert.equal(ok.permission, 'full');
  assert.equal(ok.amount, '1000');
  assert.equal(ok.destination, dest);
  assert.equal(ok.confirmed, true);
  assert.equal(ok.asset, 'USDC');

  const viaHandle = parsePermissionedSpendBody({
    permission: 'ask',
    botId: 'bot_1',
    amount: '5',
    handle: '@Alex',
  });
  assert.equal(viaHandle.handle, 'alex');
  assert.equal(viaHandle.destination, null);

  assert.equal(parsePermissionedSpendBody(null), null);
  assert.equal(parsePermissionedSpendBody({ permission: 'sudo', botId: 'bot_1', amount: '1', destination: dest }), null);
  assert.equal(parsePermissionedSpendBody({ permission: 'full', botId: 'bot_1', amount: '0', destination: dest }), null);
  assert.equal(parsePermissionedSpendBody({ permission: 'full', botId: 'bot_1', amount: '1' }), null);
  assert.equal(parsePermissionedSpendBody({ permission: 'full', botId: 'bot_1', amount: '1', destination: dest, asset: 'SOL' }), null);
  assert.equal(parsePermissionedSpendBody({
    permission: 'full', botId: 'bot_1', amount: '1', destination: dest, quote: { pricingCluster: 'bogus' },
  }), null);
  assert.deepEqual(OWNER_SPEND_PERMISSIONS, ['ask', 'review', 'full']);

  const req = buildPermissionedSpendRequest({
    permission: 'review',
    botId: 'bot_1',
    amount: '42',
    destination: dest,
  });
  assert.equal(req.method, 'POST');
  assert.equal(req.path, PERMISSIONED_SPEND_PATH);
  assert.equal(req.path, '/api/spend');
  assert.throws(
    () => buildPermissionedSpendRequest({ permission: 'full', botId: 'bot_1', amount: '1' }),
    ContractError,
  );
});

