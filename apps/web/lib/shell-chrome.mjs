import { composioConnectors, composioLogo } from './composio-catalog.mjs';

/** Dock panes. Not account data. */
export const SHELL_PANES = Object.freeze(['Main', 'Positions', 'History']);

/** Built-in demo agents. A saved roster must not bring these back. */
export const PLACEHOLDER_BOT_IDS = Object.freeze(['bot_meteora', 'bot_shop', 'bot_positions']);

const PLACEHOLDER_IDS = new Set(PLACEHOLDER_BOT_IDS);

export function isPlaceholderBotId(id) {
  return PLACEHOLDER_IDS.has(id);
}

export function withoutPlaceholderBots(roster) {
  const order = Array.isArray(roster?.order) ? roster.order : [];
  const extra = Array.isArray(roster?.extra) ? roster.extra : [];
  return {
    order: order.filter(id => !isPlaceholderBotId(id)),
    extra: extra.filter(bot => !isPlaceholderBotId(bot?.id)),
  };
}

/** Plugin catalog. Builtin rows are product connectors, not sample accounts. */
export function shellConnectors() {
  return [
    { id: 'solana', name: 'Solana', detail: 'Devnet only. Mainnet execution stays off.', category: 'Chain', popular: true, builtin: true, linked: true },
    { id: 'privy', name: 'Privy', detail: 'Owner sign-in and the agent wallet.', category: 'Identity', popular: true, builtin: true, linked: true },
    { id: 'firecrawl', name: 'Firecrawl', detail: 'Research pages for the decision loop.', category: 'Research', popular: true, builtin: true, linked: true, logo: composioLogo('firecrawl') },
    { id: 'browser-run', name: 'Browser Run', detail: 'Cloudflare browser session for the live view.', category: 'Research', popular: true, builtin: true, linked: true },
    { id: 'x402', name: 'x402', detail: 'Paid fetches. A spend still needs approval.', category: 'Payments', popular: true, builtin: true, linked: true },
    ...composioConnectors(),
  ];
}
