/**
 * Agent-to-agent commerce (Isaac / chunk 6C): bots sell signals over x402 on devnet.
 */
import { buildPaymentRequired, NETWORKS, DEVNET_USDC_MINT, paymentFeedEntry } from '@ubc2026/x402';

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
