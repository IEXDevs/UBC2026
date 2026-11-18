/**
 * POST /api/spend — the permissioned spend voice, the glass UI, and Grok Bot share.
 * Order is trust, verify, freeze, policy, approval, then sign.
 * Signing goes through the Privy devnet client from @ubc2026/wallets.
 * Responses carry a signature and a state, never a key or a signed payload.
 */
import { parsePermissionedSpendBody } from '@ubc2026/contracts';
import { runPermissionedSpend } from '@ubc2026/agent-loop';
import { transferDevnetUsdc } from '@ubc2026/transfers';
import { DEVNET_USDC_MINT } from '@ubc2026/wallets/privy';
import { loadOwnerLoopContext, supabaseConfig } from './supabase-rest.mjs';
import { alertFromSpend, publishBotAlert } from './bot-alerts.mjs';
import { deskSpendAllowed } from './desk-grant.mjs';
import { verifierFacts } from './spend-verifier.mjs';
import { resolveTrustLookup } from './trust-lookup.mjs';

function readLookupScore(looked) {
  if (typeof looked === 'string' || typeof looked === 'number') return String(looked);
  if (looked && (typeof looked.score === 'string' || typeof looked.score === 'number')) return String(looked.score);
  return '';
}

/** Jupiter score when a lookup is configured. A failed lookup blocks the spend. */
async function spendTrustScore(env) {
  const lookup = resolveTrustLookup(env);
  if (lookup) {
    try {
      const score = readLookupScore(await lookup(DEVNET_USDC_MINT));
      if (!/^(0|[1-9][0-9]{0,2}|1000)$/.test(score)) return { ok: false, state: 'trust-unavailable' };
      return { ok: true, score };
    } catch {
      return { ok: false, state: 'trust-unavailable' };
    }
  }
  if (typeof env.spendTrustScore === 'string') return { ok: true, score: env.spendTrustScore };
  return { ok: true, score: '800' };
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function ownerIdFrom(request) {
  const value = request.headers.get('x-owner-id');
  if (typeof value !== 'string') return '';
  const owner = value.trim();
  if (!/^[a-zA-Z0-9:_.-]{1,256}$/.test(owner)) return '';
  return owner;
}

export async function handleSpend(request, env = {}) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const ownerId = ownerIdFrom(request);
  if (!ownerId) return json({ error: 'owner_required', signed: false }, 401);
  const desk = await deskSpendAllowed(env, request, ownerId, env.fetch ?? fetch, Number.isSafeInteger(env.spendNow) ? env.spendNow : Date.now());
  // A locked desk (missing or expired grant) is not a substitute for the gates
  // and must not answer before them. No lock row, or a lock store that cannot
  // be read, still refuses here. The grant is never invented.
  if (!desk.ok && desk.error !== 'desk_locked') {
    const status = desk.error === 'desk_lock_unavailable' ? 503 : 403;
    return json({ error: desk.error, signed: false }, status);
  }
  const raw = await request.json().catch(() => null);
  const parsed = parsePermissionedSpendBody(raw);
  if (!parsed) return json({ error: 'invalid_spend', signed: false }, 400);

  let context = null;
  if (typeof env.loadSpendContext === 'function') {
    context = await env.loadSpendContext({ botId: parsed.botId, ownerId });
  } else if (supabaseConfig(env)) {
    context = await loadOwnerLoopContext(env, { botId: parsed.botId, ownerId }, env.fetch ?? fetch);
  }
  if (!context?.bot || !context.wallet || !context.ledger) {
    return json({ error: 'context_missing', signed: false }, 409);
  }
  if (context.bot.ownerId !== ownerId || context.wallet.ownerId !== ownerId) {
    return json({ error: 'owner_mismatch', signed: false }, 403);
  }

  const now = Number.isSafeInteger(env.spendNow) ? env.spendNow : Date.now();
  const trust = await spendTrustScore(env);
  if (!trust.ok) {
    return json({
      ok: false,
      state: trust.state,
      steps: ['trust-gate'],
      signed: false,
      cluster: 'devnet',
      reason: trust.state,
    }, 409);
  }
  const trustScore = trust.score;
  const facts = {
    asset: 'USDC',
    mint: DEVNET_USDC_MINT,
    cluster: 'devnet',
    price: '1000000',
    amount: parsed.amount,
    trustScore,
    reasonSummary: `${parsed.action} ${parsed.amount} USDC on devnet`,
  };
  const proposal = {
    id: parsed.idempotencyKey || `spend_${parsed.botId}`,
    botId: parsed.botId,
    cluster: 'devnet',
    asset: 'USDC',
    recipient: parsed.destination || parsed.handle,
    quoteId: parsed.quote?.pricingCluster === 'mainnet' ? 'mainnet-quote' : 'devnet',
    outflow: parsed.amount,
    expectedReceive: parsed.amount,
    expectedReceiveAsset: 'USDC',
    maxFee: '0',
    expiresAt: now + 120_000,
  };
  const grantOk = desk.ok === true;
  const canSign = grantOk && Boolean(parsed.destination && env.transferClient);
  const signDevnet = canSign
    ? async ({ bot, wallet, memo }) => {
      const sent = await transferDevnetUsdc({
        client: env.transferClient,
        bot,
        wallet,
        destination: parsed.destination,
        amount: parsed.amount,
        memo,
      });
      return { cluster: sent.cluster, signature: sent.signature };
    }
    : undefined;

  let result;
  try {
    result = await runPermissionedSpend({
      bot: context.bot,
      wallet: context.wallet,
      ledger: context.ledger,
      proposal,
      trustScore,
      mainFn: async () => facts,
      verifyFn: typeof env.spendVerifyFn === 'function'
        ? env.spendVerifyFn
        : async () => verifierFacts({
          facts,
          proposal,
          parsed,
          trustScore,
          mint: DEVNET_USDC_MINT,
        }),
      now,
      ownerPermission: parsed.permission,
      confirmed: parsed.confirmed,
      reviewCap: parsed.reviewCap,
      quote: parsed.quote,
      signDevnet,
      beforeSign: grantOk && env.ledgerApi && typeof env.ledgerApi.reserveBudget === 'function'
        ? ({ proposal: spendProposal }) => env.ledgerApi.reserveBudget({
          ownerId,
          now,
          idempotencyKey: parsed.idempotencyKey || spendProposal.id,
          proposal: spendProposal,
        })
        : undefined,
    });
  } catch {
    return json({ error: 'spend_failed', signed: false }, 400);
  }

  let state = result.state;
  if (!grantOk && state === 'signer-not-configured') state = 'desk_locked';
  else if (state === 'signer-not-configured' && !parsed.destination) state = 'recipient_address_missing';
  const body = {
    ok: result.signed === true,
    state,
    steps: result.steps,
    signed: result.signed === true,
    cluster: 'devnet',
    reason: result.reason || null,
  };
  if (state === 'desk_locked') body.error = 'desk_locked';
  if (result.signed === true && grantOk) body.signature = result.signature;
  const alert = alertFromSpend(result, parsed);
  if (alert) {
    await publishBotAlert(env, {
      alert,
      botId: parsed.botId,
      ownerId,
      at: now,
      scope: parsed.idempotencyKey || `${parsed.action}_${parsed.amount}`,
    });
  }
  const status = result.signed && grantOk ? 200 : (state === 'desk_locked' ? 403 : 409);
  return json(body, status);
}
