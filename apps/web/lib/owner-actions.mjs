/**
 * Owner controls that sit on the agent already on screen.
 * Wake and run post the existing bot routes. A signal line is only present
 * when this agent record already carries a signal id and a base-unit price.
 */
import { formatBaseUnits } from './money-views.mjs';
import { runtimeBaseUrl } from './runtime-data.mjs';

const ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const PLACEHOLDER_GOAL = 'Waiting for a goal.';

export function agentRunCall(action, bot) {
  if (action !== 'wake' && action !== 'loop') return null;
  if (!bot || typeof bot.id !== 'string' || !ID.test(bot.id)) return null;
  const goal = typeof bot.goal === 'string' ? bot.goal.trim() : '';
  const body = goal && goal !== PLACEHOLDER_GOAL ? { goal } : {};
  return {
    method: 'POST',
    path: `/bots/${encodeURIComponent(bot.id)}/${action}`,
    body,
  };
}

export function signalOfferView(bot, origin) {
  const signalId = typeof bot?.signalId === 'string' ? bot.signalId : bot?.record?.signalId;
  const amount = typeof bot?.signalAmount === 'string' ? bot.signalAmount : bot?.record?.signalAmount;
  if (typeof signalId !== 'string' || !ID.test(signalId)) return null;
  if (!bot || typeof bot.id !== 'string' || !ID.test(bot.id)) return null;
  if (typeof amount !== 'string' || !AMOUNT.test(amount) || amount === '0') return null;
  const root = runtimeBaseUrl(origin);
  if (!root) return null;
  return {
    signalId,
    amountLabel: formatBaseUnits(amount),
    href: `${root}/bots/${encodeURIComponent(bot.id)}/commerce/signals/${encodeURIComponent(signalId)}`,
  };
}
