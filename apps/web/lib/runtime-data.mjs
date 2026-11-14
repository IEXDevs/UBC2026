/**
 * Live Worker list helpers for the glass shell.
 * Never invent PreviewMain / demo bots — empty arrays when unsigned or unconfigured.
 */

const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;

export function runtimeBaseUrl(value = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return '';
  }
}

export function shellBotFromRemote(row, looks = {}) {
  if (!row || typeof row.id !== 'string') return null;
  const look = looks[row.id] && typeof looks[row.id] === 'object' ? looks[row.id] : {};
  const frozen = row.frozen === true;
  const enabled = row.enabled !== false;
  return {
    id: row.id,
    name: typeof look.name === 'string' && look.name.trim()
      ? look.name.trim()
      : (typeof row.name === 'string' && row.name.trim() ? row.name.trim() : row.id),
    shape: look.shape || 'circle',
    color: look.color || '#3dd6c6',
    type: row.type || 'trading',
    status: frozen ? 'paused' : (enabled ? 'watching' : 'idle'),
    goal: typeof row.goal === 'string' && row.goal.trim() ? row.goal.trim() : 'Waiting for a goal.',
    walletId: row.walletId || null,
    ownerId: row.ownerId || null,
    approvalMode: row.approvalMode,
    enabled,
    frozen,
    record: row,
  };
}

async function getJson(url, ownerId) {
  const response = await fetch(url, {
    headers: { 'x-owner-id': ownerId },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, body };
}

export async function fetchOwnerLists(ownerId, runtimeBase = runtimeBaseUrl()) {
  if (typeof ownerId !== 'string' || !OWNER.test(ownerId) || !runtimeBase) {
    return { bots: [], wallets: [], payments: [], source: 'unsigned' };
  }
  const root = runtimeBase.replace(/\/$/, '');
  const [botsRes, walletsRes, paymentsRes] = await Promise.all([
    getJson(`${root}/api/bots`, ownerId),
    getJson(`${root}/api/wallets`, ownerId),
    getJson(`${root}/api/payments`, ownerId),
  ]);
  const source = botsRes.body?.source || walletsRes.body?.source || 'unknown';
  return {
    source,
    bots: botsRes.ok && Array.isArray(botsRes.body?.items) ? botsRes.body.items : [],
    wallets: walletsRes.ok && Array.isArray(walletsRes.body?.items) ? walletsRes.body.items : [],
    payments: paymentsRes.ok && Array.isArray(paymentsRes.body?.items) ? paymentsRes.body.items : [],
  };
}

export function emptyMoneyState() {
  return { bots: [], wallets: [], payments: [], positions: [] };
}

export function deleteBotUrl(runtimeBase, botId) {
  const root = runtimeBaseUrl(runtimeBase);
  if (!root || typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return `${root}/api/bots/${encodeURIComponent(botId)}`;
}

export async function deleteOwnerBot(ownerId, botId, runtimeBase = runtimeBaseUrl()) {
  const url = deleteBotUrl(runtimeBase, botId);
  if (!url || typeof ownerId !== 'string' || !OWNER.test(ownerId)) {
    return { ok: false, error: 'invalid_request' };
  }
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-owner-id': ownerId },
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body.error || `http_${response.status}` };
    return { ok: true, deleted: body.deleted || botId };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * Same-origin Next route — works without redeploying the agent-runtime Worker.
 * (Worker also exposes the same path after deploy; the shell prefers Next.)
 */
export function botChatUrl(_runtimeBase, botId) {
  if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return `/api/bots/${encodeURIComponent(botId)}/chat`;
}

/**
 * Owner text chat with a bot via the Next OpenRouter path.
 * history: prior bubble lines ({ role, text }) — agent/assistant both map server-side.
 */
export async function sendBotChat({
  ownerId,
  botId,
  message,
  history = [],
  name,
  goal,
  type,
  runtimeBase = runtimeBaseUrl(),
} = {}) {
  const url = botChatUrl(runtimeBase, botId);
  if (!url || typeof ownerId !== 'string' || !OWNER.test(ownerId)) {
    return { ok: false, error: 'invalid_request' };
  }
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return { ok: false, error: 'message_required' };
  const prior = Array.isArray(history)
    ? history
      .filter(line => line && (line.role === 'user' || line.role === 'agent' || line.role === 'assistant'))
      .map(line => ({
        role: line.role === 'user' ? 'user' : 'assistant',
        text: typeof line.text === 'string' ? line.text : '',
      }))
      .filter(line => line.text.trim())
      .slice(-16)
    : [];
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-owner-id': ownerId,
      },
      body: JSON.stringify({
        message: text,
        history: prior,
        ...(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 80) } : {}),
        ...(typeof goal === 'string' && goal.trim() ? { goal: goal.trim().slice(0, 2000) } : {}),
        ...(typeof type === 'string' && type.trim() ? { type: type.trim().slice(0, 40) } : {}),
      }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body.error || `http_${response.status}` };
    const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
    if (!reply) return { ok: false, error: 'empty_reply' };
    return { ok: true, reply, model: body.model || null };
  } catch {
    return { ok: false, error: 'network' };
  }
}
