# `@ubc2026/agent-loop`

Pure orchestration for the Maelstrom safety gate:

`trust-score → verify-consensus → wallet freeze → bot-policy → approval mode`

No networking and no signing. A passing gate includes `memo`: the hashed verifier decision record, ready for a later transfer to attach. This package does not submit that memo. The Durable Object calls this before any execute step.

```bash
npm test -w @ubc2026/agent-loop
```
