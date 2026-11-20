import { parsePermissionedSpendBody } from '@ubc2026/contracts';
import { SOLANA_CLUSTER, SOLANA_USDC_MINT } from '@ubc2026/contracts/solana';
import { SOL_MINT } from './usd-budget.mjs';
import { botStub } from './bot-alerts.mjs';

export const LOOP_SWAP_PENDING = 'swap-approval-required';
export const INTERNAL_LOOP_SWAP = 'loop-swap';
const INTENT_LIFETIME_MS = 60 * 60_000;
const LOOP_KEY = /^loop_swap_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function isLoopSwapKey(value) {
  return typeof value === 'string' && LOOP_KEY.test(value);
}

function swapAsset(mint) {
  if (mint === SOL_MINT) return 'SOL';
  if (mint === SOLANA_USDC_MINT) return 'USDC';
  return mint;
}

export function createLoopSwapIntent({ swap, bot, wallet, now }) {
  if (typeof swap?.inputMint !== 'string' || typeof swap.outputMint !== 'string') return null;
  const draft = parsePermissionedSpendBody({
    botId: bot.id, action: 'swap', permission: 'ask', amount: swap.inAmount,
    asset: swapAsset(swap.inputMint), outputAsset: swapAsset(swap.outputMint),
  });
  if (!draft) return null;
  return {
    botId: bot.id, asset: draft.asset, outputAsset: draft.outputAsset, amount: draft.amount,
    idempotencyKey: `loop_swap_${crypto.randomUUID()}`, expiresAt: now + INTENT_LIFETIME_MS,
    walletId: wallet.id, policyVersion: bot.policyVersion, cluster: SOLANA_CLUSTER,
  };
}

export function pendingLoopSwap(run) {
  const step = run?.checkpoints?.decide;
  return step?.status === 'waiting' && step.reason === LOOP_SWAP_PENDING
    && !run.checkpoints?.execute?.signature ? step.swapIntent ?? null : null;
}

export function matchesLoopSwap(intent, spend, context, now) {
  return Boolean(intent && isLoopSwapKey(spend.idempotencyKey) && spend.action === 'swap'
    && intent.idempotencyKey === spend.idempotencyKey && intent.botId === spend.botId
    && intent.asset === spend.asset && intent.outputAsset === spend.outputAsset && intent.amount === spend.amount
    && intent.walletId === context.wallet.id && intent.policyVersion === context.bot.policyVersion
    && intent.cluster === SOLANA_CLUSTER && intent.expiresAt > now);
}

export async function useLoopSwap(env, ownerId, spend, signature) {
  const headers = { 'x-maelstrom-internal': INTERNAL_LOOP_SWAP, 'x-owner-id': ownerId };
  const receipt = signature ? { idempotencyKey: spend.idempotencyKey, signature } : null;
  try {
    const response = await botStub(env, spend.botId).fetch(new Request('https://bot/loop-swap', {
      headers,
      ...(receipt ? { method: 'POST', body: JSON.stringify(receipt) } : {}),
    }));
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
