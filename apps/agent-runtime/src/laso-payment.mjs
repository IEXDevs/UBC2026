import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { buildSolanaX402Transaction, selectX402SourceAccount } from '@ubc2026/transfers';

const TTL = 300_000;
const mac = (key, payload) => createHmac('sha256', key).update(payload).digest();

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

function paymentError(reason) {
  const error = new Error('simulation_failed');
  error.code = 'simulation_failed';
  error.simulationReason = reason;
  return error;
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
    if (!sourceTokenAccount) throw paymentError('source_account_not_found');
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

export async function settleLasoPayment(env, ticket, transaction) {
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
  if (typeof card?.card_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(card.card_id)
      && Number(card.usd_amount) === Number(ticket.amount) / 1_000_000
      && ['pending', 'ready'].includes(card.status)) {
    result.card = { card_id: card.card_id, usd_amount: Number(card.usd_amount), status: card.status };
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
  return result;
}
