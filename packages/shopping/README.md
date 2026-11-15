# `@ubc2026/shopping`

Isaac / chunk **6B**: x402 sandbox shopping (catalog → price and quality comparison → proposal → policy → settle) plus Laso tiny-card mainnet challenge (owner-gated).

Quality scores are optional integers from 0 to 1000 on catalog items (`quality` or `qualityScore`). When any item has a score, the proposal is the best quality per sandbox price. Unscored items stay in the ranking after scored ones. A catalog with no scores still proposes the lowest price. `prepareSandboxPurchase` requests the 402 challenge only. Settlement stays on `settleSandboxPurchase` after approval. A live catalog still depends on the sandbox host.

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
