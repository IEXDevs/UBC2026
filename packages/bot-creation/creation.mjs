/**
 * Bot templates and the creation flow.
 * Drafts are not live until enableBot. No signing, no secrets, no wallet-package edits.
 */
import { APPROVAL_MODES, BOT_TYPES, ContractError, createBuiltinTemplates, validateBotRecord, validateWallet } from '@ubc2026/contracts';
import { assignBotWallet, WalletError } from '@ubc2026/wallets';

export class CreationError extends Error {}
const fail = message => { throw new CreationError(message); };

const GOALS = Object.freeze({
  trading: 'Hunt stablecoin and blue-chip yield on hourly checks. No day trading and no meme coins.',
  shopping: 'Compare products on price and quality, then wait for approval before paying.',
  'position-management': 'Watch paper positions and stop at the max-loss cap.',
});

const textOk = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const idOk = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(value);

function newId(prefix) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function lockedTemplates() {
  return createBuiltinTemplates().map(template => ({
    ...template,
    ownerId: null,
    goal: GOALS[template.type],
    hidden: false,
  }));
}

function normalizeCap(type, cap) {
  if (!cap || !['limited', 'unlimited'].includes(cap.mode) || !textOk(cap.asset, 64)) {
    fail('Explicit cap choice and accounting asset are required');
  }
  if (cap.mode === 'unlimited') return { mode: 'unlimited', asset: cap.asset };
  if (type === 'position-management') return { mode: 'limited', asset: cap.asset, maxLoss: cap.maxLoss };
  return { mode: 'limited', asset: cap.asset, maxOutflow: cap.maxOutflow, maxPerTransaction: cap.maxPerTransaction };
}

function normalizeApproval(mode, autoApproveCap) {
  if (!APPROVAL_MODES.includes(mode)) fail('Approval mode must be fully-automatic, capped-automatic, or ask');
  if (mode === 'capped-automatic') {
    if (autoApproveCap == null || autoApproveCap === '') fail('Capped automatic requires an auto-approve cap');
    return { approvalMode: mode, autoApproveCap };
  }
  if (autoApproveCap != null && autoApproveCap !== '') fail('autoApproveCap is only for capped-automatic');
  return { approvalMode: mode };
}

export function validateUserTemplate(template) {
  if (!template || template.builtin === true || template.deletable === false) fail('User templates cannot be locked');
  if (!idOk(template.id) || template.id.startsWith('builtin:')) fail('Invalid template id');
  if (!idOk(template.ownerId)) fail('Template owner is required');
  if (!textOk(template.name, 64) || !textOk(template.goal, 4000)) fail('Template name and goal are required');
  if (!BOT_TYPES.includes(template.type)) fail('A supported bot type is required');
  const approval = normalizeApproval(template.defaultApprovalMode, template.autoApproveCap);
  const cap = normalizeCap(template.type, template.defaultCap);
  return {
    id: template.id,
    ownerId: template.ownerId,
    name: template.name,
    goal: template.goal,
    type: template.type,
    builtin: false,
    deletable: true,
    hidden: false,
    defaultApprovalMode: approval.approvalMode,
    ...(approval.autoApproveCap != null ? { autoApproveCap: approval.autoApproveCap } : {}),
    defaultCap: cap,
  };
}

export function createUserTemplate(input) {
  const id = input?.id ?? newId('tpl');
  return validateUserTemplate({
    id,
    ownerId: input?.ownerId,
    name: input?.name,
    goal: input?.goal,
    type: input?.type,
    builtin: false,
    deletable: true,
    defaultApprovalMode: input?.approvalMode,
    autoApproveCap: input?.autoApproveCap,
    defaultCap: input?.cap,
  });
}

export function deleteUserTemplate(template) {
  if (!template) fail('Template not found');
  if (template.builtin === true || template.deletable === false || (typeof template.id === 'string' && template.id.startsWith('builtin:'))) {
    fail('Locked templates cannot be deleted');
  }
  validateUserTemplate(template);
  return { deleted: true, id: template.id };
}

