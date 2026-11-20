/**
 * POST /api/spend — the permissioned spend voice, the glass UI, and Grok Bot share.
 * Order is trust, verify, freeze, policy, approval, then sign.
 * Signing goes through the Privy devnet client from @ubc2026/wallets.
 * Responses carry a signature and a state, never a key or a signed payload.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  parsePermissionedSpendBody, parsePrivySigningFailure, parseSpendAuthorizationSignature, spendApprovalMessage,
} from '@ubc2026/contracts';
import { mainnetQuoteBlocksSpend, runPermissionedSpend } from '@ubc2026/agent-loop';
import { proposalDigest } from '@ubc2026/bot-policy';
import { buildDevnetAssetTransaction, transferDevnetUsdc } from '@ubc2026/transfers';
import { DEVNET_USDC_MINT } from '@ubc2026/wallets/privy';
import { loadOwnerLoopContext, supabaseConfig, supabaseGet, supabaseWrite } from './supabase-rest.mjs';
import { alertFromSpend, publishBotAlert } from './bot-alerts.mjs';
import { deskSpendAllowed, sha256Hex } from './desk-grant.mjs';
import { verifierFacts } from './spend-verifier.mjs';
import { resolveTrustLookup } from './trust-lookup.mjs';

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
  return mint === DEVNET_USDC_MINT ? { score: '800' } : { unavailable: true };
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
    const block = await client.getDevnetBlockhash();
    if (block?.cluster !== 'devnet') throw new Error('wrong_cluster');
    blockhash = block.blockhash;
  }
  let decimals;
  if (parsed.asset !== 'SOL') {
    const mint = await client.readDevnetMint({ mint: parsed.asset });
    if (mint?.cluster !== 'devnet' || mint.mint !== parsed.asset) throw new Error('wrong_mint');
    decimals = mint.decimals;
  }
  const transaction = buildDevnetAssetTransaction({
    asset: parsed.asset, decimals, sourceOwner: wallet.address, destinationOwner: destination,
    amount: parsed.amount, memo: `maelstrom:spend:${id}`, recentBlockhash: blockhash,
  });
  const prepared = await client.prepareDevnetTransfer({ transaction });
  if (prepared?.transaction !== transaction || !/^(0|[1-9]\d{0,19})$/.test(prepared.feeLamports || '')) throw new Error('invalid_simulation');
  return { prepared, blockhash };
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
  const assetTransfer = parsed.asset !== 'USDC';
  const overrideToken = request.headers.get('x-spend-approve-once');
  const approvalKey = supabaseConfig(env)?.key;
  const prepareAuthorization = raw.spendAuthorization === 'prepare';
  const ownerAuthorization = parseSpendAuthorizationSignature(raw.spendAuthorization);
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
  if (ownerAuthorization && (ownerAuthorization.expiresAt <= now
    || ownerAuthorization.expiresAt > now + SPEND_AUTHORIZATION_TTL_MS)) {
    return json({ error: 'spend_authorization_expired', signed: false }, 409);
  }
  const mint = parsed.asset === 'USDC' ? DEVNET_USDC_MINT : (parsed.asset === 'SOL' ? SOL_TRUST_MINT : parsed.asset);
  const lookedUp = await spendTrustScore(env, mint);
  const trustUnavailable = lookedUp.unavailable === true;
  const trustScore = trustUnavailable ? undefined : lookedUp.score;
  const recipient = assetTransfer
    ? await transferDestination(env, parsed)
    : (parsed.destination || parsed.handle || (parsed.selfCustody ? context.wallet.address : ''));
  if (typeof recipient !== 'string' || recipient.length < 1) {
    return json({ error: assetTransfer ? 'recipient_address_missing' : 'invalid_spend', signed: false }, 400);
  }
  const id = parsed.idempotencyKey || (assetTransfer ? `spend_${crypto.randomUUID()}` : `spend_${parsed.botId}`);
  let prepared = null;
  let blockhash;
  // A proposal may run the gates without an unlock or confirmation, but it cannot sign.
  if (assetTransfer && desk.ok && parsed.confirmed && context.bot.cap?.asset === parsed.asset && !context.wallet.frozen && !context.bot.frozen) {
    if (!parsed.idempotencyKey) return json({ error: 'idempotency_key_required', signed: false }, 400);
    if (!env.ledgerApi?.reserveBudget || !env.transferClient?.signPreparedDevnetTransfer) {
      return json({ error: 'asset_transfer_unavailable', signed: false }, 503);
    }
    try {
      ({ prepared, blockhash } = await prepareAssetTransfer(env, parsed, context.wallet, recipient, id, ownerAuthorization?.blockhash));
    } catch (error) {
      const code = ['unsupported_mint', 'simulation_failed', 'invalid_destination'].includes(error?.code) ? error.code : 'transfer_preparation_failed';
      return json({ error: code, signed: false }, 409);
    }
  }
  const facts = {
    asset: parsed.asset,
    mint,
    cluster: 'devnet',
    price: assetTransfer ? '0' : '1000000',
    amount: parsed.amount,
    ...(trustUnavailable ? { trustUnavailable: true } : { trustScore }),
    reasonSummary: `${parsed.action} ${parsed.amount} ${parsed.asset} on devnet`,
  };
  const proposal = {
    id,
    botId: parsed.botId,
    cluster: 'devnet',
    asset: parsed.asset,
    recipient,
    quoteId: prepared ? await sha256Hex(prepared.transaction) : (parsed.quote?.pricingCluster === 'mainnet' ? 'mainnet-quote' : 'devnet'),
    outflow: parsed.amount,
    expectedReceive: parsed.amount,
    expectedReceiveAsset: parsed.asset,
    maxFee: parsed.asset === 'SOL' ? prepared?.feeLamports ?? '0' : '0',
    expiresAt: now + 120_000,
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
  let signDevnet;
  let beforeSign;
  let privyFailure;
  let authorizationChallenge;
  if (prepared) {
    const accessToken = request.headers.get('authorization')?.match(/^Bearer ([^\s]{1,8192})$/i)?.[1];
    signDevnet = async ({ bot, wallet }) => {
      try {
        return await env.transferClient.signPreparedDevnetTransfer({
          bot, wallet, prepared, ...(ownerAuthorization ? { ownerAuthorization } : { accessToken }),
        });
      } catch (error) {
        privyFailure = parsePrivySigningFailure(error?.privyFailure);
        throw error;
      }
    };
    beforeSign = async ({ bot, wallet, proposal, policy, approvedOnce }) => {
      if (prepareAuthorization || ownerAuthorization) {
        const expiresAt = ownerAuthorization?.expiresAt ?? now + SPEND_AUTHORIZATION_TTL_MS;
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
      return reserveAssetTransfer(env, {
        ownerId, bot, proposal, policy, now, idempotencyKey: id, budgetApproval: approvedOnce ? budgetApproval : null,
      });
    };
  } else if (!assetTransfer && grantOk) {
    if (parsed.destination && env.transferClient) signDevnet = async ({ bot, wallet, memo }) => {
      const sent = await transferDevnetUsdc({
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
      mainFn: async () => facts,
      verifyFn: typeof env.spendVerifyFn === 'function'
        ? env.spendVerifyFn
        : async () => verifierFacts({
          facts,
          proposal,
          parsed: assetTransfer ? { ...parsed, destination: recipient } : parsed,
          trustScore,
          trustUnavailable,
          mint,
        }),
      now,
      ownerPermission: assetTransfer ? 'ask' : parsed.permission,
      confirmed: parsed.confirmed,
      reviewCap: parsed.reviewCap,
      quote: parsed.quote,
      signDevnet,
      beforeSign,
      budgetApproval,
    });
  } catch {
    return json({ error: 'spend_failed', signed: false }, 400);
  }

  if (authorizationChallenge && result.reason === 'awaiting-wallet-authorization') {
    return json({ signed: false, spendAuthorization: authorizationChallenge });
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
    cluster: 'devnet',
    reason: result.reason || null,
    ...(privyFailure ? { privyFailure } : {}),
    ...(prepared ? { feeLamports: prepared.feeLamports } : {}),
    ...(overrideToken === null && approvalTerms && perTransferLimit ? { approvalTerms } : {}),
  };
  if (state === 'desk_locked') body.error = 'desk_locked';
  if (typeof result.trust?.prompt === 'string') body.prompt = result.trust.prompt;
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
  const status = state === 'desk_locked'
    ? 403
    : ((result.signed && grantOk) || state === 'reserved' ? 200 : 409);
  return json(body, status);
}
