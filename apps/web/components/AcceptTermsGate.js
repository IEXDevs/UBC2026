'use client';

/**
 * Require-terms is off. Do not wrap fetch/storage or POST accept_terms — that
 * fought Privy and wiped sessions on refresh.
 * Previously this marked body.maelstrom-session-ready to hide Privy dialogs
 * after login; that also hid the private-key export / MFA modals. Login
 * leftover chrome is handled by the delayed Privy modal close patches instead.
 */
export default function AcceptTermsGate({ children }) {
  return children;
}
