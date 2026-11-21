import { solscanTxUrl } from './money-views.mjs';

const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function asObject(result) {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
}

/**
 * A broadcast signature is enough to link. Confirmation on Solana is seconds.
 * Use the recorded cluster so older receipts keep their original explorer links.
 */
export function txReceiptFromResult(result) {
  const parsed = asObject(result);
  if (!parsed) return null;
  if (typeof parsed.error === 'string' && parsed.error) return null;
  if (parsed.signed === false || parsed.ok === false) return null;
  const signature = typeof parsed.signature === 'string' ? parsed.signature : '';
  if (!SIG.test(signature)) return null;
  const cluster = parsed.cluster;
  if (!['mainnet-beta', 'mainnet', 'devnet', 'testnet'].includes(cluster)) return null;
  const url = solscanTxUrl(signature, cluster);
  if (!url) return null;
  return {
    signature,
    cluster,
    url,
    text: parsed.card && typeof parsed.card.card_id === 'string'
      ? `Laso card ${parsed.card.card_id}: $${parsed.card.usd_amount}, ${parsed.card.status}. ${url}`
      : parsed.giftCard && typeof parsed.giftCard.card_id === 'string'
        ? `Laso gift card ${parsed.giftCard.card_id} (${parsed.giftCard.laso_server_id}): ${parsed.giftCard.amount} ${parsed.giftCard.currency}, ${parsed.giftCard.status}. ${url}`
        : parsed.intlCardOrder && typeof parsed.intlCardOrder.card_id === 'string'
          ? `Laso international card ${parsed.intlCardOrder.card_id}: $${parsed.intlCardOrder.on_card_usd_amount} queued. ${url}`
          : parsed.topUp && typeof parsed.topUp.top_up_id === 'string'
            ? `Laso card balance top-up $${parsed.topUp.funded_usd}: ${parsed.topUp.status}. ${url}`
            : parsed.kycRequired === true
              ? `Laso needs KYC before this payout dispatches. The funds are credited and recoverable. ${url}`
              : parsed.provider === 'laso'
                ? `Laso payment settled, but card details are unavailable. Check Laso before buying again. ${url}`
                : `Sent. ${url}`,
  };
}

/** Give the model the Solscan URL on the tool payload it already received. */
export function withSolscanUrl(result) {
  const receipt = txReceiptFromResult(result);
  if (!receipt) return result;
  const parsed = asObject(result);
  if (!parsed || typeof parsed.solscanUrl === 'string') return result;
  const next = { ...parsed, solscanUrl: receipt.url };
  return typeof result === 'string' ? JSON.stringify(next) : next;
}
