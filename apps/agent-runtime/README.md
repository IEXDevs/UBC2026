# Maelstrom agent runtime

Cloudflare Worker + per-bot Durable Object for live run checkpoints.

- `POST /bots/:id/wake` — start or continue research step
- `POST /bots/:id/loop` — full loop, checkpointed per step: research → decide → trust gate → verify → bot-policy → approval → execute → memo → monitor. Requires `x-owner-id`. Models go through OpenRouter with the locked platform prompt. No API key is written into the prompt. Without `OPENROUTER_API_KEY` the step returns `openrouter_not_configured` and does not call the network. Execute signs only when a devnet transfer client is injected; otherwise the run waits at `signer-not-configured`.
- `POST /bots/:id/decide` — trust → verify → policy gate (pauses on approval)
- `POST /bots/:id/pause|resume|advance`
- `GET /bots/:id/status`
- `POST /bots/:id/browser/sessions` — open an owner-bound Cloudflare browser session (`x-owner-id`)
- `GET /bots/:id/browser/sessions` — list that owner's open sessions
- `POST /bots/:id/browser/sessions/:sessionRecordId/live-view` — readonly Live View URL, `Cache-Control: no-store`
- `POST /bots/:id/browser/sessions/:sessionRecordId/release` — close the Browser Run session
- `POST /webhooks/quicknode` — Streams HMAC → dedupe → Supabase persist → wake → optional `/loop`
- `POST /internal/streams/sync-wallets` — owner push of wallet addresses into QuickNode KV list (`x-owner-id`)
- `POST /internal/streams/backfill` — owner replay of missed Stream rows (`x-owner-id`)
- `GET /api/routes` — contract route list and secret names (no values)
- `GET /api/me`, `/api/wallets`, `/api/bots`, `/api/events`, `/api/decisions`, `/api/payments`, `/api/metrics` — stubs from `API_ROUTES`
- `POST /api/wallets` and `POST /api/wallets/:walletId/sign` — stubs until wallet signing lands
- Hourly cron `0 * * * *` — paper position check for trading and position-management bots. Shopping bots are skipped. The check is stored on the bot Durable Object and does not start a research or spend loop. Prices use `lookupPrice` when a bot has positions; otherwise DexScreener (no key). With `lookupPrice: null`, marks are left unpriced.
- Stream-fallback cron `5,20,35,50 * * * *` — if Supabase `stream_events` has no delivery in the last hour (or Supabase is not configured), re-read each bot wallet's devnet USDC with `QUICKNODE_DEVNET_RPC_URL`. The RPC URL is not written into the check. A non-devnet genesis hash is refused. The same re-check also runs on the hourly cron when the stream is stale.

Business data (wallets, ledger, approvals) stays in Supabase. This Worker holds checkpointed run state only. Optional model id overrides, not secrets: `OPENROUTER_MODEL_RESEARCH`, `OPENROUTER_MODEL_DECIDE`, `OPENROUTER_MODEL_VERIFY`, `OPENROUTER_MODEL_MONITOR`, `OPENROUTER_MODEL_VISION`. Defaults are `x-ai/grok-4-fast` (research, monitor), `x-ai/grok-4.7` (decide, verify), and `x-ai/grok-4` (vision).

```bash
npm test -w @ubc2026/agent-runtime
```

Deploy (after secrets):

```bash
npx wrangler deploy -c apps/agent-runtime/wrangler.jsonc
```
