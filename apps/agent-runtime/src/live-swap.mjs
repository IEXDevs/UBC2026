import { createHmac, timingSafeEqual } from 'node:crypto';
import { SOLANA_CLUSTER, SOLANA_USDC_MINT } from '@ubc2026/contracts/solana';
import { buildJupiterSwap } from '@ubc2026/transfers';
import { SYSTEM_PROGRAM, swapSolShortfall } from '@ubc2026/wallets/swap-diagnostics';
import { SOL_MINT, valueUsdSpend } from './usd-budget.mjs';

const TTL = 55_000;
const UNITS = /^(0|[1-9][0-9]{0,39})$/;

export function mintForAsset(asset) {
  if (asset === 'SOL') return SOL_MINT;
  return asset === 'USDC' ? SOLANA_USDC_MINT : asset;
}

async function mintDecimals(client, mint) {
  if (mint === SOL_MINT) return 9;
  const metadata = await client.readSolanaMint({ mint, allowToken2022: true });
  if (metadata?.cluster !== SOLANA_CLUSTER || metadata.mint !== mint
      || !Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255) throw new Error('swap_mint_invalid');
  return metadata.decimals;
}

function identity({ bot, wallet }, parsed) {
  return [
    'maelstrom:swap:v1', bot.ownerId, bot.id, bot.policyVersion, wallet.id, wallet.address,
    parsed.idempotencyKey, parsed.asset, parsed.outputAsset, parsed.amount, SOLANA_CLUSTER,
  ];
}

function ticketMac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

export function bindSwapTicket(state, context, parsed, key) {
  const payload = Buffer.from(JSON.stringify([identity(context, parsed), state])).toString('base64url');
  return `${payload}.${ticketMac(key, payload).toString('hex')}`;
}

export function readSwapTicket(ticket, context, parsed, key, now) {
  if (typeof ticket !== 'string' || ticket.length > 5000) return null;
  const match = /^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(ticket);
  if (!match || !timingSafeEqual(ticketMac(key, match[1]), Buffer.from(match[2], 'hex'))) return null;
  try {
    const [bound, state] = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    if (JSON.stringify(bound) !== JSON.stringify(identity(context, parsed))
        || !Number.isSafeInteger(state?.expiresAt) || state.expiresAt <= now || state.expiresAt > now + TTL) return null;
    return state;
  } catch {
    return null;
  }
}

function swapSimulation(context, parsed, offer) {
  return {
    transaction: offer.transaction, walletAddress: context.wallet.address,
    inputMint: mintForAsset(parsed.asset), outputMint: mintForAsset(parsed.outputAsset),
    amount: parsed.amount, minOutput: offer.minOutput,
  };
}

function checkedSwapPreparation(prepared, transaction, approvedSolCost = null) {
  let reason;
  if (prepared?.transaction !== transaction) reason = 'swap_transaction_mismatch';
  else if (!UNITS.test(prepared.maxSolCost ?? '')) reason = 'swap_fee_unavailable';
  else if (approvedSolCost !== null) {
    if (!UNITS.test(approvedSolCost)) reason = 'swap_approved_cost_missing';
    else if (BigInt(prepared.maxSolCost) > BigInt(approvedSolCost)) reason = 'swap_approved_cost_exceeded';
  }
  if (reason) throw Object.assign(new Error('simulation_failed'), { simulationReason: reason });
  return prepared;
}

export async function previewLiveSwap(env, context, parsed, key, now, { allowReducedSolQuote = false } = {}) {
  const client = env.transferClient;
  const inputMint = mintForAsset(parsed.asset);
  const outputMint = mintForAsset(parsed.outputAsset);
  const [block, inputDecimals, outputDecimals] = await Promise.all([
    client.getSolanaBlockhash(), mintDecimals(client, inputMint), mintDecimals(client, outputMint),
  ]);
  if (block?.cluster !== SOLANA_CLUSTER) throw new Error('wrong_cluster');
  let amount = parsed.amount;
  for (let attempt = 0; ; attempt += 1) {
    const quoted = { ...parsed, amount };
    const offer = await buildJupiterSwap({
      walletAddress: context.wallet.address, inputMint, outputMint, amount,
      blockhash: block.blockhash, apiKey: env.JUPITER_API_KEY, fetcher: env.fetch ?? fetch,
    });
    let prepared;
    try {
      prepared = checkedSwapPreparation(await client.prepareSolanaSwap(swapSimulation(context, quoted, offer)), offer.transaction);
    } catch (error) {
      if (inputMint !== SOL_MINT || !allowReducedSolQuote || attempt >= 2 || !error?.solWrapReached
          || !/^instruction_[0-9]+_custom_1$/.test(error.simulationReason ?? '')) throw error;
      const funding = swapSolShortfall(error.simulationDetails);
      if (!funding || (error.simulationDetails.instructionProgram === SYSTEM_PROGRAM && funding.needed !== BigInt(amount))) throw error;
      const reduced = BigInt(amount) - (funding.needed - funding.available);
      if (reduced <= 0n) throw error;
      amount = reduced.toString();
      continue;
    }
    const valuation = await valueUsdSpend(env, {
      mint: inputMint, decimals: inputDecimals, amount, feeLamports: prepared.maxSolCost, now,
    });
    const expiresAt = now + TTL;
    const terms = {
      transaction: offer.transaction, blockhash: block.blockhash, minOutput: offer.minOutput,
      expiresAt, maxSolCost: prepared.maxSolCost, ...valuation, requiresOwnerApproval: amount !== parsed.amount,
    };
    return {
      expiresAt, inputDecimals, outputDecimals, minOutput: offer.minOutput,
      ...(amount !== parsed.amount ? { inputAmount: amount } : {}),
      usdMicros: (BigInt(valuation.outflow) + BigInt(valuation.maxFee)).toString(),
      ticket: bindSwapTicket(terms, context, quoted, key),
    };
  }
}

export async function prepareApprovedSwap(env, context, parsed, offer) {
  const prepared = await env.transferClient.prepareSolanaSwap(swapSimulation(context, parsed, offer));
  return checkedSwapPreparation(prepared, offer.transaction, offer.maxSolCost ?? '');
}
