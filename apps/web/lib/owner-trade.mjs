import { parsePermissionedSpendBody } from '@ubc2026/contracts';
import { toolAccessRequest } from './spend-permission.mjs';

/**
 * An owner sentence that asks for one trade.
 * A price question does not match. The platform then runs the existing loop.
 */
export function ownerAsksForOneTrade(message) {
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  if (!text.trim()) return false;
  const trade = /\b(trad(?:e|ing)|swap)\b/.test(text);
  const action = /\b(do|doing|place|placing|make|making|find|finding|execute|executing|try|swap|buy|sell)\b/.test(text);
  return trade && action;
}

/**
 * When the model stops after get_price, wake this bot and start the existing loop.
 * A spend tool that already ran stays on the shared spend route.
 */
export async function ensureOwnerTradeLoop({
  message,
  goal,
  permission,
  activity,
  invoke,
} = {}) {
  if (typeof invoke !== 'function' || !ownerAsksForOneTrade(message)) return null;
  const names = new Set(
    (Array.isArray(activity) ? activity : [])
      .map(step => (step && typeof step.name === 'string' ? step.name : ''))
      .filter(Boolean),
  );
  if (names.has('start_task') || names.has('request_spend')) return null;
  const request = String(message || '').trim();
  const text = typeof goal === 'string' && goal.trim() ? `${request}\nAgent goal: ${goal.trim()}` : request;
  const args = { goal: text.slice(0, 2000) };
  if (permission === 'full') args.ownerPermission = 'full';
  let wake = null;
  try {
    wake = await invoke('wake_bot', { goal: args.goal });
  } catch (error) {
    wake = { error: typeof error?.code === 'string' ? error.code : 'wake_failed' };
  }
  let loop = null;
  try {
    loop = await invoke('start_task', args);
  } catch (error) {
    loop = { error: typeof error?.code === 'string' ? error.code : 'loop_failed' };
  }
  return { wake, loop };
}
export function pendingSwapHold(botId, intent) {
  const parsed = parsePermissionedSpendBody({
    botId, action: 'swap', permission: 'ask', asset: intent?.asset,
    outputAsset: intent?.outputAsset, amount: intent?.amount, idempotencyKey: intent?.idempotencyKey,
  });
  if (intent?.botId !== botId || !parsed?.idempotencyKey?.startsWith('loop_swap_')) return null;
  const args = { botId, action: 'swap', asset: parsed.asset, outputAsset: parsed.outputAsset, amount: parsed.amount };
  return { ...toolAccessRequest('ask', 'request_spend', args), idempotencyKey: parsed.idempotencyKey };
}
