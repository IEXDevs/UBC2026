'use client';

import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { installAcceptTermsAuth } from '../lib/accept-terms-auth.mjs';

if (typeof window !== 'undefined') installAcceptTermsAuth(window);

/**
 * Once Privy has a user, the login modal must not stay up. The email-code
 * screen says "Success!" and then waits on terms or wallet creation, which
 * never returns to this shell. Hide that dialog as soon as the session exists.
 */
export default function AcceptTermsGate({ children }) {
  const { ready, authenticated } = usePrivy();
  const signedIn = ready && authenticated;

  useEffect(() => {
    if (!signedIn) return undefined;
    document.body.classList.add('maelstrom-session-ready');
    return () => document.body.classList.remove('maelstrom-session-ready');
  }, [signedIn]);

  return children;
}
