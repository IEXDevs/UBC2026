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
