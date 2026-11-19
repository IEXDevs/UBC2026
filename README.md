# UBC2026

Hackathon project for **UBC 2026 — Agentic Payments and AI** (Solana chain award; ElevenLabs, Grok Bot, and QuickNode Streams bounties).

**Maelstrom** is a budget-aware Solana agent. It researches a goal, checks trust, re-derives the spend with a separate verifier, and pays in **devnet USDC** only inside the bot's caps. Copy-paste answers for the Devpost form are in [DEVPOST.md](DEVPOST.md).

Agents hold budgets and guardrails, pay for APIs/data over **x402** on Solana **devnet**, and only execute after independent verification plus the bot's approval mode.

## Prize / compliance targets

| Target | Plan |
| --- | --- |
| Main track | Agentic Payments and AI |
| Chain award | Best use of Solana (devnet execution; mainnet read-only prices) |
| Bounties | ElevenLabs Agents (voice), Grok Bot on X (drafts + chat export), QuickNode Streams |
| Originality | Fresh repo; code written during hackathon week |

Official guide: [Hackathon Guide UBC 26](https://docs.google.com/document/d/1QaySCo7u3VxMVNdk3C5Ab3ewc2E46AuLntti-Uzx5EY/edit?usp=sharing)

Backend routes are live when local secrets are set (Privy signing, Supabase data APIs, ledger reserve, shopping/SNS/grab-back). The agent-runtime Worker is hosted at `https://runtime.maelstrom.iexdevs.com`. The desk is hosted at `https://dev.maelstrom.iexdevs.com`. Hosted Supabase has `platform_transfers`, `platform_post_transfer`, and `desk_locks`. Still open for a complete submission: a recorded live devnet USDC send, a recorded Streams wake, posting Grok Bot drafts to X, and the 2–3 minute demo video. This repo does not deploy its own Solana program, and the Worker does not bind a Cloudflare Queue. The program IDs below are the existing programs the transfer builder calls.

## Architecture

```
apps/web (Next.js, OpenNext on Cloudflare)
  Sid shell · positions book · plugins · voice composer
  Privy login · bot creation · approval preview · timeline · Live View
  overview · security (pause / freeze)
        │
apps/agent-runtime (Cloudflare Worker + one Durable Object per bot)
  checkpointed loop · OpenRouter · ElevenLabs agent spec + webhook tools
  QuickNode webhook · hourly and stream-fallback crons · browser session routes
        │
packages: contracts, wallets, transfers, bot-policy, bot-creation,
  agent-loop, verify-consensus, trust-score, prices, paper-positions,
  x402, browser-search, browser-session, quicknode-streams, grok-bot
  shopping, sns, agent-commerce (Worker-mounted; settle when Privy secrets exist)
        │
apps/x402-service — devnet price/trust HTTP 402 Worker
        │
Solana devnet USDC + memo · mainnet prices over HTTP (DexScreener, Jupiter)
Supabase migrations checked in (users, ledger, approvals, stream events)
```

The Worker holds checkpointed run state. Wallets, the spend ledger, and approvals belong in Supabase. Queues are not bound in `apps/agent-runtime/wrangler.jsonc`. Secret values are not in the repo. Names are in `.env.example`.

## Agent decision loop

```
goal → research (Firecrawl search/scrape, browser tools)
     → decide (OpenRouter, locked platform prompt)
     → trust-score gate (confirm if the score is under 400)
     → verify-consensus (independent re-derive, at most 5 attempts)
     → bot-policy (caps, kill switch, approval mode)
     → preview / approve when the mode requires it
     → execute on Solana devnet (USDC transfer + memo) when a signer is configured
     → memo must match the verifier digest
     → monitor note
```

`POST /bots/:id/loop` checkpoints each step on the bot Durable Object. Without `META_MODEL_API_KEY` (or the `OPENROUTER_API_KEY` fallback) the model step returns `openrouter_not_configured` and does not call the network. Without an injected devnet transfer client, execute waits at `signer-not-configured`. It does not broadcast.

### Safety limits

Amounts are unsigned integer strings in one accounting asset's base units. The debit is outflow plus max fee. The ledger, not the model, supplies spent, reserved, and realized loss.

| Limit | What the code does |
| --- | --- |
| Bot type | `trading`, `shopping`, or `position-management`. A type is required. |
| Per-bot budget | `limited` or `unlimited` (FRQ). Trading and shopping limits are `maxOutflow` (spent + reserved + this debit) and `maxPerTransaction`. |
| Max loss | Position-management uses `maxLoss`. Reaching it returns `max-loss-reached` and blocks. It is not an outflow cap. |
| Over budget | Returns `over-budget` with `approve-once` or `raise-limit`. Raise-limit cannot lower a number and bumps `policyVersion`. |
| Approval mode | Set per bot. `ask` (default) needs an approval for every spend, including unlimited. `fully-automatic` may reserve while the cap holds. `capped-automatic` does that only up to `autoApproveCap`. |
| Kill switch | Pause or resume one bot, Stop All (pause every bot that owner has), freeze or unfreeze a bot, freeze or unfreeze a wallet. A frozen wallet blocks spend for every bot assigned to it. These calls do not sign. |
| Trust gate | Scores are integers 0–1000. Below 400 the gate is `confirmation-required` ("This has a low trust score, are you sure you want to buy?"). |
| Verifier | A second function re-derives the spend. Mismatches retry in the backend. The cap is 5 attempts (`packages/verify-consensus`). |
| Cluster | Proposals must be `devnet` or `testnet`. x402 refuses to emit a mainnet `PAYMENT-REQUIRED` challenge. Broadcast checks the devnet genesis hash. |
| Quote | An expired quote, a disabled bot, or an accounting-asset mismatch blocks. |
| Voice | The agent prompt refuses sends, approvals, limit raises, and wallet freezes. Those stay on the approval screen. |
| Paper trading | Fills are devnet or testnet and do not broadcast a swap. The priced set is SOL, mainnet USDC, and USDT. A close before one hour returns `hold_period`. |

Funding and top-ups from the main wallet are specified as always needing the owner. Grab-back to main is built in `packages/transfers` and is still an intent on the security page until the wallet route signs.

## Solana usage and program IDs

Execution is Solana devnet. This repo does not deploy a program. `packages/transfers` builds a devnet USDC `transferChecked`, an idempotent associated-token account when needed, and a Memo instruction. Privy signs bot spends and owner moves. A Wallet Adapter signs deposits. Nothing in that package opens a connection. The caller broadcasts only when the QuickNode genesis hash is devnet (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`).

| Program | ID | Use |
| --- | --- | --- |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | `transferChecked` of devnet USDC |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | Idempotent destination ATA (`ASSOCIATED_TOKEN_PROGRAM` in `packages/transfers`) |
| Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | Decision memo, 1–566 bytes, must match the verifier digest |

Devnet USDC mint (Circle, 6 decimals, not a program): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

x402 v2 (`packages/x402`, `apps/x402-service`) uses the exact scheme on CAIP-2 `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` and that mint. Mainnet challenges (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) are rejected. The price/trust Worker returns HTTP 402 and settles only when `confirmDevnetPayment` accepts a devnet transfer. It does not broadcast by itself.

Mainnet is for price identity only. `packages/paper-positions` prices SOL `So11111111111111111111111111111111111111112`, USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, and USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`. DexScreener and the Jupiter Price and Tokens HTTP APIs are not on-chain programs. `packages/sns` resolves a `.sol` name through an injected function and builds an unsigned intent. It does not call a name-service program (that send path is still open).

## QuickNode Streams

Stream 1 is the wake path for wallet activity. Create the Stream and the Key-Value list in the QuickNode dashboard at deploy time. The repo does not contain a live stream id.

- **Network:** `solana-devnet`
- **Dataset:** Block (or Programs + Logs) filtered to Privy bot wallets
- **Filter logic:** Keep transactions touching addresses in the QuickNode Key-Value Store wallet set. Emit compact `{signature, wallet, type, amount, token, slot}`.
- **Destination:** Cloudflare Worker `POST /webhooks/quicknode`. HMAC is `X-QN-Nonce`, `X-QN-Timestamp`, and `X-QN-Signature` over the raw body, keyed by `QUICKNODE_WEBHOOK_SECRET`.
- **KV sync:** `POST /internal/streams/sync-wallets` (owner, `x-owner-id`) writes Privy addresses into the list (`QUICKNODE_API_KEY`, `QUICKNODE_WALLET_LIST_KEY`) so the filter can change without a Stream redeploy.
- **Backfill:** `POST /internal/streams/backfill` (owner) replays missed rows through the same normalize → dedupe → `stream_events` → wake → loop path.
- **Why:** Deposits, x402 settlement, grab-back, and spend-ledger cross-checks should wake the bot from chain data. The cron below is the fallback when that stream goes quiet.

Helpers live in `packages/quicknode-streams`. The Worker wires verify → dedupe → Supabase `stream_events` → wallet-to-bot → Durable Object `/wake` → `/loop` when loop context is available.

### Schedules

- **Hourly position check:** Cloudflare Cron `0 * * * *` records a paper mark for each enabled trading or position-management bot. It does not wake the spend loop.
- **Stream-drop fallback:** Cron `5,20,35,50 * * * *` (and the hourly run, when the same condition holds) re-reads devnet USDC over `QUICKNODE_DEVNET_RPC_URL` if the newest `stream_events` row is older than one hour, or if that table cannot be read. A non-devnet genesis hash is refused. The RPC URL is not stored on the check.

## ElevenLabs

The product in this repo is **ElevenLabs Agents**, not ElevenCreative. `@elevenlabs/react` is not a dependency, and the Talk button does not open a session.

- `GET /voice/agent` returns the agent spec. The custom LLM is Meta Muse Spark 1.3 Contributor (`muse-spark-1.3-contributor`, or `OPENROUTER_MODEL_VOICE`) via `POST /voice/llm/chat/completions`. Prefer `META_MODEL_API_KEY` (LLM_…); OpenRouter is a fallback.
- `POST /voice/tools/:name` is the webhook tool route. Each tool calls the same bot, event, wallet, metric, payment, or browser route as the UI, with the same `x-owner-id`. Live View URLs are removed before the model sees the result. The route requires `ELEVENLABS_WEBHOOK_SECRET`. Without it the handler returns `elevenlabs_webhook_not_configured` and does not call ElevenLabs.
- The system prompt tells the agent to name the bot, to call a tool instead of inventing balances, and to refuse sends, approvals, limit raises, and freezes.
- Sid’s composer / Talk path mounts when `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` is set and the Worker has `ELEVENLABS_*` secrets. Client tools (open bot, Live View, confirm, read-back) share the same permissioned routes as the UI.

`ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` are secret names only.

## Grok Bot

Grok Bot on X watches Maelstrom's notable Solana devnet activity: confirmed transactions, settled x402 payments, fund grab-backs, and stop-all memos. Each notable event becomes a post draft with an explorer link, and that draft stays off the network because this build does not read an X credential or send a request. The chat that reviewed those drafts exports to JSON and Markdown, and secret-shaped strings are removed before the file is written. Grok Bot is the part of Maelstrom that surfaces on-chain activity and keeps the chat record for the bounty.

`packages/grok-bot` returns `delivery: "offline"` and `networkCalls: 0`. Export with `node scripts/grok-bot.mjs export --markdown < chat.json`.

## Packages

| Package / app | Role |
| --- | --- |
| `packages/contracts` | Shared bot / wallet / event / payment / metric validators and API route list |
| `packages/wallets` | Privy login provisioning, wallet assignment, freeze gates, and devnet server signing |
| `packages/transfers` | Devnet USDC transfer with memo, wallet-adapter deposit, withdraw, wallet moves, and grab-back to main |
| `packages/agent-loop` | Trust → verify → policy decision gate orchestrator |
| `packages/browser-search` | Firecrawl search + scrape + Cloudflare Browser Run adapters |
| `packages/browser-session` | Owner-bound Cloudflare browser sessions, per-bot concurrency, Live View URLs |
| `packages/bot-policy` | Bot types, caps, approval modes, kill switch, Supabase ledger reserve |
| `packages/bot-creation` | Locked templates, user templates, and the draft creation flow |
| `packages/verify-consensus` | Independent verify-agent loop + decision digests |
| `packages/trust-score` | Low trust-score confirmation gate + Jupiter Tokens adapter |
| `packages/prices` | DexScreener mainnet price reads, Jupiter Price API fallback |
| `packages/grok-bot` | Offline Grok Bot post drafts for notable devnet events, plus chat export |
| `packages/paper-positions` | Trading-bot paper lots and position-bot mark-to-market. Mainnet prices, devnet execution, no live trades |
| `packages/x402` | x402 v2 Solana devnet helpers |
| `packages/quicknode-streams` | Streams HMAC verify, dedupe, wallet KV sync / backfill plans |
| `packages/shopping` | x402 sandbox catalog → proposal → policy → 402 buy (scaffold; not an end-to-end checkout) |
| `packages/sns` | SNS `.sol` resolve + unsigned transfer intents (scaffold) |
| `packages/agent-commerce` | Builders for bots selling signals over x402 on devnet (scaffold; Worker routes not mounted) |
| `apps/x402-service` | Devnet x402 price/trust Worker and bot-policy payer |
| `apps/agent-runtime` | Cloudflare Worker + per-bot Durable Object described above |
| `apps/web` | Next.js glass UI (OpenNext on Cloudflare). Payments, wallets, and positions panes are not built |
| `supabase/schema.sql` | Foundations, policy ledger, bot templates, and wallet soft delete. Later migrations: `supabase/migrations/20261114050000_stream_events.sql` and `supabase/migrations/20261114180000_activity_logs.sql` (owner activity log, RLS, secret redaction). Neither is folded into `schema.sql` |

`/api/*` data routes and wallet create/sign are live against Supabase + Privy when those secrets are set; otherwise they return empty `source: unconfigured`. Persist sessions, approvals, and budgets in the Durable Object or in Supabase. Do not treat a queue as the source of truth.

## Setup

```bash
npm test
```

Node 20 or newer. Tests use injected clients and do not read secret values.

### Env files vs Worker secrets

| Where | Used by |
| --- | --- |
| Root `.env` / `.env.local` (from `.env.example`) | Next.js web (`NEXT_PUBLIC_*` + server routes) |
| `apps/agent-runtime/.dev.vars` | `wrangler dev` only |
| `npx wrangler secret put` from `apps/agent-runtime` | **Deployed** Worker — `.env.local` is not uploaded automatically |

Pipe secrets after `source`ing your local file:

```bash
cd apps/agent-runtime
set -a && source ../../.env.local && set +a
printf %s "$SUPABASE_URL" | npx wrangler secret put SUPABASE_URL
# …repeat for each name in .env.example (skip empty / NEXT_PUBLIC_*)
curl https://<runtime-host>/health   # secrets.*.set should be true; signing + supabase true
```

Apply SQL to the **hosted** project (`npx supabase db push --remote`, or the files under `supabase/migrations/` in the SQL editor). Local Docker is optional (`supabase start`).

```bash
node scripts/accounts-and-funds.mjs --address <SOLANA_PUBKEY>
```

Devnet SOL: [faucet.solana.com](https://faucet.solana.com/). Devnet USDC: [Circle faucet](https://faucet.circle.com/?chain=SOL), mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

Worker config: `apps/agent-runtime/wrangler.jsonc`. UI config: `apps/web/wrangler.jsonc`.

Local web deploys (build on your machine, upload with Wrangler — no Cloudflare Builds minutes):

```bash
npm run deploy:web:dev    # maelstrom-web-dev → https://dev.maelstrom.iexdevs.com
npm run deploy:web:prod   # maelstrom-web → https://maelstrom.iexdevs.com
```

```bash
npm run dev -w @ubc2026/web
npm test -w @ubc2026/agent-runtime
```

Web needs `NEXT_PUBLIC_PRIVY_APP_ID` in the **root** `.env.local` (Next loads root `NEXT_PUBLIC_*` via `apps/web/next.config.mjs`), `NEXT_PUBLIC_AGENT_RUNTIME_URL` pointing at the **agent-runtime** Worker URL (not `localhost:3000`), and optionally `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`. Leave `NEXT_PUBLIC_PRIVY_CLIENT_ID` empty unless you use a Privy App client. Allowlist `http://localhost:3000` (and the hosted **web** origin such as `https://maelstrom.iexdevs.com`) under Privy → Domains — not the agent-runtime `*.workers.dev` URL. Enable Email, Google, GitHub, Discord; keep require-terms off. Leave Privy HttpOnly cookies off. The web app stores the refresh token in its own HttpOnly cookie — see `apps/web/README.md`. After login, main-wallet create also needs `PRIVY_APP_SECRET` and `QUICKNODE_DEVNET_RPC_URL` in that same root file (an empty wallet list means that call failed). Leave every secret value in `.env.example` empty.
