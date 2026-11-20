# `@ubc2026/grok-bot`

Grok Bot on X watches Maelstrom's notable Solana mainnet-beta activity: confirmed transactions, settled x402 payments, fund grab-backs, and stop-all memos. Each notable event becomes a post draft with an explorer link, and that draft stays off the network because this build does not read an X credential or send a request. The chat that reviewed those drafts exports to JSON and Markdown, and secret-shaped strings are removed before the file is written. Grok Bot is the part of Maelstrom that surfaces on-chain activity and keeps the chat record for the bounty.

`prepareNotablePosts` accepts timeline events (`tx.confirmed`, `payment.x402`, `funds.grabbed`, `kill.stop-all`) and QuickNode stream rows (`deposit`, `withdrawal`, `x402-in`, `x402-out`, `memo`, `swap`). It returns `delivery: "offline"` and `networkCalls: 0`. There is no X client in this package.

```js
import { exportGrokChat, prepareNotablePosts } from '@ubc2026/grok-bot';

const payload = prepareNotablePosts(events);
const exported = exportGrokChat(chat, { format: 'both' });
```

```bash
npm test -w @ubc2026/grok-bot
node scripts/grok-bot.mjs draft < events.json
node scripts/grok-bot.mjs export --markdown < chat.json
```
