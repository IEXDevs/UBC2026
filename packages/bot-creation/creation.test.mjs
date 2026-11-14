import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdditionalWallet, createMainWallet, freezeWallet } from '@ubc2026/wallets';
import {
  CreationError,
  createBotDraft,
  createUserTemplate,
  deleteUserTemplate,
  enableBot,
  listTemplates,
  lockedTemplates,
  missingCreationSteps,
  removeUserTemplate,
  templateDefaults,
  walletPickerOptions,
} from './creation.mjs';

const ownerId = 'user_1';
const mainAddress = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const extraAddress = 'So11111111111111111111111111111111111111112';
const frozenAddress = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function wallets() {
  const main = createMainWallet({ ownerId, address: mainAddress, id: 'w_main' });
  const extra = createAdditionalWallet({ ownerId, address: extraAddress, label: 'Trading sleeve', id: 'w_add' });
  const frozen = freezeWallet(createAdditionalWallet({
    ownerId,
    address: frozenAddress,
    label: 'Frozen sleeve',
    id: 'w_frozen',
  }));
  return [main, extra, frozen];
}

const limited = { mode: 'limited', asset: 'USDC', maxOutflow: '50000000', maxPerTransaction: '5000000' };

function draftInput(overrides = {}) {
  return {
    id: 'bot_apy',
    ownerId,
    name: 'APY hunter',
    goal: 'Hunt blue-chip yield',
    type: 'trading',
    walletId: 'w_main',
    wallets: wallets(),
    cap: limited,
    approvalMode: 'ask',
    templateId: 'builtin:trading',
    ...overrides,
  };
}

test('three locked templates stay visible and cannot be deleted or hidden', () => {
  const locked = lockedTemplates();
  assert.equal(locked.length, 3);
  assert.deepEqual(locked.map(template => template.type), ['trading', 'shopping', 'position-management']);
  assert.ok(locked.every(template => template.builtin && template.deletable === false && template.ownerId === null));
  for (const template of locked) assert.throws(() => deleteUserTemplate(template), /Locked templates cannot be deleted/);
  const hidden = listTemplates([], {
    hiddenIds: ['builtin:trading', 'builtin:shopping', 'builtin:position-management'],
  });
  assert.deepEqual(hidden.map(template => template.id), locked.map(template => template.id));
});

test('users can create and delete their own templates', () => {
  const template = createUserTemplate({
    id: 'tpl_apy',
    ownerId,
    name: 'APY hunter',
    goal: 'Hunt blue-chip yield',
    type: 'trading',
    approvalMode: 'capped-automatic',
    autoApproveCap: '1000000',
    cap: limited,
  });
  assert.equal(template.builtin, false);
  assert.equal(template.deletable, true);
  const visible = listTemplates([template]);
  assert.equal(visible.length, 4);
  assert.equal(visible[3].id, 'tpl_apy');
  assert.deepEqual(removeUserTemplate([template], 'tpl_apy', ownerId), []);
  assert.throws(() => removeUserTemplate([template], 'tpl_apy', 'user_2'), /Template owner must match/);
  assert.throws(
    () => createUserTemplate({ ...template, id: 'builtin:trading', approvalMode: 'ask', autoApproveCap: undefined }),
    /Invalid template id/,
  );
});

test('template defaults fill type, caps, and approval mode and do not assign a wallet', () => {
  const defaults = templateDefaults(lockedTemplates()[2]);
  assert.equal(defaults.type, 'position-management');
  assert.equal(defaults.approvalMode, 'ask');
  assert.equal(defaults.cap.maxLoss, '10000000');
  assert.equal(defaults.walletId, undefined);
});

test('wallet picker lists the owner wallets and marks frozen ones unselectable', () => {
  const options = walletPickerOptions(wallets(), ownerId);
  assert.deepEqual(options.map(option => [option.wallet.id, option.selectable]), [
    ['w_main', true],
    ['w_add', true],
    ['w_frozen', false],
  ]);
  const other = createMainWallet({ ownerId: 'user_2', address: mainAddress, id: 'w_other' });
  assert.equal(walletPickerOptions([other], ownerId).length, 0);
});

test('creation flow requires type, wallet, caps, and approval mode', () => {
  assert.deepEqual(missingCreationSteps({ ownerId, name: 'APY hunter', goal: 'Hunt' }), [
    'type',
    'wallet',
    'caps',
    'approval-mode',
  ]);
  assert.throws(() => createBotDraft({ ownerId, name: 'APY hunter', goal: 'Hunt' }), /Creation needs type, wallet, caps, approval-mode/);
  assert.throws(() => createBotDraft(draftInput({ walletId: 'missing' })), /Creation needs wallet/);
  assert.throws(() => createBotDraft(draftInput({ cap: undefined })), /Creation needs caps/);
  assert.throws(() => createBotDraft(draftInput({ approvalMode: 'capped-automatic' })), /Creation needs auto-approve-cap/);
});

test('draft assigns a selectable wallet and stays disabled until enable', () => {
  const draft = createBotDraft(draftInput({ enabled: true, walletId: 'w_add' }));
  assert.equal(draft.enabled, false);
  assert.equal(draft.walletId, 'w_add');
  assert.equal(draft.approvalMode, 'ask');
  assert.equal(draft.cap.maxOutflow, '50000000');
  assert.equal(draft.templateId, 'builtin:trading');
  assert.throws(() => createBotDraft(draftInput({ walletId: 'w_frozen' })), /Cannot assign a frozen wallet/);
  assert.throws(() => createBotDraft(draftInput({
    wallets: [createMainWallet({ ownerId: 'user_2', address: mainAddress, id: 'w_main' })],
  })), /Wallet owner must match bot owner/);

  const position = createBotDraft(draftInput({
    type: 'position-management',
    cap: { mode: 'limited', asset: 'USDC', maxLoss: '10000000' },
    templateId: 'builtin:position-management',
  }));
  assert.equal(position.cap.maxLoss, '10000000');

  const free = createBotDraft(draftInput({
    type: 'shopping',
    cap: { mode: 'unlimited', asset: 'USDC' },
    approvalMode: 'fully-automatic',
    templateId: null,
  }));
  assert.equal(free.cap.mode, 'unlimited');
  assert.equal(free.approvalMode, 'fully-automatic');
  assert.equal(free.templateId, null);

  const capped = createBotDraft(draftInput({
    approvalMode: 'capped-automatic',
    autoApproveCap: '2500000',
  }));
  assert.equal(capped.autoApproveCap, '2500000');
  assert.equal(enableBot(draft).enabled, true);
  assert.equal(draft.enabled, false);
  assert.throws(() => enableBot({ ...draft, frozen: true }), /Bot is frozen/);
});
