# `@ubc2026/agent-loop`

Pure orchestration for the Maelstrom safety gate:

`trust-score → verify-consensus → wallet freeze → bot-policy → approval mode`

No networking and no signing. The Durable Object calls this before any execute step.

```bash
npm test -w @ubc2026/agent-loop
```
