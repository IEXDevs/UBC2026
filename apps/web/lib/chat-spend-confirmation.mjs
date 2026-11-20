import { createHmac, timingSafeEqual } from 'node:crypto';
import { devnetSpendAsset, parseSpendApprovalTerms } from '@ubc2026/contracts';
import { spendFailureMessage, toolStep } from './chat-activity.mjs';
import { formatBaseUnits, shortAddress } from './money-views.mjs';
import { matchingToolGrant } from './spend-permission.mjs';
import { txReceiptFromResult } from './tx-receipt.mjs';

const HOLD_LIFETIME_MS = 5 * 60 * 1000;

export function isAssetSpendHold(hold) {
  return hold?.name === 'request_spend' && devnetSpendAsset(hold.args?.asset ?? 'USDC') !== 'USDC';
}

function holdMac(hold, { ownerId, botId, secret }) {
  const args = Object.keys(hold.args).sort().map(key => [key, hold.args[key]]);
  const data = JSON.stringify([
    'maelstrom:chat-spend:v1', ownerId, botId, hold.name, hold.idempotencyKey, hold.expiresAt, args,
    ...(hold.budgetOverride == null ? [] : [hold.budgetOverride]),
  ]);
  return createHmac('sha256', secret).update(data).digest();
}

export function sealAssetSpendHold(hold, context, now = Date.now()) {
  const sealed = { ...hold, expiresAt: hold.budgetOverride ? hold.expiresAt : now + HOLD_LIFETIME_MS };
  return { ...sealed, proof: holdMac(sealed, context).toString('hex') };
}

export async function resumeAssetSpend(hold, context, invokeTool, now = Date.now()) {
  if (
    !isAssetSpendHold(hold)
    || hold.kind !== 'modal'
    || !matchingToolGrant([hold], hold.name, hold.args)
    || !Number.isSafeInteger(hold.expiresAt)
    || now >= hold.expiresAt
    || typeof hold.proof !== 'string'
    || !/^[a-f0-9]{64}$/.test(hold.proof)
    || !context.secret
    || !timingSafeEqual(holdMac(hold, context), Buffer.from(hold.proof, 'hex'))
  ) {
    return {
      provider: 'desk',
      text: 'This confirmation is invalid or expired. Ask for the payment again.',
    };
  }

  let approveOnce;
  if (hold.budgetOverride != null) {
    const terms = parseSpendApprovalTerms(hold.budgetOverride);
    if (!terms || !context.attestBudgetApproval) {
      return { provider: 'desk', text: 'One-time approval is not available. No payment was sent.' };
    }
    approveOnce = await context.attestBudgetApproval(hold, terms);
  }
  const result = await invokeTool(hold.name, hold.args, { approveOnce });
  let gate = result;
  if (typeof result === 'string') {
    try { gate = JSON.parse(result); } catch { gate = null; }
  }
  const terms = parseSpendApprovalTerms(gate?.approvalTerms);
  const { action, asset, handle, destination, amount } = hold.args;
  if (!hold.budgetOverride && context.attestBudgetApproval && action === 'spend' && asset === 'SOL'
    && handle && destination && terms && gate?.signed === false
    && (gate.error || gate.state) === 'approval-needed'
    && gate.reason === 'per-transaction') {
    const label = `Approve once: send ${formatBaseUnits(amount, 9)} SOL to @${handle} (${shortAddress(destination)}) on Solana devnet plus a ${formatBaseUnits(terms.feeLamports, 9)} SOL fee.`;
    const prompt = `${label} This overrides the agent’s per-transfer limit and, if needed, its remaining budget for this payment only. The limits won’t change. Slide to approve once.`;
    return { provider: 'desk', toolRounds: 1, text: prompt, hold: { ...hold, budgetOverride: terms, label, prompt } };
  }
  const receipt = txReceiptFromResult(result);
  const step = toolStep(hold.name, hold.args, result);
  const text = receipt?.text || spendFailureMessage(result)
    || 'The send returned no receipt. Check the spend details before trying again.';
  return {
    provider: 'desk',
    toolRounds: 1,
    text,
    ...(step ? { activity: [step] } : {}),
  };
}
