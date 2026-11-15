/** Unsigned visitors with Privy configured see only the sign-in page. */
export function showSignInGate({ privyConfigured, ready, authenticated }) {
  if (privyConfigured !== true) return false;
  return !(ready === true && authenticated === true);
}
