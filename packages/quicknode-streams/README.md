# `@ubc2026/quicknode-streams`

Isaac / chunk **5A**: QuickNode Streams webhook verify, dedupe, wallet KV sync plans, and backfill plans.

```js
import {
  handleQuickNodeWebhook,
  createMemoryDedupeStore,
  planWalletKvSync,
  streamsReadmeSection,
} from '@ubc2026/quicknode-streams';
```

HMAC: `X-QN-Nonce` + `X-QN-Timestamp` + raw body, keyed by `QUICKNODE_WEBHOOK_SECRET`.

```bash
npm test -w @ubc2026/quicknode-streams
```
