import { SOLANA_PRIVY_CHAIN } from '@ubc2026/contracts/solana';

function fail(code) {
  throw Object.assign(new Error(code), { code });
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
