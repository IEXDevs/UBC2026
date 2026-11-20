# `@ubc2026/wallets`

Privy wallet assignment helpers for Maelstrom.

- Required main wallet + optional additional wallets
- Bot → wallet binding (shared wallets allowed)
- Freeze gates for bots and wallets before spend
- Privy login provisioning: `acceptLogin` reads the Privy user and creates the Solana main wallet when sign-up has none
- Additional Privy wallets via `createAdditional`
- Server signing: Privy `signTransaction`, then `sendTransaction` on Solana mainnet-beta through `SOLANA_RPC_URL`
- Owner moves: `signAndBroadcastOwnerSolana` uses the same mainnet-beta gate without the bot freeze check, so grab-back can sweep a frozen wallet
- Wallet Adapter deposits: `broadcastSignedSolana` sends an already-signed transaction only after the genesis hash matches mainnet-beta
- `getSolanaBlockhash` and `getSolanaUsdcBalance` read QuickNode only after that same genesis check. The USDC mint is Circle mainnet-beta USDC

Import server Privy helpers from `@ubc2026/wallets/privy` (not the package root). The root export stays browser-safe for bot creation / freeze helpers used by `apps/web`.

`createPrivyWalletClientFromEnv` reads `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and the server RPC secret. Mainnet prefers `QUICKNODE_MAINNET_RPC_URL` and falls back to `SOLANA_RPC_URL`. Devnet uses `SOLANA_RPC_URL`. `PRIVY_AUTHORIZATION_KEY` is optional (`wallet-auth:` P-256 key) and is attached only when a user wallet requires an authorization signature. Tests inject `fetcher` and never call Privy or QuickNode. Do not log or commit those values. The Next.js login screen stays in `apps/web`.

```bash
npm test -w @ubc2026/wallets
```
