import { createHash } from 'node:crypto';

export class PolicyError extends Error {}
const fail = message => { throw new PolicyError(message); };
function amount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) fail('Amounts must be unsigned integer strings in base units');
  return BigInt(value);
}
const required = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
export function validateBot(bot) {
  if (!bot || !required(bot.id) || !required(bot.ownerId) || !required(bot.name) || !required(bot.goal)) fail('Bot identity, name, owner and goal are required');
  if (!['trading', 'shopping', 'position-management'].includes(bot.type)) fail('A supported bot type is required');
  if (typeof bot.enabled !== 'boolean' || !Number.isSafeInteger(bot.policyVersion) || bot.policyVersion < 1) fail('Invalid policy state');
  const cap = bot.cap;
  if (!cap || !['limited', 'unlimited'].includes(cap.mode) || !required(cap.asset)) fail('Explicit cap choice and accounting asset are required');
  if (cap.mode === 'limited') {
    if (bot.type === 'position-management') amount(cap.maxLoss);
    else { amount(cap.maxOutflow); amount(cap.maxPerTransaction); }
  }
  return bot;
}
function proposalFields(p) {
  if (!p || ![p.id, p.botId, p.asset, p.recipient, p.quoteId, p.expectedReceiveAsset].every(required)) fail('Incomplete transaction preview');
  if (!['devnet', 'testnet'].includes(p.cluster)) fail('Hackathon execution must use devnet or testnet');
  amount(p.outflow); amount(p.expectedReceive); amount(p.maxFee);
  if (!Number.isSafeInteger(p.expiresAt) || p.expiresAt <= 0) fail('Invalid quote expiry');
  return { id: p.id, botId: p.botId, cluster: p.cluster, asset: p.asset, recipient: p.recipient, quoteId: p.quoteId, outflow: p.outflow, expectedReceive: p.expectedReceive, expectedReceiveAsset: p.expectedReceiveAsset, maxFee: p.maxFee, expiresAt: p.expiresAt };
}
export function proposalDigest(proposal) {
  return createHash('sha256').update(JSON.stringify(proposalFields(proposal))).digest('hex');
}
export function evaluateProposal(bot, proposal, ledger, now) {
  validateBot(bot); const p = proposalFields(proposal);
  if (!Number.isSafeInteger(now)) fail('Explicit server time is required');
  if (p.botId !== bot.id) fail('Proposal belongs to a different bot');
  if (!bot.enabled) return { state: 'blocked', reason: 'bot-disabled' };
  if (p.expiresAt <= now) return { state: 'blocked', reason: 'quote-expired' };
  if (p.asset !== bot.cap.asset) return { state: 'blocked', reason: 'accounting-asset-mismatch' };
  if (!ledger || ledger.asset !== bot.cap.asset) fail('Matching budget ledger is required');
  const spent = amount(ledger.spent), reserved = amount(ledger.reserved), loss = amount(ledger.realizedLoss);
  const debit = amount(p.outflow) + amount(p.maxFee);
  const violations = [];
  if (bot.cap.mode === 'limited') {
    const lossCap = typeof bot.cap.maxLoss === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(bot.cap.maxLoss)
      ? amount(bot.cap.maxLoss)
      : null;
    if (bot.type === 'position-management' && lossCap == null) amount(bot.cap.maxLoss);
    // Loss is measured by the ledger, not the model. No approval can override it.
    if (lossCap != null && loss >= lossCap) return { state: 'blocked', reason: 'max-loss-reached' };
    if (bot.type !== 'position-management') {
      if (debit > amount(bot.cap.maxPerTransaction)) violations.push('per-transaction');
      if (spent + reserved + debit > amount(bot.cap.maxOutflow)) violations.push('total-outflow');
    }
  }
  return { state: violations.length ? 'over-budget' : 'approval-needed', violations, actions: violations.length ? ['approve-once', 'raise-limit'] : ['approve'], digest: proposalDigest(p), debit: debit.toString() };
}
// Approval records must be created ONLY by an authenticated, owner-authorized endpoint.
// This validates an existing record; it is not authentication or transaction execution.
export function validateApproval({ bot, proposal, ledger, approval, now }) {
  const decision = evaluateProposal(bot, proposal, ledger, now);
  if (decision.state === 'blocked') return decision;
  if (!approval || approval.ownerId !== bot.ownerId || approval.botId !== bot.id || approval.policyVersion !== bot.policyVersion || approval.digest !== decision.digest || approval.usedAt != null || !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= now || approval.expiresAt > proposal.expiresAt) return { state: 'blocked', reason: 'invalid-approval' };
  if (!['approve', 'approve-once'].includes(approval.action)) return { state: 'blocked', reason: 'invalid-approval-action' };
  if (decision.state === 'over-budget' && approval.action !== 'approve-once') return { state: 'blocked', reason: 'budget-override-required' };
  return { state: 'ready-to-reserve', digest: decision.digest, debit: decision.debit };
}
export function raiseLimits(bot, cap) {
  validateBot(bot);
  const next = { ...bot, cap: { ...cap }, policyVersion: bot.policyVersion + 1 };
  validateBot(next);
  if (cap.asset !== bot.cap.asset || cap.mode !== 'limited' || bot.cap.mode !== 'limited') fail('Changing accounting asset or unlimited mode requires a separate policy change');
  const keys = bot.type === 'position-management' ? ['maxLoss'] : ['maxOutflow', 'maxPerTransaction'];
  if (keys.some(key => amount(cap[key]) < amount(bot.cap[key]))) fail('Raise-limit action cannot lower a limit');
  return next;
}
