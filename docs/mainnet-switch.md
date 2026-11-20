# Mainnet cutover runbook

Code defaults to **mainnet-beta and real funds**. This runbook is not a claim that any hosted deployment, dashboard, wallet or database has been changed. No deploy or hosted migration is performed by this change.

## Network contract

`SOLANA_CLUSTER=mainnet-beta` is the server/Worker choice; optional `devnet` selects the test network. `NEXT_PUBLIC_SOLANA_CLUSTER` is the corresponding web build choice and must match. Empty values default to mainnet-beta; invalid or conflicting values fail closed. Restart/rebuild when changing clusters, including all Workers. Do not share a database, bot or Durable Object checkpoint between active networks.

`QUICKNODE_MAINNET_RPC_URL` selects the HTTPS endpoint for mainnet. If it is unset, mainnet uses `SOLANA_RPC_URL`. Devnet uses `SOLANA_RPC_URL`. Public balance reads can fall back to the selected network's public endpoint. Signing requires a server RPC secret. Keep API-keyed RPC URLs in server secrets.

Mainnet identity: full RPC genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`; x402 CAIP-2 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`; Circle USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals. Privy wallet-standard chain is `solana:mainnet`; QuickNode Streams network is `solana-mainnet`. Mainnet explorer URLs omit the cluster query.

## Deployment configuration checklist

Every checkbox requires the **owner/operator with dashboard, secret or production access** unless marked code-only. Do not copy secrets between unrelated environments without reviewing access boundaries.

### Web: repeat separately for `maelstrom-web-dev` and `maelstrom-web`

