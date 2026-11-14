# Maelstrom web (Cloudflare-hosted Next.js)

Glassmorphic shell (Sid): agent rail, positions book, plugins, history, Privy login, and the ElevenLabs voice composer.

Create bot asks for a type, a wallet, caps, and an approval mode. The three built-in templates are locked. User templates can be saved and deleted in the page. Create stores a draft; Enable turns it on. The wallet list is built with the wallet helpers (main, additional, and a frozen wallet that cannot be assigned). Nothing here signs or reads secret values.

Privy mounts when `NEXT_PUBLIC_PRIVY_APP_ID` is set (`NEXT_PUBLIC_PRIVY_CLIENT_ID` is optional). Put the same app id in root `.env.local`. Login is Solana-only and creates an embedded wallet for users who do not have one. `PRIVY_APP_SECRET` stays on the Worker / `.env.local` server routes — never in `NEXT_PUBLIC_*`.

Set `NEXT_PUBLIC_AGENT_RUNTIME_URL` to the deployed agent-runtime origin (for example `https://maelstrom-agent-runtime.<subdomain>.workers.dev`). That is not the Next dev server on port 3000.

The Main pane leads with Live View plus chat and the voice composer. Overview and Security stay available in the dock. Shopping bots get a prepare panel for sandbox/Laso. Talk uses `@elevenlabs/client` when `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` (and the Worker `ELEVENLABS_*` secrets) are set.

Hosting is OpenNext on Cloudflare Workers (`wrangler.jsonc`, `open-next.config.ts`). This package does not deploy by itself.

```bash
npm run dev -w @ubc2026/web
npm test -w @ubc2026/web
npm run preview -w @ubc2026/web
npm run deploy -w @ubc2026/web
```
