import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
/**
 * Account security page model (Isaac / 7C).
 * Kill-switch + freeze intents only. Never signs, never shows secret values.
 */

export const SECURITY_ACTIONS = Object.freeze([
  'pause-all',
  'freeze-all-bots',
  'unfreeze-all-bots',
  'request-grab-back',
]);

export function securityActionLabel(action) {
  switch (action) {
    case 'pause-all': return 'Pause every agent';
    case 'freeze-all-bots': return 'Freeze every agent';
    case 'unfreeze-all-bots': return 'Unfreeze every agent';
    case 'request-grab-back': return 'Request grab-back';
    default: return action;
  }
}

/**
 * Build the security view. `account` is display-only Privy label / owner id.
 * Bot freeze/enabled flags come from local shell state until wallets/API land.
 */
export function buildSecurityPage({
  ownerId = null,
  accountLabel = null,
  bots = [],
  cluster = SOLANA_CLUSTER,
} = {}) {
  const list = Array.isArray(bots) ? bots : [];
  const frozen = list.filter((b) => b.record?.frozen === true || b.frozen === true);
  const enabled = list.filter((b) => b.record?.enabled !== false && b.status !== 'draft');
  const paused = list.filter((b) => b.status === 'paused');

  return {
    title: 'Security',
    subtitle: 'Kill switch and freezes. Keys stay in Privy; this page never shows secrets.',
    ownerId,
    accountLabel: accountLabel || (ownerId ? String(ownerId) : 'Not signed in'),
    cluster,
    signedIn: Boolean(ownerId),
    summary: {
      botCount: list.length,
      enabled: enabled.length,
      paused: paused.length,
      frozen: frozen.length,
    },
    bots: list.map((bot) => ({
      id: bot.id,
      name: bot.name,
      status: bot.status,
      frozen: bot.record?.frozen === true || bot.frozen === true,
      enabled: bot.record?.enabled !== false && bot.status !== 'draft',
    })),
    actions: SECURITY_ACTIONS.map((id) => ({
      id,
      label: securityActionLabel(id),
      kind: id === 'request-grab-back' ? 'danger' : id === 'freeze-all-bots' ? 'warn' : 'default',
      confirm: id === 'pause-all'
        ? 'Pause every running agent? They can be resumed later.'
        : id === 'freeze-all-bots'
          ? 'Freeze every agent so policy refuses new spends until you unfreeze them?'
          : id === 'unfreeze-all-bots'
            ? 'Clear the freeze on every agent? A paused agent stays paused until you resume it.'
            : 'Request grab-back of agent funds to the owner main wallet? Signing stays server-side.',
    })),
    notes: [
      'Privy holds wallet keys. The model and this UI never receive private keys.',
      'Pause stops the Durable Object run. Freeze blocks policy until an owner unfreezes.',
      'Grab-back is an owner intent only here — the Worker signs on Privy when wired.',
    ],
  };
}

/**
 * Apply a local security action to bot list state (optimistic UI).
 * Real pause/freeze hits the runtime when `runtimeApply` is provided by the caller.
 */
export function applySecurityActionLocal(bots, actionId) {
  if (!Array.isArray(bots)) return [];
  if (actionId === 'pause-all') {
    return bots.map((bot) => (
      bot.status === 'draft' ? bot : { ...bot, status: 'paused' }
    ));
  }
  if (actionId === 'freeze-all-bots') {
    return bots.map((bot) => ({
      ...bot,
      frozen: true,
      status: bot.status === 'draft' ? bot.status : 'paused',
      record: bot.record ? { ...bot.record, frozen: true, enabled: false } : bot.record,
    }));
  }
  if (actionId === 'unfreeze-all-bots') {
    return bots.map((bot) => ({
      ...bot,
      frozen: false,
      record: bot.record ? { ...bot.record, frozen: false } : bot.record,
    }));
  }
  // grab-back: no local mutation beyond returning the same list
  return bots.map((bot) => bot);
}

export function pauseAllUrl(runtimeBase, botId) {
  if (typeof runtimeBase !== 'string' || !runtimeBase || !botId) return null;
  let base;
  try { base = new URL(runtimeBase); } catch { return null; }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const root = `${base.origin}${base.pathname.replace(/\/$/, '')}`;
  return `${root}/bots/${encodeURIComponent(botId)}/pause`;
}
