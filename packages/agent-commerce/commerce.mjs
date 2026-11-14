/**
 * Agent-to-agent commerce (Isaac / chunk 6C): bots sell signals over x402 on devnet.
 */
import {
  buildPaymentRequired,
  NETWORKS,
  DEVNET_USDC_MINT,
  paymentFeedEntry,
  parsePaymentSignature,
} from '@ubc2026/x402';

export class CommerceError extends Error {}
const fail = message => { throw new CommerceError(message); };

export function buildSignalOffer({
  botId,
  walletAddress,
  feePayer,
  resourceUrl,
  description,
  amount,
  signalId,
}) {
  if (typeof botId !== 'string' || !botId) fail('botId is required');
  if (typeof signalId !== 'string' || !signalId) fail('signalId is required');
  const challenge = buildPaymentRequired({
    resourceUrl,
    description: description ?? `Signal ${signalId} from bot ${botId}`,
    amount,
    payTo: walletAddress,
    feePayer,
    network: NETWORKS.devnet,
    asset: DEVNET_USDC_MINT,
    serviceName: `maelstrom-bot-${botId}`,
  });
  return {
    botId,
    signalId,
    cluster: 'devnet',
    direction: 'earned',
    challenge,
  };
}

export function signalSaleFeedEntry({
  id,
  botId,
  buyer,
  amount,
  resourceUrl,
  transaction = null,
  createdAt = Date.now(),
}) {
  return paymentFeedEntry({
    id,
    botId,
    recipient: buyer,
    amount,
    asset: DEVNET_USDC_MINT,
    resourceUrl,
    transaction,
    status: transaction ? 'paid' : 'requested',
    createdAt,
  });
}

/**
 * Verify a buyer PAYMENT-SIGNATURE against the offer and release the signal payload.
 * Does not broadcast; assumes the buyer already settled on-chain.
 */
export function settleSignalSale({
  offer,
  paymentSignatureHeader,
  signalPayload,
  buyer = '11111111111111111111111111111111',
  paymentId = null,
  now = Date.now(),
} = {}) {
  if (!offer?.challenge?.body?.accepts?.[0]) fail('Signal offer challenge is required');
  if (!signalPayload || typeof signalPayload !== 'object') fail('Signal payload is required');
  const parsed = parsePaymentSignature(paymentSignatureHeader);
  const accepted = offer.challenge.body.accepts[0];
  if (parsed.accepted.amount !== accepted.amount || parsed.accepted.payTo !== accepted.payTo) {
    fail('Payment signature does not match signal offer');
  }
  const id = paymentId || `earn_${offer.botId}_${offer.signalId}`;
  return {
    signalId: offer.signalId,
    botId: offer.botId,
    payload: signalPayload,
    payment: signalSaleFeedEntry({
      id,
      botId: offer.botId,
      buyer,
      amount: accepted.amount,
      resourceUrl: offer.challenge.body.resource.url,
      transaction: parsed.payload.signature,
      createdAt: now,
    }),
    next: 'released',
  };
}
