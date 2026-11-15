'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  installAcceptTermsAuth,
  postAcceptTerms,
  readPrivyCaId,
  resolveAcceptTermsToken,
  resolvePrivyRefreshToken,
} from '../lib/accept-terms-auth.mjs';

if (typeof window !== 'undefined') installAcceptTermsAuth(window);

/**
 * Privy dashboard "require terms" logs the user out on every refresh until
 * accept_terms succeeds. The built-in Accept modal is easy to miss (and the
 * email-code flow skips it), so we POST accept_terms ourselves once the
 * session exists, then reload so hasAcceptedTerms sticks.
 */
export default function AcceptTermsGate({ children }) {
  const { ready, authenticated, user } = usePrivy();
  const [error, setError] = useState('');
  const accepting = useRef(false);

  const signedIn = ready && authenticated && user;
  const needsTerms = Boolean(signedIn && user.hasAcceptedTerms === false);
  const sessionReady = Boolean(signedIn && user.hasAcceptedTerms !== false);

  useEffect(() => {
    if (!sessionReady) {
      document.body.classList.remove('maelstrom-session-ready');
      return undefined;
    }
    document.body.classList.add('maelstrom-session-ready');
    return () => document.body.classList.remove('maelstrom-session-ready');
  }, [sessionReady]);

  useEffect(() => {
    if (!needsTerms || accepting.current) return undefined;
    accepting.current = true;
    setError('');
    let cancelled = false;

    (async () => {
      const result = await postAcceptTerms({
        token: resolveAcceptTermsToken(window),
        refreshToken: resolvePrivyRefreshToken(window),
        appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
        clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
        caId: readPrivyCaId(window.localStorage),
        storages: [window.localStorage, window.sessionStorage],
      });
      if (cancelled) return;
      if (!result.ok) {
        accepting.current = false;
        setError(result.error === 'token_missing'
          ? 'Session token missing. Sign in again.'
          : 'Could not finish sign-in. Refresh or try again.');
        return;
      }
      window.location.reload();
    })().catch(() => {
      if (cancelled) return;
      accepting.current = false;
      setError('Could not finish sign-in. Refresh or try again.');
    });

    return () => {
      cancelled = true;
    };
  }, [needsTerms]);

  return (
    <>
      {children}
      {needsTerms ? (
        <div className="terms-gate" role="status" aria-live="polite">
          <div className="terms-gate__panel">
            <h1 className="terms-gate__title">Finishing sign-in…</h1>
            <p className="terms-gate__copy">
              {error || 'Confirming your session with Privy. This only takes a moment.'}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
