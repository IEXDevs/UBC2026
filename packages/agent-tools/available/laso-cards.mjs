
import { EXECUTION_LABEL } from '@ubc2026/contracts/solana';
export default Object.freeze({
  "id": "laso-cards",
  "command": "/laso-cards",
  "title": "Laso cards",
  "group": "Money",
  "source": "available",
  "needsConnector": null,
  "description": "Run any Laso flow end to end: account, KYC, prepaid, reloadable, gift, top-up, payout, or status.",
  "order": 26,
  "instruction": [
    'Skill /laso-cards. Group: Money.',
    'The owner text names the Laso job. Do the whole flow, not just the quote.',
    'Money always moves the same way: prepare_shopping for the x402 quote, then request_spend action x402 with the exact proposed outflow and lasoTicket. Never send a plain transfer to Laso payTo. The owner confirms every purchase. Splitting one payment to dodge a spend limit is forbidden.',
    'Fees are added ON TOP, except /get-card which costs exactly the amount. Size every request below the wallet balance. A 402 with success false means nothing was charged, so retrying smaller is safe. Never reuse a payment: a replay answers 409 payment_already_used.',
    'Pick the product before quoting. Ask which one when the message does not say; never default. Reloadable stays open for repeat charges: subscriptions, ads, AI and inference, anything kept on file. Non-reloadable USA is one prepaid card for a known one-time total at a US merchant with US shipping. International non-reloadable is one prepaid card for a non-US merchant. Gift is a brand card from the catalog. Top-up adds funds to the existing reloadable balance.',
    'Account and KYC belong to the owner. Hand over each link exactly as returned and never open it: the claim link for signup, the kyc_url from /get-kyc-link, the issuer one-time code the owner reads from their own inbox, the approval_url for saved-card buys, the redemption_url form for push-to-card. Never read their email or messages, never submit identity for them, never print a key, seed, token, or card number.',
    'New reloadable card order: check /get-kyc-status, hand over the kyc link until kyc_verified is true, then /get-card-issuer-status, /start-card-issuer-link, the owner types the code, /verify-card-issuer-link with consent accepted, fund with /fund-card-balance or /fund-card-from-account-balance and poll /list-card-transactions to credited, then /create-reloadable-card (min $1), then /get-card-data by card_id for the number and CVV. Billing address is null on reloadable cards: use the address the owner verified with, never Laso Finance or a substitute.',
    'USA prepaid order: /get-card for the exact checkout total ($5-$1000). Poll /get-card-data every 2-3 seconds until ready, about 7-10 seconds. Pending is not ready. USA cards decline subscriptions and kept-on-file merchants.',
    'International prepaid order: /order-intl-card in whole dollars ($100-$1000 plus 3.8% fee, less in a fee promotion). The order queues for about 24 hours; keep polling /get-card-data with the same id. Cancel a queued order with /cancel-intl-card, which credits the account balance back.',
    'Gift card order: read /search-gift-cards facets first, then search by brand. Copy laso_server_id exactly, never country-suffix it. Amount is in the product currency, not USD, and must convert to $5-$9000. Unknown ids answer 404 unknown_laso_server_id before any charge: terminal, fix the id, do not retry.',
    'Top-up: /fund-card-balance ($5-$10000, bridges Solana or Base, lands under a minute) or /fund-card-from-account-balance. Withdraw unspent money with /withdraw-card-balance to a Base wallet the owner names; it pays out manually in 1-3 business days.',
    'Payouts: push-to-card needs the redemption_url form finished in a browser. Venmo and PayPal need /get-kyc-status true first or the paid call answers kyc_required with the balance recoverable via /withdraw; a 202 means dispatched, so poll /get-payment-status to complete, failed, or cancelled. Bank needs the destination set up first (profile, recipient, destination) and settles by ACH in 1-2 business days. Saved cards need the owner link and each buy pauses at their approval_url.',
    'Status reads are free and never spend: /get-account-balance, /get-kyc-status, /get-card-data, /list-card-transactions, /get-payment-status, /search-merchants. Check the merchant list before ordering a reloadable top-up. Banking and money-transfer merchants are always not accepted on any card.',
    'Error codes decide the next move, not retries. 503 or 422 card_unavailable means USA cards are down: offer the international card instead. 403 kyc_required hands over the kyc_url. 429 means wait out retry_after_seconds. 404 unknown_laso_server_id, payment_not_found, or account_balance_not_found means fix the input. Timeout after payment means check status first, never blindly repay. Send Idempotency-Key on every POST you might retry.',
    'When the owner asks about Laso itself, fetch the live docs instead of answering from memory: web_scrape https://laso.finance/SKILL.md first, then only the reference the task needs (payments, cards, gift-cards, payouts, banking, account, wallet-native), re-checking the docs-version beacon when the cached copy may be stale. Never invent endpoints, amounts, or limits.',
    'Whenever a flow pauses for the owner, save a laso_checkpoint with kind, stage, and card id, and ask them to reply done. When they confirm, read the checkpoint and continue from that stage with laso_status to verify: never restart, never re-ask what the checkpoint holds.',
    `A mainnet price quote is paper PnL labeled ${EXECUTION_LABEL}. It never authorizes a transaction.`,
    'Do not spend unless the permission line allows that spend.',
  ].join('\n')
});
