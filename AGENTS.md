# AGENTS.md

Rules for coding agents working in Maelstrom (`UBC2026`). Read this before editing. The product explanation is in [README.md](README.md).

## Scope

- Change only the chunk you were given. Leave neighboring chunks alone, including files that look unfinished.
- One chunk per pull request. Say which chunk it is in the PR body.
- Do not deploy the Worker or the OpenNext app unless the task says to deploy.
- Do not apply the Supabase migration to a hosted project unless the task says to.
- `npm test` from the repo root must pass before you finish. Tests stay mocked and offline.

## Money and chain

- Execution, broadcasts, and x402 challenges are Solana **devnet**. Fact validators also allow `testnet`. Reject mainnet proposals.
- Mainnet price reads are paper PnL. Label them `devnet execution, mainnet pricing`. A mainnet quote never authorizes a transaction.
- Spend follows this order: trust gate, verify-consensus, wallet freeze check, bot-policy, approval mode, then sign. Skipping a step is a bug.
- A passing `runDecisionGate` may return a memo string. Submitting that memo, signing, or broadcasting is a separate chunk and stays out of `@ubc2026/agent-loop`, `@ubc2026/verify-consensus`, `@ubc2026/bot-policy`, and `@ubc2026/x402`.
- `@ubc2026/wallets` is the only package that signs. It signs through Privy and broadcasts only after the QuickNode genesis hash is Solana devnet. A frozen wallet never broadcasts.
- Amounts are unsigned integer strings in one asset's base units, matching `^(0|[1-9][0-9]{0,39})$`. Trust scores are integer strings from 0 to 1000.
- Ledger totals come from Postgres (or the in-memory test double). Model output is not a balance.
- A policy digest, a decision digest, and a memo string are not signatures. Bind the exact serialized transaction and its simulation before signing.
- Reserve budget with `policy_reserve_budget` (one increment per idempotency key). Reconcile the reservation when the transfer confirms or fails. That reconcile path is its own chunk.
- Voice, the glass UI, and any future Grok Bot must call the same permissioned spend APIs. No parallel payment path.

## Secrets

- Commit names, never values. `.env.example` and `SECRET_NAMES` list names with empty values.
- Keep Privy app secrets, Supabase service role keys, Cloudflare tokens, Firecrawl keys, QuickNode URLs, OpenRouter keys, and ElevenLabs keys in Worker secrets or a gitignored env file.
- `NEXT_PUBLIC_*` values are public. The Privy app secret and authorization key stay off the client.
- Tests inject `fetcher` or an in-memory store. They must pass when every secret is unset.
- Do not print secret values, Live View URLs, or raw provider errors that include credentials.
- Do not put keys, wallet seeds, or Live View URLs into model context, timeline events, or tool results.

## Browser sessions

- Persist session records in the bot Durable Object or a transactional table. A queue is not ownership.
- Authorize with the owner id and the `sessionRecordId` this service created. Ignore a Cloudflare `sessionId` supplied by the model or the client.
- Return Live View URLs only on the owner HTTP route, with `Cache-Control: no-store`. `invokeTool('browser_live_view')` redacts the URL.
- iframe only `https://live.browser.run/ui/view` and `/ui/inspector`. Any other host is a separate tab.
- Tools are web search, scrape, and browser open, view, and release. This is not a filesystem or coding-agent sandbox.

## Data boundaries

- Supabase holds users, wallets, bots, ledgers, approvals, decisions, events, payments, and metrics.
- The Durable Object holds the live run checkpoint and browser session records for that bot.
- `@ubc2026/contracts` is pure validation plus the shared route list. No I/O and no secrets there.
- New HTTP routes go into `API_ROUTES` with an honest `status`: `live`, `guarded`, or `stub`. A stub returns an empty payload. It does not pretend to read the database.
- Timeline event kinds stay inside `EVENT_KINDS`.

## Repo hygiene

- Node 20+. Workspaces are `packages/*` and `apps/*`. Package names are `@ubc2026/<name>`.
- Match the style of the file you edit. Packages are ESM (`.mjs`) except the Next.js app (`apps/web`).
- Add or update a unit test next to the change. Prefer the existing test runner (`node --test`).
- Do not commit `.env`, `.dev.vars`, `node_modules`, `.next`, `.open-next`, or `.wrangler`.
- Do not update git config. Do not force-push. Do not skip hooks.
- Commit only when the user asks. PR descriptions state the chunk, what stayed out of scope, and that `npm test` passed.

## Claimed work

Check merged PRs and the Notion page "UBC Conference AIgent idea" before starting. As of PR #13, these chunks are on `main`: 0A, 0B, 1A, 1B, 1C, 1D, 2A, 2B, 3A, 3B, and the 4B memo hash (attached on the devnet USDC transfer). That Notion page is ahead of this list. 7B (payments, wallets, positions) is claimed by Sid and stays open: the positions book and the voice stage are on `cursor/maelstrom-web-shell`, not merged. A live payments feed and a live positions read are still open.

If a Notion search does not show "UBC Conference AIgent idea", ask for the board URL instead of guessing a chunk is free.
