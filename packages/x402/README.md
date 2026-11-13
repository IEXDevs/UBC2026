# x402 v2 (Solana)

Server-side helpers for the Agentic Payments track's recommended x402 payment loop on Solana. Builds HTTP 402 `PAYMENT-REQUIRED` challenges, parses `PAYMENT-SIGNATURE` payloads, and shapes `PAYMENT-RESPONSE` / payment-feed rows. Hackathon policy is hard-coded: only Solana **devnet** challenges and settlements are accepted.

```js
import { buildPaymentRequired, parsePaymentSignature, paymentFeedEntry } from '@ubc2026/x402';
const challenge = buildPaymentRequired({
  resourceUrl: 'https://api.example.com/trust-score',
  description: 'Paid trust score lookup',
  amount: '10000', // 0.01 USDC
  payTo: merchantPubkey,
  feePayer: facilitatorPubkey,
});
```

This package does not sign, broadcast, or verify on-chain transfers. Pair it with `@ubc2026/bot-policy` (budgets / approvals) and `@ubc2026/verify-consensus` before creating a challenge the user can approve. Facilitator verify/settle calls and Durable Object accounting belong to the service layer.

Protocol references:
- https://solana.com/docs/payments/agentic-payments/x402
- https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md

Run `npm test` here or at the repository root. No secrets required.
