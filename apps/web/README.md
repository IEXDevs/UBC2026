# Maelstrom web (Cloudflare-hosted Next.js)

Glassmorphic UI shell for bots, panes, timeline, and approvals.

Privy login and ElevenAgents Talk are stubbed. Live View calls the agent runtime when `NEXT_PUBLIC_AGENT_RUNTIME_URL` is set and an owner id is present; until Privy login, the panel stays closed. Hosting target is Cloudflare (OpenNext), not Vercel.

```bash
npm run dev -w @ubc2026/web
npm test -w @ubc2026/web
```
