/**
 * Shared Maelstrom data shapes for bots, wallets, events, and approvals.
 * Pure validators only — no I/O, no signing, no secrets.
 */

export class ContractError extends Error {}
const fail = message => { throw new ContractError(message); };

const idOk = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[a-zA-Z0-9:_.-]+$/.test(value);
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const amount = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) fail('Amounts must be unsigned integer strings in base units');
  return value;
};
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const pubkey = value => {
  if (!text(value, 64) || !base58.test(value)) fail('Invalid Solana pubkey');
  return value;
};

export const BOT_TYPES = Object.freeze(['trading', 'shopping', 'position-management']);
export const APPROVAL_MODES = Object.freeze(['fully-automatic', 'capped-automatic', 'ask']);
export const CLUSTERS = Object.freeze(['devnet', 'testnet']);
export const BUILTIN_TEMPLATES = Object.freeze(['trading', 'shopping', 'position-management']);

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

export function validateWallet(wallet) {
  if (!wallet || !idOk(wallet.id) || !idOk(wallet.ownerId) || !text(wallet.label, 64)) fail('Wallet id, owner, and label are required');
  if (!['main', 'additional'].includes(wallet.kind)) fail('Wallet kind must be main or additional');
  pubkey(wallet.address);
  if (typeof wallet.frozen !== 'boolean') fail('Wallet frozen flag is required');
  if (wallet.provider !== 'privy') fail('Only Privy wallets are supported');
  return wallet;
}

export function validateBotRecord(bot) {
  if (!bot || !idOk(bot.id) || !idOk(bot.ownerId) || !text(bot.name, 64) || !text(bot.goal, 4000)) fail('Bot identity, name, owner, and goal are required');
  if (!BOT_TYPES.includes(bot.type)) fail('A supported bot type is required');
  if (!APPROVAL_MODES.includes(bot.approvalMode)) fail('Approval mode must be fully-automatic, capped-automatic, or ask');
  if (bot.approvalMode === 'capped-automatic') amount(bot.autoApproveCap ?? '');
  if (!idOk(bot.walletId)) fail('Bot must be assigned a Privy wallet');
  if (typeof bot.enabled !== 'boolean' || typeof bot.frozen !== 'boolean') fail('Bot enabled/frozen flags are required');
  if (!Number.isSafeInteger(bot.policyVersion) || bot.policyVersion < 1) fail('Invalid policy version');
  if (bot.templateId != null && !idOk(bot.templateId)) fail('Invalid template id');
  const cap = bot.cap;
  if (!cap || !['limited', 'unlimited'].includes(cap.mode) || !text(cap.asset, 64)) fail('Explicit cap choice and accounting asset are required');
  if (cap.mode === 'limited') {
    if (bot.type === 'position-management') amount(cap.maxLoss);
    else { amount(cap.maxOutflow); amount(cap.maxPerTransaction); }
  }
  return bot;
}

export function validateSpendLedger(ledger) {
  if (!ledger || !idOk(ledger.botId) || !text(ledger.asset, 64)) fail('Spend ledger requires botId and asset');
  amount(ledger.spent);
  amount(ledger.reserved);
  amount(ledger.realizedLoss);
  return ledger;
}

export function validateDecisionRecord(record) {
  if (!record || !idOk(record.id) || !idOk(record.botId) || !idOk(record.runId)) fail('Decision record ids are required');
  if (!CLUSTERS.includes(record.cluster)) fail('Hackathon execution must use devnet or testnet');
  if (!text(record.factsDigest, 64) || !/^[a-f0-9]{64}$/.test(record.factsDigest)) fail('factsDigest must be sha256 hex');
  if (!text(record.proposalDigest, 64) || !/^[a-f0-9]{64}$/.test(record.proposalDigest)) fail('proposalDigest must be sha256 hex');
  if (!Number.isSafeInteger(record.createdAt) || record.createdAt <= 0) fail('createdAt is required');
  if (!['pending', 'approved', 'executed', 'rejected', 'mismatch'].includes(record.status)) fail('Invalid decision status');
  return record;
}

export function validateTimelineEvent(event) {
  if (!event || !idOk(event.id) || !idOk(event.botId) || !idOk(event.ownerId)) fail('Event id, botId, and ownerId are required');
  if (!EVENT_KINDS.includes(event.kind)) fail('Unknown event kind');
  if (!Number.isSafeInteger(event.at) || event.at <= 0) fail('Event timestamp is required');
  if (event.prevHash != null && (typeof event.prevHash !== 'string' || !/^[a-f0-9]{64}$/.test(event.prevHash))) fail('prevHash must be sha256 hex when set');
  if (typeof event.summary !== 'string' || event.summary.length > 500) fail('Event summary is required and must stay short');
  return event;
}

