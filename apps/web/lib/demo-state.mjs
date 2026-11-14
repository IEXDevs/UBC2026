import { createBuiltinTemplates } from '@ubc2026/contracts';

/** Placeholder shell chrome. Pane bodies stay empty until later bot features. */
export function panePlaceholder(name) {
  return { title: name, body: 'Empty.' };
}

export function getDemoShellState() {
  const templates = createBuiltinTemplates();
  return {
    product: 'Maelstrom',
    ownerId: null,
    panes: ['Overview', 'Agents', 'Payments', 'Positions', 'Wallets', 'Security'],
    bots: [
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
    ],
    timeline: [
      { at: 'just now', summary: 'Trust gate cleared for SOL/USDC check' },
      { at: '2m ago', summary: 'Verify-agent matched price + mint (attempt 1)' },
      { at: '5m ago', summary: 'Firecrawl research: Meteora pool APY snapshot' },
    ],
    approvals: [
      { id: 'appr_1', title: 'Send 5 USDC to alex.sol', state: 'needs-preview' },
    ],
    templates,
  };
}
