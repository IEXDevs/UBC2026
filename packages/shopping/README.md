# `@ubc2026/shopping`

Isaac / chunk **6B**: x402 sandbox shopping (catalog → proposal → policy → settle) plus Laso tiny-card mainnet challenge (owner-gated).

```js
import {
  prepareSandboxPurchase,
  settleSandboxPurchase,
  prepareLasoTinyCardPurchase,
} from '@ubc2026/shopping';
```

Worker routes: `POST /bots/:id/shopping/prepare` and `POST /bots/:id/shopping/settle`.

```bash
npm test -w @ubc2026/shopping
```
