import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
/**
 * POST /api/spend — the permissioned spend voice, the glass UI, and Grok Bot share.
 * Order is trust, verify, freeze, policy, approval, then sign.
 * Signing goes through the Privy mainnet-beta client from @ubc2026/wallets.
 * Responses carry a signature and a state, never a key or a signed payload.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  parsePermissionedSpendBody, parsePrivySigningFailure, parseSpendAuthorizationSignature, spendApprovalMessage,
} from '@ubc2026/contracts';
import { mainnetQuoteBlocksSpend, runPermissionedSpend } from '@ubc2026/agent-loop';
import { proposalDigest } from '@ubc2026/bot-policy';
import { buildSolanaAssetTransaction, buildSolanaUsdcTransaction, transferSolanaUsdc } from '@ubc2026/transfers';
import { SOLANA_USDC_MINT } from '@ubc2026/wallets/privy';
import { loadOwnerLoopContext, supabaseConfig, supabaseGet, supabaseWrite } from './supabase-rest.mjs';
import { alertFromSpend, publishBotAlert } from './bot-alerts.mjs';
import { deskSpendAllowed, sha256Hex } from './desk-grant.mjs';
import { ownerAuthStatus, resolveSpendOwner } from './owner-auth.mjs';
import { verifierFacts } from './spend-verifier.mjs';
import { resolveTrustLookup } from './trust-lookup.mjs';
import { mintForAsset, prepareApprovedSwap, previewLiveSwap, readSwapTicket } from './live-swap.mjs';
import { isLoopSwapKey, matchesLoopSwap, useLoopSwap } from './loop-swap.mjs';
import { valueUsdSpend } from './usd-budget.mjs';
import { prepareLasoPayment, readLasoTicket, settleLasoPayment } from './laso-payment.mjs';
import { swapFailure } from './swap-failure.mjs';
import { parseLasoBrowserPayment } from './laso-browser-payment.mjs';

const SOL_TRUST_MINT = 'So11111111111111111111111111111111111111112';
const WALLET_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SPEND_AUTHORIZATION_TTL_MS = 60_000;

function readLookupScore(looked) {
  if (typeof looked === 'string' || typeof looked === 'number') return String(looked);
  if (looked && (typeof looked.score === 'string' || typeof looked.score === 'number')) return String(looked.score);
  return '';
}

/** Jupiter score when a lookup is configured. A missing score is not invented. */
async function spendTrustScore(env, mint) {
  const lookup = resolveTrustLookup(env);
  if (lookup) {
    try {
      const score = readLookupScore(await lookup(mint));
      if (!/^(0|[1-9][0-9]{0,2}|1000)$/.test(score)) return { unavailable: true };
      return { score };
    } catch {
      return { unavailable: true };
    }
  }
  if (typeof env.spendTrustScore === 'string') return { score: env.spendTrustScore };
  return mint === SOLANA_USDC_MINT ? { score: '800' } : { unavailable: true };
}

async function transferDestination(env, parsed) {
  if (!parsed.handle) return parsed.destination;
  const profile = await supabaseGet(env, `profiles?handle=eq.${encodeURIComponent(parsed.handle)}&select=owner_id&limit=1`, env.fetch);
  const ownerId = profile.rows?.[0]?.owner_id;
  if (typeof ownerId !== 'string' || !ownerId) return null;
  const wallet = await supabaseGet(env, `wallets?owner_id=eq.${encodeURIComponent(ownerId)}&kind=eq.main&select=address&limit=1`, env.fetch);
  const address = wallet.rows?.[0]?.address;
  return WALLET_ADDRESS.test(address || '') && (!parsed.destination || parsed.destination === address) ? address : null;
}

