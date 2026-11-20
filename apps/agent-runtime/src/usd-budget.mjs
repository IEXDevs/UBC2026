import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { createJupiterPriceProvider } from '@ubc2026/prices';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const PRICE = /^(0|[1-9][0-9]{0,19})(?:\.([0-9]{1,24}))?$/;

// Round a nonzero debit up to a microdollar. Keep the original token amount
// in the transaction and independently verified facts.
export function usdMicros(units, decimals, priceUsd) {
  const match = PRICE.exec(priceUsd ?? '');
  if (!AMOUNT.test(units ?? '') || !Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !match) return null;
  const fractional = match[2] || '';
  const price = BigInt(match[1] + fractional);
  if (price === 0n) return null;
  const scale = 10n ** BigInt(decimals + fractional.length);
  const numerator = BigInt(units) * price * 1_000_000n;
  const result = ((numerator + scale - 1n) / scale).toString();
  return AMOUNT.test(result) ? result : null;
}

export async function valueUsdSpend(env, { mint, decimals, amount, feeLamports, now }) {
  const lookup = env.lookupSpendPrice ?? createJupiterPriceProvider({
    fetcher: env.fetch ?? fetch,
    apiKey: env.JUPITER_API_KEY,
  });
  async function priceFor(address) {
    const quote = await lookup(address);
    const reference = Number.isSafeInteger(env.spendNow) ? now : Date.now();
    const age = reference - Date.parse(quote?.fetchedAt);
    if (quote?.mint !== address || quote.pricingCluster !== 'mainnet' || quote.executionCluster !== SOLANA_CLUSTER
        || !Number.isFinite(age) || age < -10_000 || age > 60_000) throw new Error('usd_price_unavailable');
    return quote.priceUsd;
  }
  const input = priceFor(mint);
  const [price, solPrice] = await Promise.all([
    input,
    feeLamports === '0' ? null : mint === SOL_MINT ? input : priceFor(SOL_MINT),
  ]);
  const outflow = usdMicros(amount, decimals, price);
  const maxFee = feeLamports === '0' ? '0' : usdMicros(feeLamports, 9, solPrice);
  if (!outflow || outflow === '0' || maxFee == null || !AMOUNT.test((BigInt(outflow) + BigInt(maxFee)).toString())) {
    throw new Error('usd_price_unavailable');
  }
  return { outflow, maxFee };
}
