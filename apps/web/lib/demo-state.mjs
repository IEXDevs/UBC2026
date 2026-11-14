import { createBuiltinTemplates } from '@ubc2026/contracts';
import { demoBotExperiences } from './bot-experience.mjs';

/** Placeholder shell chrome. Money panes stay empty; Agents/Overview/Security are real panes. */
export function panePlaceholder(name) {
  if (name === 'Overview') return { title: 'Overview', body: 'Owner metrics.' };
  if (name === 'Security') return { title: 'Security', body: 'Kill switch and freezes.' };
  return { title: name, body: 'Empty.' };
}

export function getDemoShellState() {
  const templates = createBuiltinTemplates();
  const experiences = demoBotExperiences();
  const bots = [
    {
      id: 'bot_meteora',
      name: 'Meteora bot',
      type: 'trading',
      status: 'watching',
      goal: 'Hunt stable LP APY and rotate into blue-chip stables on hourly checks.',
    },
    {
      id: 'bot_shop',
      name: 'Sandbox shopper',
      type: 'shopping',
      status: 'idle',
      goal: 'Compare x402 sandbox catalog items and wait for approval before buy.',
    },
    {
      id: 'bot_positions',
      name: 'Position guard',
      type: 'position-management',
      status: 'paused',
      goal: 'Monitor paper PnL on mainnet prices; alert on max-loss proximity.',
    },
  ].map(bot => ({ ...bot, experience: experiences[bot.id] }));
  return {
    product: 'Maelstrom',
    ownerId: null,
    panes: ['Overview', 'Agents', 'Payments', 'Positions', 'Wallets', 'Security'],
    bots,
    templates,
  };
}
