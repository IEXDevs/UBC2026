import { createHmac, timingSafeEqual } from 'node:crypto';
import { solanaSpendAsset, parseSpendAuthorizationChallenge } from '@ubc2026/contracts';
import { spendFailureCode, spendFailureMessage, toolStep } from './chat-activity.mjs';
import { matchingToolGrant } from './spend-permission.mjs';
import { TextChatError } from './text-chat.mjs';
import { txReceiptFromResult } from './tx-receipt.mjs';

const HOLD_LIFETIME_MS = 5 * 60 * 1000;

export function isAssetSpendHold(hold) {
  return hold?.name === 'request_spend' && solanaSpendAsset(hold.args?.asset ?? 'USDC') !== 'USDC';
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
  const text = receipt?.text || spendFailureMessage(result)
    || 'The send returned no receipt. Check the spend details before trying again.';
  return {
    provider: 'desk',
    toolRounds: 1,
    text,
    ...(step ? { activity: [step] } : {}),
  };
}
