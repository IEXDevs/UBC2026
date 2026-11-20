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

export function browserCanSign(signer, wallet) {
  return browserSignerHasWallet(signer, wallet) || (typeof signer?.signWithOwnerAuthorization === 'function'
    && wallet?.provider === 'privy' && wallet.kind !== 'main' && wallet.spendable !== false && !wallet.frozen
    && !!wallet.id && !/^(linked_|client_)/.test(wallet.id));
}

export function createOwnerAuthorizationSigner({ fetchImpl = fetch, headers, authorize }) {
  return async ({ address, transaction }) => {
    const post = async body => {
      const response = await fetchImpl('/api/wallets/authorize-sign', { method: 'POST',
        headers: typeof headers === 'function' ? await headers() : headers, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || result.error) throw Object.assign(new Error(result.error || 'wallet_owner_authorization_failed'),
        { code: result.error, privyFailure: result.privy });
      return result;
    };
    const encoded = btoa(Array.from(transaction, byte => String.fromCharCode(byte)).join(''));
    const request = await post({ phase: 'request', address, transaction: encoded });
    const { signature } = await authorize(Uint8Array.from(atob(request.payload), char => char.charCodeAt(0)));
    const result = await post({ phase: 'sign', address, transaction: encoded, expiresAt: request.expiresAt, signature });
    const signed = Uint8Array.from(atob(result.signedTransaction), char => char.charCodeAt(0));
    if (signed.length <= 64) fail('invalid_signature');
    return signed;
  };
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
    if (wallets.every(wallet => browserCanSign(signer, wallet))) return signer;
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
  if (from.kind !== 'main' && typeof signer?.signWithOwnerAuthorization === 'function'
      && (!wallet || signer.preferOwnerAuthorization)) {
    try {
      const signed = await signer.signWithOwnerAuthorization({ address: from.address, transaction });
      if (!(signed instanceof Uint8Array) || signed.length <= 64) fail('invalid_signature');
      return signed;
    } catch (error) {
      throw Object.assign(new Error('wallet_owner_authorization_failed'), {
        code: 'wallet_owner_authorization_failed', ...(error?.privyFailure ? { privyFailure: error.privyFailure } : {}),
      });
    }
  }
  if (!wallet || typeof signer?.signTransaction !== 'function') {
    signer?.connectWallet?.(walletConnectionOptions(from));
    fail('wallet_connection_required');
  }
  let signed;
  try {
    signed = wallet.standardWallet && typeof wallet.signTransaction === 'function'
      ? await wallet.signTransaction({ transaction, chain: SOLANA_PRIVY_CHAIN })
      : await signer.signTransaction({ transaction, wallet, chain: SOLANA_PRIVY_CHAIN });
  } catch { fail('wallet_approval_cancelled'); }
  if (!(signed?.signedTransaction instanceof Uint8Array) || signed.signedTransaction.length <= 64) fail('invalid_signature');
  return signed.signedTransaction;
}

export async function signWalletMoveTransaction({ wallets, transaction, signer } = {}) {
  let current = Transaction.from(transaction);
  const message = current.serializeMessage();
  const payer = current.feePayer?.toBase58();
  const ordered = [...wallets.filter(wallet => wallet.address !== payer), ...wallets.filter(wallet => wallet.address === payer)];
  if (new Set(ordered.map(wallet => wallet.address)).size !== current.signatures.length
      || current.signatures.some(entry => !ordered.some(wallet => wallet.address === entry.publicKey.toBase58()))) fail('invalid_signature');
  for (const from of ordered) {
    if (from.address === payer && current.signatures.some(entry => entry.publicKey.toBase58() !== payer && !entry.signature)) {
      fail('invalid_signature');
    }
    const signingContext = from.address !== payer && from.kind !== 'main' && from.provider === 'privy'
      && typeof signer?.signWithOwnerAuthorization === 'function'
      ? { ...signer, preferOwnerAuthorization: true } : signer;
    const signed = await signSelectedWalletTransaction({ from, transaction: new Uint8Array(current.serialize({
      requireAllSignatures: false, verifySignatures: false,
    })), signer: signingContext });
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
