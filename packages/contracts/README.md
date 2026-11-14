# `@ubc2026/contracts`

Shared Maelstrom data shapes used by the web app, Workers, and library packages.

Covers:

- Privy wallet records (main + additional, freeze flag)
- Bot records (type, goal, assigned wallet, approval mode, caps)
- Spend ledger, decision records, hash-chained timeline events, x402 payments, metrics
- API route list (`API_ROUTES`, `matchApiRoute`) shared by the Worker
- Secret and public config **names** (`SECRET_NAMES`, `readConfig`) — values are never stored here
- Locked builtin templates (trading / shopping / position-management)

Pure validators only. No I/O, signing, or secrets.

```bash
npm test -w @ubc2026/contracts
```
