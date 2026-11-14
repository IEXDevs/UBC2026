# `@ubc2026/wallets`

Privy wallet assignment helpers for Maelstrom.

- Required main wallet + optional additional wallets
- Bot → wallet binding (shared wallets allowed)
- Freeze gates for bots and wallets before spend

No signing and no private keys. Production signing uses Privy server APIs from Workers only.

```bash
npm test -w @ubc2026/wallets
```