export function removeUserTemplate(userTemplates, templateId, ownerId) {
  if (!Array.isArray(userTemplates)) fail('Template list is required');
  const template = userTemplates.find(item => item.id === templateId);
  if (!template) fail('Template not found');
  if (template.builtin === true || template.deletable === false || (typeof template.id === 'string' && template.id.startsWith('builtin:'))) {
    fail('Locked templates cannot be deleted');
  }
  if (template.ownerId !== ownerId) fail('Template owner must match');
  deleteUserTemplate(template);
  return userTemplates.filter(item => item.id !== templateId);
}

export function listTemplates(userTemplates = [], { hiddenIds = [] } = {}) {
  if (!Array.isArray(userTemplates) || !Array.isArray(hiddenIds)) fail('Template lists are required');
  const hidden = new Set(hiddenIds);
  const extras = [];
  for (const template of userTemplates) {
    const valid = validateUserTemplate(template);
    if (hidden.has(valid.id)) continue;
    extras.push(valid);
  }
  return [...lockedTemplates(), ...extras];
}

export function templateDefaults(template) {
  const locked = lockedTemplates().find(item => item.id === template?.id);
  const source = locked ?? validateUserTemplate(template);
  return {
    templateId: source.id,
    name: source.name,
    goal: source.goal,
    type: source.type,
    approvalMode: source.defaultApprovalMode,
    autoApproveCap: source.autoApproveCap ?? '',
    cap: { ...source.defaultCap },
  };
}

function chosenWallet(input) {
  if (input?.wallet) return input.wallet;
  if (!input?.walletId || !Array.isArray(input.wallets)) return null;
  return input.wallets.find(wallet => wallet && wallet.id === input.walletId) ?? null;
}

export function missingCreationSteps(input) {
  const missing = [];
  if (!textOk(input?.name, 64)) missing.push('name');
  if (!textOk(input?.goal, 4000)) missing.push('goal');
  if (!BOT_TYPES.includes(input?.type)) missing.push('type');
  if (!chosenWallet(input)) missing.push('wallet');
  if (!input?.cap || !['limited', 'unlimited'].includes(input.cap.mode) || !textOk(input.cap.asset, 64)) missing.push('caps');
  if (!APPROVAL_MODES.includes(input?.approvalMode)) missing.push('approval-mode');
  else if (input.approvalMode === 'capped-automatic' && (input.autoApproveCap == null || input.autoApproveCap === '')) {
    missing.push('auto-approve-cap');
  }
  return missing;
}

export function walletPickerOptions(wallets, ownerId) {
  if (!Array.isArray(wallets)) fail('Wallet list is required');
  if (!idOk(ownerId)) fail('Template owner is required');
  const options = [];
  for (const wallet of wallets) {
    try {
      const valid = validateWallet(wallet);
      if (valid.ownerId !== ownerId) continue;
      options.push({ wallet: valid, selectable: valid.frozen === false });
    } catch (error) {
      if (error instanceof ContractError) continue;
      throw error;
    }
  }
  return options;
}

export function createBotDraft(input) {
  const missing = missingCreationSteps(input);
  if (missing.length) fail(`Creation needs ${missing.join(', ')}`);
  const cap = normalizeCap(input.type, input.cap);
  const approval = normalizeApproval(input.approvalMode, input.autoApproveCap);
  if (input.templateId != null && input.templateId !== '' && !idOk(input.templateId)) fail('Invalid template id');
  const wallet = chosenWallet(input);
  const draft = {
    id: input.id ?? newId('bot'),
    ownerId: input.ownerId,
    name: input.name,
    goal: input.goal,
    type: input.type,
    ...approval,
    walletId: wallet.id,
    enabled: false,
    frozen: false,
    policyVersion: 1,
    templateId: input.templateId || null,
    cap,
  };
  try {
    const record = validateBotRecord(draft);
    return assignBotWallet(record, wallet);
  } catch (error) {
    if (error instanceof WalletError || error instanceof ContractError) fail(error.message);
    throw error;
  }
}

export function enableBot(bot) {
  if (!bot || bot.frozen === true) fail('Bot is frozen');
  try {
    return validateBotRecord({ ...bot, enabled: true });
  } catch (error) {
    if (error instanceof ContractError) fail(error.message);
    throw error;
  }
}
