import { normalizeHandle } from '@ubc2026/contracts';
import { stampSpendPermission } from './harness-run.mjs';
import { formatBaseUnits, shortAddress } from './money-views.mjs';
import { toolAccessRequest } from './spend-permission.mjs';
import { txReceiptFromResult } from './tx-receipt.mjs';

const COMMAND = /^(?:(?:can|could|would) you +)?(?:please +)?(?:send|pay|transfer) +([0-9]+(?:\.[0-9]+)?) +sol +to +(@[a-z0-9_]+)(?: +on +(?:solana +)?devnet)?(?: +please)?[.!?]?$/i;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function parseSolHandleSend(message) {
  if (typeof message !== 'string') return null;
  const match = message.trim().match(COMMAND);
  if (!match) return null;
  const handle = normalizeHandle(match[2]);
  const [whole, fraction = ''] = match[1].split('.');
  if (!handle || whole.length > 11 || fraction.length > 9) return { handle, amount: null };
  const units = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  return { handle, amount: units > 0n && units <= 18446744073709551615n ? units.toString() : null };
}

function sendFailure(result) {
  if (result.error === 'desk_locked') return 'Unlock the wallet desk before sending SOL.';
  if (result.error === 'recipient_address_missing') return 'The recipient wallet changed. Look up the handle again before sending.';
  if (result.error === 'asset_transfer_unavailable') return 'SOL transfers are not available right now.';
  if (result.reason === 'spend-frozen') return 'That wallet or agent is frozen.';
  if (result.reason === 'accounting-asset-mismatch') return 'This agent needs a SOL spending budget to send SOL.';
  if (result.state === 'approval-needed' && result.reason) return 'This send exceeds the agent’s spending limit.';
  return 'I couldn’t confirm the SOL transfer. Check your wallet history before trying again.';
}

export async function runSolHandleSend({ handle, amount }, { botId, invoke, spend }) {
  if (!handle) return { reply: 'Enter a valid Maelstrom @handle.' };
  if (!amount) return { reply: 'Enter a valid SOL amount greater than zero, with up to nine decimal places.' };

  const lookup = await invoke('lookup_recipient', { q: `@${handle}` });
  if (lookup.error === 'login_required') return { reply: 'Sign in again before sending SOL.' };
  if (lookup.error === 'ambiguous_handle') return { reply: `Several accounts match @${handle}. Enter the exact handle.` };
  if (lookup.error) return { reply: `I couldn’t look up @${handle}. Try again in a moment.` };
  const recipient = lookup.recipient;
  if (recipient?.missing === true) return { reply: `I couldn’t find @${handle} on Maelstrom.` };
  const resolved = normalizeHandle(recipient?.handle);
  if (recipient?.kind !== 'handle' || !resolved || !ADDRESS.test(recipient.address || '')) {
    return { reply: `@${handle} doesn’t have a wallet I can send SOL to.` };
  }

  const name = 'request_spend';
  const args = { botId, action: 'spend', amount, asset: 'SOL', handle: resolved, destination: recipient.address };
  const stamped = stampSpendPermission(name, args, spend);
  const amountLabel = `${formatBaseUnits(amount, 9)} SOL`;
  if (!stamped.confirmed) {
    const hold = toolAccessRequest(spend.permissionMode, name, args, spend.reviewCap);
    const label = `Send ${amountLabel} to @${resolved} (${shortAddress(recipient.address)}) on Solana devnet, plus the network fee`;
    return { reply: label, hold: { ...hold, label, prompt: `${label}. Slide to confirm.` } };
  }

  const result = await invoke(name, stamped);
  const receipt = result.signed === true && result.cluster === 'devnet' ? txReceiptFromResult(result) : null;
  return { reply: receipt ? `Sent ${amountLabel} to @${resolved} on Solana devnet. ${receipt.url}` : sendFailure(result) };
}
