import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { buildSolanaX402Transaction, selectX402SourceAccount } from '@ubc2026/transfers';

const TTL = 300_000;
const mac = (key, payload) => createHmac('sha256', key).update(payload).digest();

/** Internal worker→DO header carrying a fresh Laso session. Never from the public edge. */
export const INTERNAL_LASO_SESSION_HEADER = 'x-maelstrom-laso-session';
export const INTERNAL_LASO_SESSION_VALUE = 'laso-session';

/**
 * Stash a fresh Laso id_token in the bot Durable Object so later status reads
 * can run without asking the owner to log in again. The token lives only in
 * DO storage under the owner-bound bot, expires with the Laso session, and is
 * never logged, never put on the timeline, and never echoed back. Offline
 * environments without a BOT binding skip silently. Never throws.
 */
export async function saveLasoSession(env, ticket, idToken, expiresIn, now = Date.now()) {
  try {
    if (!env?.BOT || typeof env.BOT.idFromName !== 'function' || typeof env.BOT.get !== 'function') return false;
    const botId = ticket?.botId;
    const ownerId = ticket?.ownerId;
    if (typeof botId !== 'string' || !botId || typeof ownerId !== 'string' || !ownerId) return false;
    if (typeof idToken !== 'string' || !idToken || idToken.length > 8192) return false;
    const ttl = Number.isFinite(Number(expiresIn)) && Number(expiresIn) > 0
      ? Math.min(Math.floor(Number(expiresIn)), 86400)
      : 3600;
    const stub = env.BOT.get(env.BOT.idFromName(botId));
    const response = await stub.fetch(new Request('https://bot/laso/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-owner-id': ownerId,
        [INTERNAL_LASO_SESSION_HEADER]: INTERNAL_LASO_SESSION_VALUE,
      },
      body: JSON.stringify({ ownerId, botId, idToken, expiresAt: now + ttl * 1000 }),
    }));
    return response.ok === true;
  } catch {
    return false;
  }
}

