# `@ubc2026/contracts`

Shared Maelstrom data shapes used by the web app, Workers, and library packages.

Covers:

- Privy wallet records (main + additional, freeze flag)
- Bot records (type, goal, assigned wallet, approval mode, caps)
- Spend ledger, decision records, hash-chained timeline events
- Locked builtin templates (trading / shopping / position-management)

Pure validators only. No I/O, signing, or secrets.

```bash
npm test -w @ubc2026/contracts
```
