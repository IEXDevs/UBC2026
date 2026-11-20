import {
  createBotDraft,
  createUserTemplate,
  listTemplates,
  removeUserTemplate,
  templateDefaults,
  walletPickerOptions,
} from '@ubc2026/bot-creation';
import { createAdditionalWallet, createMainWallet, freezeWallet } from '@ubc2026/wallets';

const ADDRESSES = Object.freeze({
  main: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  extra: 'So11111111111111111111111111111111111111112',
  frozen: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
});

export function demoWallets(ownerId) {
  const slug = String(ownerId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const main = createMainWallet({ ownerId, address: ADDRESSES.main, id: `w_main_${slug}` });
  const extra = createAdditionalWallet({
    ownerId,
    address: ADDRESSES.extra,
    label: 'Trading sleeve',
    id: `w_add_${slug}`,
  });
  const frozen = freezeWallet(createAdditionalWallet({
    ownerId,
    address: ADDRESSES.frozen,
    label: 'Frozen sleeve',
    id: `w_frz_${slug}`,
  }));
  return [main, extra, frozen];
}

export function initialForm(ownerId) {
  return {
    ownerId,
    name: '',
    goal: '',
    type: '',
    walletId: '',
    approvalMode: '',
    autoApproveCap: '',
    capMode: '',
    asset: 'USDC',
    maxOutflow: '',
    maxPerTransaction: '',
    maxLoss: '',
    templateId: '',
  };
}

export function capFromForm(form) {
  if (form.capMode === 'unlimited') return { mode: 'unlimited', asset: form.asset };
  if (form.type === 'position-management') {
    return { mode: 'limited', asset: form.asset, maxLoss: form.maxLoss };
  }
  return {
    mode: 'limited',
    asset: form.asset,
    maxOutflow: form.maxOutflow,
    maxPerTransaction: form.maxPerTransaction,
  };
}

export function draftInputFromForm(form, wallets) {
  return {
    ownerId: form.ownerId,
    name: form.name,
    goal: form.goal,
    type: form.type,
    walletId: form.walletId,
    wallets,
    cap: form.capMode ? capFromForm(form) : undefined,
    approvalMode: form.approvalMode,
    autoApproveCap: form.approvalMode === 'capped-automatic' ? form.autoApproveCap : undefined,
    templateId: form.templateId || undefined,
  };
}

export function applyTemplate(form, template) {
  const defaults = templateDefaults(template);
  return {
    ...form,
    templateId: defaults.templateId,
    name: defaults.name,
    goal: defaults.goal,
    type: defaults.type,
    approvalMode: defaults.approvalMode,
    autoApproveCap: defaults.autoApproveCap,
    capMode: defaults.cap.mode,
    asset: defaults.cap.asset,
    maxOutflow: defaults.cap.maxOutflow ?? '',
    maxPerTransaction: defaults.cap.maxPerTransaction ?? '',
    maxLoss: defaults.cap.maxLoss ?? '',
  };
}

export function submitDraft(form, wallets) {
  return createBotDraft(draftInputFromForm(form, wallets));
}

export function saveTemplate(form) {
  const input = draftInputFromForm(form, []);
  return createUserTemplate({
    ownerId: form.ownerId,
    name: form.name,
    goal: form.goal,
    type: form.type,
    approvalMode: input.approvalMode,
    autoApproveCap: input.autoApproveCap,
    cap: input.cap,
  });
}

export function visibleTemplates(userTemplates, hiddenIds = []) {
  return listTemplates(userTemplates, { hiddenIds });
}

export { removeUserTemplate, walletPickerOptions };
