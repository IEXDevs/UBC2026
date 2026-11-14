# Bot creation and templates

Creation flow for Maelstrom bots: type, wallet picker, caps, and approval mode. Three locked templates (trading, shopping, position management) are always visible and cannot be deleted or hidden. User templates can be created and deleted.

`createBotDraft` returns a disabled bot. `enableBot` is a separate step, so a template or a draft is not a live bot. The wallet picker uses `@ubc2026/wallets` (`assignBotWallet` and wallet records). Frozen wallets are listed and cannot be assigned. This package does not sign, does not read secrets, and does not modify `packages/wallets`.

Caps are unsigned integer strings in the accounting asset's base units. `unlimited` is the FRQ (no cap) choice. Position-management limits use `maxLoss`. Trading and shopping limits use `maxOutflow` and `maxPerTransaction`. Approval modes are fully automatic, capped automatic (with `autoApproveCap`), and ask.

Postgres persistence for the same rules is `supabase/migrations/20261114040000_bot_templates.sql`.

```bash
npm test -w @ubc2026/bot-creation
```
