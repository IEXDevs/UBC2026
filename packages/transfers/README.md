# `@ubc2026/transfers`

Solana USDC movement. Every transaction creates the destination token account if needed, transfers Circle mainnet-beta USDC, then writes a memo. Nothing in this package opens a Solana connection or broadcasts.

Signing and broadcast go through `@ubc2026/wallets`:

- Bot spend: `signAndBroadcastSolana` (frozen bots and wallets are refused before Privy is called)
- Withdraw, wallet-to-wallet move, and grab-back: `signAndBroadcastOwnerSolana` (the owner can still sweep a frozen wallet)
- Deposit: the Wallet Adapter `signTransaction` signs locally. `broadcastSignedSolana` sends it only after the QuickNode genesis hash is Solana mainnet-beta. `sendTransaction` on the adapter is never called.

`grabBackToMain` reads mainnet-beta USDC balances through `getSolanaUsdcBalance`, or uses a caller-supplied balance map so tests need no keys. Amounts are integer strings in base units (6 decimals).

```bash
npm test -w @ubc2026/transfers
```
