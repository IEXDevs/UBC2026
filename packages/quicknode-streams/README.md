# `@ubc2026/quicknode-streams`

Isaac / chunk **5A**: QuickNode Streams webhook verify, dedupe, Supabase persist helpers, QuickNode KV wallet sync, and backfill.

```js
import {
  handleQuickNodeWebhook,
  createMemoryDedupeStore,
  createQuickNodeKvClient,
  createSupabaseStreamStore,
  syncWalletsToKv,
  runStreamBackfill,
  planWalletKvSync,
  streamsReadmeSection,
} from '@ubc2026/quicknode-streams';
```

HMAC: `X-QN-Nonce` + `X-QN-Timestamp` + raw body, keyed by `QUICKNODE_WEBHOOK_SECRET`.

```bash
npm test -w @ubc2026/quicknode-streams
```
