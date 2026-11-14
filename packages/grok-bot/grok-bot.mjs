/**
 * Grok Bot on X: draft posts for notable Solana devnet events, and export the chat.
 * This module does not read credentials and does not call the network.
 * Live posting stays withheld until an X secret exists outside this build.
 */

export class GrokBotError extends Error {}

const fail = message => {
  throw new GrokBotError(message);
};

const ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const POST_LIMIT = 280;
const MAX_POSTS = 20;

/** Timeline kinds from @ubc2026/contracts. Only the on-chain subset is postable. */
export const EVENT_KINDS = Object.freeze([
  'bot.created',
  'bot.enabled',
  'bot.paused',
  'bot.frozen',
  'bot.unfrozen',
  'wallet.frozen',
  'wallet.unfrozen',
  'run.checkpoint',
  'tool.call',
  'trust.gate',
  'verify.attempt',
  'verify.settled',
  'verify.mismatch',
  'approval.requested',
  'approval.granted',
  'approval.consumed',
  'budget.reserved',
  'budget.spent',
  'payment.x402',
  'tx.submitted',
  'tx.confirmed',
  'kill.stop-all',
  'funds.grabbed',
]);

export const NOTABLE_ONCHAIN_KINDS = Object.freeze([
  'tx.confirmed',
  'payment.x402',
  'funds.grabbed',
  'kill.stop-all',
]);

const KIND_LABEL = Object.freeze({
  'tx.confirmed': 'transaction confirmed',
  'payment.x402': 'x402 payment settled',
  'funds.grabbed': 'funds grabbed back',
  'kill.stop-all': 'stop-all memo landed',
});

/** Compact rows from QuickNode Streams (`packages/quicknode-streams`). `unknown` is not posted. */
export const STREAM_EVENT_TYPES = Object.freeze(['deposit', 'withdrawal', 'x402-in', 'x402-out', 'memo', 'swap', 'unknown']);

const STREAM_LABEL = Object.freeze({
  deposit: 'deposit landed',
  withdrawal: 'withdrawal confirmed',
  'x402-in': 'x402 payment received',
  'x402-out': 'x402 payment settled',
  memo: 'on-chain memo landed',
  swap: 'swap confirmed',
});

const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const CLUSTERS = new Set(['devnet', 'testnet', 'mainnet']);
const EXECUTION_CLUSTERS = new Set(['devnet', 'testnet']);

