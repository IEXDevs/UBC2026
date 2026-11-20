/**
 * Plan a mainnet-beta USDC send to an owner the SNS proxy already returned.
 * This file does not look up domains.
 */
import { normalizeSnsName } from '@ubc2026/sns';

const AMOUNT = /^[1-9][0-9]{0,39}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function planSnsSend({ domain, address, amount, wallet, env = {} } = {}) {
  let name;
  try {
    const raw = typeof domain === 'string' ? domain.trim().replace(/^@/, '') : '';
    name = normalizeSnsName(raw);
  } catch {
    return { error: 'invalid_domain' };
  }
  if (typeof address !== 'string' || !BASE58.test(address)) return { error: 'sns_not_found', domain: name };
  if (typeof amount !== 'string' || !AMOUNT.test(amount)) return { error: 'invalid_amount', domain: name, address };
  if (!wallet || wallet.kind !== 'main' || wallet.provider !== 'privy' || typeof wallet.address !== 'string') {
    return { error: 'wallet_required', domain: name, address };
  }
  if (wallet.address === address) return { error: 'invalid_destination', domain: name, address };
  const missing = [];
  for (const key of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'SOLANA_RPC_URL']) {
    const value = typeof env[key] === 'string' ? env[key].trim() : '';
    const pub = key === 'PRIVY_APP_ID' && typeof env.NEXT_PUBLIC_PRIVY_APP_ID === 'string'
      ? env.NEXT_PUBLIC_PRIVY_APP_ID.trim()
      : '';
    if (!value && !pub) missing.push(key);
  }
  if (missing.length > 0) {
    return { error: 'missing_config', missing, domain: name, address };
  }
  return {
    domain: name,
    address,
    amount,
    wallet,
    memo: `maelstrom:sns:${name}`,
  };
}
