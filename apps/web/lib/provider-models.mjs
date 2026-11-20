import { fallbackThinkingCatalog, META_SPARK_NAME } from './thinking-levels.mjs';
import { accountProviderModels, aiProvider, MODEL_ID } from './ai-provider.mjs';
import { readProviderViews, readProviderCredentials } from './provider-tokens.mjs';

export const MODEL_SETTINGS_EVENT = 'maelstrom:models-changed';
const CATALOG_KEY = 'maelstrom.modelCatalogs';
const HIDDEN_KEY = 'maelstrom.hiddenModels';
export const ACCOUNT_PROVIDER = 'account';

function read(storage, key, fallback) {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function modelOptionKey(providerId, modelId) {
  return providerId === ACCOUNT_PROVIDER ? modelId : `${providerId}::${modelId}`;
}

function cleanModels(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    if (!MODEL_ID.test(row?.id || '') || seen.has(row.id)) return [];
    seen.add(row.id);
    return [{
      id: row.id,
      name: typeof row.name === 'string' ? row.name.slice(0, 80) : row.id,
      levels: Array.isArray(row.levels) ? row.levels : [],
      contextWindow: Number.isSafeInteger(row.contextWindow) ? row.contextWindow : 0,
    }];
  });
}

export function readModelCatalogs(storage) {
  const rows = read(storage, CATALOG_KEY, []);
  return Array.isArray(rows) ? rows.filter(row => typeof row?.providerId === 'string').map(row => ({
    providerId: row.providerId,
    models: cleanModels(row.models),
  })) : [];
}

export function saveModelCatalog(storage, providerId, models) {
  const next = readModelCatalogs(storage).filter(row => row.providerId !== providerId);
  next.push({ providerId, models: cleanModels(models) });
  storage.setItem(CATALOG_KEY, JSON.stringify(next));
}

export function readHiddenModels(storage) {
  const rows = read(storage, HIDDEN_KEY, []);
  return new Set(Array.isArray(rows) ? rows.filter(row => typeof row === 'string') : []);
}

export function setModelVisible(storage, key, visible) {
  const hidden = readHiddenModels(storage);
  if (visible) hidden.delete(key); else hidden.add(key);
  storage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

export function forgetProviderModels(storage, providerId) {
  storage.setItem(CATALOG_KEY, JSON.stringify(readModelCatalogs(storage).filter(row => row.providerId !== providerId)));
  storage.setItem(HIDDEN_KEY, JSON.stringify([...readHiddenModels(storage)].filter(key => !key.startsWith(`${providerId}::`))));
}

export function providerModelGroups(storage) {
  const catalogs = readModelCatalogs(storage);
  return [{ id: ACCOUNT_PROVIDER, name: 'Account provider' }, ...readProviderViews(storage)].map(provider => {
    const cached = catalogs.find(row => row.providerId === provider.id);
    const account = provider.id === ACCOUNT_PROVIDER;
    let models = cached?.models ?? (account ? fallbackThinkingCatalog() : []);
    // Older account catalogs have no provider field. Meta's account IDs used the bare Muse prefix.
    if (aiProvider(provider.baseUrl)?.provider === 'meta' || (account && models.some(model => /^muse-/i.test(model.id)))) {
      models = accountProviderModels(models, 'meta').map(model => ({ ...model, name: META_SPARK_NAME }));
      if (account && models.length === 0) models = fallbackThinkingCatalog();
    }
    return { ...provider, checked: Boolean(cached), models };
  });
}

export function visibleModelOptions(storage) {
  const hidden = readHiddenModels(storage);
  return providerModelGroups(storage).flatMap(provider => provider.models.flatMap(model => {
    const key = modelOptionKey(provider.id, model.id);
    return hidden.has(key) ? [] : [{ ...model, key, providerId: provider.id,
      name: provider.id === ACCOUNT_PROVIDER ? model.name : `${model.name} · ${provider.name}`,
    }];
  }));
}

export function selectedModelRequest(storage, optionKey) {
  const selected = visibleModelOptions(storage).find(model => model.key === optionKey);
  if (!selected) return null;
  if (selected.providerId === ACCOUNT_PROVIDER) return { model: selected.id };
  const credentials = readProviderCredentials(storage, selected.providerId);
  return credentials ? { model: selected.id, modelProvider: credentials } : null;
}

export function announceModelSettings() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
}
