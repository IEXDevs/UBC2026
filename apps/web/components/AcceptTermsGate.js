'use client';

import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

/**
 * Require-terms is off. Do not wrap fetch/storage or POST accept_terms — that
 * fought Privy and wiped sessions on refresh. Only mark when a session is live
 * so CSS can hide leftover Privy dialog chrome.
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
