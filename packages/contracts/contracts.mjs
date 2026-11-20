import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
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
export const CLUSTERS = Object.freeze([SOLANA_CLUSTER]);
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
  if (!CLUSTERS.includes(record.cluster)) fail('Execution must use the configured Solana cluster');
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
  if (!CLUSTERS.includes(payment.cluster)) fail('Execution must use the configured Solana cluster');
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
  'SOLANA_RPC_URL',
  'QUICKNODE_MAINNET_RPC_URL',
  'QUICKNODE_TESTNET_RPC_URL',
  'QUICKNODE_WEBHOOK_SECRET',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_AGENT_ID',
  'ELEVENLABS_WEBHOOK_SECRET',
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN',
]);

export const PUBLIC_CONFIG_NAMES = Object.freeze([
  'NEXT_PUBLIC_SOLANA_CLUSTER',
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
  quicknode: Object.freeze(['SOLANA_RPC_URL']),
  quicknodePortfolio: Object.freeze(['QUICKNODE_MAINNET_RPC_URL']),
  quicknodeTestnet: Object.freeze(['QUICKNODE_TESTNET_RPC_URL']),
  quicknodeWebhook: Object.freeze(['QUICKNODE_WEBHOOK_SECRET']),
  elevenlabs: Object.freeze(['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_WEBHOOK_SECRET']),
  googleDrive: Object.freeze(['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN']),
  serverSigning: Object.freeze(['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'SOLANA_RPC_URL']),
});

/** OpenRouter fallback. The id ends with :free so a low-balance key is not billed. */
export const OPENROUTER_FREE_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';

function isZeroModelPrice(value) {
  if (typeof value === 'number') return Object.is(value, 0);
  if (typeof value !== 'string') return false;
  return /^0(?:\.0+)?$/.test(value.trim());
}

/**
 * OpenRouter may bill only a free model: an id ending in `:free`, or a
 * pricing object whose listed amounts are all zero.
 */
export function isFreeOpenRouterModel(modelId, pricing) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id || id.length > 128) return false;
  if (id.endsWith(':free')) return true;
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) return false;
  const amounts = Object.values(pricing).filter(value => value != null && value !== '');
  if (amounts.length === 0) return false;
  return amounts.every(isZeroModelPrice);
}

/**
 * Keep a free OpenRouter id. A paid id is skipped in favor of `fallback`.
 * Returns null when neither id is free, so the caller can reject the call.
 */
export function selectFreeOpenRouterModel(modelId, { pricing, fallback = OPENROUTER_FREE_MODEL, fallbackPricing } = {}) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (isFreeOpenRouterModel(id, pricing)) return id;
  const next = typeof fallback === 'string' ? fallback.trim() : '';
  if (isFreeOpenRouterModel(next, fallbackPricing)) return next;
  return null;
}

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

/** Public recipient names can come from older profiles that used an email as the label. */
export function publicDisplayName(value) {
  const name = normalizeDisplayName(value);
  return name && !/[^\s@]+@[^\s@]+/.test(name) ? name : null;
}

export function normalizeHandle(value) {
  if (typeof value !== 'string') return null;
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) return null;
  return handle;
}

/**
 * PostgREST `eq` filter. Quotes are part of the value for `eq`, not delimiters,
 * so `eq."did:privy:…"` matches nothing. Percent-encode the raw value so a
 * colon in a Privy DID stays inside it.
 */
export function postgrestEq(column, value) {
  if (typeof column !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(column)) return '';
  return `${column}=eq.${encodeURIComponent(String(value ?? ''))}`;
}