async function prepareAssetTransfer(env, parsed, wallet, destination, id, blockhash) {
  const client = env.transferClient;
  if (!blockhash) {
    const block = await client.getSolanaBlockhash();
    if (block?.cluster !== SOLANA_CLUSTER) throw new Error('wrong_cluster');
    blockhash = block.blockhash;
  }
  let decimals = parsed.asset === 'SOL' ? 9 : 6;
  if (parsed.asset !== 'SOL' && parsed.asset !== 'USDC') {
    const mint = await client.readSolanaMint({ mint: parsed.asset });
    if (mint?.cluster !== SOLANA_CLUSTER || mint.mint !== parsed.asset) throw new Error('wrong_mint');
    decimals = mint.decimals;
  }
  const args = {
    asset: parsed.asset, decimals, sourceOwner: wallet.address, destinationOwner: destination,
    amount: parsed.amount, memo: `maelstrom:spend:${id}`, recentBlockhash: blockhash,
  };
  const isUsdc = parsed.asset === 'USDC';
  const transaction = isUsdc
    ? buildSolanaUsdcTransaction({ ...args, feePayer: wallet.address }).transactionBase64
    : buildSolanaAssetTransaction(args);
  const prepared = await client.prepareSolanaTransfer({
    transaction, ...(isUsdc ? { accountCreationPayer: wallet.address } : {}),
  });
  if (prepared?.transaction !== transaction || !/^(0|[1-9]\d{0,19})$/.test(prepared.feeLamports || '')) throw new Error('invalid_simulation');
  return { prepared, blockhash, decimals };
}

async function reserveAssetTransfer(env, { ownerId, bot, proposal, policy, now, idempotencyKey, budgetApproval }) {
  let approvalId;
  if (budgetApproval || bot.approvalMode === 'ask' || (bot.approvalMode === 'capped-automatic' && BigInt(policy.debit) > BigInt(bot.autoApproveCap ?? '0'))) {
    approvalId = `approve_${crypto.randomUUID()}`;
    const saved = await supabaseWrite(env, {
      path: 'approvals', prefer: 'return=minimal', fetcher: env.fetch,
      body: {
        id: approvalId, owner_id: ownerId, bot_id: bot.id, policy_version: bot.policyVersion,
        digest: policy.digest,
        action: budgetApproval?.action ?? 'approve',
        expires_at: new Date(budgetApproval?.expiresAt ?? proposal.expiresAt).toISOString(),
      },
    });
    if (!saved.ok) return { state: 'blocked', reason: 'approval-save-failed' };
  }
  const reserved = await env.ledgerApi.reserveBudget({ ownerId, now, idempotencyKey, proposal, approvalId });
  if (reserved?.replay === true) return { state: 'blocked', reason: 'duplicate-spend' };
  if (reserved?.state === 'ready-to-reserve') return { state: 'blocked', reason: 'reserve-failed' };
  return reserved;
}

