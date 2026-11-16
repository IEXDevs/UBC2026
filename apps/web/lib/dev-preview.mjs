/**
 * Sample balances for the local developer preview.
 * Dollar values are filled by a live DexScreener read in the browser.
 */

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

export const DEV_PREVIEW_OWNER = 'developer';

export function samplePortfolio() {
  return {
    cluster: 'mainnet',
    authorizesTransaction: false,
    wallets: [{
      address: SOL,
      label: 'Preview',
      client: 'preview',
      spendable: false,
      holdings: [
        { mint: SOL, symbol: 'SOL', amount: '1500000000', decimals: 9, usdMicro: '0' },
        { mint: USDC, symbol: 'USDC', amount: '25000000', decimals: 6, usdMicro: '0' },
        { mint: BONK, symbol: 'BONK', amount: '100000000000', decimals: 5, usdMicro: '0' },
      ],
    }],
    note: 'Developer preview. Sample balances. DexScreener prices this browser. devnet execution, mainnet pricing. This does not authorize a transaction.',
  };
}
