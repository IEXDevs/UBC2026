/**
 * Privy’s Solana connector reads `wallet.accounts` after `standard:connect`
 * and ignores the accounts that call returns. After a disconnect, Phantom’s
 * connect page often resolves with an empty account list. One silent retry
 * picks up the account Phantom just authorized, and the list is published
 * onto the wallet before Privy checks it.
 *
 * Do not call `provider.disconnect()` before login. That is what opens the
 * Phantom page and leaves Privy with no accounts and no SIWS request.
 */

const CONNECT = 'standard:connect';
let connectRetryBound = false;

function accountsOf(source) {
  const accounts = source?.accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts.filter(account => account && typeof account === 'object');
}

function publishAccounts(wallet, accounts) {
  if (!accounts.length || accountsOf(wallet).length) return;
  try {
    Object.defineProperty(wallet, 'accounts', {
      configurable: true,
      enumerable: true,
      get() {
        return accounts;
      },
    });
  } catch {
    /* a frozen wallet keeps the list it already has */
  }
}

function installConnect(features, feature, wrapped) {
  try {
    feature.connect = wrapped;
    if (feature.connect === wrapped) return true;
  } catch {
    /* frozen connect method */
  }
  try {
    features[CONNECT] = { ...feature, connect: wrapped };
    return features[CONNECT]?.connect === wrapped;
  } catch {
    return false;
  }
}

/**
 * Retry a prompted connect once, silently, when it returns no accounts.
 * @param {object} wallet
 * @returns {boolean}
 */
export function retryEmptySolanaConnect(wallet) {
  const features = wallet?.features;
  const feature = features?.[CONNECT];
  if (!feature || typeof feature.connect !== 'function') return false;
  if (feature.connect.__maelstromSolanaConnect) return true;
  const original = feature.connect.bind(feature);
  const wrapped = async (input) => {
    const first = await original(input);
    let chosen = first;
    const prompted = !input?.silent;
    if (prompted && accountsOf(first).length === 0 && accountsOf(wallet).length === 0) {
      try {
        const again = await original({
          ...(input && typeof input === 'object' ? input : {}),
          silent: true,
        });
        if (accountsOf(again).length > 0 || accountsOf(wallet).length > 0) chosen = again;
      } catch {
        /* the site is still not authorized */
      }
    }
    const accounts = accountsOf(chosen);
    publishAccounts(wallet, accounts.length ? accounts : accountsOf(wallet));
    return chosen;
  };
  Object.defineProperty(wrapped, '__maelstromSolanaConnect', { value: true });
  return installConnect(features, feature, wrapped);
}

/** Patch wallets Privy has now, and any that register afterward. */
export function bindSolanaConnectRetry(getWallets) {
  const api = typeof getWallets === 'function' ? getWallets() : null;
  if (!api || typeof api.get !== 'function') return;
  for (const wallet of api.get() || []) retryEmptySolanaConnect(wallet);
  if (connectRetryBound || typeof api.on !== 'function') return;
  connectRetryBound = true;
  api.on('register', (...wallets) => {
    for (const wallet of wallets) retryEmptySolanaConnect(wallet);
  });
}

/**
 * Sentence for a failed Privy link. Closing the modal is not a failure.
 * @param {{ privyErrorCode?: string } | string | null | undefined} error
 */
export function linkAccountNote(error) {
  const code = typeof error === 'string'
    ? error
    : (typeof error?.privyErrorCode === 'string' ? error.privyErrorCode : '');
  if (code === 'exited_link_flow' || code === 'exited_auth_flow') return '';
  if (code === 'linked_to_another_user') {
    return 'That wallet already belongs to another account. Sign in with it instead.';
  }
  return 'That wallet could not be linked. If it already belongs to another account, sign in with it instead.';
}

/** Open Privy’s Solana link modal. The connector retries an empty connect. */
export async function connectSolanaWallet(linkWallet) {
  if (typeof linkWallet !== 'function') return undefined;
  return linkWallet({ walletChainType: 'solana-only' });
}
