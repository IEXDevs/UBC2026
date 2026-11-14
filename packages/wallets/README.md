# `@ubc2026/wallets`

Privy wallet assignment helpers for Maelstrom.

- Required main wallet + optional additional wallets
- Bot → wallet binding (shared wallets allowed)
- Freeze gates for bots and wallets before spend
- Privy login provisioning: `acceptLogin` reads the Privy user and creates the Solana main wallet when sign-up has none
- Additional Privy wallets via `createAdditional`
- Server signing: Privy `signTransaction`, then `sendTransaction` on Solana devnet through `QUICKNODE_DEVNET_RPC_URL`
- Owner moves: `signAndBroadcastOwnerDevnet` uses the same devnet gate without the bot freeze check, so grab-back can sweep a frozen wallet
- Wallet Adapter deposits: `broadcastSignedDevnet` sends an already-signed transaction only after the genesis hash matches devnet
- `getDevnetBlockhash` and `getDevnetUsdcBalance` read QuickNode only after that same genesis check. The USDC mint is Circle devnet USDC

`createPrivyWalletClientFromEnv` reads `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `QUICKNODE_DEVNET_RPC_URL`. `PRIVY_AUTHORIZATION_KEY` is optional (`wallet-auth:` P-256 key) and is attached only when a user wallet requires an authorization signature. Tests inject `fetcher` and never call Privy or QuickNode. Do not log or commit those values. The Next.js login screen stays in `apps/web`.

```bash
npm test -w @ubc2026/wallets
```
