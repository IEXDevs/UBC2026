# Devpost form answers — Maelstrom

Copy source for the UBC 2026 Devpost form. Written from `dev` at `a45f458`. This file is not a submitted entry. It does not claim a prize or a metric.

Still open, and not described below as finished:

- A signed-in click check of the wallet sheet. The hosted developer preview opens that sheet from the top-right balance, Profile, and a positions wallet card. A Privy session has not been checked.
- One recorded live devnet USDC send and one recorded Streams wake. The hosted main wallet `8VPb8xEorh3yis3cnvJRUhFs5oZhYYyj3CNJoKGG7U42` holds 10 SOL and 20 USDC from the Circle faucet. The desk has no password yet, and the sign-in page is still up, so nothing has been broadcast. `stream_events` is empty. Repeating the wallet-list sync adds the same address again, so `QUICKNODE_API_KEY` or `QUICKNODE_WALLET_LIST_KEY` is empty on the Worker and the list does not stick.
- Posting Grok Bot drafts to X. There is no X credential in the repo or the Worker secret list, and `packages/grok-bot` still returns `delivery: "offline"`
- On-chain PDA caps and Cloudflare Queues. This repo does not deploy its own Solana program, and the Worker config does not bind a queue. Adding either would be a second path, so they stay out
- The 2–3 minute demo video and the live pitch. The script is below. Do not submit the form from this file

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

`npm test` covers this without secret values. With local Privy + QuickNode secrets the Worker builds a transfer client and can execute, settle shopping, and grab-back on Solana devnet. With Supabase service-role secrets the `/api/*` data routes and `policy_reserve_budget` path are live. Without those secrets, routes return empty `unconfigured` payloads or pause at `signer-not-configured`.

## What problem does it solve?

An agent that can pay should not be able to invent an amount, a token, or an approval. Maelstrom puts a budget, a second opinion, and an approval mode in front of every devnet USDC debit, and it leaves a memo the transfer has to match.

## How does it work?

The owner creates a bot with a type, a goal, a Privy wallet, caps (or unlimited), and an approval mode. The loop asks a model, through OpenRouter, to research and propose. A trust gate stops low-score buys until the owner confirms. A verifier re-derives the asset, amount, and score and retries at most five times. Bot policy then applies the cap, the kill switch, and the approval mode. Over the cap, the owner can approve once or raise the limit. If a devnet signer is configured, the bot wallet sends USDC with the decision memo. If not, the run waits. QuickNode is how a later wallet event wakes that bot; an hourly cron is only the fallback. Voice uses the same routes and is instructed not to move funds.

## What makes it unique?

The verifier is the only automatic reviewer, and the owner sees the settled result rather than each mismatch. Approval is a per-bot mode, not a single global switch, and position bots stop on max loss instead of a spend cap. Execution is devnet USDC plus the Memo program. Mainnet appears only as price data for a three-asset paper book with a one-hour hold. The voice agent is a remote for the same API, and its prompt refuses the spend buttons.

## What would you build next?

Post the Grok Bot drafts after an X credential exists outside the build. Record the demo on the hosted desk once a signed-in send and a Streams wake are on camera. Leave PDA caps and Queues out unless they use the same spend path.

No award amounts are results. The track, chain award, and bounties above are what we are entering.

## Demo script (about 2–3 minutes)

Do not invent a recording. Say these facts only.

1. Open https://dev.maelstrom.iexdevs.com. Sign in with Privy. The desk is Solana devnet execution with mainnet prices.
2. Finish the handle, then the password and the seed download. Say that Maelstrom does not store the seed or the password. If the download is gone, it is gone.
3. Create one agent with an ask-every-time permission and a USDC cap. Show the top-right balance opening the wallet sheet, then the same sheet from Profile and from a positions wallet card.
4. Copy the address from the first-five, last-five line. Price a non-USDC send and point at the label "devnet execution, mainnet pricing". Say the quote is not broadcast. The slide sends the quoted USDC on the platform ledger.
5. Set the desk password, unlock, and send a small amount of the 20 devnet USDC already on `8VPb8xEorh3yis3cnvJRUhFs5oZhYYyj3CNJoKGG7U42`. The same desk grant is what the Worker requires before a spend.
6. Freeze all agents and show that a frozen bot cannot spend. Unfreeze clears the freeze and leaves a paused bot paused.
7. A Streams wake needs a solana-devnet stream whose destination is `POST /webhooks/quicknode`, plus Worker values for `QUICKNODE_API_KEY` and `QUICKNODE_WALLET_LIST_KEY`. Those values are empty today, and `stream_events` has no rows. The hourly cron is only the fallback. Do not invent a webhook.
8. Close on the order: trust gate, verifier, wallet freeze, bot policy, approval mode, then sign. Signing stays in the wallet package. A mainnet quote never authorizes a transaction.