async function verifyBudgetApproval(token, key, { ownerId, spend, terms, now, proposal }) {
  const match = /^v1\.([0-9]{13})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return null;
  const expiresAt = Number(match[1]);
  if (expiresAt <= now || expiresAt > now + 300_000) return null;
  const encoder = new TextEncoder();
  const secret = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = Uint8Array.from(match[2].match(/../g), byte => Number.parseInt(byte, 16));
  const message = spendApprovalMessage({ ownerId, spend, terms, expiresAt });
  if (!await crypto.subtle.verify('HMAC', secret, signature, encoder.encode(message))) return null;
  return {
    ownerId, botId: spend.botId, policyVersion: terms.policyVersion,
    action: 'approve-once', expiresAt: Math.min(expiresAt, proposal.expiresAt), digest: proposalDigest(proposal),
  };
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function handleSpend(request, env = {}) {
  const swap = (await request.clone().json().catch(() => null))?.action === 'swap';
  if (!swap) return handleSpendRequest(request, env);
  let response;
  try {
    response = await handleSpendRequest(request, env);
  } catch {
    response = json({ error: 'swap_failed', signed: false }, 502);
  }
  const body = await response.json();
  if (body.signed !== true && !body.swapPreview && !body.spendAuthorization) {
    body.failure = swapFailure(body);
  }
  return json(body, response.status);
}

async function handleSpendRequest(request, env = {}) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const { ownerId, error } = await resolveSpendOwner(request, env);
  if (error) return json({ error, signed: false }, ownerAuthStatus(error));
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
  const swap = parsed.action === 'swap';
  const laso = parsed.action === 'x402';
  const browserPayment = parseLasoBrowserPayment(raw.lasoPayment);
  if (raw.lasoPayment !== undefined && (!laso || !parsed.confirmed || !browserPayment
      || browserPayment.phase === 'prepared' || raw.spendAuthorization !== undefined)) {
    return json({ error: 'invalid_laso_payment', signed: false }, 400);
  }
  const assetTransfer = laso || swap || parsed.asset !== 'USDC';
  const overrideToken = request.headers.get('x-spend-approve-once');
  const approvalKey = supabaseConfig(env)?.key;
  const prepareAuthorization = raw.spendAuthorization === 'prepare';
  const ownerAuthorization = parseSpendAuthorizationSignature(raw.spendAuthorization);
  if (browserPayment && (!approvalKey || !desk.ok || desk.via !== 'grant')) {
    return json({ error: desk.ok ? 'invalid_laso_payment' : 'desk_locked', signed: false }, 403);
  }
  if (raw.spendAuthorization !== undefined
    && (!assetTransfer || !parsed.confirmed || (!prepareAuthorization && !ownerAuthorization))) {
    return json({ error: 'invalid_spend_authorization', signed: false }, 400);
  }
  if ((prepareAuthorization || ownerAuthorization)
    && (!approvalKey || typeof env.transferClient?.formatPreparedSpendAuthorization !== 'function')) {
    return json({ error: 'wallet_authorization_unavailable', signed: false }, 503);
  }
  if ((prepareAuthorization || ownerAuthorization) && desk.ok && desk.via !== 'grant') {
    return json({ error: 'invalid_spend_authorization', signed: false }, 403);
  }
  const solHandleApproval = approvalKey && parsed.asset === 'SOL' && parsed.action === 'spend'
    && parsed.confirmed && parsed.handle && parsed.destination && parsed.idempotencyKey;
  if (overrideToken !== null && (!solHandleApproval || (desk.ok && desk.via !== 'grant'))) {
    return json({ error: 'invalid_spend_approval', signed: false }, 403);
  }
  if (assetTransfer && mainnetQuoteBlocksSpend(parsed.quote)) return json({ state: 'quote-not-authorization', signed: false }, 409);

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
  if (browserPayment?.phase === 'settle' && (browserPayment.expiresAt <= now
      || browserPayment.expiresAt > now + SPEND_AUTHORIZATION_TTL_MS
      || browserPayment.walletAddress !== context.wallet.address)) {
    return json({ error: 'laso_payment_expired', signed: false }, 409);
  }
  const lasoOffer = laso ? readLasoTicket(parsed.lasoTicket, ownerId, parsed.botId, approvalKey, now) : null;
  if (laso && (!lasoOffer || lasoOffer.amount !== parsed.amount)) return json({ error: 'laso_ticket_invalid', signed: false }, 409);
  if (laso && (!env.transferClient?.prepareSolanaX402Payment || !(browserPayment
      ? env.transferClient?.verifyPreparedSolanaX402Payment : env.transferClient?.signPreparedSolanaX402Payment)
      || !env.ledgerApi?.reserveBudget || !approvalKey)) return json({ error: 'laso_unavailable', signed: false }, 503);
  const usdBudget = context.bot.cap?.asset === 'USD';
  const loopSwap = isLoopSwapKey(parsed.idempotencyKey);
  const activeLoopSwap = async () => {
    const pending = await useLoopSwap(env, ownerId, parsed);
    return matchesLoopSwap(pending?.intent, parsed, context, Number.isSafeInteger(env.spendNow) ? now : Date.now());
  };
  // A queued agent swap runs without the slide only on the same terms as an agent send:
  // Full or Review permission, within the review cap, trusted, and through the same desk check.
  const autoSwap = raw.autoSwap === true;
  if (autoSwap && (!swap || !loopSwap || (parsed.permission !== 'full' && parsed.permission !== 'review')
      || typeof raw.swapTicket !== 'string' || raw.spendAuthorization !== undefined || overrideToken !== null)) {
    return json({ error: 'invalid_auto_swap', signed: false }, 400);
  }
  if (loopSwap && (!swap || !await activeLoopSwap())) {
    return json({ error: 'swap_intent_unavailable', signed: false }, 409);
  }
  if (swap) {
    if (SOLANA_CLUSTER !== 'mainnet-beta') return json({ error: 'wrong_cluster', signed: false }, 409);
    if (!usdBudget) return json({ error: 'swap_requires_usd_budget', signed: false }, 409);
    if (context.bot.frozen || !context.bot.enabled || context.wallet.frozen) {
      return json({ state: 'blocked', reason: 'spend-frozen', signed: false }, 409);
    }
    if (!parsed.idempotencyKey) return json({ error: 'idempotency_key_required', signed: false }, 400);
    if (!approvalKey || !env.JUPITER_API_KEY || !env.transferClient?.prepareSolanaSwap
        || !env.transferClient?.signPreparedSolanaTransfer || !env.ledgerApi?.reserveBudget) {
      return json({ error: 'swap_unavailable', signed: false }, 503);
    }
    if (!parsed.confirmed && !autoSwap) {
      try {
        const preview = await previewLiveSwap(env, context, parsed, approvalKey, now);
        return json({ state: 'approval-needed', signed: false, swapPreview: preview });
      } catch (error) {
        const failure = swapFailure({ error: error?.code || error?.message, simulationReason: error?.simulationReason });
        return json({ error: failure.code === 'swap_failed' ? 'swap_quote_unavailable' : failure.code, signed: false }, 409);
      }
    }
    if (!autoSwap && desk.ok && (desk.via !== 'grant' || (!prepareAuthorization && !ownerAuthorization))) {
      return json({ error: 'swap_owner_authorization_required', signed: false }, 403);
    }
  }
  if ((usdBudget || laso) && !desk.ok) return json({ error: 'desk_locked', signed: false }, 403);
  if (usdBudget && !swap && (parsed.action === 'buy' || parsed.action === 'sell')) {
    return json({ error: 'swap_mints_required', signed: false }, 400);
  }
  const swapOffer = swap ? readSwapTicket(raw.swapTicket, context, parsed, approvalKey, now) : null;
  if (swap && !swapOffer) return json({ error: 'swap_quote_expired', signed: false }, 409);
  if (ownerAuthorization && (ownerAuthorization.expiresAt <= now
    || ownerAuthorization.expiresAt > now + SPEND_AUTHORIZATION_TTL_MS)) {
    return json({ error: 'spend_authorization_expired', signed: false }, 409);
  }
  const mint = parsed.asset === 'USDC' ? SOLANA_USDC_MINT : (parsed.asset === 'SOL' ? SOL_TRUST_MINT : parsed.asset);
  let lookedUp = await spendTrustScore(env, mint);
  if (swap) {
    const outputTrust = await spendTrustScore(env, mintForAsset(parsed.outputAsset));
    if (lookedUp.unavailable || outputTrust.unavailable) return json({ state: 'blocked', reason: 'trust-unavailable', signed: false }, 409);
    if (BigInt(outputTrust.score) < BigInt(lookedUp.score)) lookedUp = outputTrust;
  }
  const trustUnavailable = lookedUp.unavailable === true;
  const trustScore = trustUnavailable ? undefined : lookedUp.score;
  const recipient = laso ? lasoOffer.accepted.payTo : swap ? context.wallet.address : (assetTransfer || usdBudget)
    ? await transferDestination(env, parsed)
    : (parsed.destination || parsed.handle || (parsed.selfCustody ? context.wallet.address : ''));
  if (typeof recipient !== 'string' || recipient.length < 1) {
    return json({ error: assetTransfer ? 'recipient_address_missing' : 'invalid_spend', signed: false }, 400);
  }
  const id = lasoOffer?.purchaseId || parsed.idempotencyKey || (assetTransfer || usdBudget ? `spend_${crypto.randomUUID()}` : `spend_${parsed.botId}`);
  let prepared = null;
  let blockhash;
  let valuation = swapOffer;
  // A proposal may run the gates without an unlock or confirmation, but it cannot sign.
  if ((laso || usdBudget || (assetTransfer && desk.ok && parsed.confirmed && context.bot.cap?.asset === parsed.asset))
      && !context.wallet.frozen && !context.bot.frozen) {
    if (!parsed.idempotencyKey && assetTransfer) return json({ error: 'idempotency_key_required', signed: false }, 400);
    if (!env.ledgerApi?.reserveBudget || !(laso ? (browserPayment ? env.transferClient?.verifyPreparedSolanaX402Payment : env.transferClient?.signPreparedSolanaX402Payment) : env.transferClient?.signPreparedSolanaTransfer)) {
      return json({ error: 'asset_transfer_unavailable', signed: false }, 503);
    }
    try {
      if (laso) {
        ({ prepared, blockhash } = await prepareLasoPayment(env, context, lasoOffer, browserPayment?.blockhash ?? ownerAuthorization?.blockhash));
        if (usdBudget) valuation = await valueUsdSpend(env, { mint, decimals: 6, amount: parsed.amount, feeLamports: '0', now });
      } else if (swap) {
        blockhash = swapOffer.blockhash;
        if (ownerAuthorization && ownerAuthorization.blockhash !== blockhash) throw new Error('simulation_failed');
        prepared = await prepareApprovedSwap(env, context, parsed, swapOffer);
      } else {
        let decimals;
        ({ prepared, blockhash, decimals } = await prepareAssetTransfer(env, parsed, context.wallet, recipient, id, ownerAuthorization?.blockhash));
        if (usdBudget) {
          const feeLamports = parsed.asset === 'USDC' ? prepared.maxSolCost : prepared.feeLamports;
          if (!feeLamports) throw new Error('simulation_failed');
          valuation = await valueUsdSpend(env, { mint, decimals, amount: parsed.amount, feeLamports, now });
        }
      }
    } catch (error) {
      const known = ['unsupported_mint', 'simulation_failed', 'invalid_destination', 'usd_price_unavailable', ...(swap ? ['swap_simulation_unavailable'] : [])];
      const code = known.includes(error?.code) ? error.code : known.includes(error?.message) ? error.message : 'transfer_preparation_failed';
      const simulationReason = typeof error?.simulationReason === 'string'
        && /^[a-zA-Z0-9_]{1,100}$/.test(error.simulationReason) ? error.simulationReason : null;
      const hint = code === 'simulation_failed' && !laso
        ? 'The USDC transfer did not simulate. The wallet needs the USDC and a little SOL for the fee. Nothing was sent.'
        : '';
      return json({ error: code, ...(hint ? { hint } : {}), signed: false, ...(simulationReason ? { simulationReason } : {}) }, 409);
    }
  }
  const facts = {
    asset: parsed.asset,
    mint,
    cluster: SOLANA_CLUSTER,
    price: assetTransfer ? '0' : '1000000',
    amount: parsed.amount,
    ...(trustUnavailable ? { trustUnavailable: true } : { trustScore }),
    reasonSummary: `${parsed.action} ${parsed.amount} ${parsed.asset} on mainnet-beta`,
  };
  const proposal = {
    id,
    botId: parsed.botId,
    cluster: SOLANA_CLUSTER,
    asset: valuation ? 'USD' : parsed.asset,
    recipient,
    quoteId: prepared ? await sha256Hex(prepared.transaction) : (parsed.quote?.pricingCluster === 'mainnet' ? 'mainnet-quote' : SOLANA_CLUSTER),
    outflow: valuation?.outflow ?? parsed.amount,
    expectedReceive: laso ? '1' : swapOffer?.minOutput ?? parsed.amount,
    expectedReceiveAsset: laso ? `laso:card:${parsed.amount}` : parsed.outputAsset ?? parsed.asset,
    maxFee: valuation?.maxFee ?? (parsed.asset === 'SOL' ? prepared?.feeLamports ?? '0' : '0'),
    expiresAt: lasoOffer?.expiresAt ?? swapOffer?.expiresAt ?? now + 120_000,
  };
  const grantOk = desk.ok === true;
  const approvalTerms = prepared && solHandleApproval && desk.via === 'grant'
    ? { walletId: context.wallet.id, walletAddress: context.wallet.address, policyVersion: context.bot.policyVersion, feeLamports: prepared.feeLamports }
    : null;
  const budgetApproval = overrideToken && approvalTerms
    ? await verifyBudgetApproval(overrideToken, approvalKey, { ownerId, spend: parsed, terms: approvalTerms, now, proposal })
    : null;
  if (overrideToken !== null && approvalTerms && !budgetApproval) {
    return json({ error: 'invalid_spend_approval', signed: false }, 403);
  }
  let signSolana;
  let beforeSign;
  let privyFailure;
  let authorizationChallenge;
  let lasoReceipt;
  let lasoFailure;
  let lasoChallenge;
  let browserPartial;
  if (prepared) {
    const accessToken = request.headers.get('authorization')?.match(/^Bearer ([^\s]{1,8192})$/i)?.[1];
    signSolana = async ({ bot, wallet }) => {
      try {
        if (laso) {
          if (lasoOffer.expiresAt <= Date.now() && !Number.isSafeInteger(env.spendNow)) throw new Error('laso_ticket_invalid');
          const partial = browserPayment ? browserPartial : await env.transferClient.signPreparedSolanaX402Payment({
            bot, wallet, prepared, ...(ownerAuthorization ? { ownerAuthorization } : { accessToken }),
          });
          lasoReceipt = await settleLasoPayment(env, lasoOffer, partial.transaction);
          return lasoReceipt;
        }
        return await env.transferClient.signPreparedSolanaTransfer({
          bot, wallet, prepared, ...(ownerAuthorization ? { ownerAuthorization } : { accessToken }),
        });
      } catch (error) {
        privyFailure = parsePrivySigningFailure(error?.privyFailure);
        if (laso && ['laso_settlement_unknown', 'laso_payment_rejected', 'laso_ticket_invalid'].includes(error?.message)) lasoFailure = error.message;
        throw error;
      }
    };
    beforeSign = async ({ bot, wallet, proposal, policy, approvedOnce }) => {
      if (browserPayment) {
        const expiresAt = browserPayment.phase === 'settle' ? browserPayment.expiresAt
          : Math.min(proposal.expiresAt, now + SPEND_AUTHORIZATION_TTL_MS);
        const binding = JSON.stringify([
          'maelstrom:laso-browser-payment:v1', ownerId, bot.id, id, wallet.id, wallet.address,
          bot.policyVersion, expiresAt, blockhash, prepared.transaction,
        ]);
        const proof = createHmac('sha256', approvalKey).update(binding).digest();
        if (browserPayment.phase === 'prepare') {
          lasoChallenge = { phase: 'prepared', transaction: prepared.transaction,
            walletAddress: wallet.address, expiresAt, blockhash, proof: proof.toString('hex') };
          return { state: 'awaiting-wallet-authorization' };
        }
        if (!timingSafeEqual(proof, Buffer.from(browserPayment.proof, 'hex'))) {
          return { state: 'blocked', reason: 'laso_payment_changed' };
        }
        browserPartial = await env.transferClient.verifyPreparedSolanaX402Payment({
          bot, wallet, prepared, signedTransaction: browserPayment.transaction,
        });
      }
      if (prepareAuthorization || ownerAuthorization) {
        const expiresAt = ownerAuthorization?.expiresAt ?? Math.min(proposal.expiresAt, now + SPEND_AUTHORIZATION_TTL_MS);
        const payload = env.transferClient.formatPreparedSpendAuthorization({ bot, wallet, prepared, expiresAt });
        const binding = JSON.stringify([
          'maelstrom:spend-authorization:v1', ownerId, bot.id, id, wallet.id, bot.policyVersion,
          prepared.feeLamports, blockhash, payload, overrideToken,
        ]);
        const mac = createHmac('sha256', approvalKey).update(binding).digest();
        if (prepareAuthorization) {
          authorizationChallenge = { payload, blockhash, expiresAt, proof: mac.toString('hex') };
          return { state: 'awaiting-wallet-authorization' };
        }
        if (!timingSafeEqual(mac, Buffer.from(ownerAuthorization.proof, 'hex'))) {
          return { state: 'blocked', reason: 'spend_authorization_changed' };
        }
      }
      if (loopSwap && !await activeLoopSwap()) return { state: 'blocked', reason: 'swap_intent_unavailable' };
      return reserveAssetTransfer(env, {
        ownerId, bot, proposal, policy, now, idempotencyKey: id, budgetApproval: approvedOnce ? budgetApproval : null,
      });
    };
  } else if (!assetTransfer && !usdBudget && grantOk) {
    if (parsed.destination && env.transferClient) signSolana = async ({ bot, wallet, memo }) => {
      const sent = await transferSolanaUsdc({
        client: env.transferClient,
        bot,
        wallet,
        destination: parsed.destination,
        amount: parsed.amount,
        memo,
      });
      return { cluster: sent.cluster, signature: sent.signature };
    };
    if (typeof env.ledgerApi?.reserveBudget === 'function') {
      beforeSign = ({ proposal }) => env.ledgerApi.reserveBudget({ ownerId, now, idempotencyKey: id, proposal });
    }
  }

  let result;
  try {
    result = await runPermissionedSpend({
      bot: context.bot,
      wallet: context.wallet,
      ledger: context.ledger,
      proposal,
      trustScore,
      trustUnavailable,
      ...(swap ? { trustConfirmed: !autoSwap && parsed.confirmed === true } : {}),
      mainFn: async () => facts,
      verifyFn: typeof env.spendVerifyFn === 'function'
        ? env.spendVerifyFn
        : async () => verifierFacts({
          facts,
          proposal: valuation ? { ...proposal, asset: parsed.asset, outflow: parsed.amount } : proposal,
          parsed: assetTransfer || usdBudget ? { ...parsed, destination: recipient } : parsed,
          trustScore,
          trustUnavailable,
          mint,
        }),
      now,
      ownerPermission: assetTransfer && !autoSwap ? 'ask' : parsed.permission,
      confirmed: autoSwap ? false : parsed.confirmed,
      reviewCap: parsed.reviewCap,
      quote: parsed.quote,
      signSolana,
      beforeSign,
      budgetApproval,
    });
  } catch {
    return json({ error: 'spend_failed', signed: false }, 400);
  }

  if (authorizationChallenge && result.reason === 'awaiting-wallet-authorization') {
    return json({ signed: false, spendAuthorization: authorizationChallenge });
  }
  if (lasoChallenge && result.reason === 'awaiting-wallet-authorization') {
    return json({ signed: false, lasoPayment: lasoChallenge });
  }

  let state = result.state;
  const perTransferLimit = result.state === 'approval-needed' && result.reason === 'per-transaction';
  if (!grantOk && (state === 'signer-not-configured' || (solHandleApproval && perTransferLimit))) state = 'desk_locked';
  else if (state === 'signer-not-configured' && !assetTransfer && !parsed.destination && !parsed.selfCustody) state = 'recipient_address_missing';
  const body = {
    ok: result.signed === true,
    state,
    steps: result.steps,
    signed: result.signed === true,
    ...(laso ? { provider: 'laso' } : {}),
    cluster: SOLANA_CLUSTER,
    reason: result.reason || null,
    ...(privyFailure ? { privyFailure } : {}),
    ...(lasoFailure ? { error: lasoFailure } : {}),
    ...(prepared ? { feeLamports: prepared.feeLamports } : {}),
    ...(overrideToken === null && approvalTerms && perTransferLimit ? { approvalTerms } : {}),
  };
  if (state === 'desk_locked') body.error = 'desk_locked';
  if (usdBudget && result.policy?.debit) body.usdMicros = result.policy.debit;
  if (typeof result.trust?.prompt === 'string') body.prompt = result.trust.prompt;
  if (result.signed === true && grantOk) {
    body.signature = result.signature;
    if (lasoReceipt?.card) body.card = lasoReceipt.card;
    if (lasoReceipt?.claimUrl) body.claimUrl = lasoReceipt.claimUrl;
    if (loopSwap) await useLoopSwap(env, ownerId, parsed, result.signature);
  }
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
  const status = state === 'desk_locked'
    ? 403
    : ((result.signed && grantOk) || state === 'reserved' ? 200 : 409);
  return json(body, status);
}
