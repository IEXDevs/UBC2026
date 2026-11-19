/**
 * A leftover injected session makes Privy sign in with the previous address.
 * SIWS then fails inside the modal as "Could not log in with wallet".
 * Disconnect the known providers before the next login and after logout.
 */

const PROVIDER_PATHS = Object.freeze([
  ['phantom', 'solana'],
  ['solflare'],
  ['backpack'],
  ['solana'],
]);

function providerAt(target, path) {
  let current = target;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = current[key];
  }
  return current && typeof current === 'object' ? current : null;
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

/** Drop a stale injected session, then open Privy’s Solana link modal. */
export async function connectSolanaWallet(linkWallet, target = globalThis) {
  await releaseInjectedSolanaWallets(target);
  if (typeof linkWallet !== 'function') return undefined;
  return linkWallet({ walletChainType: 'solana-only' });
}

/** Disconnect each distinct injected Solana provider. Failures are ignored. */
export async function releaseInjectedSolanaWallets(target = globalThis) {
  const seen = new Set();
  for (const path of PROVIDER_PATHS) {
    const provider = providerAt(target, path);
    if (!provider || seen.has(provider) || typeof provider.disconnect !== 'function') continue;
    seen.add(provider);
    try {
      await provider.disconnect();
    } catch {
      /* locked or already disconnected */
    }
  }
}
