# `@ubc2026/paper-positions`

Paper lots for trading bots and mark-to-market for position bots.

Prices come from an injected lookup with the same quote shape as `@ubc2026/prices` (`createMainnetPriceProvider`: DexScreener, then Jupiter Price API v3). Quotes are labeled `devnet execution, mainnet pricing`. Allowed assets are SOL, USDC, and USDT. Meme coins and other mints are refused.

Buys and sells update the in-memory book only. A fill records `broadcast: false` and `mode: 'paper'`. Mainnet clusters, swap transactions, and signing requests throw. A sell before one hour throws `hold_period` (no day trading). Position bots cannot open or close lots; `markPaperBook` values the owner's paper book and sets `action: 'stop'` when limited max-loss is reached. `positionLossDecision` copies that loss into the existing bot-policy check. It does not reserve or sign.

Tests pass a fake lookup or `createMainnetPriceProvider({ primary, fallback })`. They do not call the network and do not read API keys.

```bash
npm test -w @ubc2026/paper-positions
```
