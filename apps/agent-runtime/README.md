# Maelstrom agent runtime

Cloudflare Worker + per-bot Durable Object for live run checkpoints.

- `POST /bots/:id/wake` — start or continue research step
- `POST /bots/:id/loop` — full loop, checkpointed per step: research → decide → trust gate → verify → bot-policy → approval → execute → memo → monitor. Requires `x-owner-id`. Models go through OpenRouter with the locked platform prompt. No API key is written into the prompt. Without `META_MODEL_API_KEY` (or the `OPENROUTER_API_KEY` fallback) the step returns `openrouter_not_configured` and does not call the network. Execute signs through Privy when `PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `QUICKNODE_DEVNET_RPC_URL` are set (or an injected `transferClient`); otherwise the run waits at `signer-not-configured`. With Supabase, execute reserves budget via `policy_reserve_budget` before broadcasting.
- `POST /bots/:id/decide` — trust → verify → policy gate (pauses on approval)
- `POST /bots/:id/pause|resume|advance`
- `GET /bots/:id/status`
- `POST /bots/:id/browser/sessions` — open an owner-bound Cloudflare browser session
- `GET /bots/:id/browser/sessions` — list that owner's open sessions
- `POST /bots/:id/browser/sessions/:sessionRecordId/live-view` — readonly Live View URL, `Cache-Control: no-store`
- `POST /bots/:id/browser/sessions/:sessionRecordId/release` — close the Browser Run session
- `POST /webhooks/quicknode` — Streams HMAC → dedupe → Supabase persist → wake → optional `/loop`
- `POST /internal/streams/sync-wallets` — owner push of wallet addresses into QuickNode KV list (`x-owner-id`)
- `POST /internal/streams/backfill` — owner replay of missed Stream rows (`x-owner-id`)
- `POST /bots/:id/shopping/prepare|settle` — x402 sandbox (and Laso prepare) shopping path for an owned bot
- `GET|POST /bots/:id/commerce/signals/:signalId` — bot sells a signal over x402 (402 challenge)
- `POST /bots/:id/commerce/signals/:signalId/settle` — release signal after PAYMENT-SIGNATURE
- `POST /bots/:id/sns/send` — resolve `.sol` and build a send intent for an owned bot
- `POST /security/grab-back` — owner sweep additional wallets to main; dry-run without transfer client
- `GET /voice/agent` — ElevenLabs agent spec. Custom LLM is Meta Muse Spark 1.3 Contributor (`muse-spark-1.3-contributor`, override with `OPENROUTER_MODEL_VOICE`) via `POST /voice/llm/chat/completions`. Prefer `META_MODEL_API_KEY` (LLM_…) against `https://api.meta.ai/v1`.
- `POST /voice/tools/:name` — retired ElevenLabs webhook tools (410 after webhook authentication).
- `GET /api/routes` — contract route list and secret names (no values)
- `GET /api/me`, `/api/wallets`, `/api/bots`, `/api/events`, `/api/decisions`, `/api/payments`, `/api/metrics` — live Supabase reads when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set (empty `source: unconfigured` otherwise).
- `POST /api/wallets` — Privy `acceptLogin` + optional Supabase persist (`PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `QUICKNODE_DEVNET_RPC_URL`)
- `POST /api/wallets/:walletId/sign` — Privy `signAndBroadcastDevnet` / owner sweep when secrets are present
- Loop execute, shopping settle, SNS execute, and grab-back use a Privy `transferClient` built from those same secrets when one is not injected. Loop also calls `policy_reserve_budget` through Supabase when the service role is set. QuickNode auto-`/loop` loads bot/wallet/ledger from Supabase via `loadLoopContext`.
- Hourly cron `0 * * * *` — paper position check for trading and position-management bots. Shopping bots are skipped. The check is stored on the bot Durable Object and does not start a research or spend loop. Prices use `lookupPrice` when a bot has positions; otherwise DexScreener (no key). With `lookupPrice: null`, marks are left unpriced.
- Stream-fallback cron `5,20,35,50 * * * *` — if Supabase `stream_events` has no delivery in the last hour (or Supabase is not configured), re-read each bot wallet's devnet USDC with `QUICKNODE_DEVNET_RPC_URL`. The RPC URL is not written into the check. A non-devnet genesis hash is refused. The same re-check also runs on the hourly cron when the stream is stale.

Business data (wallets, ledger, approvals) stays in Supabase. This Worker holds checkpointed run state only. Prefer `META_MODEL_API_KEY` for Muse Spark. Optional model id overrides, not secrets: `OPENROUTER_MODEL_RESEARCH`, `OPENROUTER_MODEL_DECIDE`, `OPENROUTER_MODEL_VERIFY`, `OPENROUTER_MODEL_MONITOR`, `OPENROUTER_MODEL_VISION`, `OPENROUTER_MODEL_VOICE`. Default for every role and voice is `muse-spark-1.3-contributor`.

Browser and API callers must send a Privy access token as `Authorization: Bearer <token>` on owner data, bot control, shopping, SNS send, grab-back, and spend routes. An optional `x-owner-id` must match the verified subject. The Worker needs `PRIVY_APP_ID` matching the browser build's Privy app, and HTTPS access to that app's JWKS on `auth.privy.io`. Both web environments share this Worker: verify their app IDs match before deploying, then roll out the web handlers as well. Wallet provisioning and signing still need the existing secrets; this authentication change needs no database migration.

```bash
npm test -w @ubc2026/agent-runtime
```

Browser calls from the Next shell (`http://localhost:3000`) need CORS. The Worker allowlists that origin (and `127.0.0.1:3000`) by default and answers `OPTIONS` preflights for `x-owner-id`. Add more origins with a comma-separated `CORS_ORIGINS` Worker var / secret after you deploy the web app.

Deploying the agent-deletion API before applying `20261119010000_agent_deletions.sql` leaves existing deletion and sync behavior in place. With the migration, deletions are recorded by owner and agent ID, including agents that only existed in a browser. Earlier deletions cannot be reconstructed.

Deploy (after secrets):

```bash
npx wrangler deploy -c apps/agent-runtime/wrangler.jsonc
```
