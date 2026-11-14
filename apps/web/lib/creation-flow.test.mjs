import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enableBot } from '@ubc2026/bot-creation';
import {
  applyTemplate,
  demoWallets,
  initialForm,
  removeUserTemplate,
  saveTemplate,
  submitDraft,
  visibleTemplates,
  walletPickerOptions,
} from './creation-flow.mjs';

const ownerId = 'demo_owner';

test('creation flow uses the wallet picker, caps, and approval mode', () => {
  const wallets = demoWallets(ownerId);
  const options = walletPickerOptions(wallets, ownerId);
  assert.equal(options.filter(option => option.selectable).length, 2);
  assert.equal(options.find(option => option.wallet.label === 'Frozen sleeve').selectable, false);

  const locked = visibleTemplates([]);
  assert.equal(locked.length, 3);
  assert.ok(locked.every(template => template.deletable === false));
  const form = applyTemplate(initialForm(ownerId), locked[0]);
  assert.equal(form.type, 'trading');
  assert.equal(form.approvalMode, 'ask');
  assert.equal(form.capMode, 'limited');
  assert.equal(form.maxOutflow, '50000000');
  assert.equal(form.walletId, '');

  assert.throws(() => submitDraft(form, wallets), /Creation needs wallet/);
  const draft = submitDraft({ ...form, walletId: options[0].wallet.id }, wallets);
  assert.equal(draft.enabled, false);
  assert.equal(draft.walletId, options[0].wallet.id);
  assert.equal(draft.type, 'trading');
  assert.equal(enableBot(draft).enabled, true);
  assert.equal(draft.enabled, false);
  assert.throws(() => submitDraft({ ...form, walletId: options[2].wallet.id }, wallets), /Cannot assign a frozen wallet/);
});

test('user templates can be saved and deleted and locked templates cannot', () => {
  const trading = visibleTemplates([])[0];
  const form = applyTemplate(initialForm(ownerId), trading);
  const saved = saveTemplate({ ...form, name: 'My trader', approvalMode: 'fully-automatic' });
  assert.equal(saved.deletable, true);
  assert.equal(saved.ownerId, ownerId);
  const visible = visibleTemplates([saved], ['builtin:trading', saved.id]);
  assert.deepEqual(visible.map(template => template.id), [
    'builtin:trading',
    'builtin:shopping',
    'builtin:position-management',
  ]);
  assert.deepEqual(removeUserTemplate([saved], saved.id, ownerId), []);
  assert.throws(() => removeUserTemplate([trading], trading.id, ownerId), /Locked templates cannot be deleted/);
});
