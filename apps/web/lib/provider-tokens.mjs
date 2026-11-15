const STORE_KEY = 'maelstrom.providerTokens';
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}$/;
const TOKEN = /^[^\s]{8,256}$/;

export function maskToken(token) {
  const text = typeof token === 'string' ? token : '';
  if (text.length < 4) return '';
  return `••••${text.slice(-4)}`;
}

export function parseProviderDraft({ id = '', name = '', token = '', baseUrl = '' } = {}) {
  const label = String(name || '').trim();
  const secret = String(token || '').trim();
  const endpoint = String(baseUrl || '').trim();
  if (!NAME.test(label)) return { ok: false, reason: 'name' };
  if (!TOKEN.test(secret)) return { ok: false, reason: 'token' };
  if (endpoint) {
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      return { ok: false, reason: 'url' };
    }
    if (url.protocol !== 'https:') return { ok: false, reason: 'url' };
  }
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'provider';
  const cleanId = typeof id === 'string' && id.trim() ? id.trim() : `provider_${slug}`;
  return {
    ok: true,
    provider: {
      id: cleanId.slice(0, 64),
      name: label,
      baseUrl: endpoint,
      token: secret,
      hint: maskToken(secret),
    },
  };
}

export function publicProvider(record) {
  if (!record || typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  return {
    id: record.id,
    name: record.name,
    detail: record.hint ? `Token ${record.hint}` : 'Custom provider',
    category: 'Custom',
    custom: true,
    linked: true,
    builtin: false,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    hint: typeof record.hint === 'string' ? record.hint : '',
  };
}

function readRaw(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readProviderViews(storage) {
  if (!storage) return [];
  return readRaw(storage).map(publicProvider).filter(Boolean);
}

export function saveProvider(storage, draft) {
  const parsed = parseProviderDraft(draft);
  if (!parsed.ok) return parsed;
  const next = readRaw(storage).filter(row => row?.id !== parsed.provider.id);
  next.push(parsed.provider);
  storage.setItem(STORE_KEY, JSON.stringify(next));
  return { ok: true, provider: publicProvider(parsed.provider) };
}

export function removeProvider(storage, id) {
  const next = readRaw(storage).filter(row => row?.id !== id);
  storage.setItem(STORE_KEY, JSON.stringify(next));
}
