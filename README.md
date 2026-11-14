# Maelstrom (UBC 2026)

Hackathon project for **UBC 2026 — Agentic Payments and AI**. The product name is **Maelstrom**.

Team: Sid Chevvan, Alex Helton, Isaac Linus, Mark Ordonez. Repo: [IEXDevs/UBC2026](https://github.com/IEXDevs/UBC2026).

An owner gives a bot a goal and a budget. The bot researches, proposes a spend, and stops for a human unless its approval mode already allows that amount. Nothing moves on Solana until trust, an independent verifier, and budget policy all pass. Payments for paid APIs use **x402** on Solana **devnet**.

Official guide: [Hackathon Guide UBC 26](https://docs.google.com/document/d/1QaySCo7u3VxMVNdk3C5Ab3ewc2E46AuLntti-Uzx5EY/edit?usp=sharing)

## Prize targets

| Target | How this repo aims at it |
| --- | --- |
| Main track | Agentic Payments and AI: bots hold budgets, pay for data, and execute only after verification and approval |
| Chain award | Best use of Solana. Execution and x402 challenges are **devnet**. Price reads are mainnet and labeled paper PnL |
| ElevenLabs | Voice is a first-class path. The glass UI has a Talk stub. Spoken actions must hit the same spend APIs as the screen |
| Grok Bot on X | Real work on X (chat export), separate from a Grok-styled UI |
| Originality | Code written for this hackathon. Prior UI and voice work is reference only |

Still required for a complete submission: filled frontend panes, a live x402 settle path, on-chain program IDs in this README, an ElevenLabs demo with audio, a Grok Bot on X chat export, and a 2–3 minute demo video.

## Decision loop

```
goal → research (Firecrawl search/scrape, Cloudflare browser)
     → decide (trade / shop / transfer)
     → trust-score gate (confirm if the score is under 400)
     → verify-consensus (independent re-derive, ≤5 retries, silent until settled)
     → bot-policy (budget / kill switch / approval digest)
     → Phantom-style preview → human approve, unless the mode already allows it
     → x402 pay (if buying paid data) and/or execute on Solana devnet
     → memo = decision digest → monitor / notify (per bot)
```

`@ubc2026/agent-loop` runs the middle of that chain and returns a memo string. It does not sign or broadcast. Chunk 2B (`@ubc2026/transfers`, PR #13) builds a devnet USDC transfer, appends that memo, and sends it through Privy. Deposits are signed by a Wallet Adapter and still have to pass the devnet genesis check.

## Technology

### Cloudflare

The UI and the agent runtime both target Cloudflare.

- **`apps/web`** is Next.js 15 (React 19), built for Workers with [OpenNext](https://opennext.js.org/cloudflare). `wrangler.jsonc` and `open-next.config.ts` are the deploy target. This repo does not deploy by itself.
- **`apps/agent-runtime`** is a Worker plus one **Durable Object per bot** (`BotDurableObject`). The DO holds the live run checkpoint: wake, pause, resume, advance, decide, and browser sessions. Business rows stay in Supabase.
- **Browser Rendering / Browser Run** opens interactive sessions. Live View URLs are owner-only and sent with `Cache-Control: no-store`. The model never receives the URL.
- **Cron** is `0 * * * *`. The handler wakes bots only when `listScheduledBots` is supplied. Position checks against Supabase are still a stub.
- **Queues** may move jobs later. They are transport. Session ownership and exactly-once budget state live in a Durable Object or Postgres.

### Supabase

Postgres is the system of record for users, Privy wallet assignments, bots, caps, the spend ledger, approvals, decision records, timeline events, x402 payments, and metrics.

- `supabase/schema.sql` is the full schema.
- `supabase/migrations/20261114000000_foundations.sql` is the phase 1 copy.
- `supabase/migrations/20261114020000_policy_ledger.sql` adds atomic `policy_reserve_budget` plus pause, freeze, and Stop All functions.
- Row-level security keys off the JWT `owner_id` or `sub`. Authenticated roles can read. They cannot rewrite `reserved`, forge an approval, or clear a freeze. The SQL functions are the write path.
- The migration is checked in. It has not been applied to a hosted project from this repo.

### Privy

Login and key custody. Solana embedded wallets. The app secret never ships to the browser.

- The web shell uses `@privy-io/react-auth`. Login is Solana-only and creates an embedded wallet when the user has none. `NEXT_PUBLIC_PRIVY_APP_ID` turns the button on. `NEXT_PUBLIC_PRIVY_CLIENT_ID` is optional.
- `@ubc2026/wallets` verifies a Privy access token (`acceptLogin`), maps the required **main** wallet plus optional **additional** wallets, and can `signTransaction` then `sendTransaction` on devnet through QuickNode.
- A frozen wallet or a genesis hash that is not Solana devnet never broadcasts.
- `PRIVY_AUTHORIZATION_KEY` is optional (`wallet-auth:` P-256). Attach it only when that user wallet requires an authorization signature.

### Solana and QuickNode

- Cluster for execution, x402, and broadcasts: **devnet** (testnet is accepted by the fact validators; mainnet proposals are rejected).
- `QUICKNODE_DEVNET_RPC_URL` is the RPC. The client checks the genesis hash before `sendTransaction`.
- `POST /webhooks/quicknode` wakes a bot from Streams. `QUICKNODE_WEBHOOK_SECRET` is checked when it is set. Leave it empty until Streams is wired.
- Devnet SOL: [faucet.solana.com](https://faucet.solana.com/). The public RPC airdrop returns HTTP 410, so `solana airdrop --url devnet` is not the path.
- Devnet USDC: [Circle faucet](https://faucet.circle.com/?chain=SOL), mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- On-chain program IDs are not published yet. The memo program write is the open follow-up to the decision-hash helper.

### x402

`@ubc2026/x402` builds HTTP 402 `PAYMENT-REQUIRED` challenges, parses `PAYMENT-SIGNATURE` payloads, and shapes `PAYMENT-RESPONSE` / payment-feed rows. Only Solana devnet challenges are accepted. The package does not sign, broadcast, or settle. A sandbox catalog client (`listCatalog` / `buy`) surfaces 402 challenges for the shopping bot. Facilitator verify/settle is still service-layer work.

Protocol: [Solana agentic payments](https://solana.com/docs/payments/agentic-payments/x402), [x402 v2 spec](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

### Models and research

- **OpenRouter** (`OPENROUTER_API_KEY`) is the planned model route. It is named and unused by the current loop.
- **Firecrawl** (`FIRECRAWL_API_KEY`) is search and scrape. Results keep source URLs. Provider errors are sanitized. The key stays in Worker secrets.
- **ElevenLabs Agents** (`ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`) is the voice path. The UI button stays disabled until an agent id exists.

### Market data

- **Trust.** Jupiter Tokens API V2 maps organic score and audit flags onto a 0–1000 gate. Below 400 the prompt is: "This has a low trust score, are you sure you want to buy?" Scores from the model do not bypass the adapter. A durable cache (file, Cloudflare KV, or DO storage) keeps the per-mint record for one hour by default. `JUPITER_API_KEY` is optional on the free tier and is not in `SECRET_NAMES`.
- **Prices.** DexScreener is primary (no key). Jupiter Price API V3 is the fallback. Quotes are labeled `devnet execution, mainnet pricing`. They feed paper PnL. They do not authorize a mainnet transaction.

### Bot policy

Three builtin types: `trading`, `shopping`, `position-management`.

Three approval modes:

| Mode | Behavior |
| --- | --- |
| `ask` | Every spend needs a manual approval, including unlimited budgets |
| `fully-automatic` | May proceed while the outflow cap holds |
| `capped-automatic` | Same, only up to `autoApproveCap`. Above that needs approval |

Amounts are unsigned integer strings in one accounting asset's base units (max 40 digits). `maxFee` must already be converted to that asset by trusted quoting code. Ledger totals come from the database.

`evaluateProposal` returns `blocked`, `over-budget` (approve-once or raise-limit), or approval-needed. Max loss is a hard stop for position managers. Over-cap outflow needs an explicit approve-once.

`policy_reserve_budget` locks the bot, wallet, and ledger, re-checks policy, consumes a matching approval when one is required, and increments `reserved` once per idempotency key. Kill switch: pause, resume, Stop All (every bot that owner has), freeze and unfreeze a bot, freeze and unfreeze a wallet. Freezing a wallet blocks every bot assigned to it. These calls do not sign or move funds.

A policy digest is not a signature. The signer must bind the exact serialized transaction and simulation. Releasing or settling a reservation after confirm or failure is still open.

### Verify consensus

The main agent and a separate verify function each supply asset, mint, cluster, price, amount, trust score, and a short reasoning summary. A match is silent. A mismatch stays in the backend and retries, at most five times. After five disagreements the state is `manual-review`. No alarm fires on the intermediate retries.

`memoFromDecision` rebuilds the canonical record and SHA-256s it. The memo string is `{ v, o, d, r }` where `r` is that digest. A caller-supplied digest that does not match is rejected. Manual review produces no memo. The digest is not a signature and is not yet written on chain.

## Repository layout

| Path | Package | Role |
| --- | --- | --- |
| `packages/contracts` | `@ubc2026/contracts` | Validators, builtin templates, `API_ROUTES`, `SECRET_NAMES`. No I/O |
| `packages/wallets` | `@ubc2026/wallets` | Privy provisioning, wallet assignment, freeze gates, devnet server signing |
| `packages/transfers` | `@ubc2026/transfers` | Devnet USDC transfer with memo, Wallet Adapter deposit, withdraw, wallet-to-wallet moves, grab-back to main |
| `packages/agent-loop` | `@ubc2026/agent-loop` | Trust → verify → freeze → policy. Returns the memo. No network |
| `packages/bot-policy` | `@ubc2026/bot-policy` | Caps, approval modes, kill switch, Supabase reserve client |
| `packages/verify-consensus` | `@ubc2026/verify-consensus` | Independent verify loop and decision digests |
| `packages/trust-score` | `@ubc2026/trust-score` | 0–1000 gate, Jupiter adapter, durable cache |
| `packages/prices` | `@ubc2026/prices` | DexScreener with Jupiter Price fallback |
| `packages/x402` | `@ubc2026/x402` | Devnet payment challenges and the sandbox store client |
| `packages/browser-search` | `@ubc2026/browser-search` | Firecrawl search/scrape and Browser Run session create/view/close |
| `packages/browser-session` | `@ubc2026/browser-session` | Owner-bound sessions, per-bot concurrency, tool schemas, Live View redaction |
| `apps/agent-runtime` | `@ubc2026/agent-runtime` | Worker + per-bot Durable Object |
| `apps/web` | `@ubc2026/web` | Glass shell: bot list, empty panes, Privy login, Live View panel, Talk stub |
| `supabase/` | | Schema, policy-ledger migration, PGlite tests |
| `scripts/accounts-and-funds.mjs` | | Prints secret **names** and faucet steps. Does not read values or call a faucet |

Library packages do not sign or broadcast, except `@ubc2026/wallets` and `@ubc2026/transfers`. Those sign through Privy, or through a Wallet Adapter for deposits, and broadcast only after the devnet genesis check. Tests inject `fetcher` and pass with no live keys.

## What the Worker actually serves

`status: live` routes reach the Durable Object or a real handler. `stub` and `guarded` routes return `{ stub: true, items: [] }` until a later chunk wires Supabase or Privy. Guarded routes are `POST /api/wallets` and `POST /api/wallets/:walletId/sign`. The signing implementation exists in `@ubc2026/wallets` and is not connected to those HTTP routes yet.

Live today:

- `GET /health`, `GET /api/routes`
- `GET/POST /bots/:botId` status, wake, pause, resume, advance, decide
- Owner browser sessions: list, open, live-view, release (`x-owner-id`)
- `POST /webhooks/quicknode`

The web shell panes are Overview, Agents, Payments, Positions, Wallets, and Security. Bodies say "Empty." Create bot is disabled. Demo bots are local placeholders, not Supabase rows. Live View calls the runtime when `NEXT_PUBLIC_AGENT_RUNTIME_URL` is set and a Privy user id is present.

## Landed chunks

Merged pull requests on `main`, newest first:

| PR | Chunk | What landed |
| --- | --- | --- |
| [#13](https://github.com/IEXDevs/UBC2026/pull/13) | 2B | Devnet USDC transfer with memo, deposit, withdraw, and grab-back |
| [#12](https://github.com/IEXDevs/UBC2026/pull/12) | 1B | Privy provisioning and devnet signing in `@ubc2026/wallets` |
| [#11](https://github.com/IEXDevs/UBC2026/pull/11) | 1D | Privy login and OpenNext hosting on the glass shell |
| [#10](https://github.com/IEXDevs/UBC2026/pull/10) | 4B | Verifier decision hash inside the memo string. PR #13 attaches that memo on the devnet USDC transfer |
| [#9](https://github.com/IEXDevs/UBC2026/pull/9) | 0B | Account secret names and devnet faucet steps |
| [#8](https://github.com/IEXDevs/UBC2026/pull/8) | 3B | Owner-bound Cloudflare browser sessions and Live View |
| [#7](https://github.com/IEXDevs/UBC2026/pull/7) | 3A | Jupiter price fallback and durable trust cache |
| [#6](https://github.com/IEXDevs/UBC2026/pull/6) | 2A | Bot-policy wired to the Supabase spend ledger |
| [#5](https://github.com/IEXDevs/UBC2026/pull/5) | 0A, 1A, 1C | API route list, foundations migration, Worker dispatch |
| [#4](https://github.com/IEXDevs/UBC2026/pull/4) | phase 2 | Jupiter trust, prices, decide path, x402 sandbox, Talk stub |
| [#3](https://github.com/IEXDevs/UBC2026/pull/3) | phase 0–1 | Contracts, Firecrawl, runtime, schema, glass UI, agent-loop |
| [#2](https://github.com/IEXDevs/UBC2026/pull/2) | | verify-consensus, trust-score, x402 helpers |
| [#1](https://github.com/IEXDevs/UBC2026/pull/1) | | Browser and search adapters (later swapped from Brave to Firecrawl) |

There are no open pull requests.

Still open in the code, called out by those PRs:

- Settle or release a ledger reservation when a transfer confirms or fails.
- Connect `POST /api/wallets` and the sign route to `@ubc2026/wallets`, and replace the other `/api/*` stubs with Supabase reads.
- Hourly cron that loads scheduled bots and runs position checks.
- Pane bodies, bot creation, and the approval preview.
- ElevenLabs audio and a Grok Bot on X.
- Deploy of the Worker and the OpenNext app. Do not deploy unless asked.

The team checklist that named these chunks lives in Notion. The Notion account connected here is Sid Chevvan’s personal space (course notes). It does not contain the Maelstrom board, so claim status above is taken from merged PRs and the code, not from that board.

## Develop

Node 20 or newer.

```bash
npm test
```

That runs every workspace test, then `supabase/*.test.mjs` and `scripts/*.test.mjs`. Tests are mocked. They need no secrets and no network.

```bash
npm run dev -w @ubc2026/web
npm run dev -w @ubc2026/agent-runtime
```

Copy `.env.example` to `.env` (gitignored) or set Worker secrets with `npx wrangler secret put <NAME>` from `apps/agent-runtime`. Values stay empty in git.

```bash
node scripts/accounts-and-funds.mjs --address <SOLANA_PUBKEY>
```

That prints Privy, Supabase, Cloudflare, OpenRouter, Firecrawl, QuickNode, and ElevenLabs **names**, plus the faucet steps. It does not read secret values.

Worker deploy target: `apps/agent-runtime/wrangler.jsonc`. UI deploy target: `apps/web/wrangler.jsonc`.

Agent rules for anyone changing this repo: [AGENTS.md](AGENTS.md).
