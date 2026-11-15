# Agentic test prompts

Paste these one at a time into text chat (or say them in voice mode). After each, check the tool round / UI side effect.

## 1. Core chat + research
```
Search the web for Solana USDC mint address on mainnet, then scrape the best official docs page and summarize in 3 bullets.
```

```
What's the current price of So11111111111111111111111111111111111111112? Use get_price and say whether this is paper PnL or a real trade.
```

## 2. Dashboard reads (must call tools, not invent)
```
List my bots and their statuses. Then show my wallets with every non-zero balance label you see.
```

```
Give me an overview of the account, recent activity, and the payment feed.
```

```
What happened while I was away? Read the spoken briefing from the timeline.
```

```
Why did the latest decision happen? Call why_decision and explain it in plain English.
```

## 3. Browser / Live View
```
Open a browser for this bot, navigate to https://example.com, then open live view so I can watch it. Tell me when the page title loads.
```

```
List my open browser sessions for this bot, then release all of them.
```

## 4. Bot lifecycle
```
Wake this bot and start a short research task about Solana memecoins. Confirm when the run is checkpointing.
```

```
Pause the bot, then resume it, then stop all runs.
```

## 5. Shopping
```
Prepare a shopping proposal for a cheap sandbox catalog item. Do not settle or sign anything — just show the ranked options.
```

## 6. Spend (set permission mode in the UI first)
**Ask mode**
```
Request a spend of 1 USDC to my main wallet as a test. Ask me before doing anything that needs approval.
```

**Full mode**
```
Under full permissions, request a 1 USDC test spend on digests only. Do not ask whether I want to buy — just follow policy and report the spend result or block reason.
```

## 7. SNS / transfers
```
Resolve the SNS name `example.sol` if it exists. Do not send yet — just show the address or the error.
```

```
If SNS resolve worked earlier, prepare an sns_send of 0.1 USDC to that name and wait for my confirmation.
```

## 8. Voice-only (live voice mode)
```
Open the first bot in my shell, show live view, and read back my wallet list.
```

```
Show me a confirm dialog that says “Approve test spend?” and wait for my answer.
```

## 9. Dictation (not voice mode)
1. Click Dictate  
2. Say: `Buy the cheapest sandbox item under ten dollars and pause after prepare`  
3. Click Dictate again — draft should keep the words  

## 10. Negative / config checks
```
Call web_search for "test". If Firecrawl is missing, tell me the exact not_configured error.
```

```
Open a browser session. If Cloudflare browser secrets are missing, tell me which setting is not_configured instead of pretending it worked.
```

## Smoke order (10 minutes)
1. Dashboard reads (#2)  
2. Browser open + live view (#3)  
3. Start task + pause (#4)  
4. Prepare shopping (#5)  
5. Spend ask-mode (#6)  
6. Voice: list wallets + confirm dialog (#8)  
7. Dictate once (#9)  
