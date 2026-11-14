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
- `POST /bots/:id/shopping/prepare|settle` — x402 sandbox (and Laso prepare) shopping path (`x-owner-id`)
- `GET|POST /bots/:id/commerce/signals/:signalId` — bot sells a signal over x402 (402 challenge)
- `POST /bots/:id/commerce/signals/:signalId/settle` — release signal after PAYMENT-SIGNATURE
- `POST /bots/:id/sns/send` — resolve `.sol` and build/execute unsigned send intent (`x-owner-id`)
- `POST /security/grab-back` — owner sweep additional wallets to main (`x-owner-id`); dry-run without transfer client
- `GET /voice/agent` — ElevenLabs agent spec. Custom LLM is Grok (`x-ai/grok-4.7`, override with `OPENROUTER_MODEL_VOICE`) via `POST /voice/llm/chat/completions`, which streams OpenRouter chat completions. The OpenRouter key is not part of the spec.
- `POST /voice/tools/:name` — ElevenLabs webhook tools. Each tool calls the same bot, event, wallet, metric, payment, or browser route as the UI, with the same `x-owner-id` header. Live View URLs are removed before the model sees the result. Requires `ELEVENLABS_WEBHOOK_SECRET` and `x-owner-id`. Without the secret the route returns `elevenlabs_webhook_not_configured` and does not call ElevenLabs.
- `GET /api/routes` — contract route list and secret names (no values)
- `GET /api/me`, `/api/wallets`, `/api/bots`, `/api/events`, `/api/decisions`, `/api/payments`, `/api/metrics` — stubs from `API_ROUTES`
- `POST /api/wallets` and `POST /api/wallets/:walletId/sign` — stubs until wallet signing lands
- Hourly cron `0 * * * *` — paper position check for trading and position-management bots. Shopping bots are skipped. The check is stored on the bot Durable Object and does not start a research or spend loop. Prices use `lookupPrice` when a bot has positions; otherwise DexScreener (no key). With `lookupPrice: null`, marks are left unpriced.
- Stream-fallback cron `5,20,35,50 * * * *` — if Supabase `stream_events` has no delivery in the last hour (or Supabase is not configured), re-read each bot wallet's devnet USDC with `QUICKNODE_DEVNET_RPC_URL`. The RPC URL is not written into the check. A non-devnet genesis hash is refused. The same re-check also runs on the hourly cron when the stream is stale.

Business data (wallets, ledger, approvals) stays in Supabase. This Worker holds checkpointed run state only. Optional model id overrides, not secrets: `OPENROUTER_MODEL_RESEARCH`, `OPENROUTER_MODEL_DECIDE`, `OPENROUTER_MODEL_VERIFY`, `OPENROUTER_MODEL_MONITOR`, `OPENROUTER_MODEL_VISION`, `OPENROUTER_MODEL_VOICE`. Defaults are `x-ai/grok-4-fast` (research, monitor), `x-ai/grok-4.7` (decide, verify, voice), and `x-ai/grok-4` (vision). A voice override is used only when it is an `x-ai/grok` model id.

```bash
npm test -w @ubc2026/agent-runtime
```

Deploy (after secrets):

```bash
npx wrangler deploy -c apps/agent-runtime/wrangler.jsonc
```
