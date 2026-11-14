# Maelstrom web (Cloudflare-hosted Next.js)

Glassmorphic shell: bot list, empty panes, Privy login, bot creation, and the ElevenAgents Talk stub.

Create bot asks for a type, a wallet, caps, and an approval mode. The three built-in templates are locked. User templates can be saved and deleted in the page. Create stores a draft; Enable turns it on. The wallet list is built with the wallet helpers (main, additional, and a frozen wallet that cannot be assigned). Nothing here signs or reads secret values.

Privy mounts when `NEXT_PUBLIC_PRIVY_APP_ID` is set (`NEXT_PUBLIC_PRIVY_CLIENT_ID` is optional). Login is Solana-only and creates an embedded wallet for users who do not have one. The app secret stays off the client. Pane bodies stay empty. Live View calls the agent runtime when `NEXT_PUBLIC_AGENT_RUNTIME_URL` is set and a Privy user id is present.

Hosting is OpenNext on Cloudflare Workers (`wrangler.jsonc`, `open-next.config.ts`). This package does not deploy by itself.

```bash
npm run dev -w @ubc2026/web
npm test -w @ubc2026/web
npm run preview -w @ubc2026/web
npm run deploy -w @ubc2026/web
```
