import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseSpendAuthorizationChallenge } from '@ubc2026/contracts';
import { spendFailureCode, spendFailureMessage, toolStep } from './chat-activity.mjs';
import { matchingToolGrant, needsBoundSpend } from './spend-permission.mjs';
import { formatBaseUnits } from './money-views.mjs';
import { TextChatError } from './text-chat.mjs';
import { txReceiptFromResult } from './tx-receipt.mjs';
import { swapFailure } from './swap-failure.mjs';

const HOLD_LIFETIME_MS = 5 * 60 * 1000;

export function isAssetSpendHold(hold) {
  return needsBoundSpend(hold?.name, hold?.args);
}

function holdMac(hold, { ownerId, botId, secret }) {
  const args = Object.keys(hold.args).sort().map(key => [key, hold.args[key]]);
  const data = JSON.stringify([
    'maelstrom:chat-spend:v1', ownerId, botId, hold.name, hold.idempotencyKey, hold.expiresAt, args,
    ...(hold.budgetOverride == null ? [] : [hold.budgetOverride]),
    ...(hold.swapTicket == null ? [] : [hold.swapTicket]),
  ]);
  return createHmac('sha256', secret).update(data).digest();
}

export function sealAssetSpendHold(hold, context, now = Date.now()) {
  const sealed = { ...hold, expiresAt: hold.budgetOverride || hold.swapTicket ? hold.expiresAt : now + HOLD_LIFETIME_MS };
  return { ...sealed, proof: holdMac(sealed, context).toString('hex') };
}

export function swapHoldFromPreview(hold, preview) {
  const units = /^[1-9][0-9]{0,39}$/;
  const decimals = value => Number.isInteger(value) && value >= 0 && value <= 255;
  if (hold?.args?.action !== 'swap' || !preview || !units.test(hold.args.amount) || !units.test(preview.minOutput)
      || !units.test(preview.usdMicros) || !decimals(preview.inputDecimals) || !decimals(preview.outputDecimals)
      || !Number.isSafeInteger(preview.expiresAt) || typeof preview.ticket !== 'string' || preview.ticket.length > 5000) return null;
  const input = formatBaseUnits(hold.args.amount, preview.inputDecimals);
  const output = formatBaseUnits(preview.minOutput, preview.outputDecimals);
  const debit = formatBaseUnits(preview.usdMicros, 6);
  const label = `Swap ${input} ${hold.args.asset} for at least ${output} ${hold.args.outputAsset}. Budget charge including fees is $${debit}.`;
  return { ...hold, label, prompt: `${label} Slide to confirm.`, expiresAt: preview.expiresAt, swapTicket: preview.ticket };
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
      text: hold?.args?.action === 'swap'
        ? 'Swap — approval: This confirmation is invalid or expired. Ask for a fresh swap quote. [swap_quote_expired]'
        : 'This confirmation is invalid or expired. Ask for the payment again.',
    };
  }

  const result = await invokeTool(hold.name, hold.args);
  if (['desk_locked', 'desk_lock_required'].includes(spendFailureCode(result))) {
    throw new TextChatError('desk_locked', 403);
  }
  const spendAuthorization = parseSpendAuthorizationChallenge(result?.spendAuthorization);
  if (spendAuthorization && result.signed === false) {
    return { provider: 'desk', toolRounds: 1, spendAuthorization };
  }
  const receipt = txReceiptFromResult(result);
  const step = toolStep(hold.name, hold.args, result);
  const receiptText = receipt && (hold.args.action === 'swap' ? `Swap submitted. ${receipt.url}` : receipt.text);
  const text = receiptText || (hold.args.action === 'swap' ? swapFailure(result).message : spendFailureMessage(result))
    || (hold.args.action === 'swap'
      ? 'The swap returned no receipt. Check the trade details before trying again.'
      : 'The send returned no receipt. Check the spend details before trying again.');
  return {
    provider: 'desk',
    toolRounds: 1,
    text,
    ...(receipt && typeof result?.claimUrl === 'string' ? { claimUrl: result.claimUrl } : {}),
    ...(step ? { activity: [step] } : {}),
  };
}