export function createBuiltinTemplates() {
  return BUILTIN_TEMPLATES.map(type => ({
    id: `builtin:${type}`,
    type,
    builtin: true,
    deletable: false,
    name: type === 'position-management' ? 'Position management' : type[0].toUpperCase() + type.slice(1),
    defaultApprovalMode: 'ask',
    defaultCap: type === 'position-management'
      ? { mode: 'limited', asset: 'USDC', maxLoss: '10000000' }
      : { mode: 'limited', asset: 'USDC', maxOutflow: '50000000', maxPerTransaction: '5000000' },
  }));
}

export function validatePayment(payment) {
  if (!payment || !idOk(payment.id) || !idOk(payment.botId)) fail('Payment id and botId are required');
  if (!['paid', 'earned'].includes(payment.direction)) fail('Payment direction must be paid or earned');
  if (payment.protocol !== 'x402') fail('Only x402 payments are supported');
  amount(payment.amount);
  if (!text(payment.asset, 64)) fail('Payment asset is required');
  if (!CLUSTERS.includes(payment.cluster)) fail('Hackathon execution must use devnet or testnet');
  if (payment.txSignature != null && (typeof payment.txSignature !== 'string' || payment.txSignature.length > 128)) {
    fail('Invalid transaction signature');
  }
  return payment;
}

const METRIC_COUNTS = Object.freeze([
  'decisions',
  'transactionsExecuted',
  'mismatchesCaught',
  'transactionsBlocked',
  'approvalsRequested',
  'approvalsGranted',
  'x402Payments',
]);

export function validateMetric(metric) {
  if (!metric || !idOk(metric.id) || !idOk(metric.ownerId)) fail('Metric id and ownerId are required');
  if (metric.botId != null && !idOk(metric.botId)) fail('Invalid metric botId');
  for (const key of METRIC_COUNTS) {
    if (!Number.isSafeInteger(metric[key]) || metric[key] < 0) fail(`Metric ${key} must be a non-negative integer`);
  }
  if (typeof metric.pnlMicroUsdc !== 'string' || !/^-?(0|[1-9][0-9]{0,39})$/.test(metric.pnlMicroUsdc)) {
    fail('pnlMicroUsdc must be an integer string');
  }
  return metric;
}

/**
 * Secret and config names only. Values stay in the environment / Wrangler secrets.
 * Never commit credentials.
 */
export const SECRET_NAMES = Object.freeze([
  'PRIVY_APP_ID',
  'PRIVY_APP_SECRET',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'META_MODEL_API_KEY',
  'OPENROUTER_API_KEY',
  'FIRECRAWL_API_KEY',
  'QUICKNODE_DEVNET_RPC_URL',
  'QUICKNODE_TESTNET_RPC_URL',
  'QUICKNODE_WEBHOOK_SECRET',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_AGENT_ID',
  'ELEVENLABS_WEBHOOK_SECRET',
]);

export const PUBLIC_CONFIG_NAMES = Object.freeze([
  'NEXT_PUBLIC_PRIVY_APP_ID',
  'NEXT_PUBLIC_AGENT_RUNTIME_URL',
]);

export const SECRET_GROUPS = Object.freeze({
  privy: Object.freeze(['PRIVY_APP_ID', 'PRIVY_APP_SECRET']),
  privyClient: Object.freeze(['NEXT_PUBLIC_PRIVY_APP_ID']),
  supabase: Object.freeze(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']),
  supabaseClient: Object.freeze(['SUPABASE_URL', 'SUPABASE_ANON_KEY']),
  cloudflare: Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']),
  metaModel: Object.freeze(['META_MODEL_API_KEY']),
  openrouter: Object.freeze(['OPENROUTER_API_KEY']),
  firecrawl: Object.freeze(['FIRECRAWL_API_KEY']),
  quicknode: Object.freeze(['QUICKNODE_DEVNET_RPC_URL']),
  quicknodeTestnet: Object.freeze(['QUICKNODE_TESTNET_RPC_URL']),
  quicknodeWebhook: Object.freeze(['QUICKNODE_WEBHOOK_SECRET']),
  elevenlabs: Object.freeze(['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_WEBHOOK_SECRET']),
  serverSigning: Object.freeze(['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'QUICKNODE_DEVNET_RPC_URL']),
});

export class ConfigError extends Error {
  constructor(missing) {
    super(`Missing configuration: ${missing.join(', ')}. Set these names in the environment. Do not commit values.`);
    this.name = 'ConfigError';
    this.code = 'missing_secrets';
    this.missing = [...missing];
  }
}

export function readConfig(env, names) {
  const source = env ?? {};
  const values = {};
  const missing = [];
  for (const name of names) {
    const value = source[name];
    if (typeof value !== 'string' || value.trim() === '') missing.push(name);
    else values[name] = value;
  }
  return { ok: missing.length === 0, values, missing };
}

export function requireConfig(env, names) {
  const result = readConfig(env, names);
  if (!result.ok) throw new ConfigError(result.missing);
  return result.values;
}

/**
 * HTTP and cron contracts shared by the Worker and the web app.
 * status: live (implemented skeleton), guarded (calls out only when secrets exist), stub (empty until a later phase).
 */
const HANDLE = /^[a-z0-9][a-z0-9_]{1,31}$/;
const SNS_NAME = /^[a-z0-9][a-z0-9-]{0,62}\.sol$/;

export function httpsAvatarUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.href;
}

export function privyAvatarUrl(user) {
  const linked = Array.isArray(user?.linkedAccounts) ? user.linkedAccounts : [];
  const candidates = [
    user?.twitter?.profilePictureUrl,
    user?.farcaster?.pfp,
    user?.farcaster?.profilePictureUrl,
    user?.google?.picture,
    user?.github?.profilePictureUrl,
    ...linked.map(account => account?.profilePictureUrl || account?.pfp || account?.picture),
  ];
  for (const candidate of candidates) {
    const url = httpsAvatarUrl(candidate);
    if (url) return url;
  }
  return null;
}

export function normalizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 64 || /[\r\n]/.test(name)) return null;
  return name;
}