- [ ] Cloudflare Build environment: Node 22; set `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta` and `SOLANA_CLUSTER=mainnet-beta`; rebuild, not merely redeploy an old bundle. Wrangler sets the runtime cluster for both environments, because vars do not inherit into `env.dev`.
- [ ] Keep/set public build identifiers `NEXT_PUBLIC_PRIVY_APP_ID`, optional `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `NEXT_PUBLIC_AGENT_RUNTIME_URL`, optional `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`; `NEXT_PUBLIC_BUILD_ID` is generated. Verify each origin points to the intended mainnet runtime/Privy app. Production must not enable preview fixtures.
- [ ] Worker secret `SOLANA_RPC_URL` or `QUICKNODE_MAINNET_RPC_URL`: verified mainnet endpoint. `QUICKNODE_TESTNET_RPC_URL` is used only for optional read-only testnet views in devnet mode.
- [ ] Retain/review server secrets `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, optional `PRIVY_AUTHORIZATION_KEY`; `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; `META_MODEL_API_KEY` or `OPENROUTER_API_KEY`; `FIRECRAWL_API_KEY`; optional `JUPITER_API_KEY`; `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`; `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET`; `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`. These names do not change, but must target the approved environment and retain least privilege.
- [ ] Confirm Wrangler service bindings: `AGENT_RUNTIME` → `maelstrom-agent-runtime`, `WORKER_SELF_REFERENCE` → the respective web Worker; domains `dev.maelstrom.iexdevs.com` / `maelstrom.iexdevs.com`. Both web environments currently share the runtime: **dev is not a test-money sandbox after cutover**.

### Agent runtime: `maelstrom-agent-runtime`

- [ ] Wrangler var `SOLANA_CLUSTER=mainnet-beta` replaces `CLUSTER`; retain `PRODUCT=Maelstrom`, `BOT` binding, hourly/fifteen-minute crons and routes. Pause/freeze bots before deployment; cron and webhook execution must not resume on stale checkpoints.
- [ ] Secret `SOLANA_RPC_URL` or `QUICKNODE_MAINNET_RPC_URL`: verified mainnet QuickNode endpoint. Check that runtime health reports `rpcConfigured: true` and `signing: true`.
- [ ] Retain/review `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, optional `PRIVY_AUTHORIZATION_KEY`; `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; `META_MODEL_API_KEY` or `OPENROUTER_API_KEY`; `FIRECRAWL_API_KEY`; optional `JUPITER_API_KEY`; `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`; `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET`. Model-id overrides `OPENROUTER_MODEL_*` remain unchanged. Preserve/review `CORS_ORIGINS` for both web origins.
- [ ] Set/rotate `QUICKNODE_WEBHOOK_SECRET`, `QUICKNODE_API_KEY`, `QUICKNODE_WALLET_LIST_KEY` for the mainnet stream/KV list; clear or replace optional `STREAM_DEDUPE` namespace for the new deployment. Do not replay old-network events. Keep `SKIP_STREAM_LOOP` enabled during an owner-controlled staged cutover if used operationally.
- [ ] Review optional commerce configuration `SIGNAL_PAY_TO`, `SANDBOX_PAY_TO`, `X402_SANDBOX_BASE_URL`, `LASO_BASE_URL` and injected payment-confirmation/signing integrations. Sandbox prepare/settle is deliberately disabled on mainnet; changing endpoints must not bypass this.

### x402 service: `maelstrom-x402-price-trust`

- [ ] Wrangler var `SOLANA_CLUSTER=mainnet-beta` replaces `CLUSTER`. Review `X402_PRICE_AMOUNT` (default `10000`) and `X402_TRUST_AMOUNT` (`5000`): these now represent **real** micro-USDC.
- [ ] Set `X402_PAY_TO` and `X402_FEE_PAYER` to controlled mainnet public keys (vars, not secrets). Fund the fee payer with real SOL; merchant with any needed rent.
- [ ] Configure the host's `confirmSolanaPayment` integration to verify mainnet settlement, recipient, mint, amount, finality and replay protection. The standalone Worker intentionally has no default RPC confirmer and refuses settlement without one. There is no new x402 secret/RPC variable to set unless that integration introduces one; never invent or silently fake successful confirmation.

## Privy dashboard

- [ ] In [Privy dashboard](https://dashboard.privy.io/), verify the selected app/client supports Solana mainnet embedded and external wallets, both web origin allowlists, existing OAuth callbacks and server authorization policy. Preserve MFA and owner authorization; do not broaden signing permissions to make a failing mainnet transfer succeed.
- [ ] Inspect any dashboard wallet policies/transaction allowlists: allow canonical mainnet USDC and the existing Token/ATA/Memo programs only as required; remove devnet-only network restrictions only in favor of equivalent mainnet restrictions. Browser signing uses the configured wallet-standard chain and public RPC, never a server RPC credential.

## QuickNode dashboard

- [ ] In [QuickNode dashboard](https://dashboard.quicknode.com/), create or select a **Solana mainnet** endpoint and confirm the full genesis hash. Set its URL on both web Workers and the runtime under either accepted secret name. Review paid rate limits, fees and IP/origin restrictions.
- [ ] Re-create Streams on **`solana-mainnet`** (do not merely rename a devnet stream), dataset Block / existing filter, a fresh wallet KV list and a mainnet starting slot. Copy the filter/output schema and destination `/webhooks/quicknode`, but use a fresh webhook HMAC secret and update the Worker secret. Stop the devnet stream first; events without network metadata cannot identify their original chain from payload alone.
- [ ] Resync controlled Privy wallet addresses into the new KV list; update the API/list keys, test signed delivery, inspect persisted cluster/network, and backfill only an explicitly reviewed mainnet slot range. Review delivery retries and old dedupe/backfill state before enabling loop wakes.

## Supabase and persistent state

- [ ] Back up the database. Apply **new** `supabase/migrations/20261120000000_solana_mainnet.sql` after existing migrations; do not edit/reapply historical migrations. The checked-in schema snapshot includes the new guard for offline testing. No hosted SQL has been run by this change.
- [ ] Database execution setting `app.solana_cluster` defaults to mainnet-beta; for a separate devnet database only, the database owner can use `ALTER DATABASE postgres SET app.solana_cluster = 'devnet';` (substitute the actual database name), then reconnect/recycle PostgREST connections. It must match server `SOLANA_CLUSTER`; do not expose arbitrary session configuration to clients. The proposal/reservation guard rejects inactive clusters. History constraints still admit old devnet/testnet rows without relabeling them.
- [ ] Inspect `decision_records`, `payments`, `stream_events`, `paper_positions`, `paper_fills`, `position_checks`, `timeline_events`/activity payloads, wallet/position holdings and transaction links for old clusters, mints, signatures, slots and paper labels. **Do not convert historical devnet balances or signatures into mainnet data.** Archive/filter histories by network or use a clean database/project. Devnet/testnet amounts are not assets on mainnet.
- [ ] Review `wallets.address`, bot wallet assignments, caps/assets, merchant/recipient addresses and token mints. Addresses can exist on both networks but their balances, token accounts and ownership must be rechecked on mainnet. Do not substitute the USDC mint address for a recipient wallet.
- [ ] Reconcile `spend_ledgers` (`spent`, `reserved`, `realized_loss`), policy reservations/idempotency keys, approvals/digests, platform transfers/internal balances, max-loss baselines, paper positions and metrics. Clear nothing automatically: test-money credits must not become real withdrawal claims. A clean mainnet bot/ledger with explicitly approved caps is safer than reusing old test bots. Review pending approved transactions before any funding.
- [ ] Archive/recreate bot Durable Object run checkpoints and browser/schedule state as appropriate. Resume only owner-approved mainnet goals with fresh facts, trust results, simulations, blockhashes and approvals; old approvals/memos do not authorize new transactions.

## Real funding, safety and deploy order

1. **Owner:** freeze/disable all spending bots, scheduled jobs and stream wakes; stop old streams; back up database/state and approve mainnet caps. Both web domains can spend real funds after cutover.
2. **Owner:** prepare Privy policies, mainnet endpoint, fresh Streams/KV/HMAC configuration, mainnet x402 addresses and separate/clean persistent data. Apply the new migration and verify the database cluster setting on fresh connections.
3. **Owner:** deploy runtime and x402 service with matching cluster configuration while bots remain frozen; verify health and that wrong-genesis/wrong-cluster requests fail. x402 confirmation remains closed until a real verifier is bound.
4. **Owner:** build and deploy both web Workers with matching public/server cluster settings and updated secrets. Verify mainnet explorer links, balances, external-wallet network selection, approval previews and the mainnet sandbox-disabled state.
5. **Owner:** fund controlled main/agent/merchant/fee-payer wallets with a **small amount of real SOL for fees/rent** and **canonical real USDC**. Faucets/airdrops cannot fund mainnet. Verify recipient, mint, token-account ownership and amount out of band; use an owner-approved minimal transfer before larger funding.
6. **Owner:** enable fresh mainnet stream delivery, verify the persisted event and reconciliation, then unfreeze one reviewed bot at a time. Monitor RPC failures, duplicate settlement, budget reservations and real balances before enabling the rest.

Trust → verify-consensus → wallet freeze → bot-policy caps/max-loss → approval → sign remains mandatory. Broadcasts require the **full** configured genesis hash. Agents with live swaps store limits in microdollars. The runtime needs `JUPITER_API_KEY`, the mainnet RPC, and Privy browser wallet authorization. The desk shows the exact input, minimum output, and USD debit before approval. The runtime runs preflight on the approved transaction, reserves the USD debit, and broadcasts after wallet authorization. A scheduled swap waits under **Review pending swap** for a fresh quote and owner confirmation. Holdings come from on-chain balances. Historical paper lots do not enter the live position book.

### Deliberately retained devnet references / unsafe demo assumptions

- The shared network registry retains devnet RPC/genesis/CAIP-2/mint for an explicit `SOLANA_CLUSTER=devnet` deployment, with separate state. Negative tests exercise rejection; historical migration SQL retains its original constraints and labels.
- Faucet URLs and test funding instructions are reachable only in explicitly selected devnet mode. Mainnet instructions require real funding; no airdrop call is made.
- Historical explorer links support devnet/testnet. Read-only testnet balance helpers remain, but mainnet defaults neither query testnet nor sum testnet SOL into spendable SOL.
- The old sandbox shopping path trusts request/demo ledger data and has an injected/dry-run signer path rather than the complete permissioned spend gate. Its demo recipient was a mint address, not a controlled merchant. **Runtime sandbox prepare/settle and UI purchase controls are disabled on mainnet**, rather than upgrading fake-money shortcuts into real spending. Laso remains a separate owner-gated challenge, not automatic settlement.
- Preview/demo wallet addresses and balances remain synthetic/offline. Production preview is already disabled. Do not fund addresses copied from fixtures or historical Devpost/demo notes. Those notes are not evidence of mainnet assets or a completed deployment.

### Legacy routes and mainnet guards

These are not newly permissioned spend APIs. Keep them inaccessible to bots/untrusted callers during the cutover; freezing bots alone does not protect an owner sweep route.

- Runtime `/bots/:botId/sns/send` supports unsigned recipient and transfer previews. On mainnet it rejects `execute: true`. The raw signing route rejects bot signing on mainnet. Agents must use the permissioned spend route.
- Runtime signal offers and settlement return `signal_payments_unavailable` on mainnet. Enable them only after adding on-chain confirmation and replay protection. The dedicated x402 service requires a configured payment confirmer.
- Owner SNS withdrawals, grab-back, and wallet moves use owner-authorized sweep paths. Wallet moves verify the Privy session and load both wallets from owner-scoped storage. Review Privy signing policies before exposure.

No live security audit, transfer, deployment, hosted migration or dashboard change is asserted here.
