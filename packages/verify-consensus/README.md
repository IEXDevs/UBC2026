# Verification consensus

Pure server-side loop that independently re-derives trade facts before any transaction preview reaches the user. The main agent and verify agent each supply asset, mint, cluster, price, amount, trust score, and a short reasoning summary. Matches green-light silently. Mismatches stay in the backend and re-check until the main agent is correct, capped at five attempts. After five disagreements the result is `manual-review` for the user; no alarm is raised during intermediate retries.

```js
import { reachConsensus, memoFromDecision } from '@ubc2026/verify-consensus';
const result = await reachConsensus({
  mainFn: async () => mainAgentFacts,
  verifyFn: async ({ main }) => independentlyDerivedFacts,
});
if (result.state === 'consensus') {
  const memo = memoFromDecision(result.decisionRecord);
}
```

Amounts and trust scores are unsigned integer strings. Only `mainnet-beta` and `testnet` clusters are accepted. `memoFromDecision` recomputes the SHA-256 of the canonical decision record — asset, mint, cluster, price, amount, trust score, reasoning summary, and attempt history — and places that digest in the memo string. A caller-supplied digest that does not match is rejected. A digest is not a signature or authorization credential, and this package does not submit the memo on chain. It never signs, broadcasts, or reserves budget. Pair settled consensus facts with `@ubc2026/bot-policy` before creating an approval-bound preview.

Run `npm test` here or at the repository root. No secrets or external services required.