/** SQLSTATE / PGRST code, else the HTTP status. Never the provider message. */
export function directoryFailureCode(status, parsed) {
  const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.code === 'string'
    ? parsed.code
    : '';
  if (/^[0-9A-Z]{5}$/.test(raw) || /^PGRST[0-9]{3}$/.test(raw)) return raw;
  if (Number.isInteger(status) && status >= 400 && status <= 599) return `supabase_http_${status}`;
  return '';
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

const LOOKUP_SKIP = new Set([
  'a', 'an', 'the', 'up', 'look', 'lookup', 'find', 'for', 'me', 'my', 'please',
  'what', 'whats', 'is', 'can', 'you', 'show', 'check', 'who', 'send', 'to', 'of',
  'and', 'their', 'his', 'her', 'hey', 'hi', 'wallet', 'handle', 'address', 'user',
  'profile', 'name', 'about', 'with', 'from', 'this', 'that', 'just', 'like', 'do',
  'does', 'has', 'have', 'on', 'in', 'at', 'it', 'its', 'get', 'tell', 'where',
  'which', 'your', 'our', 'them', 'him', 'pay', 'money', 'usdc', 'solana',
  'maelstrom', 'account',
]);

/** Words that end a spoken name. "the" can still sit inside the name. */
const HANDLE_CLOSERS = new Set([
  'please', 'thanks', 'thank', 'wallet', 'address', 'handle', 'account', 'for',
  'to', 'send', 'me', 'my', 'now', 'today', 'ok', 'okay', 'and', 'then', 'so',
  'their', 'his', 'her', 'its', 'on', 'in', 'with', 'from', 'about', 'of',
  'show', 'check', 'what', 'whats', 'is', 'can', 'you', 'who', 'just',
  'pay', 'money', 'usdc',
]);

function lookupWords(text) {
  return text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Keep the spoken name, then stop when the sentence turns back into a request. */
function takeSpokenName(words) {
  const kept = [];
  for (const word of words) {
    if (HANDLE_CLOSERS.has(word)) break;
    kept.push(word);
    if (kept.length === 5) break;
  }
  const meaningful = kept.filter(word => word !== 'the' && word !== 'a' && word !== 'an');
  if (meaningful.length === 0) return '';
  const handle = kept.join('');
  return /^[a-z0-9]{2,32}$/.test(handle) ? handle : '';
}

/** Letters and numbers only, for a lookup. Underscores and other marks drop out. */
export function lookupHandleKey(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A lookup can be a sentence. Pull out a .sol name or a handle and keep only
 * letters and numbers on the handle. A bare send token still uses parseRecipient.
 */
export function parseLookupQuery(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 240) return null;
  const bareHandle = normalizeHandle(raw);
  if (bareHandle) return { kind: 'handle', handle: lookupHandleKey(bareHandle) };
  const lower = raw.toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '');
  const sns = lower.match(/\b([a-z0-9][a-z0-9-]{0,62}\.sol)\b/);
  if (sns && SNS_NAME.test(sns[1])) return { kind: 'sns', domain: sns[1] };
  const at = lower.match(/@([\s\S]+)$/);
  if (at) {
    const handle = takeSpokenName(lookupWords(at[1]));
    if (handle) return { kind: 'handle', handle };
  }
  const spokenAt = lower.match(/(?:^|\s)at\s+([a-z0-9][\s\S]*)$/);
  if (spokenAt) {
    const handle = takeSpokenName(lookupWords(spokenAt[1]));
    if (handle) return { kind: 'handle', handle };
  }
  const words = lookupWords(lower);
  let start = 0;
  while (start < words.length && LOOKUP_SKIP.has(words[start])) start += 1;
  const handle = takeSpokenName(words.slice(start));
  if (handle) return { kind: 'handle', handle };
  return null;
}

/** Exact handle, or the same letters and numbers with weird marks between them. */
export function lookupHandleFilter(handle) {
  if (!/^[a-z0-9]{2,32}$/.test(handle)) return '';
  const pattern = `^${handle.split('').join('[^a-z0-9]*')}$`;
  return `or=(handle.eq.${encodeURIComponent(handle)},handle.imatch.${encodeURIComponent(pattern)})`;
}

export function profileInitials(label) {
  const text = typeof label === 'string' ? label.trim().replace(/^@/, '') : '';
  if (!text) return '?';
  const parts = text.split(/[\s@.]+/).filter(Boolean);
  const letters = `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`;
  return (letters || text[0]).toUpperCase();
}

export const OWNER_SPEND_PERMISSIONS = Object.freeze(['ask', 'review', 'full']);
export const FUND_ACTIONS = Object.freeze(['buy', 'sell', 'spend', 'pay']);
export const PERMISSIONED_SPEND_PATH = '/api/spend';

export function parseSpendAuthorization(value) {
  if (!value || typeof value !== 'object') return null;
  const { blockhash, expiresAt, proof } = value;
  if (typeof blockhash !== 'string' || !base58.test(blockhash)
    || !Number.isSafeInteger(expiresAt) || expiresAt <= 0
    || typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return null;
  return { blockhash, expiresAt, proof };
}

export function parseSpendAuthorizationChallenge(value) {
  const binding = parseSpendAuthorization(value);
  const payload = value?.payload;
  if (!binding || typeof payload !== 'string' || !/^[A-Za-z0-9+/]{64,4096}={0,2}$/.test(payload)
    || payload.length % 4 !== 0) return null;
  return { ...binding, payload };
}

export function parseSpendAuthorizationSignature(value) {
  const binding = parseSpendAuthorization(value);
  const signature = value?.signature;
  if (!binding || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{80,128}={0,2}$/.test(signature)
    || signature.length % 4 !== 0) return null;
  return { ...binding, signature };
}

const PRIVY_SIGN_CODES = new Set([
  'policy_violation',
  'insufficient_funds',
  'transaction_broadcast_failure',
  'missing_or_empty_authorization_header',
  'zero_correct_authorization_signatures',
  'insufficient_correct_authorization_signatures',
  'incorrect_quantity_of_authorization_signatures',
  'request_expired',
  'no_valid_user_session_keys',
  'user_session_keys_expired',
  'insufficient_app_secret_permissions',
]);
const PRIVY_SIGN_TRANSPORT = new Set(['network', 'timeout', 'redirect', 'invalid-response']);
const PRIVY_SIGN_STAGES = new Set(['app-sign', 'wallet-lookup', 'session-exchange', 'owner-sign', 'browser-owner-sign']);
const PRIVY_REQUEST_CODES = new Set([
  ...PRIVY_SIGN_CODES, 'invalid_data', 'invalid_auth_token', 'mfa_required', 'missing_mfa_enrollment',
]);
const PRIVY_SIGN_DETAILS = new Set([
  'wallet-matched', 'wallet-mismatch', 'missing-signed-transaction',
  'mfa-required', 'mfa-enrollment-required', 'token-expired', 'token-invalid',
  'jwt-configuration', 'no-wallets', 'invalid-encryption', 'invalid-data',
  'provider-detail', 'local-failure',
]);
const PRIVY_SESSION_CHECKS = new Set(['missing', 'unreadable', 'owner-mismatch', 'owner-matched']);
const PRIVY_CLAIM_CHECKS = new Set(['missing', 'match', 'mismatch']);
const PRIVY_EXPIRY_CHECKS = new Set(['missing', 'expired', 'current']);

function parsePrivySigningRequest(value) {
  if (!PRIVY_SIGN_STAGES.has(value?.stage)) return null;
  const { stage, status, code, transport, detail, requestId, edgeId, mfaProof } = value;
  return {
    stage,
    ...(Number.isInteger(status) && status >= 200 && status <= 599 ? { status } : {}),
    ...(PRIVY_REQUEST_CODES.has(code) ? { code } : {}),
    ...(PRIVY_SIGN_TRANSPORT.has(transport) ? { transport } : {}),
    ...(PRIVY_SIGN_DETAILS.has(detail) ? { detail } : {}),
    ...(typeof requestId === 'string'
      && /^(?:req[_-][a-z0-9_-]{6,64}|[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(requestId)
      ? { requestId } : {}),
    ...(typeof edgeId === 'string' && /^[a-f0-9]{16,32}-[a-z]{3}$/i.test(edgeId) ? { edgeId } : {}),
    ...(stage === 'session-exchange' && typeof mfaProof === 'boolean' ? { mfaProof } : {}),
  };
}

/** Carry provider diagnostics without response bodies, URLs, or credentials. */
export function parsePrivySigningFailure(value) {
  const status = Number.isInteger(value?.status) && value.status >= 400 && value.status <= 599
    ? value.status
    : null;
  const code = PRIVY_SIGN_CODES.has(value?.code) ? value.code : null;
  const transport = PRIVY_SIGN_TRANSPORT.has(value?.transport) ? value.transport : null;
  const lookup = value?.walletLookupStatus;
  const walletLookupStatus = status === 401 && (lookup === 200
    || Number.isInteger(lookup) && lookup >= 400 && lookup <= 599)
    ? lookup
    : null;
  const requests = Array.isArray(value?.requests)
    ? value.requests.slice(0, 4).map(parsePrivySigningRequest).filter(Boolean)
    : [];
  const { session, appSignature, at } = value ?? {};
  const sessionCheck = PRIVY_SESSION_CHECKS.has(session?.check) ? {
    check: session.check,
    ...(PRIVY_CLAIM_CHECKS.has(session.audience) ? { audience: session.audience } : {}),
    ...(PRIVY_CLAIM_CHECKS.has(session.issuer) ? { issuer: session.issuer } : {}),
    ...(PRIVY_EXPIRY_CHECKS.has(session.expiry) ? { expiry: session.expiry } : {}),
  } : null;
  if (!status && !code && !transport && !requests.length) return null;
  return {
    ...(status ? { status } : {}),
    ...(code ? { code } : {}),
    ...(transport ? { transport } : {}),
    ...(walletLookupStatus ? { walletLookupStatus } : {}),
    ...(requests.length ? { requests } : {}),
    ...(sessionCheck ? { session: sessionCheck } : {}),
    ...(typeof appSignature === 'boolean' ? { appSignature } : {}),
    ...(Number.isSafeInteger(at) && at > 0 && at <= 8.64e15 ? { at } : {}),
  };
}

/** Budget units are lamports for SOL, micro-USDC for USDC, or raw units for one mint. */
export function solanaSpendAsset(value) {
  const asset = typeof value === 'string' ? value.trim() : '';
  if (asset.toUpperCase() === 'SOL' || asset.toUpperCase() === 'USDC') return asset.toUpperCase();
  return base58.test(asset) ? asset : null;
}

function sanitizeSpendQuote(quote) {
  if (quote == null) return null;
  if (typeof quote !== 'object' || Array.isArray(quote)) return undefined;
  const pricingCluster = quote.pricingCluster === 'mainnet' || quote.pricingCluster === SOLANA_CLUSTER ? quote.pricingCluster : null;
  const cluster = quote.cluster === 'mainnet' || quote.cluster === SOLANA_CLUSTER ? quote.cluster : null;
  if (quote.pricingCluster != null && !pricingCluster) return undefined;
  if (quote.cluster != null && !cluster) return undefined;
  return {
    ...(pricingCluster ? { pricingCluster } : {}),
    ...(cluster ? { cluster } : {}),
    ...(quote.paperPnl === true ? { paperPnl: true } : {}),
    ...(quote.authorizesTransaction === true ? { authorizesTransaction: true } : {}),
  };
}

function spendUnits(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return value;
}

/** A mainnet-beta quote does not authorize. A mainnet quote stays paper and never signs. */
function quoteFromCluster(cluster) {
  if (cluster === 'mainnet') {
    return { pricingCluster: 'mainnet', paperPnl: true, authorizesTransaction: false };
  }
  if (cluster === SOLANA_CLUSTER) {
    return { pricingCluster: SOLANA_CLUSTER, cluster: SOLANA_CLUSTER, authorizesTransaction: false };
  }
  return null;
}

/** Shared body for voice, the glass UI, and Grok Bot. Returns null when the body cannot be a spend. */
export function parsePermissionedSpendBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!OWNER_SPEND_PERMISSIONS.includes(body.permission)) return null;
  if (!idOk(body.botId)) return null;
  if (body.action != null && !FUND_ACTIONS.includes(body.action)) return null;
  let units;
  try { units = amount(spendUnits(body.amount)); } catch { return null; }
  if (units === '0') return null;
  const destination = typeof body.destination === 'string' && base58.test(body.destination) ? body.destination : null;
  const handle = typeof body.handle === 'string' ? normalizeHandle(body.handle) : null;
  const action = FUND_ACTIONS.includes(body.action) ? body.action : 'spend';
  const asset = solanaSpendAsset(body.asset ?? 'USDC');
  if (!asset) return null;
  if (asset !== 'USDC' && (action === 'buy' || action === 'sell' || BigInt(units) > 18446744073709551615n)) return null;
  // A USDC buy of wrapped SOL stays in the assigned wallet. The spend is the cap asset.
  const selfCustody = action === 'buy' && !destination && !handle;
  if (!destination && !handle && !selfCustody) return null;
  if (body.quoteCluster != null && body.quoteCluster !== SOLANA_CLUSTER && body.quoteCluster !== 'mainnet') return null;
  let quote = sanitizeSpendQuote(body.quote);
  if (body.quote != null && quote == null && body.quote !== null) return null;
  if (quote == null && body.quoteCluster != null) quote = quoteFromCluster(body.quoteCluster);
  let reviewCap = null;
  if (body.reviewCap != null) {
    try { reviewCap = amount(body.reviewCap); } catch { return null; }
    if (reviewCap === '0') return null;
  }
  return {
    permission: body.permission,
    botId: body.botId,
    action,
    amount: units,
    asset,
    destination,
    handle,
    selfCustody,
    confirmed: body.confirmed === true,
    reviewCap,
    quote,
    idempotencyKey: typeof body.idempotencyKey === 'string' && idOk(body.idempotencyKey) ? body.idempotencyKey : null,
  };
}

export function buildPermissionedSpendRequest(input) {
  const parsed = parsePermissionedSpendBody(input);
  if (!parsed) fail('Permissioned spend needs ask, review, or full, plus a bot, amount, and handle or destination');
  return { method: 'POST', path: PERMISSIONED_SPEND_PATH, body: parsed };
}

export function parseSpendApprovalTerms(value) {
  if (!value || !idOk(value.walletId) || typeof value.walletAddress !== 'string' || !base58.test(value.walletAddress)
    || !Number.isSafeInteger(value.policyVersion) || value.policyVersion < 1
    || typeof value.feeLamports !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.feeLamports)) return null;
  return { walletId: value.walletId, walletAddress: value.walletAddress, policyVersion: value.policyVersion, feeLamports: value.feeLamports };
}

export function spendApprovalMessage({ ownerId, spend, terms, expiresAt }) {
  return JSON.stringify([
    'maelstrom:sol-solana:approve-once:v1', ownerId, spend.botId,
    spend.idempotencyKey, spend.action, spend.asset, spend.amount, spend.handle, spend.destination,
    terms.walletId, terms.walletAddress, terms.policyVersion, terms.feeLamports, expiresAt,
  ]);
}

export const API_ROUTES = Object.freeze([
  { id: 'models.list', method: 'GET', path: '/api/models', phase: 1, auth: 'none', status: 'guarded' },
  { id: 'models.check', method: 'POST', path: '/api/models', phase: 1, auth: 'none', status: 'guarded' },
  { id: 'health', method: 'GET', path: '/health', phase: 1, auth: 'none', status: 'live' },
  { id: 'routes.list', method: 'GET', path: '/api/routes', phase: 0, auth: 'none', status: 'live' },
  { id: 'me', method: 'GET', path: '/api/me', phase: 1, auth: 'privy', status: 'live' },
  { id: 'wallets.list', method: 'GET', path: '/api/wallets', phase: 1, auth: 'privy', status: 'live' },
  { id: 'solana.balance', method: 'GET', path: '/api/solana-balance', phase: 1, auth: 'privy', status: 'guarded' },
  { id: 'wallets.create', method: 'POST', path: '/api/wallets', phase: 1, auth: 'privy', status: 'live' },
  { id: 'wallets.persist', method: 'POST', path: '/api/wallets/persist', phase: 1, auth: 'privy', status: 'live' },
  { id: 'wallets.sign', method: 'POST', path: '/api/wallets/:walletId/sign', phase: 1, auth: 'privy', status: 'live' },
  { id: 'wallets.export', method: 'POST', path: '/api/wallets/:walletId/export', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.list', method: 'GET', path: '/api/bots', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.create', method: 'POST', path: '/api/bots', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.delete', method: 'DELETE', path: '/api/bots/:botId', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.freeze', method: 'POST', path: '/api/bots/freeze', phase: 1, auth: 'privy', status: 'live' },
  { id: 'desk.lock', method: 'POST', path: '/api/desk/lock', phase: 1, auth: 'privy', status: 'live' },
  { id: 'desk.unlock', method: 'POST', path: '/api/desk/unlock', phase: 1, auth: 'privy', status: 'live' },
  { id: 'desk.status', method: 'GET', path: '/api/desk', phase: 1, auth: 'privy', status: 'live' },
  { id: 'state.list', method: 'GET', path: '/api/state', phase: 1, auth: 'privy', status: 'live' },
  { id: 'state.write', method: 'POST', path: '/api/state', phase: 1, auth: 'privy', status: 'live' },
  { id: 'recovery.status', method: 'GET', path: '/api/recovery', phase: 1, auth: 'privy', status: 'live' },
  { id: 'recovery.issue', method: 'POST', path: '/api/recovery', phase: 1, auth: 'privy', status: 'live' },
  { id: 'recovery.verify', method: 'POST', path: '/api/recovery/verify', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.chat', method: 'POST', path: '/api/bots/:botId/chat', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.status', method: 'GET', path: '/bots/:botId/status', phase: 1, auth: 'owner', status: 'live', action: 'status' },
  { id: 'bots.status.root', method: 'GET', path: '/bots/:botId', phase: 1, auth: 'owner', status: 'live', action: 'status' },
  { id: 'positions.list', method: 'GET', path: '/api/positions', phase: 1, auth: 'privy', status: 'live' },
  { id: 'bots.wake', method: 'POST', path: '/bots/:botId/wake', phase: 1, auth: 'owner', status: 'live', action: 'wake' },
  { id: 'bots.pause', method: 'POST', path: '/bots/:botId/pause', phase: 1, auth: 'owner', status: 'live', action: 'pause' },
  { id: 'bots.resume', method: 'POST', path: '/bots/:botId/resume', phase: 1, auth: 'owner', status: 'live', action: 'resume' },
  { id: 'bots.advance', method: 'POST', path: '/bots/:botId/advance', phase: 1, auth: 'owner', status: 'live', action: 'advance' },
  { id: 'bots.decide', method: 'POST', path: '/bots/:botId/decide', phase: 1, auth: 'owner', status: 'live', action: 'decide' },
  { id: 'bots.loop', method: 'POST', path: '/bots/:botId/loop', phase: 4, auth: 'owner', status: 'live', action: 'loop' },
  { id: 'bots.cardLoop.create', method: 'POST', path: '/bots/:botId/card-loop', phase: 4, auth: 'owner', status: 'live', action: 'card-loop' },
  { id: 'bots.cardLoop.cooldown', method: 'POST', path: '/bots/:botId/card-loop/cooldown', phase: 4, auth: 'owner', status: 'live', action: 'card-loop/cooldown' },
  { id: 'bots.cardLoop.break', method: 'POST', path: '/bots/:botId/card-loop/break', phase: 4, auth: 'owner', status: 'live', action: 'card-loop/break' },
  { id: 'bots.browser.list', method: 'GET', path: '/bots/:botId/browser/sessions', phase: 3, auth: 'owner', status: 'live', action: 'browser/sessions' },
  { id: 'bots.browser.open', method: 'POST', path: '/bots/:botId/browser/sessions', phase: 3, auth: 'owner', status: 'live', action: 'browser/sessions' },
  { id: 'bots.browser.navigate', method: 'POST', path: '/bots/:botId/browser/sessions/:sessionRecordId/navigate', phase: 3, auth: 'owner', status: 'live', action: 'browser/navigate' },
  { id: 'bots.browser.liveView', method: 'POST', path: '/bots/:botId/browser/sessions/:sessionRecordId/live-view', phase: 3, auth: 'owner', status: 'live', action: 'browser/live-view' },
  { id: 'bots.browser.release', method: 'POST', path: '/bots/:botId/browser/sessions/:sessionRecordId/release', phase: 3, auth: 'owner', status: 'live', action: 'browser/release' },
  { id: 'bots.shopping.prepare', method: 'POST', path: '/bots/:botId/shopping/prepare', phase: 6, auth: 'owner', status: 'live' },
  { id: 'bots.shopping.settle', method: 'POST', path: '/bots/:botId/shopping/settle', phase: 6, auth: 'owner', status: 'live' },
  { id: 'bots.commerce.signal', method: 'GET', path: '/bots/:botId/commerce/signals/:signalId', phase: 6, auth: 'none', status: 'guarded' },
  { id: 'bots.commerce.signal.settle', method: 'POST', path: '/bots/:botId/commerce/signals/:signalId/settle', phase: 6, auth: 'none', status: 'guarded' },
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
  { id: 'spend.create', method: 'POST', path: '/api/spend', phase: 2, auth: 'privy', status: 'live' },
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

export const PROFILE_LOOK_KEY = '$profile';

export function profilePhoto(looks) {
  const image = looks?.[PROFILE_LOOK_KEY]?.image;
  return typeof image === 'string' && image.length <= 32768
    && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image) ? image : '';
}

export function withProfilePhoto(looks, image) {
  if (!profilePhoto({ [PROFILE_LOOK_KEY]: { image } })) return null;
  return { ...looks, [PROFILE_LOOK_KEY]: { image } };
}
