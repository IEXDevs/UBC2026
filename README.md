# UBC2026

Hackathon project for **UBC 2026 — Agentic Payments and AI** (Solana chain award; ElevenLabs + Grok Bot bounties planned).

Agents hold budgets and guardrails, pay for APIs/data over **x402** on Solana **devnet**, and only execute after independent verification plus human approval.

## Prize / compliance targets

| Target | Plan |
| --- | --- |
| Main track | Agentic Payments and AI |
| Chain award | Best use of Solana (devnet execution; mainnet read-only data) |
| Bounties | ElevenLabs (voice central), Grok Bot on X (real work — not only a Grok-styled UI) |
| Originality | Fresh repo; all code written during hackathon week; prior UI/voice used as reference only |

Official guide: [Hackathon Guide UBC 26](https://docs.google.com/document/d/1QaySCo7u3VxMVNdk3C5Ab3ewc2E46AuLntti-Uzx5EY/edit?usp=sharing)

Library scaffolds (not product-complete) cover pieces of:

1. x402 v2 Solana **devnet** payment challenges / feed helpers
2. Bot types, caps / FRQ, kill switch, over-budget approve-once / raise-limit, approval digests
3. Verify-agent consensus loop + digests; trust-score confirmation gate
4. Owner-bound browser sessions, per-bot concurrency, agent search/browser tools

Still required for a complete submission: working frontend, x402 sandbox shopping, on-chain settlement confirmation, on-chain program IDs in README, ElevenLabs demo with audio, Grok Bot on X chat export, 2–3 minute demo video. The per-bot loop is checkpointed in the Durable Object.

## Agent decision loop

```
goal → research (browser/search)
     → decide (trade / shop / transfer)
     → trust-score gate (confirm if low)
     → verify-consensus (independent re-derive, ≤5 retries, silent until settled)
     → bot-policy (budget / kill switch / approval digest)
     → Phantom-style preview → human approve
     → x402 pay (if buying paid data) and/or execute on Solana devnet
     → memo = decision digest → monitor / notify (per bot)
```

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
| `packages/prices` | DexScreener mainnet price reads (paper PnL) |
| `packages/x402` | x402 v2 Solana devnet helpers + sandbox store client |
| `packages/quicknode-streams` | Streams HMAC verify, dedupe, wallet KV sync / backfill plans (Isaac / 5A) |
| `packages/shopping` | x402 sandbox catalog → proposal → policy → 402 buy (Isaac / 6B) |
| `packages/sns` | SNS `.sol` resolve + unsigned transfer intents (Isaac / 6C) |
| `packages/agent-commerce` | Bots sell signals over x402 on devnet (Isaac / 6C) |
| `apps/x402-service` | Devnet x402 price/trust Worker and bot-policy payer |
| `apps/agent-runtime` | Cloudflare Worker + per-bot Durable Object. `POST /bots/:id/loop` runs research → decide → trust → verify → policy → approval → execute → memo → monitor, checkpointed per step. Models use OpenRouter and a locked platform prompt. Hourly Cron checks paper positions. A second Cron re-checks devnet USDC when the QuickNode stream has been silent for an hour |
| `apps/web` | Next.js glass UI shell (Cloudflare-hosted) |
| `supabase/schema.sql` | Postgres schema: foundations, `20261114020000_policy_ledger.sql` (atomic reserve, approval modes, kill switch), and `20261114040000_bot_templates.sql` (locked templates, user templates, draft create / enable) |

These are library scaffolds, not a shipping app. Bot spends and owner USDC moves are signed by Privy and broadcast on Solana devnet only; deposits are signed by a Wallet Adapter and sent through the same devnet genesis check. Persist sessions/approvals/budgets in a Durable Object or transactional DB; queues are transport only.

## Hosting (locked)

- **Cloudflare** — Next.js glass UI + Workers, Durable Objects, Queues, Cron, Browser Rendering / Live View
- **Supabase** — main Postgres (bots, wallets, ledger, approvals); DOs hold live run checkpoints only
- **Privy** — main + additional Solana wallets; keys never enter model context

## Develop

```bash
npm test
```

Secret names live in `.env.example` and `SECRET_NAMES`. Leave the values empty. Cloudflare, Firecrawl (`FIRECRAWL_API_KEY`), Privy, QuickNode (`QUICKNODE_DEVNET_RPC_URL`), and trust-score credentials are required for live integration; mocked tests need no secrets.

## Accounts and funds

Copy `.env.example` to `.env` (gitignored) or set Worker secrets with `npx wrangler secret put <NAME>` from `apps/agent-runtime`. The command below prints the Privy, Supabase, Cloudflare, OpenRouter, Firecrawl, QuickNode, and ElevenLabs names, plus devnet SOL and USDC faucet steps. It does not read secret values or call a faucet.

```bash
node scripts/accounts-and-funds.mjs --address <SOLANA_PUBKEY>
```

Devnet SOL: [faucet.solana.com](https://faucet.solana.com/). The public RPC faucet returns HTTP 410, so `solana airdrop --url devnet` is not the path. Devnet USDC: [Circle faucet](https://faucet.circle.com/?chain=SOL), mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

Worker deploy target (do not deploy from this change): `apps/agent-runtime/wrangler.jsonc`. The Next.js UI deploy target is Cloudflare via OpenNext: `apps/web/wrangler.jsonc`.

## QuickNode Streams (Stream 1) — Isaac / 5A

- **Network:** `solana-devnet`
- **Dataset:** Block (or Programs + Logs) filtered to Privy bot wallets
- **Filter logic:** Keep transactions touching addresses in the QuickNode Key-Value Store wallet set; emit compact `{signature, wallet, type, amount, token, slot}`
- **Destination:** Cloudflare Worker `POST /webhooks/quicknode` (HMAC via `X-QN-Nonce` / `X-QN-Timestamp` / `X-QN-Signature`, secret `QUICKNODE_WEBHOOK_SECRET`)
- **KV sync:** `POST /internal/streams/sync-wallets` (owner) pushes Privy wallet addresses into the QuickNode KV list (`QUICKNODE_API_KEY` + `QUICKNODE_WALLET_LIST_KEY`)
- **Backfill:** `POST /internal/streams/backfill` (owner) replays missed rows through the same persist → wake → loop path
- **Why:** Core wake path for deposits, x402 settlement, grab-back, and spend-ledger cross-checks. Hourly Cron is fallback only.

Helpers live in `packages/quicknode-streams`; the Worker wires verify → dedupe → Supabase `stream_events` persist → wallet→bot resolve → DO `/wake` → 4A `/loop` when loop context is available.

## Schedules (5B)

- **Hourly position check:** Cloudflare Cron `0 * * * *` records a paper mark for each enabled trading or position-management bot. The check stays on the bot Durable Object. It does not wake the spend loop.
- **Stream-drop fallback:** Cron `5,20,35,50 * * * *` (and the hourly run, when the same condition holds) re-reads devnet USDC over `QUICKNODE_DEVNET_RPC_URL` if the newest `stream_events` row is older than one hour, or if that table cannot be read. Genesis must be devnet. The RPC URL is not stored.
