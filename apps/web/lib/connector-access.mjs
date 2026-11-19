/**
 * One shared connector set. Built-ins stay on. The owner connects the rest
 * once, and every agent, voice handoff, and subagent sees that set.
 */
import { COMPOSIO_APPS } from './composio-catalog.mjs';

const ID = /^[a-z0-9-]{1,64}$/;

export const BUILTIN_CONNECTORS = Object.freeze([
  Object.freeze({ id: 'solana', name: 'Solana', automatic: 'wallet' }),
  Object.freeze({ id: 'privy', name: 'Privy', automatic: 'wallet' }),
  Object.freeze({ id: 'firecrawl', name: 'Firecrawl', automatic: 'search' }),
  Object.freeze({ id: 'browser-run', name: 'Browser Run', automatic: 'browser' }),
  Object.freeze({ id: 'x402', name: 'x402', automatic: 'shopping' }),
]);

const SEARCH_PREFIX = Object.freeze({
  firecrawl: '',
  exa: '',
  hackernews: 'site:news.ycombinator.com ',
  reddit: 'site:reddit.com ',
  github: 'site:github.com ',
  vercel: 'site:vercel.com ',
  notion: 'site:notion.so ',
});

const CATALOG = new Map();
for (const row of BUILTIN_CONNECTORS) CATALOG.set(row.id, row);
for (const app of COMPOSIO_APPS) {
  const prefix = SEARCH_PREFIX[app.id];
  CATALOG.set(app.id, Object.freeze({
    id: app.id,
    name: app.name,
    automatic: prefix != null ? 'search' : 'listed',
    prefix: prefix || '',
  }));
}

export function connectorById(id) {
  return typeof id === 'string' ? CATALOG.get(id) || null : null;
}

/** Built-ins plus the owner links that match the catalog. Unknown ids are dropped. */
export function resolveDeskConnectors(linkedIds) {
  const extra = [];
  const seen = new Set(BUILTIN_CONNECTORS.map(row => row.id));
  const source = Array.isArray(linkedIds) ? linkedIds : [];
  for (const raw of source.slice(0, 40)) {
    const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!ID.test(id) || seen.has(id)) continue;
    const row = CATALOG.get(id);
    if (!row) continue;
    seen.add(id);
    extra.push(row);
  }
  return [...BUILTIN_CONNECTORS, ...extra];
}

export function connectorInstruction(connectors) {
  const rows = resolveDeskConnectors(connectors);
  const names = rows.map(row => `${row.name} (${row.id})`).join(', ');
  return [
    `Connected apps, shared by every agent and subagent: ${names}.`,
    'These stay on automatically. Do not ask the owner to connect an app that is already in this list.',
    'Use list_connectors to read them and use_connector to run one.',
    'A search or browser result is a real lookup. Do not say you posted, sent mail, or deployed unless that tool result says the action completed.',
  ].join('\n');
}

/**
 * Decide the automatic action for a connected app.
 * Returns `{ error }` when it is off, or `{ tool, args, connector, hint }`.
 */
export function planConnectorUse(linkedIds, args = {}) {
  const id = typeof args.connectorId === 'string' ? args.connectorId.trim().toLowerCase() : '';
  const row = connectorById(id);
  if (!row) return { error: 'unknown_connector' };
  const linked = resolveDeskConnectors(linkedIds);
  if (!linked.some(item => item.id === row.id)) {
    return {
      error: 'connector_off',
      connector: row.id,
      hint: `Connect ${row.name} on the connectors page.`,
    };
  }
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 300) : '';
  const url = typeof args.url === 'string' ? args.url.trim().slice(0, 300) : '';
  if (row.automatic === 'browser') {
    if (url.startsWith('https://')) {
      return { connector: row.id, tool: 'browser_open', args: { url, purpose: 'connector' }, hint: '' };
    }
    if (query) {
      return {
        connector: row.id,
        tool: 'web_search',
        args: { query },
        hint: 'Opened as a search because no https URL was given.',
      };
    }
  }
  if (row.automatic === 'search' || row.automatic === 'listed') {
    const prefix = row.prefix || '';
    const text = `${prefix}${query || row.name}`.trim();
    return {
      connector: row.id,
      tool: 'web_search',
      args: { query: text.slice(0, 300) },
      hint: row.automatic === 'listed'
        ? `${row.name} is connected. This lookup is the automatic action.`
        : '',
    };
  }
  return {
    connector: row.id,
    tool: null,
    args: {},
    hint: `${row.name} is connected. Wallet and payment actions still go through the permissioned tools.`,
  };
}
