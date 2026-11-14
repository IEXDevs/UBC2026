# x402 price and trust Worker

Devnet service that sells a price quote and a trust score over x402 v2. The bot client pays from the bot's assigned wallet only after `@ubc2026/bot-policy` reserves the spend.

`GET /price/:mint` and `GET /trust/:mint` return HTTP 402 with a Solana devnet USDC `PAYMENT-REQUIRED` challenge. A retry with `PAYMENT-SIGNATURE` returns the resource only when `confirmDevnetPayment` accepts that devnet transfer. The catalog quotes are static, so tests never call a price API or an RPC. A host can inject `lookupPrice` / `lookupTrust` later. `pricingCluster` stays `mainnet` and `executionCluster` stays `devnet`.

```js
import worker, { createPriceTrustHandler } from '@ubc2026/x402-service';
import { createX402BotClient } from '@ubc2026/x402-service/client';
```

Set `X402_PAY_TO` and `X402_FEE_PAYER` to devnet pubkeys before deploy. They are not secrets. Bind `confirmDevnetPayment` in the host; this Worker does not read keys and does not broadcast.

```bash
npm test -w @ubc2026/x402-service
```
