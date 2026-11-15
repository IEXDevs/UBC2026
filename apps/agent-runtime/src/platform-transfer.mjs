const HANDLE = /^[a-z0-9][a-z0-9_]{1,31}$/;
const AMOUNT = /^[1-9][0-9]{0,39}$/;
const KEY = /^[a-zA-Z0-9:_-]{8,128}$/;
const ID = /^[a-zA-Z0-9:_-]{1,128}$/;

export function transferRequest(body) {
  if (!body || typeof body !== 'object') return null;
  const handle = typeof body.handle === 'string' ? body.handle.trim().replace(/^@/, '').toLowerCase() : '';
  const amount = typeof body.amount === 'string' ? body.amount.trim() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const botId = body.botId == null || body.botId === '' ? null : String(body.botId).trim();
  if (!HANDLE.test(handle) || !AMOUNT.test(amount) || !KEY.test(idempotencyKey)) return null;
  if (botId && !ID.test(botId)) return null;
  return { handle, amount, idempotencyKey, botId };
}

export function platformProposal({ ownerId, botId, handle, amount, idempotencyKey, now }) {
  return {
    ownerId,
    now,
    approvalId: null,
    proposal: {
      id: idempotencyKey,
      botId,
      asset: 'USDC',
      recipient: `@${handle}`,
      quoteId: idempotencyKey,
      outflow: amount,
      expectedReceive: amount,
      expectedReceiveAsset: 'USDC',
      maxFee: '0',
      expiresAt: String(now + 120_000),
      cluster: 'devnet',
    },
  };
}

export function mapTransferRow(row, ownerId) {
  if (!row || typeof row !== 'object') return null;
  const amount = typeof row.amount === 'number' ? String(row.amount) : String(row.amount ?? '');
  if (!AMOUNT.test(amount)) return null;
  const fromOwnerId = row.from_owner_id || row.fromOwnerId;
  const toOwnerId = row.to_owner_id || row.toOwnerId;
  return {
    id: row.id,
    handle: row.handle,
    amount,
    asset: 'USDC',
    botId: row.bot_id || row.botId || null,
    fromOwnerId,
    toOwnerId,
    direction: toOwnerId === ownerId ? 'in' : 'out',
    createdAt: row.created_at || row.createdAt || null,
  };
}

const CODES = new Set([
  'owner_required',
  'invalid_handle',
  'invalid_amount',
  'invalid_bot',
  'idempotency_key_required',
  'idempotency_mismatch',
  'handle_missing',
  'self_transfer',
  'sender_wallet_missing',
  'recipient_wallet_missing',
  'wallet_frozen',
]);

export function transferErrorCode(error) {
  const text = `${error?.body || ''} ${error?.message || ''}`;
  for (const code of CODES) {
    if (text.includes(code)) return code;
  }
  return 'transfer_failed';
}
