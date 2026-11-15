'use client';

import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { installAcceptTermsAuth } from '../lib/accept-terms-auth.mjs';

if (typeof window !== 'undefined') installAcceptTermsAuth(window);

/**
 * Require-terms is off in the Privy dashboard, so we do not POST accept_terms
 * or block the shell. This only marks the body when a Privy session is live
 * (CSS hides leftover Privy dialog chrome after login).
 */
export default function AcceptTermsGate({ children }) {
  const { ready, authenticated, user } = usePrivy();
  const sessionReady = Boolean(ready && authenticated && user);

  useEffect(() => {
    if (!sessionReady) {
      document.body.classList.remove('maelstrom-session-ready');
      return undefined;
    }
    document.body.classList.add('maelstrom-session-ready');
    return () => document.body.classList.remove('maelstrom-session-ready');
  }, [sessionReady]);

  return children;
}
