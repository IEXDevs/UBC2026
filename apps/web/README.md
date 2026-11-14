# Maelstrom web (Cloudflare-hosted Next.js)

Glassmorphic shell: bot list, bot pages, Privy login, bot creation, and the ElevenAgents Talk stub.

Create bot asks for a type, a wallet, caps, and an approval mode. The three built-in templates are locked. User templates can be saved and deleted in the page. Create stores a draft; Enable turns it on. The wallet list is built with the wallet helpers (main, additional, and a frozen wallet that cannot be assigned). Nothing here signs or reads secret values.

Privy mounts when `NEXT_PUBLIC_PRIVY_APP_ID` is set (`NEXT_PUBLIC_PRIVY_CLIENT_ID` is optional). Login is Solana-only and creates an embedded wallet for users who do not have one. The app secret stays off the client.

The Agents pane is the bot page. It leads with an approval preview (approve, approve once, or raise limit) and does not sign. Under that is a live tool timeline, the owner Live View, and a "Why did it do this?" record built from decision digests. Live View and the timeline call the agent runtime when `NEXT_PUBLIC_AGENT_RUNTIME_URL` is set and a Privy user id is present.

Overview shows owner rollup metrics (and polls `/api/metrics` when the runtime is up). Security is the kill switch / freeze page — pause-all hits each bot DO when possible; grab-back stays an intent until wallet routes sign. Payments, wallets, and positions stay empty for Sid.

Hosting is OpenNext on Cloudflare Workers (`wrangler.jsonc`, `open-next.config.ts`). This package does not deploy by itself.

```bash
npm run dev -w @ubc2026/web
npm test -w @ubc2026/web
npm run preview -w @ubc2026/web
npm run deploy -w @ubc2026/web
```
