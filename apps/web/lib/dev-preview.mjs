/**
 * Sample balances for the local developer preview.
 * Dollar values are filled by a live DexScreener read in the browser.
 */
import { draftBot } from './roster.mjs';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

export const DEV_PREVIEW_OWNER = 'developer';

/** Sample wallets so the preview desk can open the sheet and show Send destinations. */
export function previewWallets() {
  return [
    {
      id: 'w_preview',
      ownerId: DEV_PREVIEW_OWNER,
      kind: 'main',
      label: 'Preview',
      address: '11111111111111111111111111111111',
      frozen: false,
      spendable: false,
      readOnly: true,
      provider: 'privy',
    },
    {
      id: 'w_preview_shop',
      ownerId: DEV_PREVIEW_OWNER,
      kind: 'additional',
      label: 'Shop',
      address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      frozen: false,
      spendable: false,
      readOnly: true,
      provider: 'privy',
    },
  ];
}

export function previewBot() {
  return draftBot({
    id: 'bot_preview',
    name: 'Preview',
    shape: 'circle',
    color: '#7c5cff',
  });
}

/** Sample balances addressed to the preview wallet the sheet is showing. */
export function previewPortfolioFor(wallets) {
  const sample = samplePortfolio();
  const list = Array.isArray(wallets) ? wallets : [];
  const main = list.find(wallet => wallet?.kind === 'main') || list[0];
  if (!main?.address || !Array.isArray(sample.wallets) || sample.wallets.length === 0) return sample;
  return {
    ...sample,
    wallets: [
      { ...sample.wallets[0], address: main.address, label: main.label || sample.wallets[0].label },
      ...sample.wallets.slice(1),
    ],
  };
}

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
