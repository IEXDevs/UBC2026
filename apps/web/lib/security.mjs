import { shellRuntimeUrl } from './runtime-data.mjs';

export function securityAgent(bot) {
  return {
    id: bot.id,
    name: bot.name,
    draft: !bot.record || bot.status === 'draft',
    frozen: bot.record?.frozen === true || bot.frozen === true,
    disabled: bot.record?.enabled === false,
  };
}

export async function securityPauseStatus(botId, headers, signal, fetcher = fetch) {
  const url = shellRuntimeUrl(`/bots/${botId}/status`);
  if (!url) return null;
  try {
    const response = await fetcher(url, { headers, signal, cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data.ok === true ? data.paused === true || data.run?.paused === true : null;
  } catch {
    return null;
  }
}

export async function setSecurityPause(botIds, paused, headers, fetcher = fetch) {
  const action = paused ? 'pause' : 'resume';
  const updated = await Promise.all(botIds.map(async (id) => {
    const url = shellRuntimeUrl(`/bots/${id}/${action}`);
    if (!url) return null;
    try {
      const response = await fetcher(url, { method: 'POST', headers });
      const data = await response.json();
      return response.ok && data.ok === true && data.paused === paused ? id : null;
    } catch {
      return null;
    }
  }));
  const ids = updated.filter(Boolean);
  return { ids, ok: ids.length === botIds.length };
}

export async function setSecurityFreeze(botId, frozen, headers, fetcher = fetch) {
  try {
    const response = await fetcher(shellRuntimeUrl('/api/bots/freeze'), {
      method: 'POST',
      headers,
      body: JSON.stringify(botId ? { botId, frozen } : { frozen }),
    });
    const data = await response.json();
    // A bulk response can report some confirmed changes alongside an error.
    const items = (Array.isArray(data.items) ? data.items : []).filter(
      item => typeof item?.botId === 'string' && item.frozen === frozen && (!botId || item.botId === botId),
    );
    return { items, ok: response.ok && data.ok === true && (!botId || items.length === 1) };
  } catch {
    return { items: [], ok: false };
  }
}
