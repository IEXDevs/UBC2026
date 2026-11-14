# Bot budget and approval policy

Server-side policy for bot types, limited or unlimited caps, approval modes, position-manager loss stops, and the kill switch. No wallet signing or payment execution lives here.

All amounts are unsigned integer strings in one accounting asset's base units. `maxFee` must already be converted to that asset by trusted quoting code. Ledger spending and loss come from the database, not from model output.

`evaluateProposal` returns blocked, over-budget (approve-once or raise-limit), or approval-needed. With no approval mode, or with Ask, unlimited budgets still need a manual approval. Fully Automatic may proceed without an approval while the cap holds. Capped Automatic does that only up to `autoApproveCap`. Anything over the outflow cap needs an explicit `approve-once`. Max loss is a hard stop. No mainnet proposals are accepted.

`ledger.mjs` wires those decisions to the Supabase spend ledger:

- `assessSpend` applies caps, the approval mode, and pause or freeze flags to rows the server already loaded. It does not reserve.
- `createSupabaseLedger(call)` forwards to the Postgres functions in `supabase/migrations/20261114020000_policy_ledger.sql`. `call(functionName, payload)` is the only I/O hook. This package does not embed a client or a secret.
- `policy_reserve_budget` locks the bot, wallet, and ledger, re-checks policy, consumes a matching approval when one is required, and increments `reserved` once per idempotency key.
- Kill switch: `policy_pause_bot`, `policy_resume_bot`, `policy_stop_all`, `policy_freeze_bot`, `policy_unfreeze_bot`, `policy_freeze_wallet`, `policy_unfreeze_wallet`. Stop All pauses every bot that owner has. Freezing a wallet blocks spending for every bot assigned to it. These calls do not sign or move funds.

Authenticated database roles can read those tables. They cannot rewrite `reserved`, forge an approval, or clear a freeze. The functions are the write path. A service role may insert users, wallets, and bots. `createMemoryLedger` is a serialized test double with the same rules — not the production ledger.

A digest is not a signature. Integration must still bind the exact serialized transaction and simulation before signing. Reconcile a reservation when the transfer confirms or fails. That settlement path is a later chunk.

Run `npm test` here or at the repository root. No secrets or external services required.
