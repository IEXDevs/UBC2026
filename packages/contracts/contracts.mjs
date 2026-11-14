/**
 * Shared Maelstrom data shapes for bots, wallets, events, and approvals.
 * Pure validators only — no I/O, no signing, no secrets.
 */

export class ContractError extends Error {}
const fail = message => { throw new ContractError(message); };

const idOk = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(value);
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
  'OPENROUTER_API_KEY',
  'FIRECRAWL_API_KEY',
  'QUICKNODE_DEVNET_RPC_URL',
  'QUICKNODE_WEBHOOK_SECRET',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_AGENT_ID',
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
  openrouter: Object.freeze(['OPENROUTER_API_KEY']),
  firecrawl: Object.freeze(['FIRECRAWL_API_KEY']),
  quicknode: Object.freeze(['QUICKNODE_DEVNET_RPC_URL']),
  quicknodeWebhook: Object.freeze(['QUICKNODE_WEBHOOK_SECRET']),
  elevenlabs: Object.freeze(['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID']),
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
export const API_ROUTES = Object.freeze([
  { id: 'health', method: 'GET', path: '/health', phase: 1, auth: 'none', status: 'live' },
  { id: 'routes.list', method: 'GET', path: '/api/routes', phase: 0, auth: 'none', status: 'live' },
  { id: 'me', method: 'GET', path: '/api/me', phase: 1, auth: 'privy', status: 'stub' },
  { id: 'wallets.list', method: 'GET', path: '/api/wallets', phase: 1, auth: 'privy', status: 'stub' },
  { id: 'wallets.create', method: 'POST', path: '/api/wallets', phase: 1, auth: 'privy', status: 'guarded' },
  { id: 'wallets.sign', method: 'POST', path: '/api/wallets/:walletId/sign', phase: 1, auth: 'privy', status: 'guarded' },
  { id: 'bots.list', method: 'GET', path: '/api/bots', phase: 1, auth: 'privy', status: 'stub' },
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
  { id: 'bots.browser.liveView', method: 'POST', path: '/bots/:botId/browser/sessions/:sessionRecordId/live-view', phase: 3, auth: 'owner', status: 'live', action: 'browser/live-view' },
  { id: 'bots.browser.release', method: 'POST', path: '/bots/:botId/browser/sessions/:sessionRecordId/release', phase: 3, auth: 'owner', status: 'live', action: 'browser/release' },
  { id: 'events.list', method: 'GET', path: '/api/events', phase: 1, auth: 'privy', status: 'stub' },
  { id: 'decisions.list', method: 'GET', path: '/api/decisions', phase: 1, auth: 'privy', status: 'stub' },
  { id: 'payments.list', method: 'GET', path: '/api/payments', phase: 1, auth: 'privy', status: 'stub' },
  { id: 'metrics.get', method: 'GET', path: '/api/metrics', phase: 1, auth: 'privy', status: 'stub' },
  { id: 'quicknode.webhook', method: 'POST', path: '/webhooks/quicknode', phase: 1, auth: 'webhook', status: 'live' },
  { id: 'cron.hourly', method: 'CRON', path: '0 * * * *', phase: 1, auth: 'platform', status: 'stub' },
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
