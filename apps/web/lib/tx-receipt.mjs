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
 * Mainnet signatures are not linked from chat.
 */
export function txReceiptFromResult(result) {
  const parsed = asObject(result);
  if (!parsed) return null;
  if (typeof parsed.error === 'string' && parsed.error) return null;
  if (parsed.signed === false || parsed.ok === false) return null;
  const signature = typeof parsed.signature === 'string' ? parsed.signature : '';
  if (!SIG.test(signature)) return null;
  if (parsed.cluster != null && parsed.cluster !== 'devnet' && parsed.cluster !== 'testnet') return null;
  const cluster = parsed.cluster === 'testnet' ? 'testnet' : 'devnet';
  const url = solscanTxUrl(signature, cluster);
  if (!url) return null;
  return {
    signature,
    cluster,
    url,
    text: `Sent. ${url}`,
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
