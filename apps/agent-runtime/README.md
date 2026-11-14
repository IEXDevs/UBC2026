# Maelstrom agent runtime

Cloudflare Worker + per-bot Durable Object for live run checkpoints.

- `POST /bots/:id/wake` — start or continue research step
- `POST /bots/:id/decide` — trust → verify → policy gate (pauses on approval)
- `POST /bots/:id/pause|resume|advance`
- `GET /bots/:id/status`
- `POST /webhooks/quicknode` — Streams wake path
- Hourly cron — scheduled monitoring fallback

Business data (wallets, ledger, approvals) stays in Supabase. This Worker holds checkpointed run state only.

```bash
npm test -w @ubc2026/agent-runtime
```

Deploy (after secrets):

```bash
npx wrangler deploy -c apps/agent-runtime/wrangler.jsonc
```
