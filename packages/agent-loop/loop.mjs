/**
 * Pure decision-loop orchestration:
 * trust-score gate → verify-consensus → wallet freeze → bot-policy.
 * A passing gate includes a memo whose hash is the verifier decision record.
 * Does not sign, broadcast, submit a memo, or talk to networks.
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
    return { state: 'blocked', reason: 'spend-frozen', detail: error.message };
  }

  const trust = evaluateTrust({ score: trustScore, threshold: trustThreshold, confirmed: trustConfirmed });
  if (trust.state === 'confirmation-required') {
    return { state: 'trust-confirmation-required', trust };
  }

  const consensus = await reachConsensus({ mainFn, verifyFn });
  if (consensus.state === 'manual-review') {
    return { state: 'verify-mismatch', consensus };
  }

  const policy = evaluateProposal(bot, proposal, ledger, now);
  if (policy.state === 'blocked') {
    return { state: 'blocked', reason: policy.reason, policy, trust, consensus };
  }

  const approvalNeeded = needsHumanApproval(
    { approvalMode: bot.approvalMode ?? 'ask', autoApproveCap: bot.autoApproveCap },
    policy,
  );

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
