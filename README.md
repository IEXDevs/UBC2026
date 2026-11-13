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

Agentic track requirements covered so far in libraries:

1. Agents can prepare onchain payment challenges (x402 v2 / Solana devnet)
2. Spending controls: bot types, caps / FRQ, kill switch, over-budget approve-once / raise-limit, mandatory approval digests
3. Decision loop documented below; safety limits enforced in pure modules before any signing path

Still required for a complete submission: working frontend + Cloudflare agent runtime, live x402 settle path, on-chain program IDs in README, ElevenLabs demo with audio, Grok Bot on X chat export, 2–3 minute demo video.

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

| Package | Role |
| --- | --- |
| `packages/browser-search` | Brave search + Cloudflare Browser Run live view |
| `packages/bot-policy` | Bot types, caps, kill switch, mandatory approvals |
| `packages/verify-consensus` | Independent verify-agent loop + decision digests |
| `packages/trust-score` | Low trust-score confirmation gate |
| `packages/x402` | x402 v2 Solana devnet challenge / signature / feed helpers |

None of these modules sign or broadcast. Durable accounting and authenticated owner endpoints must enforce their decisions.

## Hosting split (planned)

- **Vercel** — Next.js glassmorphic UI only
- **Cloudflare** — Workers cron, Queues, Browser Rendering / live agent view

## Develop

```bash
npm test
```

Cloudflare, Brave, and trust-score credentials are required for live integration; mocked tests need no secrets.