const SECRET_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*)=([^\s'"]+)/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi;
const TOKENISH = /\b(?:sk|xai|rk|pk)_[A-Za-z0-9_-]{8,}\b/g;
const WALLET_AUTH = /\bwallet-auth:[A-Za-z0-9+/=_-]{8,}/g;

/**
 * Four sentences for the bounty README and the top of every chat export.
 * Grok Bot drafts on-chain posts and keeps the chat record. It does not post live.
 */
export const GROK_BOT_ROLE = [
  'Grok Bot on X watches Maelstrom\'s notable Solana devnet activity: confirmed transactions, settled x402 payments, fund grab-backs, and stop-all memos.',
  'Each notable event becomes a post draft with an explorer link, and that draft stays off the network because this build does not read an X credential or send a request.',
  'The chat that reviewed those drafts exports to JSON and Markdown, and secret-shaped strings are removed before the file is written.',
  'Grok Bot is the part of Maelstrom that surfaces on-chain activity and keeps the chat record for the bounty.',
].join(' ');

export function redactSecrets(value) {
  if (typeof value !== 'string') fail('Text is required');
  return value
    .replace(SECRET_ASSIGNMENT, '$1=[redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(TOKENISH, '[redacted]')
    .replace(WALLET_AUTH, '[redacted]');
}

function formatUsdc(amount) {
  const whole = BigInt(amount);
  const scale = 1_000_000n;
  const major = whole / scale;
  const minor = (whole % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return minor ? `${major}.${minor} USDC` : `${major} USDC`;
}

function moneyLabel(event) {
  if (event.asset !== 'USDC' || event.amount == null) return '';
  return ` (${formatUsdc(event.amount)})`;
}

function explorerUrl(signature, cluster) {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

function assertEvent(event) {
  if (!event || typeof event !== 'object') fail('Event is required');
  if (typeof event.id !== 'string' || !ID.test(event.id)) fail('Event id is required');
  if (typeof event.botId !== 'string' || !ID.test(event.botId)) fail('Event botId is required');
  if (!EVENT_KINDS.includes(event.kind)) fail('Unknown event kind');
  if (!Number.isSafeInteger(event.at) || event.at <= 0) fail('Event timestamp is required');
  if (typeof event.summary !== 'string' || event.summary.length < 1 || event.summary.length > 500) {
    fail('Event summary is required and must stay short');
  }
  if (event.cluster != null && !CLUSTERS.has(event.cluster)) fail('Unknown cluster');
  if (event.signature != null && (typeof event.signature !== 'string' || !SIG.test(event.signature))) {
    fail('Invalid transaction signature');
  }
  if (event.botName != null) {
    if (typeof event.botName !== 'string' || event.botName.length < 1 || event.botName.length > 64 || /[\r\n]/.test(event.botName)) {
      fail('Invalid bot name');
    }
  }
  if (event.amount != null && (typeof event.amount !== 'string' || !AMOUNT.test(event.amount))) {
    fail('Amount must be an unsigned integer string');
  }
  if (event.asset != null && (typeof event.asset !== 'string' || event.asset.length < 1 || event.asset.length > 32 || /[\r\n]/.test(event.asset))) {
    fail('Invalid asset');
  }
}

function skipReason(event) {
  if (!NOTABLE_ONCHAIN_KINDS.includes(event.kind)) return 'not_notable';
  if (typeof event.signature !== 'string') return 'missing_signature';
  if (!EXECUTION_CLUSTERS.has(event.cluster)) return 'wrong_cluster';
  return null;
}

function isStreamRow(event) {
  return Boolean(event && typeof event === 'object' && event.kind == null && typeof event.type === 'string');
}

function streamAsset(token, amount) {
  if (amount == null) return { asset: null, amount: null };
  if (token === 'USDC' || token === DEVNET_USDC_MINT) return { asset: 'USDC', amount };
  return { asset: null, amount: null };
}

function normalizeStreamRow(raw) {
  if (typeof raw.signature !== 'string' || !SIG.test(raw.signature)) fail('Invalid transaction signature');
  if (typeof raw.wallet !== 'string' || !PUBKEY.test(raw.wallet)) fail('Invalid wallet');
  if (!STREAM_EVENT_TYPES.includes(raw.type)) fail('Unknown stream event type');
  if (raw.amount != null && (typeof raw.amount !== 'string' || !AMOUNT.test(raw.amount))) {
    fail('Amount must be an unsigned integer string');
  }
  if (raw.token != null && (typeof raw.token !== 'string' || raw.token.length < 1 || raw.token.length > 64 || /[\r\n]/.test(raw.token))) {
    fail('Invalid token');
  }
  const cluster = raw.cluster ?? 'devnet';
  if (!CLUSTERS.has(cluster)) fail('Unknown cluster');
  if (raw.botId != null && (typeof raw.botId !== 'string' || !ID.test(raw.botId))) fail('Invalid bot id');
  if (!STREAM_LABEL[raw.type] || !EXECUTION_CLUSTERS.has(cluster)) return null;
  const at = Number.isSafeInteger(raw.at) && raw.at > 0
    ? raw.at
    : (Number.isSafeInteger(raw.slot) && raw.slot > 0 ? raw.slot : 1);
  const id = raw.id == null ? `s_${raw.signature.slice(0, 40)}` : raw.id;
  if (typeof id !== 'string' || !ID.test(id)) fail('Event id is required');
  const { asset, amount } = streamAsset(raw.token, raw.amount ?? null);
  const botName = raw.botName
    ?? (raw.botId ? null : `${raw.wallet.slice(0, 4)}…${raw.wallet.slice(-4)}`);
  const summary = typeof raw.summary === 'string' && raw.summary.length > 0
    ? raw.summary
    : `${STREAM_LABEL[raw.type]} for ${raw.wallet}`;
  if (summary.length > 500) fail('Event summary is required and must stay short');
  return {
    id,
    botId: raw.botId ?? raw.wallet,
    botName,
    kind: raw.type,
    label: STREAM_LABEL[raw.type],
    cluster,
    signature: raw.signature,
    summary,
    at,
    asset,
    amount,
  };
}

function draftText(event) {
  const url = explorerUrl(event.signature, event.cluster);
  const label = event.label ?? KIND_LABEL[event.kind];
  let name = redactSecrets((event.botName ?? event.botId).trim());
  let prose = redactSecrets(event.summary).replace(/\s+/g, ' ').trim();
  let extra = moneyLabel(event);
  const compose = () => {
    const head = `Maelstrom on Solana ${event.cluster}: ${name} — ${label}${extra}.`;
    return prose ? `${head} ${prose}\n${url}` : `${head}\n${url}`;
  };
  let text = compose();
  let guard = 0;
  while (text.length > POST_LIMIT && guard < 40) {
    if (prose.length > 0) {
      const next = prose.slice(0, Math.max(0, prose.length - 16)).trimEnd().replace(/\s+\S*$/, '');
      prose = next.length > 0 && next.length < prose.length ? `${next}…` : '';
    } else if (extra) {
      extra = '';
    } else if (name.length > 16) {
      name = `${name.slice(0, 16).trimEnd()}…`;
    } else {
      break;
    }
    text = compose();
    guard += 1;
  }
  if (text.length > POST_LIMIT) fail('Post draft exceeds 280 characters');
  return text;
}

/**
 * Keep the newest notable devnet/testnet events that carry a signature.
 * Returns them oldest-first, capped at 20. Does not post.
 */
export function selectNotableOnchainEvents(events) {
  if (!Array.isArray(events)) fail('Events must be an array');
  const bySignature = new Map();
  for (const raw of events) {
    const event = isStreamRow(raw) ? normalizeStreamRow(raw) : (() => {
      assertEvent(raw);
      if (skipReason(raw)) return null;
      return raw;
    })();
    if (!event) continue;
    const previous = bySignature.get(event.signature);
    if (previous && (previous.at > event.at || (previous.at === event.at && previous.id <= event.id))) continue;
    bySignature.set(event.signature, event);
  }
  return [...bySignature.values()]
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
    .slice(0, MAX_POSTS)
    .reverse();
}

/**
 * Post payload for notable on-chain events. delivery is always offline.
 * networkCalls is always 0. No fetch client lives in this module.
 */
export function prepareNotablePosts(events) {
  const posts = selectNotableOnchainEvents(events).map(event => ({
    eventId: event.id,
    botId: event.botId,
    kind: event.kind,
    cluster: event.cluster,
    signature: event.signature,
    text: draftText(event),
    delivered: false,
  }));
  return {
    destination: 'x',
    delivery: 'offline',
    networkCalls: 0,
    reason: 'live_x_withheld',
    posts,
  };
}

const ROLES = new Set(['user', 'assistant', 'tool']);

function assertChat(chat) {
  if (!chat || typeof chat !== 'object') fail('Chat is required');
  if (typeof chat.id !== 'string' || !ID.test(chat.id)) fail('Chat id is required');
  if (typeof chat.title !== 'string' || chat.title.length < 1 || chat.title.length > 200 || /[\r\n]/.test(chat.title)) {
    fail('Chat title is required');
  }
  if (!Number.isSafeInteger(chat.exportedAt) || chat.exportedAt <= 0) fail('exportedAt is required');
  if (!Array.isArray(chat.messages) || chat.messages.length < 1 || chat.messages.length > 200) {
    fail('Chat needs between 1 and 200 messages');
  }
  for (const message of chat.messages) {
    if (!message || typeof message !== 'object') fail('Message is required');
    if (typeof message.id !== 'string' || !ID.test(message.id)) fail('Message id is required');
    if (!ROLES.has(message.role)) fail('Message role must be user, assistant, or tool');
    if (!Number.isSafeInteger(message.at) || message.at <= 0) fail('Message timestamp is required');
    if (typeof message.text !== 'string' || message.text.length < 1 || message.text.length > 8000) {
      fail('Message text is required and must stay within 8000 characters');
    }
  }
}

function stamp(at) {
  return new Date(at).toISOString();
}

function toMarkdown(exported) {
  const lines = [
    '# Grok Bot chat export',
    '',
    exported.role,
    '',
    `- id: ${exported.id}`,
    `- title: ${exported.title}`,
    `- exportedAt: ${stamp(exported.exportedAt)}`,
    `- messages: ${exported.messageCount}`,
    '',
  ];
  for (const message of exported.messages) {
    lines.push(`## ${message.role} · ${stamp(message.at)}`, '', message.text, '');
  }
  return lines.join('\n');
}

/**
 * Export a Grok Bot chat. format is json (default), markdown, or both.
 * Secret-shaped strings are removed from titles and message text.
 */
export function exportGrokChat(chat, { format = 'json' } = {}) {
  if (!['json', 'markdown', 'both'].includes(format)) fail('Export format must be json, markdown, or both');
  assertChat(chat);
  const messages = chat.messages.map(message => ({
    id: message.id,
    role: message.role,
    at: message.at,
    text: redactSecrets(message.text),
  }));
  const exported = {
    schema: 'maelstrom.grok-chat-export.v1',
    product: 'Maelstrom',
    role: GROK_BOT_ROLE,
    id: chat.id,
    title: redactSecrets(chat.title),
    exportedAt: chat.exportedAt,
    messageCount: messages.length,
    messages,
  };
  if (format === 'markdown' || format === 'both') exported.markdown = toMarkdown(exported);
  if (format === 'markdown') {
    return { schema: exported.schema, format: 'markdown', markdown: exported.markdown };
  }
  return exported;
}
