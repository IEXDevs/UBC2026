# Maelstrom demo script (Isaac / 10B)

**Headline demo (picked):** Voice-driven shopping bot on Solana — catalog compare → approval preview → x402 sandbox settle, with QuickNode Streams waking the loop and Live View open beside Talk.

## Why this headline
- Hits Agentic Payments + Solana + QuickNode Streams + ElevenLabs in one continuous path
- Shows trust/verify/policy gates instead of a silent auto-spend
- Fits a 2–3 minute cut without swapping products mid-video

## 2–3 min video beats (record when deploy + ElevenLabs agent id are live)
1. **0:00–0:20** — Glass shell, Privy connect, three bots in the rail. Brand: Maelstrom.
2. **0:20–0:50** — Open Sandbox shopper. Show approval preview + timeline. Narrate: “Caps and ask-mode before any USDC moves.”
3. **0:50–1:20** — Trigger shopping prepare (sandbox catalog → cheapest item → 402). Approve once.
4. **1:20–1:50** — Streams wake / loop checkpoint flash; Live View tab visible.
5. **1:50–2:20** — Talk: read-back of the approval; confirm by voice (needs 8A agent). Kill switch mention on Security.
6. **2:20–2:45** — Close on “budget-aware, verifiable, Solana-guarded agents.”

## 5-min pitch + 2-min Q&A rehearsal
**Pitch (5 min)**
1. Problem: agents that can spend are either locked down to demos or unsafe.
2. Product: named bots with caps, ask/capped-auto modes, hash-chained decisions.
3. Stack: Privy wallets, Cloudflare DO loop, QuickNode Streams wake, x402 settle, ElevenLabs Talk.
4. Live: shopping path + Streams + approval UI (same path voice will drive).
5. Ask: Agentic Payments track + Solana chain award + Streams / ElevenLabs bounties.

**Likely Q&A**
- Keys? Privy server signing; model never sees keys.
- Mainnet Laso? Owner-gated challenge only; hackathon settle stays devnet sandbox unless owner signs mainnet.
- Why Streams? Wallet/position events wake the bot; cron is fallback.

## Blockers before recording
- [ ] Deployed agent-runtime + web with secrets
- [ ] ElevenLabs agent id from Alex / 8A
- [ ] Team OK on headline cut and who speaks
