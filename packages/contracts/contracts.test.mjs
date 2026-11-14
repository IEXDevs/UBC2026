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

test('validates Privy wallets and rejects non-privy providers', () => {
  assert.equal(validateWallet(wallet).kind, 'main');
  assert.throws(() => validateWallet({ ...wallet, provider: 'phantom' }), ContractError);
  assert.throws(() => validateWallet({ ...wallet, address: 'not-a-key' }), ContractError);
});

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
  const assignments = example.split('\n').filter(line => /^[A-Z0-9_]+=/.test(line));
  assert.ok(assignments.every(line => /= $/.test(line) === false && line.endsWith('=')));
});

test('API route contracts match concrete paths and keep cron off the HTTP matcher', () => {
  const ids = API_ROUTES.map(route => route.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(matchApiRoute('POST', '/api/wallets/wal_1/sign').params.walletId, 'wal_1');
  assert.equal(matchApiRoute('GET', '/bots/bot_1').route.action, 'status');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/wake').route.id, 'bots.wake');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/loop').route.id, 'bots.loop');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/loop').route.action, 'loop');
  const liveView = matchApiRoute('POST', '/bots/bot_1/browser/sessions/rec_1/live-view');
  assert.equal(liveView.route.id, 'bots.browser.liveView');
  assert.equal(liveView.params.sessionRecordId, 'rec_1');
  assert.equal(matchApiRoute('GET', '/bots/bot_1/browser/sessions').route.id, 'bots.browser.list');
  assert.equal(matchApiRoute('POST', '/bots/bot_1/browser/sessions/rec_1/release').route.id, 'bots.browser.release');
  assert.equal(matchApiRoute('CRON', '0 * * * *'), null);
  assert.ok(API_ROUTES.some(route => route.id === 'cron.hourly' && route.status === 'live' && route.path === '0 * * * *'));
  assert.ok(API_ROUTES.some(route => route.id === 'cron.stream-fallback' && route.status === 'live' && route.path === '5,20,35,50 * * * *'));
});

test('builtin templates are locked and non-deletable', () => {
  const templates = createBuiltinTemplates();
  assert.equal(templates.length, 3);
  assert.ok(templates.every(t => t.builtin && t.deletable === false));
  assert.deepEqual(templates.map(t => t.type).sort(), ['position-management', 'shopping', 'trading']);
});
