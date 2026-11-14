import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWallet,
  validateBotRecord,
  validateSpendLedger,
  validateDecisionRecord,
  validateTimelineEvent,
  createBuiltinTemplates,
  ContractError,
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

test('builtin templates are locked and non-deletable', () => {
  const templates = createBuiltinTemplates();
  assert.equal(templates.length, 3);
  assert.ok(templates.every(t => t.builtin && t.deletable === false));
  assert.deepEqual(templates.map(t => t.type).sort(), ['position-management', 'shopping', 'trading']);
});
