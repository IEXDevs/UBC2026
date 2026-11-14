# `@ubc2026/transfers`

Devnet USDC movement. Every transaction creates the destination token account if needed, transfers Circle devnet USDC, then writes a memo. Nothing in this package opens a Solana connection or broadcasts.

Signing and broadcast go through `@ubc2026/wallets`:

- Bot spend: `signAndBroadcastDevnet` (frozen bots and wallets are refused before Privy is called)
- Withdraw, wallet-to-wallet move, and grab-back: `signAndBroadcastOwnerDevnet` (the owner can still sweep a frozen wallet)
- Deposit: the Wallet Adapter `signTransaction` signs locally. `broadcastSignedDevnet` sends it only after the QuickNode genesis hash is Solana devnet. `sendTransaction` on the adapter is never called.

`grabBackToMain` reads devnet USDC balances through `getDevnetUsdcBalance`, or uses a caller-supplied balance map so tests need no keys. Amounts are integer strings in base units (6 decimals).

```bash
npm test -w @ubc2026/transfers
```
