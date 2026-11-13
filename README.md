# UBC2026

Hackathon project. Browser/search implementation lives in `packages/browser-search`.

Run `npm test` for the adapter contract tests. Cloudflare and Brave credentials are required for live integration; mocked tests require no secrets or dependencies.

Bot type, budget and transaction approval decisions live in `packages/bot-policy`. This module does not sign or execute payments; durable accounting and authenticated approval endpoints must enforce its decisions.
