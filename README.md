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

Still required for a complete submission: working frontend + Cloudflare agent runtime with DO checkpoints, live x402 settle path, on-chain program IDs in README, ElevenLabs demo with audio, Grok Bot on X chat export, 2–3 minute demo video.

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
| `packages/wallets` | Privy wallet assignment + freeze gates |
| `packages/agent-loop` | Trust → verify → policy decision gate orchestrator |
| `packages/browser-search` | Firecrawl search + scrape + Cloudflare Browser Run adapters |
| `packages/browser-session` | Owner-bound Cloudflare browser sessions, per-bot concurrency, Live View URLs |
| `packages/bot-policy` | Bot types, caps, approval modes, kill switch, Supabase ledger reserve |
| `packages/bot-creation` | Locked templates, user templates, and the draft creation flow |
| `packages/verify-consensus` | Independent verify-agent loop + decision digests |
| `packages/trust-score` | Low trust-score confirmation gate + Jupiter Tokens adapter |
| `packages/prices` | DexScreener mainnet price reads (paper PnL) |
| `packages/x402` | x402 v2 Solana devnet helpers + sandbox store client |
| `apps/agent-runtime` | Cloudflare Worker + per-bot Durable Object checkpoints |
| `apps/web` | Next.js glass UI shell (Cloudflare-hosted) |
| `supabase/schema.sql` | Postgres schema: foundations, `20261114020000_policy_ledger.sql` (atomic reserve, approval modes, kill switch), and `20261114040000_bot_templates.sql` (locked templates, user templates, draft create / enable) |

These are library scaffolds, not a shipping app. None sign or broadcast. Persist sessions/approvals/budgets in a Durable Object or transactional DB; queues are transport only.

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
