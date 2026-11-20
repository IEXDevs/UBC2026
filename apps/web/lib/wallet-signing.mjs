import { SOLANA_PRIVY_CHAIN } from '@ubc2026/contracts/solana';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

export function serverSignsWallet(wallet) {
  if (!wallet || wallet.frozen === true) return false;
  const id = typeof wallet.id === 'string' ? wallet.id : '';
  if (!id || id.startsWith('linked_') || id.startsWith('client_')) return false;
  if (wallet.spendable !== false) return true;
  const client = wallet.walletClientType || wallet.wallet_client_type || '';
  return client === 'privy' || client === 'privy-v2';
}

export function walletConnectionOptions(wallet) {
  return {
    walletChainType: 'solana-only',
    description: `Connect ${wallet.label || 'the selected wallet'} to approve its actions. Select the account matching its address.`,
  };
}

export async function signSelectedWalletTransaction({ from, transaction, signer } = {}) {
  if (!from?.address || from.frozen) fail('wallet_frozen');
  if (!(transaction instanceof Uint8Array) || transaction.length <= 64) fail('invalid_transaction');
  const wallet = (Array.isArray(signer?.wallets) ? signer.wallets : []).find(item => item?.address === from.address);
  if (!wallet || typeof signer?.signTransaction !== 'function') {
    signer?.connectWallet?.(walletConnectionOptions(from));
    fail('wallet_connection_required');
  }
  let signed;
  try {
    signed = await signer.signTransaction({ transaction, wallet, chain: SOLANA_PRIVY_CHAIN });
  } catch { fail('wallet_approval_cancelled'); }
  if (!(signed?.signedTransaction instanceof Uint8Array) || signed.signedTransaction.length <= 64) fail('invalid_signature');
  return signed.signedTransaction;
}
