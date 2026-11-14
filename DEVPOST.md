# Devpost form answers — Maelstrom

Copy source for the UBC 2026 Devpost form. Written from `IEXDevs/UBC2026` on `main` (through pull request 22) and the project plan. This file is not a submitted entry. It does not claim a prize, a deploy, or a metric.

Open on the plan, and not described below as finished:

- Hosted deploy, and applying the Supabase migrations to a hosted project
- Shopping checkout, SNS sends, and bots selling signals (library scaffolds only)
- Payments feed, wallet page, and positions pane
- In-app ElevenLabs conversation (`@elevenlabs/react` is not installed; live events are not pushed into a call)
- Posting Grok Bot drafts to X (the package refuses to send)
- 2–3 minute demo video and the live pitch

## Form fields

**Project name:** Maelstrom

**Short description:** Budget-aware Solana agents that research a goal, verify the spend, and pay in devnet USDC only inside per-bot caps.

**Team members:** Sid Chevvan, Alex Helton, Isaac Linus, Mark Ordonez (the names on the GitHub repository). The plan assigns chunks to Alex, Isaac, and Sid. It does not assign Mark a finished chunk, so this file does not describe his work.

**Main track:** Agentic Payments and AI

**Chain award:** Best use of Solana

**Not entered:** Best use of Arc. Gemini Prediction Markets is out of scope.

**Bounties opted in:** ElevenLabs, Grok Bot, QuickNode Streams

**Technologies / sponsor tools:** Privy, Firecrawl, ElevenLabs Agents, QuickNode Streams, Cloudflare Workers and Durable Objects, Solana, x402, OpenRouter (Grok), Supabase, Next.js, DexScreener, Jupiter Price API and Jupiter Tokens API.

**Repository:** https://github.com/IEXDevs/UBC2026

**Demo video:** Not recorded. Isaac owns that chunk. Do not paste a link here.

**Built during the hackathon:** Yes. This repository was created for UBC 2026. No earlier project is copied in.

## What did you build?

Maelstrom is a monorepo for named bots that work toward a goal under a spend policy. The checked-in path is:

- A Cloudflare Worker and one Durable Object per bot. `POST /bots/:id/loop` checkpoints research, decide, trust, verify, policy, approval, execute, memo, and monitor.
- Bot types `trading`, `shopping`, and `position-management`, with limited or unlimited caps and an approval mode of ask, fully automatic, or capped automatic.
- A Supabase policy ledger (migrations in the repo) that reserves budget, and pause / stop-all / freeze controls that do not sign.
- Devnet USDC transfers with a Memo instruction, signed by Privy or, for deposits, a Wallet Adapter. Broadcast is refused unless the chain genesis is devnet.
- x402 v2 challenges and a devnet price/trust Worker. Mainnet payment challenges are rejected in code.
- Trust scores from the Jupiter Tokens API, with a confirmation gate under 400. Prices from DexScreener, with a Jupiter Price API fallback. Paper positions only price SOL, USDC, and USDT, and they do not broadcast a swap.
- QuickNode webhook verification, dedupe, wallet-list sync, backfill, and a cron that re-reads devnet USDC when the stream has been silent for an hour.
- An ElevenLabs Agents spec whose custom LLM is Grok on this Worker, plus webhook tools that call the same routes as the UI and cannot approve or send.
- Offline Grok Bot post drafts and a chat export that redacts secret-shaped strings.
- A Next.js glass shell: Privy login, bot creation, an approval preview, a timeline, Live View, overview metrics, and a security page.

`npm test` covers this without secret values. Execute does nothing on chain unless a devnet signer is injected. Several HTTP data routes are still stubs. The shopping, SNS, and agent-commerce packages are not wired through a live checkout.

## What problem does it solve?

An agent that can pay should not be able to invent an amount, a token, or an approval. Maelstrom puts a budget, a second opinion, and an approval mode in front of every devnet USDC debit, and it leaves a memo the transfer has to match.

## How does it work?

The owner creates a bot with a type, a goal, a Privy wallet, caps (or unlimited), and an approval mode. The loop asks a model, through OpenRouter, to research and propose. A trust gate stops low-score buys until the owner confirms. A verifier re-derives the asset, amount, and score and retries at most five times. Bot policy then applies the cap, the kill switch, and the approval mode. Over the cap, the owner can approve once or raise the limit. If a devnet signer is configured, the bot wallet sends USDC with the decision memo. If not, the run waits. QuickNode is how a later wallet event wakes that bot; an hourly cron is only the fallback. Voice uses the same routes and is instructed not to move funds.

## What makes it unique?

The verifier is the only automatic reviewer, and the owner sees the settled result rather than each mismatch. Approval is a per-bot mode, not a single global switch, and position bots stop on max loss instead of a spend cap. Execution is devnet USDC plus the Memo program. Mainnet appears only as price data for a three-asset paper book with a one-hour hold. The voice agent is a remote for the same API, and its prompt refuses the spend buttons.

## What would you build next?

Finish the pieces the plan still leaves open: a hosted Worker and a hosted database, a real x402 sandbox purchase, SNS sends, bot-sold signal endpoints, and the payments, wallet, and positions panes. Mount the ElevenLabs conversation in the app so read-back stays in the call. Post the Grok Bot drafts after an X credential exists. Record the demo once those paths are the ones on screen.

No award amounts are results. The track, chain award, and bounties above are what we are entering.
