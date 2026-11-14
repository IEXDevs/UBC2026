# `@ubc2026/agent-loop`

Pure orchestration for the Maelstrom safety gate:

`trust-score → verify-consensus → wallet freeze → bot-policy → approval mode`

No networking and no signing. A passing gate includes `memo`: the hashed verifier decision record, ready for a later transfer to attach. This package does not submit that memo. The bot Durable Object calls this gate from `POST /bots/:id/loop` before execute. `approvalRequirement` is the same approval-mode check the loop uses.

```bash
npm test -w @ubc2026/agent-loop
```
