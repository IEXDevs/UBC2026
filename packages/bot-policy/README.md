# Bot budget and approval policy

Pure server-side policy decisions for required bot types, explicit limited/unlimited caps, per-transaction and aggregate outflow caps, position-manager loss stops, bot kill switches, and mandatory transaction approval. No wallet signing or payment execution is implemented here.

All amounts are unsigned integer strings in a single accounting asset's base units. `maxFee` must be conservatively converted to that same accounting asset by trusted quoting code before evaluation; retain native fee/valuation details in the real preview. Ledger spending and loss must come from trusted accounting, not model output. Position-manager maxLoss currently stops further proposals once realized loss reaches its cap; projected loss, drawdown valuation, and exit-only behavior remain product decisions.

`evaluateProposal(bot, proposal, ledger, now)` returns blocked, over-budget (approve-once/raise-limit), or approval-needed. Unlimited budgets still require manual approval. No mainnet proposals are accepted. Proposal digests bind preview fields; integration must also bind the exact serialized chain transaction and simulation results before signing. A digest is not a signature or authorization credential.

`validateApproval` validates a stored owner approval against policy version, quote digest, expiry and consumption state. Its ready-to-reserve result is NOT permission to send directly. Authenticated endpoints must create approvals, and execution must atomically re-check policy, reserve budget, consume the approval and claim an idempotency key in durable storage. Use a Durable Object or transactional database; never use a client-side or in-memory ledger for enforcement. Reconcile reservations on confirmed success/failure, and retain unknown transaction outcomes until resolved to prevent duplicate spending. Different transactions must not consume the same budget concurrently.

`raiseLimits` returns a new policy version and does not mutate the original. An authenticated owner action must persist it, record an audit event, and require a fresh approval. On-chain enforcement is not implemented.

Run `npm test` here or at the repository root. No secrets or external services required.
