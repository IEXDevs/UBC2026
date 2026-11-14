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
  'wallet.frozen',
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
