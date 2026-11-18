# Maelstrom web (Cloudflare-hosted Next.js)

Glassmorphic shell (Sid): agent rail, positions book, plugins, history, Privy login, and the ElevenLabs voice composer.

Create bot asks for a type, a wallet, caps, and an approval mode. The three built-in templates are locked. User templates can be saved and deleted in the page. Create stores a draft; Enable turns it on. The wallet list is built with the wallet helpers (main, additional, and a frozen wallet that cannot be assigned). Nothing here signs or reads secret values.

Privy mounts when `NEXT_PUBLIC_PRIVY_APP_ID` is set. Put that value (and the matching `PRIVY_APP_ID`) in the **repo root** `.env.local` — `next.config.mjs` loads root `NEXT_PUBLIC_*` into the Next process. Login is Solana-only: Ethereum wallet login and Ethereum embedded wallets stay off, and signup creates a Solana embedded wallet for every user. The modal offers **email, Google, GitHub, Discord, and Solana wallets** (Phantom, Solflare, Backpack, Jupiter). Dashboard MFA is authenticator-app and passkey; the login modal prompts when a wallet action needs it. `PRIVY_APP_SECRET` stays on the Worker / root `.env.local` server routes — never in `NEXT_PUBLIC_*`.

If Connect shows **Something went wrong**, fix the Privy dashboard (not the Next env file):

1. [Authentication](https://dashboard.privy.io) → enable **Email**, **Google**, **GitHub**, and **Discord** (match `loginMethods` in `lib/privy-config.mjs`).
2. Configuration → App settings → **Domains** → Allowed origins → add exactly `http://localhost:3000` (include the port). For the hosted shell, add the **web** origin you open in the browser (`https://maelstrom.iexdevs.com`, or `https://maelstrom-web.<account>.workers.dev` if you use that Worker URL). Do **not** add the agent-runtime Worker (`maelstrom-agent-runtime….workers.dev`) — that is only `NEXT_PUBLIC_AGENT_RUNTIME_URL`, not the login page.
3. Leave **Require users to accept terms** off (this app does not use Privy’s terms gate). Leave `NEXT_PUBLIC_PRIVY_CLIENT_ID` **empty** unless you created an App client and copied that client’s id. A wrong client id uses a different allowlist and fails login with the same generic error.
4. Leave **HttpOnly cookies** off on this app ID (use localStorage sessions). Privy owns sign-in persistence via Local Storage keys `privy:token`, `privy:pat`, and `privy:refresh_token` — we do not monkeypatch Storage. The app only avoids calling `getAccessToken` when refresh is missing (that Privy path would wipe the session). Solana wallets are provisioned by `POST /api/wallets` after sign-in (`createOnLogin` is off in code).
5. Restart `npm run dev -w @ubc2026/web` after any `.env.local` change. In DevTools → Network, a failing init call often returns `invalid_origin`. After a good login, Local Storage `privy:*` keys must survive refresh.

**Discord / GitHub / Google `invalid OAuth2 redirect_uri`:** that error comes from the provider console, not Next. Prefer Privy’s default social credentials (toggle the method on, leave custom client empty). If you pasted your own Discord/GitHub/Google app credentials into Privy → Login methods → Socials, that provider app must allow Privy’s callback **exactly**:

```text
https://auth.privy.io/api/v1/oauth/callback
```

For Discord: [Developer Portal](https://discord.com/developers/applications) → your app → OAuth2 → Redirects → add that URL → Save. Do not use `http://localhost:3000/...` as the Discord redirect — Privy owns the callback, then sends the user back to your allowed origin. Same callback URL for GitHub Authorization callback URL and Google Authorized redirect URIs.

After login the shell calls `POST /api/wallets`. That needs **server** names in the same root `.env.local`: `PRIVY_APP_SECRET` and `QUICKNODE_DEVNET_RPC_URL` (https Solana **devnet** endpoint). `PRIVY_APP_ID` can match `NEXT_PUBLIC_PRIVY_APP_ID`. Until that succeeds the wallet list stays empty. The on-screen note lists any missing names — fix those, restart Next, sign in again.

Set `NEXT_PUBLIC_AGENT_RUNTIME_URL` to the deployed agent-runtime origin (for example `https://maelstrom-agent-runtime.<subdomain>.workers.dev`). That is not the Next dev server on port 3000.

The Main pane leads with Live View plus chat and the voice composer. Overview and Security stay available in the dock. Shopping bots get a prepare panel for sandbox/Laso. Talk uses `@elevenlabs/client` when `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` (and the Worker `ELEVENLABS_*` secrets) are set.

Hosting is OpenNext on Cloudflare Workers (`wrangler.jsonc`, `open-next.config.ts`). This package does not deploy by itself.

- Production worker `maelstrom-web` → `maelstrom.iexdevs.com`
- Dev worker `maelstrom-web-dev` → `dev.maelstrom.iexdevs.com` (`npm run deploy:dev -w @ubc2026/web`)
- Both bind `AGENT_RUNTIME` → `maelstrom-agent-runtime` (`runtime.maelstrom.iexdevs.com`)
- Put secrets on the **matching** worker (`wrangler secret put NAME` vs `wrangler secret put NAME --env=dev`). `NEXT_PUBLIC_PRIVY_APP_ID` must match `PRIVY_APP_ID`.

```bash
npm run dev -w @ubc2026/web
npm test -w @ubc2026/web
npm run preview -w @ubc2026/web
npm run deploy -w @ubc2026/web
npm run deploy:dev -w @ubc2026/web
```
