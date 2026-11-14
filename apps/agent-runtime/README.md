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
- `POST /webhooks/quicknode` — Streams wake path
- `GET /api/routes` — contract route list and secret names (no values)
- `GET /api/me`, `/api/wallets`, `/api/bots`, `/api/events`, `/api/decisions`, `/api/payments`, `/api/metrics` — stubs from `API_ROUTES`
- `POST /api/wallets` and `POST /api/wallets/:walletId/sign` — stubs until wallet signing lands
- Hourly cron — stub; wakes a bot only when `listScheduledBots` is provided

Business data (wallets, ledger, approvals) stays in Supabase. This Worker holds checkpointed run state only. Optional model id overrides, not secrets: `OPENROUTER_MODEL_RESEARCH`, `OPENROUTER_MODEL_DECIDE`, `OPENROUTER_MODEL_VERIFY`, `OPENROUTER_MODEL_MONITOR`, `OPENROUTER_MODEL_VISION`. Defaults are `x-ai/grok-4-fast` (research, monitor), `x-ai/grok-4.7` (decide, verify), and `x-ai/grok-4` (vision).

```bash
npm test -w @ubc2026/agent-runtime
```

Deploy (after secrets):

```bash
npx wrangler deploy -c apps/agent-runtime/wrangler.jsonc
```
