/**
 * Pure decision-loop orchestration.
 * Permissioned spend order: trust gate, verify-consensus, wallet freeze,
 * bot-policy, approval mode, then sign. A refusal stops at that step.
 * Signing is an injected devnet call into @ubc2026/wallets. This module
 * does not hold keys and does not broadcast.
 */
import { evaluateTrust } from '@ubc2026/trust-score';
import { reachConsensus, factsDigest, memoFromDecision } from '@ubc2026/verify-consensus';
import { evaluateProposal, proposalDigest } from '@ubc2026/bot-policy';
import { assertSpendAllowed } from '@ubc2026/wallets';

export class LoopError extends Error {}
const fail = message => { throw new LoopError(message); };

function needsHumanApproval(bot, policyDecision) {
  if (policyDecision.state === 'blocked') return false;
  if (policyDecision.state === 'over-budget') return true;
  if (bot.approvalMode === 'ask') return true;
  if (bot.approvalMode === 'fully-automatic') return false;
  if (bot.approvalMode === 'capped-automatic') {
    const cap = BigInt(bot.autoApproveCap ?? '0');
    return BigInt(policyDecision.debit) > cap;
  }
  fail('Unknown approval mode');
}

const OWNER_PERMISSIONS = new Set(['ask', 'review', 'full']);

const REVIEW_CAP = /^(?:[1-9][0-9]{0,39})$/;

/** Whether this policy result still needs a person. Over-budget always does.
 * Full permission uses the existing fully-automatic mode: no owner request.
 * Ask waits until the owner has confirmed. That confirm is the slide.
 * Review by AI continues when the debit is within reviewCap. The verify step
 * has already agreed before this function runs. Above the cap, review waits.
 * A missing or failed earlier gate is not waived by full permission. */
export function approvalRequirement(bot, policyDecision, options = {}) {
  if (!policyDecision || typeof policyDecision.state !== 'string') fail('Policy decision is required');
  if (policyDecision.state === 'blocked') return false;
  if (policyDecision.state === 'over-budget') return true;
  if (options?.ownerPermission === 'full') return false;
  if (options?.ownerPermission === 'review' && REVIEW_CAP.test(options.reviewCap ?? '')) {
    const debit = policyDecision.debit;
    if (typeof debit === 'string' && REVIEW_CAP.test(debit) && BigInt(debit) <= BigInt(options.reviewCap)) {
      return false;
    }
    return options?.confirmed !== true;
  }
  if (options?.ownerPermission === 'ask' || options?.ownerPermission === 'review') {
    return options?.confirmed !== true;
  }
  if (options?.ownerPermission != null && !OWNER_PERMISSIONS.has(options.ownerPermission)) {
    fail('Unknown owner permission');
  }
  return needsHumanApproval(
    { approvalMode: bot?.approvalMode ?? 'ask', autoApproveCap: bot?.autoApproveCap },
    policyDecision,
  );
}

export const PERMISSIONED_SPEND_STEPS = Object.freeze([
  'trust-gate',
  'verify-consensus',
  'wallet-freeze',
  'bot-policy',
  'approval-mode',
  'sign',
]);

/** A mainnet or paper price quote never authorizes a transaction. */
export function mainnetQuoteBlocksSpend(quote) {
  if (quote == null) return false;
  if (typeof quote !== 'object') return true;
  if (quote.pricingCluster === 'mainnet' || quote.cluster === 'mainnet') return true;
  if (quote.paperPnl === true) return true;
  if (quote.authorizesTransaction === true) return true;
  return false;
}

/**
 * @param {object} args
 * @param {object} args.bot - bot-policy bot shape plus approvalMode / autoApproveCap / frozen
 * @param {object} args.wallet - assigned Privy wallet
 * @param {object} args.ledger - spend ledger
 * @param {object} args.proposal - transaction preview
 * @param {string} args.trustScore - 0..1000 integer string
 * @param {boolean} [args.trustConfirmed]
 * @param {Function} args.mainFn - independent main fact producer
 * @param {Function} args.verifyFn - independent verify fact producer
 * @param {number} args.now
 */
