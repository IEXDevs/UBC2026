import { SOLANA_PRIVY_CHAIN } from '@ubc2026/contracts/solana';
import { Transaction } from '@solana/web3.js';

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

export function browserSignerHasWallet(signer, wallet) {
  return signer?.ready === true && typeof signer.signTransaction === 'function'
    && (Array.isArray(signer.wallets) ? signer.wallets : []).some(item => typeof item?.address === 'string'
      && item.address.toLowerCase() === wallet?.address?.toLowerCase());
}

export function withLinkedSolanaWallets(wallets, standardWallets, user) {
  const merged = [...wallets];
  const standard = standardWallets.find(wallet => wallet?.features?.['privy:']?.privy?.signTransaction);
  if (!standard) return merged;
  for (const account of user?.linkedAccounts || []) {
    if (account.type !== 'wallet' || account.chainType !== 'solana' || account.walletClientType !== 'privy'
        || account.userCanSign === false || !account.address || merged.some(wallet => wallet.address === account.address)) continue;
    merged.push({
      address: account.address,
      standardWallet: standard,
      signTransaction: ({ transaction, chain, options }) => standard.features['privy:'].privy.signTransaction({
        transaction, address: account.address, chain, options,
      }),
    });
  }
  return merged;
}

export async function waitForBrowserSigner(readSigner, wallets, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const signer = readSigner();
    if (signer?.ready === true && typeof signer.signTransaction === 'function'
        && wallets.every(wallet => signer.wallets?.some(item => item?.address === wallet.address))) return signer;
    if (Date.now() >= deadline) return readSigner();
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
  }
}

export async function signSelectedWalletTransaction({ from, transaction, signer } = {}) {
  if (!from?.address || from.frozen) fail('wallet_frozen');
  if (!(transaction instanceof Uint8Array) || transaction.length <= 64) fail('invalid_transaction');
  const wallets = Array.isArray(signer?.wallets) ? signer.wallets : [];
  const wallet = wallets.find(item => item?.address === from.address)
    || wallets.find(item => typeof item?.address === 'string' && item.address.toLowerCase() === from.address.toLowerCase());
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

export async function signWalletMoveTransaction({ wallets, transaction, signer } = {}) {
  let current = Transaction.from(transaction);
  const message = current.serializeMessage();
  for (const from of wallets) {
    const signed = await signSelectedWalletTransaction({ from, transaction: new Uint8Array(current.serialize({
      requireAllSignatures: false, verifySignatures: false,
    })), signer });
    const next = Transaction.from(signed);
    if (!next.serializeMessage().equals(message)) fail('transaction_mismatch');
    for (const entry of current.signatures) {
      if (entry.signature) next.addSignature(entry.publicKey, entry.signature);
    }
    if (!next.signatures.find(entry => entry.publicKey.toBase58() === from.address)?.signature
        || !next.verifySignatures(false)) fail('invalid_signature');
    current = next;
  }
  if (!current.verifySignatures()) fail('invalid_signature');
  return new Uint8Array(current.serialize());
}
