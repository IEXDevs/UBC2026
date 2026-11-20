import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
/**
 * x402 buyer for the price/trust Worker.
 * Reserves bot-policy budget, then pays mainnet-beta USDC from the bot wallet.
 * Signing goes through the transfers mainnet-beta helper. No RPC client is opened here.
 */
import { randomBytes } from 'node:crypto';
import { SOLANA_USDC_MINT, NETWORKS, X402Error, buildPaymentSignature, paymentFeedEntry } from '@ubc2026/x402';
import { PolicyError } from '@ubc2026/bot-policy/ledger';
import { TransferError, transferSolanaUsdc } from '@ubc2026/transfers';

const KEY = /^[a-zA-Z0-9:_-]{1,128}$/;
const fail = message => { throw new X402Error(message); };

export function buildX402Proposal({ bot, accepted, kind, mint, now, attemptId }) {
  const timeout = Number.isSafeInteger(accepted?.maxTimeoutSeconds) && accepted.maxTimeoutSeconds > 0
    ? Math.min(accepted.maxTimeoutSeconds, 600)
    : 60;
  return {
    id: attemptId,
    botId: bot.id,
    cluster: SOLANA_CLUSTER,
    asset: 'USDC',
    recipient: accepted.payTo,
    quoteId: `${kind}:${mint}`,
    outflow: accepted.amount,
    expectedReceive: '1',
    expectedReceiveAsset: kind === 'price' ? 'price-quote' : 'trust-score',
    maxFee: '0',
    expiresAt: now + timeout,
  };
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

export function createX402BotClient({
  baseUrl,
  fetcher = fetch,
  bot,
  wallet,
  ownerId,
  ledger,
  client,
  now,
  recentBlockhash,
  payTo = null,
} = {}) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) fail('x402 service base URL is required');
  if (!bot || !wallet || !ledger || typeof ledger.reserveBudget !== 'function') fail('Bot policy ledger is required');
  if (!Number.isSafeInteger(now) || now <= 0) fail('Explicit server time is required');

  async function request(url, paymentSignature) {
    const headers = { accept: 'application/json' };
    if (paymentSignature) headers['payment-signature'] = paymentSignature;
    try {
      return await fetcher(url, { method: 'GET', headers, signal: AbortSignal.timeout(15000) });
    } catch {
      fail('x402 service unavailable');
    }
  }

  function localBlock() {
    if (ownerId !== bot.ownerId || wallet.ownerId !== bot.ownerId || wallet.id !== bot.walletId) {
      return { state: 'blocked', reason: 'wallet-mismatch', paid: false };
    }
    if (wallet.frozen) return { state: 'blocked', reason: 'wallet-frozen', paid: false };
    if (bot.frozen) return { state: 'blocked', reason: 'bot-frozen', paid: false };
    if (bot.enabled !== true) return { state: 'blocked', reason: 'bot-disabled', paid: false };
    return null;
  }

  async function pay(kind, mint, { approvalId = null, attemptId = null } = {}) {
    const blocked = localBlock();
    if (blocked) return blocked;
    const id = attemptId ?? `x402_${bot.id}_${kind}_${randomBytes(8).toString('hex')}`;
    if (!KEY.test(id)) fail('attemptId is invalid');

    const url = new URL(`/${kind}/${encodeURIComponent(mint)}`, baseUrl).href;
    const first = await request(url);
    if (first.status === 200) {
      return { state: 'cached', kind, mint, body: await readJson(first), paid: false, attemptId: id };
    }
    if (first.status !== 402) fail(`x402 ${kind} request failed with status ${first.status}`);
    const challenge = await readJson(first);
    const accepted = challenge?.accepts?.[0];
    if (!accepted || challenge?.resource?.url !== url) {
      return { state: 'blocked', reason: 'challenge-mismatch', paid: false, attemptId: id };
    }
    if (accepted.scheme !== 'exact' || accepted.network !== NETWORKS.solana || accepted.asset !== SOLANA_USDC_MINT) {
      return { state: 'blocked', reason: 'wrong-cluster', paid: false, attemptId: id };
    }
    if (payTo && accepted.payTo !== payTo) {
      return { state: 'blocked', reason: 'merchant-mismatch', paid: false, attemptId: id };
    }

    const proposal = buildX402Proposal({ bot, accepted, kind, mint, now, attemptId: id });
    let reserved;
    try {
      reserved = await ledger.reserveBudget({
        ownerId,
        now,
        idempotencyKey: id,
        proposal,
        ...(approvalId ? { approvalId } : {}),
      });
    } catch (error) {
      if (error instanceof PolicyError || error?.name === 'PolicyError') {
        return { state: 'blocked', reason: 'invalid-proposal', paid: false, attemptId: id };
      }
      throw error;
    }
    if (reserved?.replay === true) {
      return { state: 'replay', paid: false, attemptId: id, proposal, reserved };
    }
    if (!reserved || reserved.state !== 'reserved') {
      return {
        state: reserved?.state ?? 'blocked',
        reason: reserved?.reason,
        violations: reserved?.violations,
        digest: reserved?.digest,
        proposal,
        attemptId: id,
        paid: false,
      };
    }

    let sent;
    try {
      sent = await transferSolanaUsdc({
        client,
        bot,
        wallet,
        destination: accepted.payTo,
        amount: accepted.amount,
        memo: `x402:${kind}:${mint}`,
        recentBlockhash,
      });
    } catch (error) {
      if (error instanceof TransferError || error?.name === 'TransferError') {
        return { state: 'transfer-failed', reason: error.code ?? 'transfer_error', paid: false, attemptId: id, proposal, reserved };
      }
      throw error;
    }
    if (!sent || sent.cluster !== SOLANA_CLUSTER) fail('Refusing to pay outside Solana mainnet-beta');

    const header = buildPaymentSignature({ accepted, signature: sent.signature });
    const second = await request(url, header);
    const body = await readJson(second);
    const payment = paymentFeedEntry({
      id,
      botId: bot.id,
      recipient: accepted.payTo,
      amount: accepted.amount,
      asset: accepted.asset,
      resourceUrl: url,
      transaction: sent.signature,
      status: second.status === 200 ? 'verified' : 'failed',
      createdAt: now,
    });
    if (second.status !== 200) {
      return { state: 'settlement-failed', paid: false, attemptId: id, proposal, reserved, transfer: sent, payment, detail: body };
    }
    return { state: 'paid', paid: true, kind, mint, body, attemptId: id, proposal, reserved, transfer: sent, payment };
  }

  return {
    price(mint, options) { return pay('price', mint, options ?? {}); },
    trust(mint, options) { return pay('trust', mint, options ?? {}); },
  };
}
