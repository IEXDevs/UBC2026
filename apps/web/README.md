# Maelstrom web (Cloudflare-hosted Next.js)

Glassmorphic shell (Sid): agent rail, positions book, plugins, history, Privy login, and the ElevenLabs voice composer.

Create bot asks for a type, a wallet, caps, and an approval mode. The three built-in templates are locked. User templates can be saved and deleted in the page. Create stores a draft; Enable turns it on. The wallet list is built with the wallet helpers (main, additional, and a frozen wallet that cannot be assigned). Nothing here signs or reads secret values.

Privy mounts when `NEXT_PUBLIC_PRIVY_APP_ID` is set. Put that value (and the matching `PRIVY_APP_ID`) in the **repo root** `.env.local` — `next.config.mjs` loads root `NEXT_PUBLIC_*` into the Next process. Login is Solana-only and creates an embedded wallet for users who do not have one. The modal offers **email, Google, GitHub, Discord, and wallet**. `PRIVY_APP_SECRET` stays on the Worker / root `.env.local` server routes — never in `NEXT_PUBLIC_*`.

If Connect shows **Something went wrong**, fix the Privy dashboard (not the Next env file):

1. [Authentication](https://dashboard.privy.io) → enable **Email**, **Google**, **GitHub**, and **Discord** (match `loginMethods` in `lib/privy-config.mjs`).
2. Configuration → App settings → **Domains** → Allowed origins → add exactly `http://localhost:3000` (include the port). Add your deployed web origin the same way when you host it. OAuth also needs that origin (and redirect URLs) on the App client if you use one.
3. Leave `NEXT_PUBLIC_PRIVY_CLIENT_ID` **empty** unless you created an App client and copied that client’s id. A wrong client id uses a different allowlist and fails login with the same generic error.
4. Enable **Solana** embedded wallets (create on login) so the shell can mint the main wallet after sign-in.
5. Restart `npm run dev -w @ubc2026/web` after any `.env.local` change. In DevTools → Network, a failing init call often returns `invalid_origin`.

After login the shell calls `POST /api/wallets`. That needs **server** names in the same root `.env.local`: `PRIVY_APP_SECRET` and `QUICKNODE_DEVNET_RPC_URL` (https Solana **devnet** endpoint). `PRIVY_APP_ID` can match `NEXT_PUBLIC_PRIVY_APP_ID`. Until that succeeds you still see preview wallet rows (`PreviewMain111…`). The on-screen note lists any missing names — fix those, restart Next, sign in again.

Set `NEXT_PUBLIC_AGENT_RUNTIME_URL` to the deployed agent-runtime origin (for example `https://maelstrom-agent-runtime.<subdomain>.workers.dev`). That is not the Next dev server on port 3000.

The Main pane leads with Live View plus chat and the voice composer. Overview and Security stay available in the dock. Shopping bots get a prepare panel for sandbox/Laso. Talk uses `@elevenlabs/client` when `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` (and the Worker `ELEVENLABS_*` secrets) are set.

Hosting is OpenNext on Cloudflare Workers (`wrangler.jsonc`, `open-next.config.ts`). This package does not deploy by itself.

```bash
npm run dev -w @ubc2026/web
npm test -w @ubc2026/web
npm run preview -w @ubc2026/web
npm run deploy -w @ubc2026/web
```
