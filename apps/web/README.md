# Maelstrom web (Cloudflare-hosted Next.js)

Glassmorphic shell: bot list, empty panes, Privy login, and the ElevenAgents Talk stub.

Privy mounts when `NEXT_PUBLIC_PRIVY_APP_ID` is set (`NEXT_PUBLIC_PRIVY_CLIENT_ID` is optional). Login is Solana-only and creates an embedded wallet for users who do not have one. The app secret stays off the client. Pane bodies stay empty. Live View calls the agent runtime when `NEXT_PUBLIC_AGENT_RUNTIME_URL` is set and a Privy user id is present.

Hosting is OpenNext on Cloudflare Workers (`wrangler.jsonc`, `open-next.config.ts`). This package does not deploy by itself.

```bash
npm run dev -w @ubc2026/web
npm test -w @ubc2026/web
npm run preview -w @ubc2026/web
npm run deploy -w @ubc2026/web
```