export async function runDecisionGate({
  bot,
  wallet,
  ledger,
  proposal,
  trustScore,
  trustConfirmed = false,
  trustThreshold = '400',
  mainFn,
  verifyFn,
  now,
}) {
  if (!bot || !wallet || !ledger || !proposal) fail('bot, wallet, ledger, and proposal are required');
  if (typeof mainFn !== 'function' || typeof verifyFn !== 'function') fail('mainFn and verifyFn are required');
  if (!Number.isSafeInteger(now)) fail('Explicit server time is required');

  const trust = evaluateTrust({ score: trustScore, threshold: trustThreshold, confirmed: trustConfirmed });
  if (trust.state === 'confirmation-required') {
    return { state: 'trust-confirmation-required', trust };
  }

  const consensus = await reachConsensus({ mainFn, verifyFn });
  if (consensus.state === 'manual-review') {
    return { state: 'verify-mismatch', consensus };
  }

  try {
    assertSpendAllowed({
      bot: {
        ...bot,
        approvalMode: bot.approvalMode ?? 'ask',
        frozen: bot.frozen ?? false,
        walletId: bot.walletId ?? wallet.id,
      },
      wallet,
    });
  } catch (error) {
    return { state: 'blocked', reason: 'spend-frozen', detail: error.message, trust, consensus };
  }

  const policy = evaluateProposal(bot, proposal, ledger, now);
  if (policy.state === 'blocked') {
    return { state: 'blocked', reason: policy.reason, policy, trust, consensus };
  }

  const approvalNeeded = approvalRequirement(bot, policy);

  const memo = memoFromDecision(consensus.decisionRecord);
  return {
    state: approvalNeeded ? 'approval-needed' : 'ready-to-execute',
    trust,
    consensus,
    policy,
    memo,
    digests: {
      facts: consensus.digest ?? factsDigest(consensus.facts ?? consensus.attempts?.at(-1)?.main),
      proposal: policy.digest ?? proposalDigest(proposal),
      decision: consensus.decisionRecord.recordDigest,
    },
  };
}

function spendBot(bot, wallet) {
  return {
    ...bot,
    approvalMode: bot.approvalMode ?? 'ask',
    frozen: bot.frozen ?? false,
    walletId: bot.walletId ?? wallet.id,
  };
}

/**
 * One spend path for voice, the glass UI, and Grok Bot.
 * Steps run in PERMISSIONED_SPEND_STEPS order. Sign runs only after the
 * earlier steps pass, and only through the injected wallets signer.
 */
export async function runPermissionedSpend({
  bot,
  wallet,
  ledger,
  proposal,
  trustScore,
  trustConfirmed = false,
  trustThreshold = '400',
  mainFn,
  verifyFn,
  now,
  ownerPermission,
  confirmed = false,
  reviewCap = null,
  quote = null,
  signDevnet,
  beforeSign,
} = {}) {
  const steps = [];
  if (!bot || !wallet || !ledger || !proposal) fail('bot, wallet, ledger, and proposal are required');
  if (typeof mainFn !== 'function' || typeof verifyFn !== 'function') fail('mainFn and verifyFn are required');
  if (!Number.isSafeInteger(now)) fail('Explicit server time is required');

  steps.push('trust-gate');
  const trust = evaluateTrust({ score: trustScore, threshold: trustThreshold, confirmed: trustConfirmed });
  if (trust.state === 'confirmation-required') {
    return { state: 'trust-confirmation-required', steps, signed: false, trust };
  }

  steps.push('verify-consensus');
  const consensus = await reachConsensus({ mainFn, verifyFn });
  if (consensus.state !== 'consensus') {
    return { state: 'verify-mismatch', steps, signed: false, trust, consensus };
  }

  steps.push('wallet-freeze');
  try {
    assertSpendAllowed({ bot: spendBot(bot, wallet), wallet });
  } catch (error) {
    return { state: 'blocked', reason: 'spend-frozen', steps, signed: false, detail: error.message };
  }

  steps.push('bot-policy');
  const policy = evaluateProposal(bot, proposal, ledger, now);
  if (policy.state === 'blocked') {
    return { state: 'blocked', reason: policy.reason, steps, signed: false, policy };
  }

  steps.push('approval-mode');
  const approvalNeeded = approvalRequirement(bot, policy, { ownerPermission, confirmed, reviewCap });
  if (approvalNeeded) {
    return { state: 'approval-needed', steps, signed: false, policy };
  }
  if (proposal.cluster !== 'devnet') {
    return { state: 'wrong-cluster', steps, signed: false };
  }
  if (mainnetQuoteBlocksSpend(quote)) {
    return { state: 'quote-not-authorization', steps, signed: false };
  }
  if (typeof signDevnet !== 'function') {
    return { state: 'signer-not-configured', steps, signed: false };
  }

  const memo = memoFromDecision(consensus.decisionRecord);
  if (typeof beforeSign === 'function') {
    steps.push('reserve');
    let reserved;
    try {
      reserved = await beforeSign({ bot, wallet, ledger, proposal, policy, memo });
    } catch (error) {
      return { state: 'blocked', reason: error?.code || 'reserve-failed', steps, signed: false };
    }
    const reservedState = reserved?.state;
    if (reservedState !== 'reserved' && reservedState !== 'ready-to-reserve') {
      return {
        state: 'blocked',
        reason: reserved?.reason || reservedState || 'reserve-blocked',
        steps,
        signed: false,
      };
    }
  }

  steps.push('sign');
  let signed;
  try {
    signed = await signDevnet({ bot, wallet, proposal, memo, cluster: 'devnet' });
  } catch {
    return { state: 'sign-rejected', steps, signed: false };
  }
  if (!signed || signed.cluster !== 'devnet' || typeof signed.signature !== 'string' || signed.signature.length < 1) {
    return { state: 'sign-rejected', steps, signed: false };
  }
  return {
    state: 'signed',
    steps,
    signed: true,
    signature: signed.signature,
    cluster: 'devnet',
    memo,
  };
}