export function normalizeHandle(value) {
  if (typeof value !== 'string') return null;
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) return null;
  return handle;
}

/** `@alex` is a Maelstrom handle. `@richclub.sol` is an SNS name. */
export function parseRecipient(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim().replace(/^@/, '');
  if (!token || token.length > 80) return null;
  if (SNS_NAME.test(token.toLowerCase())) return { kind: 'sns', domain: token.toLowerCase() };
  const handle = normalizeHandle(token);
  if (handle) return { kind: 'handle', handle };
  return null;
}

export function profileInitials(label) {
  const text = typeof label === 'string' ? label.trim().replace(/^@/, '') : '';
  if (!text) return '?';
  const parts = text.split(/[\s@.]+/).filter(Boolean);
  const letters = `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`;
  return (letters || text[0]).toUpperCase();
}

export const API_ROUTES = Object.freeze([
  { id: 'health', method: 'GET', path: '/health', phase: 1, auth: 'none', status: 'live' },
  { id: 'routes.list', method: 'GET', path: '/api/routes', phase: 0, auth: 'none', status: 'live' },
  { id: 'me', method: 'GET', path: '/api/me', phase: 1, auth: 'privy', status: 'live' },
  { id: 'wallets.list', method: 'GET', path: '/api/wallets', phase: 1, auth: 'privy', status: 'live' },
  { id: 'wallets.create', method: 'POST', path: '/api/wallets', phase: 1, auth: 'privy', status: 'live' },
  { id: 'wallets.persist', method: 'POST', path: '/api/wallets/persist', phase: 1, auth: 'privy', status: 'live' },
  { id: 'wallets.sign', method: 'POST', path: '/api/wallets/:walletId/sign', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.list', method: 'GET', path: '/api/bots', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.create', method: 'POST', path: '/api/bots', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.delete', method: 'DELETE', path: '/api/bots/:botId', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.chat', method: 'POST', path: '/api/bots/:botId/chat', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.status', method: 'GET', path: '/bots/:botId/status', phase: 1, auth: 'none', status: 'live', action: 'status' },
  { id: 'bots.status.root', method: 'GET', path: '/bots/:botId', phase: 1, auth: 'none', status: 'live', action: 'status' },
  { id: 'bots.wake', method: 'POST', path: '/bots/:botId/wake', phase: 1, auth: 'none', status: 'live', action: 'wake' },
  { id: 'bots.pause', method: 'POST', path: '/bots/:botId/pause', phase: 1, auth: 'none', status: 'live', action: 'pause' },
  { id: 'bots.resume', method: 'POST', path: '/bots/:botId/resume', phase: 1, auth: 'none', status: 'live', action: 'resume' },
  { id: 'bots.advance', method: 'POST', path: '/bots/:botId/advance', phase: 1, auth: 'none', status: 'live', action: 'advance' },
  { id: 'bots.decide', method: 'POST', path: '/bots/:botId/decide', phase: 1, auth: 'none', status: 'live', action: 'decide' },
  { id: 'bots.loop', method: 'POST', path: '/bots/:botId/loop', phase: 4, auth: 'owner', status: 'live', action: 'loop' },
  { id: 'bots.browser.list', method: 'GET', path: '/bots/:botId/browser/sessions', phase: 3, auth: 'owner', status: 'live', action: 'browser/sessions' },
  { id: 'bots.browser.open', method: 'POST', path: '/bots/:botId/browser/sessions', phase: 3, auth: 'owner', status: 'live', action: 'browser/sessions' },
  { id: 'bots.browser.navigate', method: 'POST', path: '/bots/:botId/browser/sessions/:sessionRecordId/navigate', phase: 3, auth: 'owner', status: 'live', action: 'browser/navigate' },
  { id: 'bots.browser.liveView', method: 'POST', path: '/bots/:botId/browser/sessions/:sessionRecordId/live-view', phase: 3, auth: 'owner', status: 'live', action: 'browser/live-view' },
  { id: 'bots.browser.release', method: 'POST', path: '/bots/:botId/browser/sessions/:sessionRecordId/release', phase: 3, auth: 'owner', status: 'live', action: 'browser/release' },
  { id: 'bots.shopping.prepare', method: 'POST', path: '/bots/:botId/shopping/prepare', phase: 6, auth: 'owner', status: 'live' },
  { id: 'bots.shopping.settle', method: 'POST', path: '/bots/:botId/shopping/settle', phase: 6, auth: 'owner', status: 'live' },
  { id: 'bots.commerce.signal', method: 'GET', path: '/bots/:botId/commerce/signals/:signalId', phase: 6, auth: 'none', status: 'live' },
  { id: 'bots.commerce.signal.settle', method: 'POST', path: '/bots/:botId/commerce/signals/:signalId/settle', phase: 6, auth: 'none', status: 'live' },
  { id: 'bots.sns.send', method: 'POST', path: '/bots/:botId/sns/send', phase: 6, auth: 'owner', status: 'live' },
  { id: 'security.grab-back', method: 'POST', path: '/security/grab-back', phase: 6, auth: 'owner', status: 'live' },
  { id: 'events.list', method: 'GET', path: '/api/events', phase: 1, auth: 'privy', status: 'live' },
  { id: 'logs.list', method: 'GET', path: '/api/logs', phase: 1, auth: 'privy', status: 'live' },
  { id: 'decisions.list', method: 'GET', path: '/api/decisions', phase: 1, auth: 'privy', status: 'live' },
  { id: 'payments.list', method: 'GET', path: '/api/payments', phase: 1, auth: 'privy', status: 'live' },
  { id: 'metrics.get', method: 'GET', path: '/api/metrics', phase: 1, auth: 'privy', status: 'live' },
  { id: 'profiles.me', method: 'GET', path: '/api/profiles/me', phase: 1, auth: 'privy', status: 'live' },
  { id: 'profiles.update', method: 'PUT', path: '/api/profiles/me', phase: 1, auth: 'privy', status: 'live' },
  { id: 'profiles.lookup', method: 'GET', path: '/api/profiles/lookup', phase: 1, auth: 'privy', status: 'live' },
  { id: 'transfers.list', method: 'GET', path: '/api/transfers', phase: 1, auth: 'privy', status: 'live' },
  { id: 'transfers.create', method: 'POST', path: '/api/transfers', phase: 1, auth: 'privy', status: 'live' },
  { id: 'quicknode.webhook', method: 'POST', path: '/webhooks/quicknode', phase: 1, auth: 'webhook', status: 'live' },
  { id: 'voice.agent', method: 'GET', path: '/voice/agent', phase: 8, auth: 'none', status: 'live' },
  { id: 'voice.session-owner', method: 'POST', path: '/voice/session-owner', phase: 8, auth: 'webhook', status: 'live' },
  { id: 'voice.tools', method: 'POST', path: '/voice/tools/:name', phase: 8, auth: 'webhook', status: 'live' },
  { id: 'voice.llm', method: 'POST', path: '/voice/llm/chat/completions', phase: 8, auth: 'webhook', status: 'live' },
  { id: 'cron.hourly', method: 'CRON', path: '0 * * * *', phase: 5, auth: 'platform', status: 'live' },
  { id: 'cron.stream-fallback', method: 'CRON', path: '5,20,35,50 * * * *', phase: 5, auth: 'platform', status: 'live' },
]);

function pathRegex(path) {
  const names = [];
  const source = path.split('/').map(part => {
    if (part.startsWith(':')) {
      names.push(part.slice(1));
      return '([^/]+)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${source}$`), names };
}

export function matchApiRoute(method, pathname) {
  if (typeof method !== 'string' || typeof pathname !== 'string' || method === 'CRON') return null;
  for (const route of API_ROUTES) {
    if (route.method === 'CRON' || route.method !== method) continue;
    const { regex, names } = pathRegex(route.path);
    const match = regex.exec(pathname);
    if (!match) continue;
    const params = {};
    names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });
    return { route, params };
  }
  return null;
}