export function issueLasoTicket(result, ownerId, botId, key, now = Date.now()) {
  const accepted = result.challenge.accepted;
  const state = {
    version: 1, ownerId, botId, purchaseId: `laso_${randomUUID()}`,
    resource: result.resource, accepted, amount: accepted.amount,
    expiresAt: now + Math.min(300, accepted.maxTimeoutSeconds) * 1000,
  };
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${mac(key, payload).toString('hex')}`;
}

export function readLasoTicket(ticket, ownerId, botId, key, now = Date.now()) {
  if (!key || typeof ticket !== 'string' || ticket.length > 5000) return null;
  const match = /^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(ticket);
  if (!match || !timingSafeEqual(mac(key, match[1]), Buffer.from(match[2], 'hex'))) return null;
  try {
    const state = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    if (state.version !== 1 || state.ownerId !== ownerId || state.botId !== botId
        || !Number.isSafeInteger(state.expiresAt) || state.expiresAt <= now || state.expiresAt > now + TTL) return null;
    return state;
  } catch { return null; }
}

function paymentError(reason, usdcBalance) {
  const error = new Error('simulation_failed');
  error.code = 'simulation_failed';
  error.simulationReason = reason;
  if (typeof usdcBalance === 'string') error.usdcBalance = usdcBalance;
  return error;
}

function totalUsdc(accounts) {
  let total = 0n;
  for (const row of Array.isArray(accounts) ? accounts : []) {
    if (typeof row?.amount === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(row.amount)) total += BigInt(row.amount);
  }
  return total;
}

export async function prepareLasoPayment(env, context, ticket, blockhash) {
  if (SOLANA_CLUSTER !== 'mainnet-beta') throw new Error('wrong_cluster');
  const client = env.transferClient;
  if (!blockhash) {
    const block = await client.getSolanaBlockhash();
    if (block?.cluster !== SOLANA_CLUSTER) throw new Error('wrong_cluster');
    blockhash = block.blockhash;
  }
  let sourceTokenAccount;
  if (typeof client.listSolanaUsdcAccounts === 'function') {
    const accounts = await client.listSolanaUsdcAccounts({ address: context.wallet.address });
    sourceTokenAccount = selectX402SourceAccount(context.wallet.address, accounts, ticket.accepted.amount);
    if (!sourceTokenAccount) {
      const total = totalUsdc(accounts);
      throw paymentError(total > 0n ? 'insufficient_funds' : 'source_account_not_found', total > 0n ? total.toString() : undefined);
    }
  }
  const built = buildSolanaX402Transaction({
    sourceOwner: context.wallet.address, sourceTokenAccount, accepted: ticket.accepted, recentBlockhash: blockhash,
  });
  const prepared = await client.prepareSolanaX402Payment({
    ...built, walletAddress: context.wallet.address, accepted: ticket.accepted,
  });
  if (prepared?.transaction !== built.transaction) throw new Error('simulation_failed');
  return { prepared, blockhash };
}

export async function settleLasoPayment(env, ticket, transaction, poll = { tries: 6, delayMs: 2000 }) {
  let response;
  try {
    response = await (env.fetch ?? fetch)(ticket.resource.url, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify({
          x402Version: 2, resource: ticket.resource, accepted: ticket.accepted, payload: { transaction },
        })).toString('base64'),
      },
    });
  } catch { throw new Error('laso_settlement_unknown'); }
  if (response.status !== 200) throw new Error(response.status === 402 ? 'laso_payment_rejected' : 'laso_settlement_unknown');
  let receipt;
  try { receipt = JSON.parse(Buffer.from(response.headers.get('PAYMENT-RESPONSE') ?? '', 'base64').toString('utf8')); } catch { /* validated below */ }
  if (receipt?.success !== true || receipt.network !== ticket.accepted.network
      || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt.transaction ?? '')) throw new Error('laso_settlement_unknown');
  const body = await response.json().catch(() => null);
  const card = body?.card;
  const result = { cluster: SOLANA_CLUSTER, signature: receipt.transaction };
  // A paid call returns a fresh session. Stash it for later status reads so the
  // owner is not asked to log in again. The paid receipt stands on its own.
  if (body && typeof body === 'object' && typeof body.auth?.id_token === 'string') {
    await saveLasoSession(env, ticket, body.auth.id_token, body.auth.expires_in);
  }
  // KYC-gated routes (Venmo/PayPal) answer kyc_required after payment: the USDC
  // is credited to the Laso account balance and nothing was dispatched.
  // Surface the owner link instead of reporting an unknown settlement.
  if (body && typeof body === 'object' && body.kyc_required === true) {
    result.kycRequired = true;
    if (typeof body.kyc_url === 'string' && /^https:\/\/[^\s/$.?#].[^\s]*$/.test(body.kyc_url)) {
      result.kyc_url = body.kyc_url;
    }
    result.note = 'KYC verification is required before this payout dispatches. Complete the flow at kyc_url and retry, or recover the credited balance with POST /withdraw.';
    return result;
  }
  if (typeof card?.card_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(card.card_id)
      && Number(card.usd_amount) === Number(ticket.amount) / 1_000_000
      && ['pending', 'ready'].includes(card.status)) {
    result.card = { card_id: card.card_id, usd_amount: Number(card.usd_amount), status: card.status };
  }
  // Gift cards complete immediately: the redemption fields are the product.
  const gift = body?.gift_card;
  if (gift && typeof gift === 'object' && typeof gift.card_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(gift.card_id)) {
    result.giftCard = {
      card_id: gift.card_id,
      ...(typeof gift.laso_server_id === 'string' ? { laso_server_id: gift.laso_server_id } : {}),
      ...(Number.isFinite(Number(gift.amount)) ? { amount: Number(gift.amount) } : {}),
      ...(typeof gift.currency === 'string' ? { currency: gift.currency } : {}),
      ...(typeof gift.country === 'string' ? { country: gift.country } : {}),
      ...(typeof gift.status === 'string' ? { status: gift.status } : {}),
      ...(typeof gift.redemption_code === 'string' ? { redemption_code: gift.redemption_code } : {}),
      ...(typeof gift.pin_code === 'string' ? { pin_code: gift.pin_code } : {}),
      ...(typeof gift.redemption_url === 'string' && gift.redemption_url.startsWith('https://')
        ? { redemption_url: gift.redemption_url } : {}),
    };
  }
  // International cards queue for admin fulfillment, usually within 24 hours.
  const intl = body?.intl_card_order;
  if (intl && typeof intl === 'object' && typeof intl.card_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(intl.card_id)) {
    result.intlCardOrder = {
      card_id: intl.card_id,
      ...(Number.isFinite(Number(intl.on_card_usd_amount)) ? { on_card_usd_amount: Number(intl.on_card_usd_amount) } : {}),
      ...(Number.isFinite(Number(intl.charged_usd_amount)) ? { charged_usd_amount: Number(intl.charged_usd_amount) } : {}),
      ...(typeof intl.status === 'string' ? { status: intl.status } : {}),
    };
  }
  // Balance top-ups confirm payment only; delivery lands under a minute later.
  const topUp = body && typeof body === 'object' && body.top_up_id != null ? body : null;
  if (topUp && (typeof topUp.top_up_id === 'string' || typeof topUp.top_up_id === 'number')
      && ['paid', 'queued'].includes(topUp.status)) {
    result.topUp = {
      top_up_id: String(topUp.top_up_id),
      status: topUp.status,
      ...(Number.isFinite(Number(topUp.funded_usd)) ? { funded_usd: Number(topUp.funded_usd) } : {}),
    };
    result.note = 'The card balance delivery usually lands within a minute. Confirm it with GET /list-card-transactions before creating a card.';
  }
  // Use the session only for the owner's one-time dashboard link, then discard it.
  if (typeof body?.auth?.id_token === 'string') {
    try {
      const linkResponse = await (env.fetch ?? fetch)('https://laso.finance/get-auth-link', {
        headers: { Authorization: `Bearer ${body.auth.id_token}` }, redirect: 'manual', signal: AbortSignal.timeout(10_000),
      });
      const link = linkResponse.ok && await linkResponse.json();
      const url = new URL(link.auth_url);
      if (url.origin === 'https://laso.finance' && url.pathname === '/agent/dashboard/auth'
          && !url.username && !url.password) result.claimUrl = url.href;
    } catch { /* The paid receipt remains valid without a login link. */ }
  }
  // USA cards return pending: poll the account's own card read until ready so a
  // pending card is never reported as finished. The pending id is not the purchase.
  if (result.card?.status === 'pending' && typeof body?.auth?.id_token === 'string'
      && (() => { try { return new URL(ticket.resource.url).pathname === '/get-card'; } catch { return false; } })()) {
    const ready = await pollLasoCardReady(env.fetch ?? fetch, result.card.card_id, body.auth.id_token, poll);
    if (ready?.status === 'ready') {
      result.card = { ...result.card, status: 'ready' };
      if (typeof ready.last4 === 'string' && /^\d{4}$/.test(ready.last4)) result.card.last4 = ready.last4;
    } else {
      result.note = 'The card is still pending. It usually turns ready within seconds; the owner can watch it on the Laso dashboard link.';
    }
  }
  return result;
}

/**
 * Poll GET /get-card-data until the USA card turns ready. Bounded and read-only:
 * a few tries a couple of seconds apart, then stop and let the dashboard link
 * finish the job. Never returns the PAN, CVV, or expiry.
 */
export async function pollLasoCardReady(fetcher, cardId, idToken, { tries = 6, delayMs = 2000 } = {}) {
  const fetchFn = typeof fetcher === 'function' ? fetcher : fetch;
  for (let attempt = 0; attempt < Math.max(1, Math.min(12, tries)); attempt++) {
    if (attempt > 0 && delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    let response;
    try {
      response = await fetchFn(`https://laso.finance/get-card-data?card_id=${encodeURIComponent(cardId)}`, {
        headers: { Authorization: `Bearer ${idToken}` }, redirect: 'manual', signal: AbortSignal.timeout(10_000),
      });
    } catch { return null; }
    if (!response?.ok) return null;
    const data = await response.json().catch(() => null);
    if (data && typeof data === 'object' && data.status === 'ready') return data;
    if (data && typeof data === 'object' && data.status !== 'pending') return data;
  }
  return null;
}
